import { digestArtifact } from "./audit-events.ts";

const FIGMA_FILE_KEY = /^[A-Za-z0-9_-]{6,256}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;

export interface FigmaDestination {
  fileKey: string;
  fileUrl: string;
}

export interface FigmaBackupGrant extends FigmaDestination {
  runId: string;
  productPrDigest: string;
  grantDigest: string;
  authorizedBy: string;
  authorizedAt: string;
}

export class FigmaDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FigmaDestinationError";
  }
}

/**
 * Resolve a human-supplied Figma file URL to an exact, stable destination.
 * Node/query/hash state is deliberately removed because the grant authorizes
 * one file, never an agent-selected node or a different file reached by a URL.
 */
export function normalizeFigmaDestination(rawUrl: string, suppliedFileKey?: string): FigmaDestination {
  const value = rawUrl.trim();
  if (!value || value.length > 2_048) {
    throw new FigmaDestinationError("Figma fileUrl must be between 1 and 2048 characters.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new FigmaDestinationError("Figma fileUrl must be a valid HTTPS Figma file URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    (parsed.hostname !== "figma.com" && parsed.hostname !== "www.figma.com") ||
    parsed.port ||
    parsed.username ||
    parsed.password
  ) {
    throw new FigmaDestinationError("Figma fileUrl must use https://www.figma.com without credentials or a custom port.");
  }
  const match = parsed.pathname.match(/^\/(design|file)\/([A-Za-z0-9_-]{6,256})(?:\/[^?#]*)?$/);
  if (!match) {
    throw new FigmaDestinationError("Figma fileUrl must identify a Figma design or file document.");
  }
  const fileKey = match[2];
  if (!FIGMA_FILE_KEY.test(fileKey)) {
    throw new FigmaDestinationError("Figma fileKey is invalid.");
  }
  if (suppliedFileKey !== undefined && suppliedFileKey.trim() !== fileKey) {
    throw new FigmaDestinationError("Figma fileKey does not match fileUrl.");
  }
  parsed.hostname = "www.figma.com";
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return { fileKey, fileUrl: parsed.toString() };
}

export async function createFigmaBackupGrant({
  runId,
  productPrDigest,
  fileUrl,
  fileKey,
  authorizedBy,
  authorizedAt = new Date().toISOString(),
}: {
  runId: string;
  productPrDigest: string;
  fileUrl: string;
  fileKey?: string;
  authorizedBy: string;
  authorizedAt?: string;
}): Promise<FigmaBackupGrant> {
  const actor = authorizedBy.trim();
  if (!runId.trim()) throw new FigmaDestinationError("A run id is required for Figma authorization.");
  if (!SHA256.test(productPrDigest)) {
    throw new FigmaDestinationError("Figma authorization must be bound to a lowercase product PR SHA-256 digest.");
  }
  if (!actor || actor.length > 320) {
    throw new FigmaDestinationError("Figma authorization requires an actor identity of at most 320 characters.");
  }
  if (!Number.isFinite(Date.parse(authorizedAt))) {
    throw new FigmaDestinationError("Figma authorizedAt must be a valid timestamp.");
  }
  const destination = normalizeFigmaDestination(fileUrl, fileKey);
  const unsigned = {
    runId: runId.trim(),
    productPrDigest,
    ...destination,
    authorizedBy: actor,
    authorizedAt,
  };
  return { ...unsigned, grantDigest: await digestArtifact(unsigned) };
}

export function sameFigmaBackupGrant(
  stored: Pick<FigmaBackupGrant, "runId" | "productPrDigest" | "fileKey" | "fileUrl">,
  expected: Pick<FigmaBackupGrant, "runId" | "productPrDigest" | "fileKey" | "fileUrl">,
) {
  return (
    stored.runId === expected.runId &&
    stored.productPrDigest === expected.productPrDigest &&
    stored.fileKey === expected.fileKey &&
    stored.fileUrl === expected.fileUrl
  );
}
