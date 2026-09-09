import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const FULL_COMMIT = /^[a-f0-9]{40}$/;
const PACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GITHUB_GIT_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/;

function parsePortableMapping(source, label) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    if (indent % 2 !== 0 || rawLine.trimStart().startsWith("- ")) {
      throw new Error(`${label}:${index + 1} must use two-space mapping indentation without lists.`);
    }
    const match = rawLine.trim().match(/^([A-Za-z][A-Za-z0-9]*):(?:\s+(.*))?$/);
    if (!match) throw new Error(`${label}:${index + 1} is not a portable mapping entry.`);
    while (stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1)?.value;
    if (!parent) throw new Error(`${label}:${index + 1} has invalid indentation.`);
    const [, key, rawValue] = match;
    if (Object.hasOwn(parent, key)) throw new Error(`${label}:${index + 1} repeats ${key}.`);
    if (rawValue === undefined || rawValue === "") {
      parent[key] = {};
      stack.push({ indent, value: parent[key] });
      continue;
    }
    const value = rawValue.replace(/^(["'])(.*)\1$/, "$2");
    parent[key] = value === "true" ? true : value === "false" ? false : /^\d+$/.test(value) ? Number(value) : value;
  }
  return root;
}

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
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git exited ${result.status}`);
  }
  return result.stdout.trim();
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function safeRelativePath(value, label) {
  if (typeof value !== "string" || !value || path.isAbsolute(value)) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (normalized !== value || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label} escapes the contract pack.`);
  }
  return normalized;
}

export function normalizeRepository(value) {
  if (typeof value !== "string") throw new Error("Contract pack repository must be a string.");
  const normalized = value
    .trim()
    .replace(/^git@github\.com:/, "")
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    throw new Error(`Invalid GitHub repository: ${value}`);
  }
  return normalized;
}

export function validatePackDefinition(pack) {
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) throw new Error("Contract pack must be an object.");
  if (!PACK_ID.test(pack.id ?? "")) throw new Error(`Invalid contract pack id: ${String(pack.id)}`);
  if (!GITHUB_GIT_URL.test(pack.repository ?? "")) {
    throw new Error(`${pack.id} must use an explicit GitHub HTTPS Git URL.`);
  }
  if (pack.baseBranch !== "main") throw new Error(`${pack.id} must use main as its reviewed base branch.`);
  if (!FULL_COMMIT.test(pack.revision ?? "")) throw new Error(`${pack.id} must pin a full Git commit.`);
  if (!Array.isArray(pack.requiredPaths) || pack.requiredPaths.length === 0) {
    throw new Error(`${pack.id} must declare requiredPaths.`);
  }
  const requiredPaths = pack.requiredPaths.map((entry, index) =>
    safeRelativePath(entry, `${pack.id}.requiredPaths[${index}]`),
  );
  if (new Set(requiredPaths).size !== requiredPaths.length) throw new Error(`${pack.id} requiredPaths must be unique.`);
  return { ...pack, requiredPaths };
}

export function validateContractPackConfig(config) {
  if (config?.schemaVersion !== 1 || !Array.isArray(config.packs)) {
    throw new Error("Invalid contract pack configuration.");
  }
  const ids = new Set();
  const repositories = new Set();
  const packs = config.packs.map((pack) => {
    const validated = validatePackDefinition(pack);
    const repository = normalizeRepository(validated.repository).toLowerCase();
    if (ids.has(validated.id)) throw new Error(`Duplicate contract pack id: ${validated.id}`);
    if (repositories.has(repository)) throw new Error(`Duplicate contract pack repository: ${repository}`);
    ids.add(validated.id);
    repositories.add(repository);
    return validated;
  });
  const environmentVariable = config.cache?.environmentVariable ?? "DESIGN_HARNESS_CONTRACT_CACHE";
  const defaultDirectory = config.cache?.defaultDirectory ?? ".cache/design-harness-agent/contract-packs";
  if (!/^[A-Z][A-Z0-9_]*$/.test(environmentVariable)) throw new Error("Invalid contract cache environment variable.");
  safeRelativePath(defaultDirectory, "contract cache defaultDirectory");
  return { ...config, cache: { environmentVariable, defaultDirectory }, packs };
}

