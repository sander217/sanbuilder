import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import releaseProvenance from "../config/release-provenance.json" with { type: "json" };

if (
  releaseProvenance?.schemaVersion !== 1 ||
  typeof releaseProvenance.repository !== "string" ||
  !Array.isArray(releaseProvenance.criticalFiles)
) {
  throw new Error("config/release-provenance.json is invalid.");
}

export const HARNESS_RELEASE_REPOSITORY = releaseProvenance.repository;

// These files are the portable coordinator's executable and policy boundary. A
// GitHub-backed install is accepted only when every local byte sequence below
// exists as the same Git blob in one repository commit.
export const HARNESS_RELEASE_CRITICAL_FILES = Object.freeze([...releaseProvenance.criticalFiles]);

const FULL_COMMIT = /^[a-f0-9]{40}$/;
const DEFAULT_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const RELEASE_HISTORY_LIMIT = 12;

function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.error?.message || `git ${args[0]} failed.`;
    throw new Error(detail);
  }
  return result.stdout.trim();
}

function assertNoGitMetadataConcealment(root, criticalFiles) {
  const replacementRefs = runGit(["for-each-ref", "--format=%(refname)", "refs/replace"], root);
  if (replacementRefs) {
    throw new Error("Harness Git checkout contains replacement refs and cannot prove release provenance.");
  }
  const indexed = runGit(["ls-files", "-v", "--", ...criticalFiles], root)
    .split("\n")
    .filter(Boolean);
  const visible = new Map(indexed.map((line) => [line.slice(2), line[0]]));
  for (const relativePath of criticalFiles) {
    if (visible.get(relativePath) !== "H") {
      throw new Error(
        `Harness critical file is missing from the ordinary Git index or uses a concealment flag: ${relativePath}`,
      );
    }
  }
}

function isSafeCriticalPath(relativePath) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) return false;
  const normalized = path.posix.normalize(relativePath.replaceAll("\\", "/"));
  return normalized === relativePath && normalized !== ".." && !normalized.startsWith("../");
}

export function gitBlobSha(content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.byteLength}\0`))
    .update(bytes)
    .digest("hex");
}

async function localCriticalBlobs(root, criticalFiles) {
  const physicalRoot = await realpath(root);
  const entries = await Promise.all(
    criticalFiles.map(async (relativePath) => {
      if (!isSafeCriticalPath(relativePath)) throw new Error(`Invalid Harness critical path: ${relativePath}`);
      const filePath = path.resolve(physicalRoot, relativePath);
      if (!filePath.startsWith(`${physicalRoot}${path.sep}`)) {
        throw new Error(`Harness critical path escapes the plugin root: ${relativePath}`);
      }
      let stats;
      try {
        stats = await lstat(filePath);
      } catch (error) {
        throw new Error(
          `Installed Harness is missing critical file ${relativePath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      if (!stats.isFile()) throw new Error(`Harness critical file must be a regular file: ${relativePath}`);
      return [relativePath, gitBlobSha(await readFile(filePath))];
    }),
  );
  return new Map(entries);
}

function repositoryApiPath(repository) {
  const segments = repository.split("/");
  if (segments.length !== 2 || segments.some((segment) => !/^[A-Za-z0-9_.-]+$/.test(segment))) {
    throw new Error(`Invalid GitHub repository: ${repository}`);
  }
  return segments.map(encodeURIComponent).join("/");
}

function normalizeGitHubOrigin(remoteUrl) {
  const value = remoteUrl.trim();
  let repositoryPath;
  const scpStyle = value.match(/^(?:[^@/:]+@)?github\.com:(.+)$/i);
  if (scpStyle) {
    repositoryPath = scpStyle[1];
  } else {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return undefined;
    }
    if (
      parsed.hostname.toLowerCase() !== "github.com" ||
      !["https:", "ssh:", "git:"].includes(parsed.protocol) ||
      parsed.search ||
      parsed.hash
    ) {
      return undefined;
    }
    repositoryPath = parsed.pathname;
  }
  const normalizedPath = repositoryPath.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  const segments = normalizedPath.split("/");
  if (segments.length !== 2 || segments.some((segment) => !/^[A-Za-z0-9_.-]+$/.test(segment))) {
    return undefined;
  }
  return segments.join("/").toLowerCase();
}

