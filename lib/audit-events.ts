export class AuditEventConflictError extends Error {
  readonly status = 500;

  constructor() {
    super("Audit event identity conflicts with a different lifecycle mutation.");
    this.name = "AuditEventConflictError";
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function serializeArtifact(value: unknown) {
  return canonicalJson(value);
}

export async function digestArtifact(value: unknown) {
  return sha256(serializeArtifact(value));
}

export interface RunEventValue {
  id: string;
  runId: string;
  type: string;
  actor: string | null;
  detailJson: string;
  createdAt: string;
}

export async function createRunEvent({
  runId,
  type,
  actor,
  detail = {},
  eventKey,
  createdAt = new Date().toISOString(),
}: {
  runId: string;
  type: string;
  actor: string | null;
  detail?: Record<string, unknown>;
  /** Stable identity of the primary mutation represented by this event. */
  eventKey?: string;
  createdAt?: string;
}): Promise<RunEventValue> {
  const id = eventKey
    ? `event_${(await sha256(serializeArtifact({ runId, type, eventKey }))).slice("sha256:".length)}`
    : crypto.randomUUID();
  return {
    id,
    runId,
    type,
    actor,
    detailJson: serializeArtifact(detail),
    createdAt,
  };
}

export function assertRunEventMatches(
  stored: RunEventValue | undefined,
  event: RunEventValue,
  { compareActor = true }: { compareActor?: boolean } = {},
) {
  if (
    !stored ||
    stored.runId !== event.runId ||
    stored.type !== event.type ||
    (compareActor && stored.actor !== event.actor) ||
    stored.detailJson !== event.detailJson
  ) {
    throw new AuditEventConflictError();
  }
  return stored;
}