export function contractPackCacheRoot(config, override) {
  const selected = override || process.env[config.cache.environmentVariable];
  return path.resolve(selected || path.join(os.homedir(), config.cache.defaultDirectory));
}

async function nearestExistingPath(candidate) {
  let current = candidate;
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

export async function assertExternalContractCache(cacheRoot, forbiddenRoot) {
  if (!path.isAbsolute(cacheRoot)) throw new Error("Contract pack cache must be absolute.");
  const ancestor = await nearestExistingPath(cacheRoot);
  const physicalAncestor = await realpath(ancestor);
  const physicalCache = path.resolve(physicalAncestor, path.relative(ancestor, cacheRoot));
  if (forbiddenRoot) {
    const physicalForbidden = await realpath(forbiddenRoot);
    if (isWithin(physicalForbidden, physicalCache)) {
      throw new Error("Contract pack cache must remain outside the Harness repository.");
    }
  }
  const probe = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: physicalAncestor,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  });
  if (probe.status === 0) {
    const worktree = await realpath(probe.stdout.trim());
    if (isWithin(worktree, physicalCache)) {
      throw new Error(`Contract pack cache must not be inside a Git worktree: ${worktree}`);
    }
  }
}

function gitBlobSha(content) {
  return createHash("sha1")
    .update(Buffer.from(`blob ${content.byteLength}\0`))
    .update(content)
    .digest("hex");
}

function assertNoGitConcealment(root) {
  if (runGit(["for-each-ref", "--format=%(refname)", "refs/replace"], root)) {
    throw new Error("checkout contains replacement refs");
  }
  const concealed = runGit(["ls-files", "-v"], root)
    .split("\n")
    .filter(Boolean)
    .find((line) => line[0] !== "H");
  if (concealed) throw new Error(`checkout uses a Git concealment flag: ${concealed.slice(2)}`);
}

async function assertPinnedFile(root, revision, relativePath) {
  const physicalRoot = await realpath(root);
  const candidate = path.resolve(physicalRoot, relativePath);
  const info = await lstat(candidate);
  if (!info.isFile()) throw new Error(`required path is not a file: ${relativePath}`);
  const physicalCandidate = await realpath(candidate);
  if (!isWithin(physicalRoot, physicalCandidate)) throw new Error(`required path escapes checkout: ${relativePath}`);
  const expected = runGit(["rev-parse", `${revision}:${relativePath}`], root);
  if (!FULL_COMMIT.test(expected) || runGit(["cat-file", "-t", expected], root) !== "blob") {
    throw new Error(`required path is not a pinned Git blob: ${relativePath}`);
  }
  if (gitBlobSha(await readFile(physicalCandidate)) !== expected) {
    throw new Error(`required path differs from pinned commit: ${relativePath}`);
  }
}

async function findWritablePath(root) {
  const info = await lstat(root);
  if (info.isSymbolicLink()) return null;
  if ((info.mode & 0o222) !== 0) return root;
  if (!info.isDirectory()) return null;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const writable = await findWritablePath(path.join(root, entry.name));
    if (writable) return writable;
  }
  return null;
}

async function makeReadOnly(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await makeReadOnly(entryPath);
      await chmod(entryPath, 0o555);
    } else if (entry.isFile()) {
      const info = await lstat(entryPath);
      await chmod(entryPath, info.mode & 0o111 ? 0o555 : 0o444);
    }
  }
  await chmod(root, 0o555);
}

export async function readContractPackManifest(sourcePath, expected) {
  const manifest = parsePortableMapping(
    await readFile(path.join(sourcePath, "contract-pack.yml"), "utf8"),
    `${expected.id}:contract-pack.yml`,
  );
  if (manifest?.schema !== 1 || manifest.id !== expected.id) throw new Error(`${expected.id} has an invalid manifest.`);
  if (normalizeRepository(manifest.repository) !== normalizeRepository(expected.repository)) {
    throw new Error(`${expected.id} manifest repository does not match its pin.`);
  }
  if (manifest.baseBranch !== expected.baseBranch) throw new Error(`${expected.id} manifest baseBranch does not match its pin.`);
  const catalogPath = safeRelativePath(manifest.catalog?.path, `${expected.id}.catalog.path`);
  const contractRegistryPath = safeRelativePath(manifest.contracts?.registry, `${expected.id}.contracts.registry`);
  const scenarioRegistryPath = safeRelativePath(manifest.scenarios?.registry, `${expected.id}.scenarios.registry`);
  return { ...manifest, catalogPath, contractRegistryPath, scenarioRegistryPath };
}