async function githubJson(
  endpoint,
  { apiBase, fetchImpl, token, allowNotFound = false, timeoutMs = 15_000 },
) {
  const url = new URL(endpoint, `${apiBase.replace(/\/$/, "")}/`);
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "design-harness-agent",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  let response;
  try {
    response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(`GitHub provenance request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  // GitHub uses both 404 and 422 for an unresolved commit-ish, depending on
  // whether the ref resembles a SHA or a tag/branch name.
  if (allowNotFound && (response.status === 404 || response.status === 422)) return undefined;
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = typeof payload?.message === "string" ? `: ${payload.message}` : "";
    } catch {
      // Status and rate-limit metadata still provide a deterministic error.
    }
    const remaining = response.headers?.get?.("x-ratelimit-remaining");
    const rateHint = remaining === "0" ? " Set GITHUB_TOKEN or GH_TOKEN to increase the GitHub API limit." : "";
    throw new Error(`GitHub provenance request returned ${response.status}${detail}.${rateHint}`);
  }
  return response.json();
}

function commitIdentity(payload, label) {
  const sha = typeof payload?.sha === "string" ? payload.sha.toLowerCase() : "";
  const treeSha = typeof payload?.commit?.tree?.sha === "string" ? payload.commit.tree.sha.toLowerCase() : "";
  if (!FULL_COMMIT.test(sha) || !FULL_COMMIT.test(treeSha)) {
    throw new Error(`GitHub returned invalid commit metadata for ${label}.`);
  }
  return { sha, treeSha, label };
}

async function readPluginManifest(root) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(root, ".codex-plugin", "plugin.json"), "utf8"));
  } catch (error) {
    throw new Error(
      `Installed Harness plugin manifest is not readable JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    manifest?.name !== "design-harness-agent" ||
    typeof manifest?.version !== "string" ||
    !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,127}$/.test(manifest.version)
  ) {
    throw new Error("Installed Harness plugin manifest has an invalid name or version.");
  }
  return manifest;
}

async function criticalTreeMatches(candidate, localBlobs, githubOptions, repositoryPath) {
  const tree = await githubJson(
    `repos/${repositoryPath}/git/trees/${candidate.treeSha}?recursive=1`,
    githubOptions,
  );
  if (tree?.truncated) {
    throw new Error(`GitHub truncated the release tree for ${candidate.sha}; provenance cannot be verified.`);
  }
  if (!Array.isArray(tree?.tree)) {
    throw new Error(`GitHub returned an invalid release tree for ${candidate.sha}.`);
  }
  const remoteBlobs = new Map(
    tree.tree
      .filter((entry) => entry?.type === "blob" && typeof entry.path === "string" && typeof entry.sha === "string")
      .map((entry) => [entry.path, entry.sha.toLowerCase()]),
  );
  return [...localBlobs].every(([relativePath, localSha]) => remoteBlobs.get(relativePath) === localSha);
}

async function resolveRemoteCommit({
  root,
  criticalFiles,
  repository,
  apiBase,
  fetchImpl,
  token,
  timeoutMs,
}) {
  if (typeof fetchImpl !== "function") throw new Error("This Node runtime does not provide fetch for GitHub provenance.");
  const manifest = await readPluginManifest(root);

  const localBlobs = await localCriticalBlobs(root, criticalFiles);
  const repositoryPath = repositoryApiPath(repository);
  const githubOptions = { apiBase, fetchImpl, token, timeoutMs };
  const repositoryMetadata = await githubJson(`repos/${repositoryPath}`, githubOptions);
  const defaultBranch = repositoryMetadata?.default_branch;
  if (typeof defaultBranch !== "string" || !defaultBranch) {
    throw new Error("GitHub returned no default branch for the Harness repository.");
  }

  const checked = new Set();
  const checkCandidate = async (candidate) => {
    if (checked.has(candidate.sha)) return undefined;
    checked.add(candidate.sha);
    return (await criticalTreeMatches(candidate, localBlobs, githubOptions, repositoryPath)) ? candidate.sha : undefined;
  };
  const loadCommit = async (ref, label, allowNotFound = false) => {
    const payload = await githubJson(
      `repos/${repositoryPath}/commits/${encodeURIComponent(ref)}`,
      { ...githubOptions, allowNotFound },
    );
    return payload ? commitIdentity(payload, label) : undefined;
  };

  const defaultCommit = await loadCommit(defaultBranch, `default branch ${defaultBranch}`);
  const defaultMatch = await checkCandidate(defaultCommit);
  if (defaultMatch) return defaultMatch;

  for (const versionRef of [`v${manifest.version}`, manifest.version]) {
    const taggedCommit = await loadCommit(versionRef, `version ref ${versionRef}`, true);
    if (!taggedCommit) continue;
    const taggedMatch = await checkCandidate(taggedCommit);
    if (taggedMatch) return taggedMatch;
  }

  const history = await githubJson(
    `repos/${repositoryPath}/commits?path=${encodeURIComponent(".codex-plugin/plugin.json")}&per_page=${RELEASE_HISTORY_LIMIT}`,
    githubOptions,
  );
  if (!Array.isArray(history)) throw new Error("GitHub returned invalid Harness release history.");
  for (const payload of history) {
    const historicalCommit = commitIdentity(payload, "plugin manifest history");
    const historicalMatch = await checkCandidate(historicalCommit);
    if (historicalMatch) return historicalMatch;
  }

  throw new Error(
    `Installed Harness critical files do not match a verifiable ${repository} release commit. Reinstall a published plugin version.`,
  );
}

