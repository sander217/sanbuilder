#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, open, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  assertExternalContractCache,
  contractPackCacheRoot,
  normalizeRepository,
  readContractPackConfig,
  readDesignHarnessBinding,
  syncContractPack,
} from "../lib/contract-packs.mjs";
import {
  approveCoordinatorRun,
  assertStageArtifactContent,
  authorizeFigmaBackup,
  beginCurrentStage,
  completeCurrentStage,
  createCoordinatorRun,
  failCurrentStage,
  upgradeCoordinatorLane,
} from "../lib/coordinator.ts";
import { assertImplementationContinuation } from "../lib/implementation.ts";
import { HARNESS_RELEASE_REPOSITORY, resolveHarnessReleaseCommit } from "../lib/release-provenance.mjs";
import {
  WORKFLOW_STAGE_DEFINITIONS,
  analyzeChangeRequest,
  getWorkflowStageDefinition,
  isWorkflowStage,
} from "../lib/harness.ts";

const scriptPath = fileURLToPath(import.meta.url);
const harnessRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultStore = path.join(os.homedir(), ".local", "state", "design-harness-agent", "runs");
const MUTATION_COMMANDS = new Set([
  "begin",
  "submit",
  "fail",
  "approve",
  "reject",
  "upgrade",
  "authorize-figma",
]);