export async function verifyContractPack(pack, cacheRoot, { requireReadOnly = true } = {}) {
  const sourcePath = path.join(cacheRoot, pack.id, pack.revision);
  try {
    await access(path.join(sourcePath, ".git"));
  } catch {
    return { id: pack.id, status: "missing", sourcePath, revision: pack.revision };
  }
  try {
    assertNoGitConcealment(sourcePath);
    const revision = runGit(["rev-parse", "HEAD^{commit}"], sourcePath);
    if (revision !== pack.revision) throw new Error(`expected ${pack.revision}, found ${revision}`);
    if (normalizeRepository(runGit(["config", "--get", "remote.origin.url"], sourcePath)) !== normalizeRepository(pack.repository)) {
      throw new Error("checkout origin does not match the configured repository");
    }
    if (runGit(["status", "--porcelain=v1", "--untracked-files=all"], sourcePath)) {
      throw new Error("checkout contains local changes");
    }
    for (const requiredPath of pack.requiredPaths) await assertPinnedFile(sourcePath, revision, requiredPath);
    const manifest = await readContractPackManifest(sourcePath, pack);
    if (requireReadOnly) {
      const writable = await findWritablePath(sourcePath);
      if (writable) throw new Error(`checkout is not read-only: ${writable}`);
    }
    return { id: pack.id, status: "ok", sourcePath, revision, manifest };
  } catch (error) {
    return {
      id: pack.id,
      status: "invalid",
      sourcePath,
      revision: pack.revision,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function syncContractPack(pack, cacheRoot) {
  const packRoot = path.join(cacheRoot, pack.id);
  const target = path.join(packRoot, pack.revision);
  const existing = await verifyContractPack(pack, cacheRoot);
  if (existing.status === "ok") return existing;
  if (existing.status === "invalid") throw new Error(`${pack.id} cache is invalid at ${target}: ${existing.error}`);
  await mkdir(packRoot, { recursive: true });
  const temporary = await mkdtemp(path.join(packRoot, ".sync-"));
  try {
    runGit(["init", "-q"], temporary);
    runGit(["remote", "add", "origin", pack.repository], temporary);
    runGit(["fetch", "--depth=1", "origin", pack.revision], temporary);
    runGit(["checkout", "--detach", pack.revision], temporary);
    await rename(temporary, target);
    const verified = await verifyContractPack(pack, cacheRoot, { requireReadOnly: false });
    if (verified.status !== "ok") throw new Error(verified.error || `${pack.id} verification failed`);
    await makeReadOnly(target);
    const readonly = await verifyContractPack(pack, cacheRoot);
    if (readonly.status !== "ok") throw new Error(readonly.error || `${pack.id} read-only verification failed`);
    return readonly;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function readContractPackConfig(configPath) {
  return validateContractPackConfig(JSON.parse(await readFile(configPath, "utf8")));
}

export function packDefinitionFromBinding(binding) {
  if (binding?.schema !== 1 || !binding.contractPack || !binding.target) {
    throw new Error("Design Harness binding must use schema 1 and define contractPack and target.");
  }
  const repository = normalizeRepository(binding.contractPack.repository);
  const id = binding.contractPack.id;
  return validatePackDefinition({
    id,
    repository: `https://github.com/${repository}.git`,
    baseBranch: binding.contractPack.baseBranch ?? "main",
    revision: binding.contractPack.revision,
    requiredPaths: [
      "contract-pack.yml",
      "portfolio.yml",
      "config/product-catalog.generated.json",
      "contracts/registry.yml",
      "scenarios/registry.yml",
    ],
  });
}

export async function readDesignHarnessBinding(bindingPath) {
  const resolvedPath = path.resolve(bindingPath);
  const binding = parsePortableMapping(await readFile(resolvedPath, "utf8"), resolvedPath);
  const pack = packDefinitionFromBinding(binding);
  const requiredTarget = ["brand", "product", "adapter", "environment"];
  for (const key of requiredTarget) {
    if (typeof binding.target[key] !== "string" || !binding.target[key].trim()) {
      throw new Error(`Design Harness binding target.${key} is required.`);
    }
  }
  return { binding, pack };
}