async function assertPublishedCheckoutCommit({
  root,
  commit,
  repository,
  apiBase,
  fetchImpl,
  token,
  timeoutMs,
}) {
  if (typeof fetchImpl !== "function") throw new Error("This Node runtime does not provide fetch for GitHub provenance.");
  const repositoryPath = repositoryApiPath(repository);
  const githubOptions = { apiBase, fetchImpl, token, timeoutMs };
  const exactPayload = await githubJson(
    `repos/${repositoryPath}/commits/${commit}`,
    { ...githubOptions, allowNotFound: true },
  );
  if (!exactPayload) {
    throw new Error(`Harness HEAD ${commit} is not published in ${repository}.`);
  }
  const exactCommit = commitIdentity(exactPayload, `Harness HEAD ${commit}`);
  if (exactCommit.sha !== commit) {
    throw new Error(`GitHub did not resolve the exact Harness HEAD ${commit}.`);
  }

  const branchHeads = await githubJson(
    `repos/${repositoryPath}/commits/${commit}/branches-where-head`,
    githubOptions,
  );
  if (!Array.isArray(branchHeads)) throw new Error("GitHub returned invalid Harness branch reachability metadata.");
  if (branchHeads.length > 0) return exactCommit;

  const repositoryMetadata = await githubJson(`repos/${repositoryPath}`, githubOptions);
  const defaultBranch = repositoryMetadata?.default_branch;
  if (typeof defaultBranch !== "string" || !defaultBranch) {
    throw new Error("GitHub returned no default branch for the Harness repository.");
  }
  const comparison = await githubJson(
    `repos/${repositoryPath}/compare/${commit}...${encodeURIComponent(defaultBranch)}`,
    { ...githubOptions, allowNotFound: true },
  );
  const mergeBase = typeof comparison?.merge_base_commit?.sha === "string"
    ? comparison.merge_base_commit.sha.toLowerCase()
    : undefined;
  if (mergeBase === commit) return exactCommit;

  const manifest = await readPluginManifest(root);
  for (const versionRef of [`v${manifest.version}`, manifest.version]) {
    const taggedPayload = await githubJson(
      `repos/${repositoryPath}/commits/${encodeURIComponent(versionRef)}`,
      { ...githubOptions, allowNotFound: true },
    );
    if (taggedPayload && commitIdentity(taggedPayload, `version ref ${versionRef}`).sha === commit) return exactCommit;
  }
  throw new Error(`Harness HEAD ${commit} is not reachable from a published ${repository} branch or version ref.`);
}

async function resolveCleanCheckoutCommit(
  root,
  { criticalFiles, repository, apiBase, fetchImpl, token, timeoutMs },
) {
  let checkoutRoot;
  try {
    checkoutRoot = runGit(["rev-parse", "--show-toplevel"], root);
  } catch {
    return undefined;
  }
  const [physicalRoot, physicalCheckout] = await Promise.all([realpath(root), realpath(checkoutRoot)]);
  if (physicalRoot !== physicalCheckout) return undefined;

  let origin;
  try {
    origin = runGit(["remote", "get-url", "origin"], root);
  } catch {
    throw new Error(`Harness Git checkout must have origin set to https://github.com/${repository}.git.`);
  }
  if (normalizeGitHubOrigin(origin) !== repository.toLowerCase()) {
    throw new Error(`Harness Git checkout origin must resolve to ${repository}.`);
  }
  assertNoGitMetadataConcealment(root, criticalFiles);
  const commit = runGit(["rev-parse", "--verify", "HEAD^{commit}"], root).toLowerCase();
  if (!FULL_COMMIT.test(commit)) throw new Error("Harness Git checkout did not resolve a full commit SHA.");
  const changes = runGit(["status", "--porcelain=v1", "--untracked-files=all"], root);
  const unsafeChanges = changes
    .split("\n")
    .filter(Boolean)
    .filter((line) => !/^\?\? \.in_use(?:\/|$)/.test(line));
  if (unsafeChanges.length > 0) {
    throw new Error("The installed Harness contains uncommitted files and cannot produce a reproducible contract lock.");
  }
  const candidate = await assertPublishedCheckoutCommit({
    root,
    commit,
    repository,
    apiBase,
    fetchImpl,
    token,
    timeoutMs,
  });
  const localBlobs = await localCriticalBlobs(root, criticalFiles);
  const repositoryPath = repositoryApiPath(repository);
  const matches = await criticalTreeMatches(
    candidate,
    localBlobs,
    { apiBase, fetchImpl, token, timeoutMs },
    repositoryPath,
  );
  if (!matches) {
    throw new Error(`Harness critical files do not match published HEAD ${commit}.`);
  }
  return commit;
}

export async function resolveHarnessReleaseCommit({
  root,
  criticalFiles = HARNESS_RELEASE_CRITICAL_FILES,
  repository = HARNESS_RELEASE_REPOSITORY,
  apiBase = DEFAULT_API_BASE,
  fetchImpl = globalThis.fetch,
  token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
  timeoutMs = 15_000,
} = {}) {
  if (!root) throw new Error("Harness plugin root is required for release provenance.");
  const checkoutCommit = await resolveCleanCheckoutCommit(root, {
    criticalFiles,
    repository,
    apiBase,
    fetchImpl,
    token,
    timeoutMs,
  });
  if (checkoutCommit) return checkoutCommit;
  return resolveRemoteCommit({ root, criticalFiles, repository, apiBase, fetchImpl, token, timeoutMs });
}