function usage() {
  return [
    "Usage:",
    "  design-agent-run.mjs start --request <json-file> [--binding <design-harness.yml>] [--store <absolute-path>]",
    "  design-agent-run.mjs status --run <run-id> [--store <absolute-path>]",
    "  design-agent-run.mjs begin --run <run-id> [--store <absolute-path>]",
    "  design-agent-run.mjs submit --run <run-id> --stage <stage> --artifact <json-file> [--store <absolute-path>]",
    "  design-agent-run.mjs fail --run <run-id> --reason <text> [--store <absolute-path>]",
    "  design-agent-run.mjs approve --run <run-id> --proposal-digest <sha256:...> --actor <identity> [--note <text>] [--store <absolute-path>]",
    "  design-agent-run.mjs reject --run <run-id> --proposal-digest <sha256:...> --actor <identity> [--note <text>] [--store <absolute-path>]",
    "  design-agent-run.mjs upgrade --run <run-id> --lane <standard|major> --reason <text> --actor <identity> [--store <absolute-path>]",
    "  design-agent-run.mjs authorize-figma --run <run-id> --file-url <https://www.figma.com/design/...> --actor <identity> [--store <absolute-path>]",
  ].join("\n");
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") return { help: true };
  if (
    ![
      "start",
      "status",
      "begin",
      "submit",
      "fail",
      "approve",
      "reject",
      "upgrade",
      "authorize-figma",
    ].includes(command)
  ) {
    throw new Error(`Unknown command: ${command}`);
  }
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`);
    const key = argument.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
    options[key] = value;
    index += 1;
  }
  return { ...options, help: false };
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
    .join(",")}}`;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function rawContentDigest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(path.resolve(filePath), "utf8"));
  } catch (error) {
    throw new Error(`${label} must be readable JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, filePath);
}

function runDependencyCommand(mode) {
  return spawnSync(process.execPath, [path.join(harnessRoot, "scripts", "sync-agent-dependencies.mjs"), mode, "--json"], {
    cwd: harnessRoot,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}

function ensureAgentDependencies() {
  let result = runDependencyCommand("check");
  if (result.status !== 0) result = runDependencyCommand("sync");
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || "Pinned agent dependencies could not be verified.");
  }
  try {
    const payload = JSON.parse(result.stdout);
    if (!payload.ok) throw new Error("dependency verification returned ok=false");
    return payload;
  } catch (error) {
    throw new Error(`Dependency verification returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function assertExternalStateStore(storeRoot) {
  if (!path.isAbsolute(storeRoot)) throw new Error("Run state store must be an absolute path.");
  const physicalHarness = await realpath(harnessRoot);
  const resolvedStore = path.resolve(storeRoot);
  if (resolvedStore === physicalHarness || resolvedStore.startsWith(`${physicalHarness}${path.sep}`)) {
    throw new Error("Run state store must be outside the installed Harness repository.");
  }
  let cursor = resolvedStore;
  while (true) {
    try {
      await access(cursor);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  const probe = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: cursor,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  });
  if (probe.status === 0) {
    const worktree = await realpath(probe.stdout.trim());
    const physicalStore = path.resolve(worktree, path.relative(cursor, resolvedStore));
    if (physicalStore === worktree || physicalStore.startsWith(`${worktree}${path.sep}`)) {
      throw new Error(`Run state store must not be inside a Git worktree: ${worktree}`);
    }
  }
}

function resolveStore(options) {
  return path.resolve(
    options.store ||
      process.env.DESIGN_HARNESS_AGENT_STATE ||
      process.env.SANBUILDER_AGENT_STATE ||
      defaultStore,
  );
}

function requireOption(options, key, flag) {
  const value = options[key];
  if (!value) throw new Error(`${flag} is required.`);
  return value;
}

function runDirectory(store, runId) {
  if (!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error("Invalid run id.");
  return path.join(store, runId);
}

function mutationLockPath(store, runId) {
  runDirectory(store, runId);
  return path.join(store, ".locks", `${runId}.lock`);
}

async function mutationLockError(runId, lockPath) {
  let owner = "owner metadata is unavailable";
  try {
    const record = JSON.parse(await readFile(lockPath, "utf8"));
    const details = [
      Number.isInteger(record.pid) ? `pid ${record.pid}` : undefined,
      typeof record.hostname === "string" && record.hostname ? `host ${record.hostname}` : undefined,
      typeof record.command === "string" && record.command ? `command ${record.command}` : undefined,
      typeof record.acquiredAt === "string" && record.acquiredAt ? `since ${record.acquiredAt}` : undefined,
    ].filter(Boolean);
    if (details.length > 0) owner = details.join(", ");
  } catch {
    // A process can crash after the O_EXCL create and before owner metadata is
    // fully flushed. The empty/corrupt lock must still fail closed.
  }
  return new Error(
    `Run ${runId} is already mutation-locked (${owner}). No run state was changed by this command. ` +
      `Mutations never steal an existing lock. If the owner crashed, first verify that it is no longer running, ` +
      `then remove only ${lockPath} and retry.`,
  );
}

async function holdMutationLockForTest() {
  if (process.env.NODE_ENV !== "test") return;
  const milliseconds = Number(
    process.env.DESIGN_HARNESS_AGENT_TEST_LOCK_HOLD_MS ??
      process.env.SANBUILDER_AGENT_TEST_LOCK_HOLD_MS ??
      0,
  );
  if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 5_000) {
    throw new Error("DESIGN_HARNESS_AGENT_TEST_LOCK_HOLD_MS must be an integer between 0 and 5000.");
  }
  if (milliseconds > 0) await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withRunMutationLock(store, runId, command, mutate) {
  const lockPath = mutationLockPath(store, runId);
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") throw await mutationLockError(runId, lockPath);
    throw error;
  }

  const owner = {
    schemaVersion: 1,
    runId,
    command,
    pid: process.pid,
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString(),
  };
  try {
    await lock.writeFile(`${JSON.stringify(owner, null, 2)}\n`, { encoding: "utf8" });
    await lock.sync();
    await holdMutationLockForTest();
    return await mutate();
  } finally {
    await lock.close();
    try {
      await unlink(lockPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function loadRun(store, runId) {
  return readJson(path.join(runDirectory(store, runId), "run.json"), "Run state");
}

async function saveRun(store, run) {
  await writeJson(path.join(runDirectory(store, run.id), "run.json"), run);
}

async function saveArtifactContent(store, runId, stage, content) {
  const contentDigest = digest(content);
  const filePath = path.join(runDirectory(store, runId), "artifacts", `${stage}-${contentDigest.slice(7, 19)}.json`);
  await writeJson(filePath, content);
  return { filePath, digest: contentDigest };
}

async function artifactReference(store, run, stage, content, subjectDigest, metadata = {}) {
  const saved = await saveArtifactContent(store, run.id, stage, content);
  return {
    id: randomUUID(),
    runId: run.id,
    stage,
    kind: getWorkflowStageDefinition(stage).output,
    schemaVersion: 1,
    digest: saved.digest,
    mediaType: "application/json",
    uri: saved.filePath,
    createdAt: new Date().toISOString(),
    ...(subjectDigest ? { subjectDigest } : {}),
    metadata,
  };
}

function resolveCatalogTarget(catalog, request, requireDelivery) {
  const requested = request.target ?? {};
  const defaultProduct = catalog.products.find((product) => product.status === "active" && product.defaultTarget);
  if (!defaultProduct?.defaultTarget) throw new Error("The product catalog has no active default target.");
  const adapterId = requested.adapter ?? request.adapterId ?? defaultProduct.defaultTarget.adapter;
  const adapter = catalog.adapters.find((entry) => entry.id === adapterId);
  if (!adapter?.brandId || !adapter?.productId) throw new Error(`${adapterId} is not a product adapter.`);
  const brand = catalog.brands.find((entry) => entry.id === adapter.brandId);
  const product = catalog.products.find((entry) => entry.id === adapter.productId);
  const environment = requested.environment ?? request.environment ?? adapter.defaultEnvironment;
  if (!brand || !product || brand.status !== "active" || product.status !== "active") {
    throw new Error(`${adapter.brandId}/${adapter.productId} is still onboarding and cannot start a run.`);
  }
  const requestedBrand = requested.brand ?? request.brandId;
  const requestedProduct = requested.product ?? request.productId;
  if (requestedBrand && requestedBrand !== brand.id) throw new Error(`${adapterId} does not belong to ${requestedBrand}.`);
  if (requestedProduct && requestedProduct !== product.id) throw new Error(`${adapterId} does not belong to ${requestedProduct}.`);
  if (!adapter.environments?.[environment]) throw new Error(`${adapterId} does not define environment ${environment}.`);
  if (requireDelivery && (!adapter.deliveryEnabled || adapter.environments[environment].writable !== "approval-gated")) {
    throw new Error(`${adapterId}/${environment} is reference-only and cannot create a delivery run.`);
  }
  const contractById = Object.fromEntries(catalog.contracts.map((contract) => [contract.id, contract]));
  const contracts = Object.fromEntries(
    Object.entries(product.contractIds).map(([kind, id]) => [kind, id ? contractById[id] : null]),
  );
  if (!contracts.design || !contracts.experience || !contracts.qa || !brand.tasteProfile || !brand.memoryPath || !product.memoryPath) {
    throw new Error(`${product.id} does not have a complete brand and product contract set.`);
  }
  return { brand, product, adapter, environment, contracts, memoryPolicyPath: catalog.portfolio.memoryPolicyPath };
}

function normalizeRequest(request, runId, now, resolved) {
  const rawPrompt = typeof request.prompt === "string" ? request.prompt : request.request?.prompt;
  const prompt = rawPrompt?.trim();
  if (!prompt) throw new Error("Request JSON must include a non-empty prompt or request.prompt.");
  if (prompt.length > 20_000) throw new Error("Request prompt must be at most 20000 characters.");
  const suppliedSources = Array.isArray(request.sources) ? request.sources : [];
  const sourceKinds = new Set(["prompt", "ticket", "conversation", "screenshot", "figma", "url", "file", "other"]);
  const sources = [
    {
      id: "source-prompt",
      kind: "prompt",
      label: "Change request",
      content: prompt,
      mediaType: "text/plain",
      digest: digest(prompt),
    },
    ...suppliedSources.map((source, index) => {
      if (!source || typeof source !== "object" || (!source.content && !source.uri)) {
        throw new Error(`sources[${index}] must include content or uri.`);
      }
      const kind = source.kind ?? "other";
      if (!sourceKinds.has(kind)) throw new Error(`sources[${index}].kind is invalid.`);
      const expectedDigest = digest(source.content ?? source.uri);
      if (source.digest && !/^sha256:[a-f0-9]{64}$/.test(source.digest)) {
        throw new Error(`sources[${index}].digest must be a lowercase SHA-256 digest.`);
      }
      if (source.content && source.digest && source.digest !== expectedDigest) {
        throw new Error(`sources[${index}].digest does not match its inline content.`);
      }
      return {
        id: source.id ?? `source-${index + 1}`,
        kind,
        label: source.label ?? source.title ?? source.id ?? `Source ${index + 1}`,
        digest: source.digest ?? expectedDigest,
        ...(source.content ? { content: source.content } : {}),
        ...(source.uri ? { uri: source.uri } : {}),
        ...(source.mediaType ? { mediaType: source.mediaType } : {}),
      };
    }),
  ];
  const ids = new Set();
  for (const source of sources) {
    if (typeof source.id !== "string" || !source.id || source.id.length > 120 || ids.has(source.id)) {
      throw new Error(`Source ids must be unique non-empty strings of at most 120 characters: ${String(source.id)}`);
    }
    ids.add(source.id);
    if (typeof source.label !== "string" || !source.label || source.label.length > 240) {
      throw new Error(`Source ${source.id} must have a label of at most 240 characters.`);
    }
  }
  const normalizeList = (value, label) => {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
      throw new Error(`${label} must be an array of non-empty strings.`);
    }
    const normalized = value.map((item) => item.trim());
    if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates.`);
    return normalized;
  };
  const nonGoals = normalizeList(request.nonGoals ?? request.request?.nonGoals ?? [], "nonGoals");
  const acceptanceCriteria = normalizeList(
    request.acceptanceCriteria ?? request.request?.acceptanceCriteria ?? [],
    "acceptanceCriteria",
  );
  const constraintsValue = request.constraints ?? request.request?.constraints;
  const constraints = constraintsValue === undefined ? undefined : normalizeList(constraintsValue, "constraints");
  const title = request.title?.trim() || prompt.split("\n").find((line) => line.trim())?.trim().slice(0, 240);
  if (!title || title.length > 240) throw new Error("Request title must be between 1 and 240 characters.");
  return {
    schemaVersion: 1,
    artifactType: "intake",
    runId,
    target: {
      brand: resolved.brand.id,
      product: resolved.product.id,
      surface: resolved.product.surface,
      adapter: resolved.adapter.id,
      environment: resolved.environment,
      repository: resolved.adapter.repository,
      baseBranch: resolved.adapter.baseBranch,
    },
    request: {
      title,
      prompt,
      nonGoals,
      acceptanceCriteria,
      ...(constraints ? { constraints } : {}),
    },
    sources,
    ...(request.locale ? { locale: request.locale } : {}),
    createdBy: request.createdBy ?? "local-user",
    createdAt: now,
  };
}

async function loadReleasePins(resolved) {
  const dependencies = await readJson(path.join(harnessRoot, "config", "agent-dependencies.json"), "Dependency config");
  const byId = Object.fromEntries(dependencies.dependencies.map((item) => [item.id, item]));
  const productCommit = resolved.adapter.commit;
  if (!/^[a-f0-9]{40}$/.test(productCommit)) throw new Error(`${resolved.adapter.id} must pin a full verifiedRevision commit.`);
  const harnessCommit = await resolveHarnessReleaseCommit({ root: harnessRoot });
  return { byId, productCommit, harnessCommit };
}

async function contractLock(runId, resolved, files) {
  const pins = await loadReleasePins(resolved);
  const [brandConfig, productConfig, design, taste, memoryPolicy, brandMemory, productMemory, experience, qa] = await Promise.all([
    readFile(path.join(files.contractRoot, resolved.brand.configPath), "utf8"),
    readFile(path.join(files.contractRoot, resolved.product.configPath), "utf8"),
    readFile(path.join(files.contractRoot, resolved.contracts.design.path), "utf8"),
    readFile(path.join(files.contractRoot, resolved.brand.tasteProfile.path), "utf8"),
    readFile(path.join(files.memoryPolicyRoot, resolved.memoryPolicyPath), "utf8"),
    readFile(path.join(files.contractRoot, resolved.brand.memoryPath), "utf8"),
    readFile(path.join(files.contractRoot, resolved.product.memoryPath), "utf8"),
    readFile(path.join(files.contractRoot, resolved.contracts.experience.path), "utf8"),
    readFile(path.join(files.contractRoot, resolved.contracts.qa.path), "utf8"),
  ]);
  const contractRef = (relativePath) => `${files.source.repository}:${relativePath}@${files.source.commit}`;
  return {
    runId,
    repository: files.source.repository,
    sourceCommit: files.source.commit,
    harness: { repository: HARNESS_RELEASE_REPOSITORY, commit: pins.harnessCommit },
    brand: { id: resolved.brand.id, ref: contractRef(resolved.brand.configPath), digest: rawContentDigest(brandConfig) },
    productProfile: {
      id: resolved.product.id,
      surface: resolved.product.surface,
      ref: contractRef(resolved.product.configPath),
      digest: rawContentDigest(productConfig),
    },
    design: { ref: `${resolved.contracts.design.ref}:${contractRef(resolved.contracts.design.path)}`, digest: rawContentDigest(design) },
    taste: { ref: `${resolved.brand.tasteProfile.ref}:${contractRef(resolved.brand.tasteProfile.path)}`, digest: rawContentDigest(taste) },
    memory: {
      policy: {
        ref: `${files.memoryPolicySource.repository}:${resolved.memoryPolicyPath}@${files.memoryPolicySource.commit}`,
        digest: rawContentDigest(memoryPolicy),
      },
      brand: { ref: contractRef(resolved.brand.memoryPath), digest: rawContentDigest(brandMemory) },
      product: { ref: contractRef(resolved.product.memoryPath), digest: rawContentDigest(productMemory) },
    },
    experience: { ref: `${resolved.contracts.experience.ref}:${contractRef(resolved.contracts.experience.path)}`, digest: rawContentDigest(experience) },
    productAdapter: { id: resolved.adapter.id, revision: `${resolved.environment}@${pins.productCommit}` },
    product: {
      repository: resolved.adapter.repository,
      baseBranch: resolved.adapter.baseBranch,
      commit: pins.productCommit,
    },
    dependencies: {
      research: {
        repository: "sander217/research-synthesis",
        commit: pins.byId["research-synthesis"].revision,
      },
      sanstudio: { repository: "sander217/sanstudio", commit: pins.byId.sanstudio.revision },
    },
    qaPolicy: { ref: `${resolved.contracts.qa.ref}:${contractRef(resolved.contracts.qa.path)}`, digest: rawContentDigest(qa) },
  };
}

function mergeBindingTarget(request, binding) {
  const aliases = { brand: "brandId", product: "productId", adapter: "adapterId", environment: "environment" };
  const requested = request.target ?? {};
  for (const [key, alias] of Object.entries(aliases)) {
    const existing = requested[key] ?? request[alias];
    if (existing && existing !== binding.target[key]) {
      throw new Error(`Request ${key} conflicts with the Design Harness binding.`);
    }
  }
  return { ...request, target: { ...binding.target } };
}

async function loadBindingContext(bindingPath) {
  if (!bindingPath) return null;
  const { binding, pack } = await readDesignHarnessBinding(bindingPath);
  const config = {
    schemaVersion: 1,
    cache: {
      environmentVariable: "DESIGN_HARNESS_CONTRACT_CACHE",
      defaultDirectory: ".cache/design-harness-agent/contract-packs",
    },
    packs: [pack],
  };
  const cacheRoot = contractPackCacheRoot(config);
  await assertExternalContractCache(cacheRoot, harnessRoot);
  const verified = await syncContractPack(pack, cacheRoot);
  if (verified.manifest.authority?.brand !== binding.target.brand) {
    throw new Error("Design Harness binding brand does not match the contract pack authority.");
  }
  const catalog = await readJson(path.join(verified.sourcePath, verified.manifest.catalogPath), "Contract pack catalog");
  return { binding, pack, verified, catalog };
}

async function resolveContractFiles(catalog, resolved, bindingContext) {
  if (bindingContext) {
    return {
      contractRoot: bindingContext.verified.sourcePath,
      memoryPolicyRoot: bindingContext.verified.sourcePath,
      source: {
        id: bindingContext.pack.id,
        repository: normalizeRepository(bindingContext.pack.repository),
        baseBranch: bindingContext.pack.baseBranch,
        commit: bindingContext.pack.revision,
      },
      memoryPolicySource: {
        repository: normalizeRepository(bindingContext.pack.repository),
        commit: bindingContext.pack.revision,
      },
    };
  }
  const harnessCommit = await resolveHarnessReleaseCommit({ root: harnessRoot });
  if (!resolved.brand.sourceId) {
    return {
      contractRoot: harnessRoot,
      memoryPolicyRoot: harnessRoot,
      source: { id: null, repository: HARNESS_RELEASE_REPOSITORY, baseBranch: "main", commit: harnessCommit },
      memoryPolicySource: { repository: HARNESS_RELEASE_REPOSITORY, commit: harnessCommit },
    };
  }
  const source = catalog.sources?.find((entry) => entry.id === resolved.brand.sourceId);
  if (!source) throw new Error(`Catalog is missing contract source ${resolved.brand.sourceId}.`);
  const config = await readContractPackConfig(path.join(harnessRoot, "config", "contract-packs.json"));
  const pack = config.packs.find((entry) => entry.id === source.id);
  if (!pack || normalizeRepository(pack.repository) !== source.repository || pack.revision !== source.commit) {
    throw new Error(`Contract source ${source.id} does not match the configured immutable pin.`);
  }
  const cacheRoot = contractPackCacheRoot(config);
  await assertExternalContractCache(cacheRoot, harnessRoot);
  const verified = await syncContractPack(pack, cacheRoot);
  return {
    contractRoot: verified.sourcePath,
    memoryPolicyRoot: harnessRoot,
    source,
    memoryPolicySource: { repository: HARNESS_RELEASE_REPOSITORY, commit: harnessCommit },
  };
}

async function completeBuiltInStage(store, run, stage, content, metadata = {}) {
  const started = beginCurrentStage(run);
  const artifact = await artifactReference(store, started, stage, content, undefined, metadata);
  return completeCurrentStage(started, artifact);
}

async function start(options, store) {
  const rawRequest = await readJson(requireOption(options, "request", "--request"), "Design request");
  const bindingContext = await loadBindingContext(options.binding);
  const request = bindingContext ? mergeBindingTarget(rawRequest, bindingContext.binding) : rawRequest;
  const mode = request.mode ?? "delivery";
  if (!["proposal", "delivery", "dry-run"].includes(mode)) {
    throw new Error("Request mode must be proposal, delivery, or dry-run.");
  }
  ensureAgentDependencies();
  const catalog = bindingContext?.catalog ?? await readJson(path.join(harnessRoot, "config", "product-catalog.generated.json"), "Product catalog");
  const resolved = resolveCatalogTarget(catalog, request, mode === "delivery");
  if ((resolved.brand.sourceId ?? null) !== (resolved.product.sourceId ?? null)) {
    throw new Error("Brand and product must come from the same contract pack.");
  }
  const files = await resolveContractFiles(catalog, resolved, bindingContext);
  const id = randomUUID();
  const now = new Date().toISOString();
  const intake = normalizeRequest(request, id, now, resolved);
  let run = createCoordinatorRun({
    id,
    prompt: intake.request.prompt,
    adapterId: resolved.adapter.id,
    environment: resolved.environment,
    mode,
    now,
  });
  run = await completeBuiltInStage(store, run, "intake", intake);
  run = await completeBuiltInStage(
    store,
    run,
    "analyze",
    analyzeChangeRequest(intake.request.prompt, resolved.product.journeyRouting),
  );
  const lock = await contractLock(id, resolved, files);
  run = await completeBuiltInStage(store, run, "compile-contract-lock", lock, {
    immutable: true,
    brandId: lock.brand.id,
    brandDigest: lock.brand.digest,
    productId: lock.productProfile.id,
    productProfileDigest: lock.productProfile.digest,
    tasteProfileRef: lock.taste.ref,
    tasteProfileDigest: lock.taste.digest,
    memoryPolicyDigest: lock.memory.policy.digest,
    brandMemoryDigest: lock.memory.brand.digest,
    productMemoryDigest: lock.memory.product.digest,
    productRepository: lock.product.repository,
    productBaseBranch: lock.product.baseBranch,
    productCommit: lock.product.commit,
    productAdapterRevision: lock.productAdapter.revision,
    qaPolicyRef: lock.qaPolicy.ref,
    qaPolicyDigest: lock.qaPolicy.digest,
    researchCommit: lock.dependencies.research.commit,
    sanstudioCommit: lock.dependencies.sanstudio.commit,
  });
  await saveRun(store, run);
  return run;
}

function subjectDigestFor(run, stage, content) {
  if (stage === "research") return run.artifacts.intake?.digest;
  if (stage === "design-qa" || stage === "implementation") return run.artifacts["build-proposal"]?.digest;
  if (stage === "product-qa") return run.artifacts.implementation?.digest;
  if (stage === "product-pr") return run.artifacts["product-qa"]?.digest;
  if (stage === "figma-backup") return run.artifacts["product-pr"]?.digest;
  if (stage === "build-proposal") {
    const lockDigest = run.artifacts["compile-contract-lock"]?.digest;
    if (content.inputLocks?.contractLock !== lockDigest) {
      throw new Error("Proposal inputLocks.contractLock must match the run contract lock.");
    }
  }
  return undefined;
}

async function submit(options, store) {
  const runId = requireOption(options, "run", "--run");
  const stage = requireOption(options, "stage", "--stage");
  if (!isWorkflowStage(stage)) throw new Error(`Unknown stage: ${stage}`);
  const run = await loadRun(store, runId);
  if (run.currentStage !== stage) throw new Error(`Current stage is ${run.currentStage}, not ${stage}.`);
  if ((run.attempts[stage] ?? 0) < 1) throw new Error(`Run begin before submitting ${stage}.`);
  const content = await readJson(requireOption(options, "artifact", "--artifact"), "Stage artifact");
  let activeRun = run;
  if (stage === "implementation") {
    const candidate = {
      repository: content.repository,
      baseBranch: content.baseBranch,
      baseCommit: content.baseCommit,
      workingBranch: content.workingBranch,
    };
    if (run.implementationTarget) assertImplementationContinuation(run.implementationTarget, candidate);
    else activeRun = { ...run, implementationTarget: candidate };
  }
  const subjectDigest = subjectDigestFor(activeRun, stage, content);
  assertStageArtifactContent(activeRun, stage, content);
  const metadata = {
    ...(stage === "build-proposal" ? { contractLockDigest: run.artifacts["compile-contract-lock"].digest } : {}),
    ...(["research", "design-qa", "implementation", "product-qa", "figma-backup"].includes(stage)
      ? { status: content.status }
      : {}),
    ...(stage === "implementation"
      ? {
          repository: content.repository,
          baseBranch: content.baseBranch,
          baseCommit: content.baseCommit,
          workingBranch: content.workingBranch,
          headCommit: content.headCommit,
          writeStarted: content.writeStarted,
        }
      : {}),
    ...(stage === "product-pr" ? { draft: content.draft } : {}),
    ...(stage === "figma-backup"
      ? {
          productPrDigest: content.productPrDigest,
          ...(content.figma
            ? {
                fileKey: content.figma.fileKey,
                fileUrl: content.figma.fileUrl,
              }
            : {}),
        }
      : {}),
  };
  const artifact = await artifactReference(store, activeRun, stage, content, subjectDigest, metadata);
  const semanticFailure =
    (stage === "research" && content.status === "blocked") ||
    (stage === "implementation" && content.status !== "succeeded") ||
    ((stage === "design-qa" || stage === "product-qa") && content.status === "failed");
  const next = semanticFailure
    ? failCurrentStage(activeRun, `${stage} artifact reported ${String(content.status)}.`, undefined, artifact)
    : completeCurrentStage(activeRun, artifact);
  await saveRun(store, next);
  return next;
}

async function begin(options, store) {
  const run = await loadRun(store, requireOption(options, "run", "--run"));
  let activeRun = run;
  if (run.currentStage === "implementation") {
    const baseCommit = run.artifacts["compile-contract-lock"]?.metadata?.productCommit;
    if (!/^[a-f0-9]{40}$/.test(baseCommit ?? "")) {
      throw new Error("Implementation cannot start without the pinned product base commit.");
    }
    const target = run.implementationTarget ?? {
      repository: run.artifacts["compile-contract-lock"]?.metadata?.productRepository,
      baseBranch: run.artifacts["compile-contract-lock"]?.metadata?.productBaseBranch,
      baseCommit,
      workingBranch: `codex/design-${run.id}`,
    };
    if (typeof target.repository !== "string" || typeof target.baseBranch !== "string") {
      throw new Error("Implementation cannot start without the locked product repository and base branch.");
    }
    if (run.implementationTarget) assertImplementationContinuation(run.implementationTarget, target);
    activeRun = { ...run, implementationTarget: target };
  }
  const next = beginCurrentStage(activeRun);
  await saveRun(store, next);
  return next;
}

async function decide(options, store, action) {
  const run = await loadRun(store, requireOption(options, "run", "--run"));
  const actor = requireOption(options, "actor", "--actor");
  const proposalDigest = requireOption(options, "proposalDigest", "--proposal-digest");
  const decidedAt = new Date().toISOString();
  const note = options.note;
  const approvalDigest = digest({
    runId: run.id,
    action,
    actor,
    proposalDigest,
    contractLockDigest: run.artifacts["compile-contract-lock"]?.digest,
    note: note ?? null,
    decidedAt,
  });
  const next = approveCoordinatorRun(run, {
    action,
    actor,
    proposalDigest,
    approvalDigest,
    ...(note ? { note } : {}),
    decidedAt,
  });
  await saveRun(store, next);
  return next;
}

async function fail(options, store) {
  const run = await loadRun(store, requireOption(options, "run", "--run"));
  if (run.currentStage === "implementation") {
    throw new Error(
      "Implementation failures require a structured implementation-result artifact so writeStarted, files, commits, and the pinned branch remain auditable.",
    );
  }
  const next = failCurrentStage(run, requireOption(options, "reason", "--reason"));
  await saveRun(store, next);
  return next;
}

async function upgrade(options, store) {
  const run = await loadRun(store, requireOption(options, "run", "--run"));
  const requestedLane = requireOption(options, "lane", "--lane").toLowerCase();
  const lane = requestedLane === "standard" ? "Standard" : requestedLane === "major" ? "Major" : undefined;
  if (!lane) throw new Error("--lane must be standard or major.");
  const next = upgradeCoordinatorLane(
    run,
    lane,
    requireOption(options, "reason", "--reason"),
    requireOption(options, "actor", "--actor"),
  );
  await saveRun(store, next);
  return next;
}

async function authorizeFigma(options, store) {
  const run = await loadRun(store, requireOption(options, "run", "--run"));
  const next = await authorizeFigmaBackup(run, {
    fileUrl: requireOption(options, "fileUrl", "--file-url"),
    authorizedBy: requireOption(options, "actor", "--actor"),
    authorizedAt: new Date().toISOString(),
  });
  await saveRun(store, next);
  return next;
}

function outputSummary(run) {
  const definition = WORKFLOW_STAGE_DEFINITIONS[run.currentStage];
  return {
    runId: run.id,
    status: run.status,
    lane: run.lane,
    mode: run.mode,
    currentStage: run.currentStage,
    nextOwner: definition.owner,
    expectedArtifact: definition.output,
    attempts: run.attempts[run.currentStage] ?? 0,
    proposalDigest: run.artifacts["build-proposal"]?.digest,
    approval: run.approval,
    implementationTarget: run.implementationTarget,
    figmaBackupGrant: run.figmaBackupGrant,
    trace: run.trace ?? [],
    warnings: run.warnings,
  };
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    const store = resolveStore(options);
    await assertExternalStateStore(store);
    if (options.command !== "status") await mkdir(store, { recursive: true });
    let run;
    if (options.command === "start") run = await start(options, store);
    if (options.command === "status") run = await loadRun(store, requireOption(options, "run", "--run"));
    if (MUTATION_COMMANDS.has(options.command)) {
      const runId = requireOption(options, "run", "--run");
      run = await withRunMutationLock(store, runId, options.command, async () => {
        if (options.command === "begin") return begin(options, store);
        if (options.command === "submit") return submit(options, store);
        if (options.command === "fail") return fail(options, store);
        if (options.command === "upgrade") return upgrade(options, store);
        if (options.command === "authorize-figma") return authorizeFigma(options, store);
        if (options.command === "approve") return decide(options, store, "approve");
        return decide(options, store, "reject");
      });
    }
    console.log(JSON.stringify({ ok: true, store, run: outputSummary(run) }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  }
}

await main();
