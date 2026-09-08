#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const harnessRoot = path.resolve(path.dirname(scriptPath), "..");
const configPath = path.join(harnessRoot, "config", "agent-dependencies.json");

function usage() {
  return [
    "Usage: node scripts/sync-agent-dependencies.mjs <check|sync> [--cache <absolute-path>] [--json]",
    "",
    "check  Verify every dependency exists at its pinned revision.",
    "sync   Fetch missing pinned revisions into the external dependency cache.",
  ].join("\n");
}

function parseArguments(argv) {
  const [mode, ...rest] = argv;
  if (mode === "--help" || mode === "-h") return { help: true };
  if (mode !== "check" && mode !== "sync") {
    throw new Error("The first argument must be check or sync.");
  }

  let cacheOverride;
  let json = false;
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === "--json") {
      json = true;
    } else if (argument === "--cache") {
      cacheOverride = rest[index + 1];
      index += 1;
      if (!cacheOverride) throw new Error("--cache requires a path.");
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return { mode, cacheOverride, json, help: false };
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
    const detail = result.stderr.trim() || result.stdout.trim() || `git exited ${result.status}`;
    throw new Error(detail);
  }
  return result.stdout.trim();
}

function gitBlobSha(content) {
  return createHash("sha1")
    .update(Buffer.from(`blob ${content.byteLength}\0`))
    .update(content)
    .digest("hex");
}

function assertNoGitMetadataConcealment(sourcePath) {
  const replacementRefs = runGit(["for-each-ref", "--format=%(refname)", "refs/replace"], sourcePath);
  if (replacementRefs) throw new Error("checkout contains replacement refs");
  const concealed = runGit(["ls-files", "-v"], sourcePath)
    .split("\n")
    .filter(Boolean)
    .find((line) => line[0] !== "H");
  if (concealed) throw new Error(`checkout uses a Git index concealment flag: ${concealed.slice(2)}`);
}

async function assertRequiredPathMatchesCommit(sourcePath, revision, requiredPath) {
  const physicalRoot = await realpath(sourcePath);
  const candidate = path.resolve(physicalRoot, requiredPath);
  const info = await lstat(candidate);
  if (!info.isFile()) throw new Error(`required path is not a regular file: ${requiredPath}`);
  const physicalCandidate = await realpath(candidate);
  if (!isWithin(physicalRoot, physicalCandidate)) {
    throw new Error(`required path escapes the dependency checkout: ${requiredPath}`);
  }
  const expectedBlob = runGit(["rev-parse", `${revision}:${requiredPath}`], sourcePath);
  if (!/^[a-f0-9]{40}$/.test(expectedBlob) || runGit(["cat-file", "-t", expectedBlob], sourcePath) !== "blob") {
    throw new Error(`required path is not a pinned Git blob: ${requiredPath}`);
  }
  const actualBlob = gitBlobSha(await readFile(physicalCandidate));
  if (actualBlob !== expectedBlob) throw new Error(`required path differs from pinned commit: ${requiredPath}`);
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
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

async function assertExternalCache(cacheRoot) {
  if (!path.isAbsolute(cacheRoot)) throw new Error("Dependency cache path must be absolute.");
  const physicalHarnessRoot = await realpath(harnessRoot);
  const existingAncestor = await nearestExistingPath(cacheRoot);
  const physicalAncestor = await realpath(existingAncestor);
  const physicalCacheRoot = path.resolve(
    physicalAncestor,
    path.relative(existingAncestor, cacheRoot),
  );

  if (isWithin(harnessRoot, cacheRoot) || isWithin(physicalHarnessRoot, physicalCacheRoot)) {
    throw new Error("Dependency cache must not be inside the Harness repository.");
  }

  const probe = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: physicalAncestor,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  if (probe.status === 0) {
    const worktreeRoot = await realpath(path.resolve(probe.stdout.trim()));
    if (isWithin(worktreeRoot, physicalCacheRoot)) {
      throw new Error(`Dependency cache must not be inside a Git worktree: ${worktreeRoot}`);
    }
  }
}

function validateConfig(config) {
  if (config?.schemaVersion !== 1 || !Array.isArray(config.dependencies) || config.dependencies.length === 0) {
    throw new Error("Invalid agent dependency configuration.");
  }

  const ids = new Set();
  for (const dependency of config.dependencies) {
    if (!/^[a-z0-9-]+$/.test(dependency.id ?? "") || ids.has(dependency.id)) {
      throw new Error(`Invalid or duplicate dependency id: ${dependency.id}`);
    }
    ids.add(dependency.id);
    if (dependency.access !== "read-only") {
      throw new Error(`${dependency.id} must declare read-only access.`);
    }
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(dependency.repository ?? "")) {
      throw new Error(`${dependency.id} must use an explicit GitHub Git URL.`);
    }
    if (!/^[0-9a-f]{40}$/.test(dependency.revision ?? "")) {
      throw new Error(`${dependency.id} must pin a full 40-character Git commit SHA.`);
    }
    if (!Array.isArray(dependency.requiredPaths) || dependency.requiredPaths.length === 0) {
      throw new Error(`${dependency.id} must declare requiredPaths.`);
    }
    for (const requiredPath of dependency.requiredPaths) {
      if (typeof requiredPath !== "string" || path.isAbsolute(requiredPath) || requiredPath.split(/[\\/]/).includes("..")) {
        throw new Error(`${dependency.id} has an unsafe required path: ${requiredPath}`);
      }
    }
  }
}

function normalizeRepository(value) {
  return value.replace(/\/+$/, "").replace(/\.git$/, "").toLowerCase();
}

export async function verifyDependency(dependency, cacheRoot, { requireReadOnly = true } = {}) {
  const sourcePath = path.join(cacheRoot, dependency.id, dependency.revision);
  try {
    await access(path.join(sourcePath, ".git"));
  } catch {
    return { id: dependency.id, status: "missing", sourcePath, revision: dependency.revision };
  }

  try {
    assertNoGitMetadataConcealment(sourcePath);
    const revision = runGit(["rev-parse", "HEAD^{commit}"], sourcePath);
    if (revision !== dependency.revision) {
      throw new Error(`expected ${dependency.revision}, found ${revision}`);
    }
    const origin = runGit(["config", "--get", "remote.origin.url"], sourcePath);
    if (normalizeRepository(origin) !== normalizeRepository(dependency.repository)) {
      throw new Error(`origin is ${origin}`);
    }
    const changes = runGit(["status", "--porcelain=v1", "--untracked-files=all"], sourcePath);
    if (changes) throw new Error("checkout contains local changes");
    for (const requiredPath of dependency.requiredPaths) {
      await assertRequiredPathMatchesCommit(sourcePath, revision, requiredPath);
    }
    if (requireReadOnly) {
      const writablePath = await findWritablePath(sourcePath);
      if (writablePath) throw new Error(`checkout is not read-only: ${writablePath}`);
    }
    return { id: dependency.id, status: "ok", sourcePath, revision };
  } catch (error) {
    return {
      id: dependency.id,
      status: "invalid",
      sourcePath,
      revision: dependency.revision,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function makeReadOnly(root) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
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

async function findWritablePath(root) {
  const info = await lstat(root);
  if (info.isSymbolicLink()) return null;
  if ((info.mode & 0o222) !== 0) return root;
  if (!info.isDirectory()) return null;

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const writable = await findWritablePath(path.join(root, entry.name));
    if (writable) return writable;
  }
  return null;
}

async function syncDependency(dependency, cacheRoot) {
  const dependencyRoot = path.join(cacheRoot, dependency.id);
  const target = path.join(dependencyRoot, dependency.revision);
  const existing = await verifyDependency(dependency, cacheRoot);
  if (existing.status === "ok") return existing;
  if (existing.status === "invalid") {
    throw new Error(`${dependency.id} cache is invalid; remove only ${target} and retry: ${existing.error}`);
  }

  await mkdir(dependencyRoot, { recursive: true });
  const temporary = await mkdtemp(path.join(dependencyRoot, `.sync-${dependency.revision.slice(0, 12)}-`));
  try {
    runGit(["init", "--quiet"], temporary);
    runGit(["config", "core.symlinks", "false"], temporary);
    runGit(["remote", "add", "origin", dependency.repository], temporary);
    runGit(["fetch", "--quiet", "--depth=1", "origin", dependency.revision], temporary);
    runGit(["checkout", "--quiet", "--detach", "FETCH_HEAD"], temporary);

    const stagedPath = path.join(cacheRoot, dependency.id, dependency.revision);
    await rename(temporary, stagedPath);
    const verified = await verifyDependency(dependency, cacheRoot, { requireReadOnly: false });
    if (verified.status !== "ok") {
      throw new Error(`${dependency.id} failed verification after sync: ${verified.error ?? verified.status}`);
    }
    await makeReadOnly(stagedPath);
    const readOnly = await verifyDependency(dependency, cacheRoot);
    if (readOnly.status !== "ok") {
      throw new Error(`${dependency.id} failed read-only verification: ${readOnly.error ?? readOnly.status}`);
    }
    return readOnly;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function loadConfig() {
  const source = JSON.parse(await readFile(configPath, "utf8"));
  validateConfig(source);
  return source;
}

function resolveCacheRoot(config, override) {
  const configured =
    override ||
    process.env[config.cache.environmentVariable] ||
    (config.cache.legacyEnvironmentVariable
      ? process.env[config.cache.legacyEnvironmentVariable]
      : undefined);
  return path.resolve(configured || path.join(os.homedir(), config.cache.defaultPath));
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }

    const config = await loadConfig();
    const cacheRoot = resolveCacheRoot(config, options.cacheOverride);
    await assertExternalCache(cacheRoot);
    if (options.mode === "sync") await mkdir(cacheRoot, { recursive: true });

    const results = [];
    for (const dependency of config.dependencies) {
      try {
        results.push(
          options.mode === "sync"
            ? await syncDependency(dependency, cacheRoot)
            : await verifyDependency(dependency, cacheRoot),
        );
      } catch (error) {
        results.push({
          id: dependency.id,
          status: "error",
          revision: dependency.revision,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const ok = results.every((result) => result.status === "ok");
    const output = { mode: options.mode, ok, cacheRoot, dependencies: results };
    if (options.json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      for (const result of results) {
        console.log(`${result.status === "ok" ? "ok" : "error"} ${result.id} ${result.revision}`);
        if (result.sourcePath) console.log(`  ${result.sourcePath}`);
        if (result.error) console.error(`  ${result.error}`);
      }
    }
    if (!ok) process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options?.json) console.error(JSON.stringify({ ok: false, error: message }, null, 2));
    else console.error(`${message}\n\n${usage()}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await main();
}
