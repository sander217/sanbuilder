import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";
import {
  assertExternalContractCache,
  contractPackCacheRoot,
  normalizeRepository,
  readContractPackConfig,
  verifyContractPack,
} from "../lib/contract-packs.mjs";

const root = process.cwd();
const outputPath = path.join(root, "config", "product-catalog.generated.json");
const checkOnly = process.argv.includes("--check");

async function readYaml(relativePath) {
  const content = await readFile(path.join(root, relativePath), "utf8");
  const value = YAML.parse(content);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${relativePath} must contain a YAML object.`);
  }
  return value;
}

function requireSlug(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`${label} must be a lowercase hyphenated identifier.`);
  }
  return value;
}

function requirePath(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    path.posix.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value.startsWith("../")
  ) {
    throw new Error(`${label} must be a safe repository-relative path.`);
  }
  return value;
}

function requireContract(contract, label, kind, scope, brandId, productId = null) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    throw new Error(`${label} must define a contract object.`);
  }
  return {
    id: requireSlug(contract.id, `${label}.id`),
    ref: String(contract.ref ?? "").trim(),
    path: requirePath(contract.path, `${label}.path`),
    owner: String(contract.owner ?? "").trim(),
    description: String(contract.description ?? "").trim(),
    kind,
    scope,
    brandId,
    productId,
  };
}

function journeyRouting(value, label, required) {
  const routes = value?.journeys ?? [];
  if (!Array.isArray(routes) || (required && routes.length === 0)) {
    throw new Error(`${label}.journeys must define at least one product journey.`);
  }
  const ids = new Set();
  return routes.map((route, index) => {
    const id = requireSlug(route?.id, `${label}.journeys[${index}].id`);
    if (ids.has(id)) throw new Error(`${label}.journeys contains duplicate ${id}.`);
    ids.add(id);
    if (!Array.isArray(route.keywords) || route.keywords.length === 0) {
      throw new Error(`${label}.journeys[${index}].keywords must be non-empty.`);
    }
    const keywords = route.keywords.map((keyword, keywordIndex) => {
      if (typeof keyword !== "string" || !keyword.trim()) {
        throw new Error(`${label}.journeys[${index}].keywords[${keywordIndex}] must be a non-empty string.`);
      }
      return keyword.normalize("NFKC").trim().toLowerCase();
    });
    if (new Set(keywords).size !== keywords.length) {
      throw new Error(`${label}.journeys[${index}].keywords must be unique.`);
    }
    return { id, keywords };
  });
}

async function addWorkflowAdapters(portfolio, adapters, usedAdapterIds) {
  for (const adapterPath of portfolio.workflowAdapters ?? []) {
    const resolvedPath = requirePath(adapterPath, "workflow adapter path");
    const adapter = await readYaml(resolvedPath);
    const adapterId = requireSlug(adapter.id, `${resolvedPath}.id`);
    if (usedAdapterIds.has(adapterId)) throw new Error(`Duplicate adapter ${adapterId}.`);
    usedAdapterIds.add(adapterId);
    adapters.push({
      id: adapterId,
      brandId: null,
      productId: null,
      surface: "workflow",
      name: String(adapter.product ?? adapterId),
      status: String(adapter.status ?? "workflow"),
      configPath: resolvedPath,
      sourceId: null,
      repository: String(adapter.repository ?? ""),
      baseBranch: String(adapter.baseBranch ?? ""),
      commit: String(adapter.verifiedRevision ?? ""),
      defaultEnvironment: String(adapter.defaultEnvironment ?? "proposal"),
      environments: adapter.environments ?? {},
      deliveryEnabled: false,
      role: adapter.role ?? [],
      capabilities: adapter.capabilities ?? {},
    });
  }
}

async function buildLocalCatalog(portfolio) {
  const brands = [];
  const products = [];
  const adapters = [];
  const contracts = [];
  const ids = { brands: new Set(), products: new Set(), adapters: new Set(), contracts: new Set() };
  for (const brandEntry of portfolio.brands ?? []) {
    const configPath = requirePath(brandEntry.path, "portfolio brand path");
    const brand = await readYaml(configPath);
    const brandId = requireSlug(brand.id, `${configPath}.id`);
    if (ids.brands.has(brandId)) throw new Error(`Duplicate brand ${brandId}.`);
    ids.brands.add(brandId);
    const productPaths = (brand.products ?? []).map((entry) => requirePath(entry.path, `${brandId} product path`));
    let designContractId = null;
    if (brand.status === "active") {
      const designContract = requireContract(brand.designContract, `${brandId}.designContract`, "design", "brand", brandId);
      if (ids.contracts.has(designContract.id)) throw new Error(`Duplicate contract ${designContract.id}.`);
      ids.contracts.add(designContract.id);
      contracts.push({ ...designContract, sourceId: null });
      designContractId = designContract.id;
    }
    const tasteProfile = brand.tasteProfile
      ? { ref: String(brand.tasteProfile.ref ?? "").trim(), path: requirePath(brand.tasteProfile.path, `${brandId}.tasteProfile.path`) }
      : null;
    const brandMemoryPath = brand.memory?.path ? requirePath(brand.memory.path, `${brandId}.memory.path`) : null;
    if (brand.status === "active" && (!tasteProfile?.ref || !tasteProfile?.path)) {
      throw new Error(`Active brand ${brandId} must define a versioned taste profile.`);
    }
    const brandRecord = {
      id: brandId,
      name: String(brand.name ?? brandId),
      status: String(brand.status ?? "onboarding"),
      configPath,
      sourceId: null,
      designContractId,
      tasteProfile,
      memoryPath: brandMemoryPath,
      productIds: [],
      onboarding: brand.onboarding ?? null,
    };
    brands.push(brandRecord);
    for (const productPath of productPaths) {
      const product = await readYaml(productPath);
      const productId = requireSlug(product.id, `${productPath}.id`);
      if (ids.products.has(productId)) throw new Error(`Duplicate product ${productId}.`);
      ids.products.add(productId);
      if (product.brand !== brandId) throw new Error(`${productId} must belong to brand ${brandId}.`);
      const status = String(product.status ?? "onboarding");
      const contractIds = { design: product.contracts?.design ?? designContractId, experience: null, qa: null };
      if (status === "active") {
        if (contractIds.design !== designContractId) throw new Error(`${productId} must inherit ${brandId} design.`);
        for (const kind of ["experience", "qa"]) {
          const contract = requireContract(product.contracts?.[kind], `${productId}.contracts.${kind}`, kind, "product", brandId, productId);
          if (ids.contracts.has(contract.id)) throw new Error(`Duplicate contract ${contract.id}.`);
          ids.contracts.add(contract.id);
          contracts.push({ ...contract, sourceId: null });
          contractIds[kind] = contract.id;
        }
      }
      const productRecord = {
        id: productId,
        brandId,
        name: String(product.name ?? productId),
        surface: requireSlug(product.surface, `${productId}.surface`),
        status,
        configPath: productPath,
        sourceId: null,
        memoryPath: product.memory?.path ? requirePath(product.memory.path, `${productId}.memory.path`) : null,
        journeyRouting: journeyRouting(product.routing, `${productId}.routing`, status === "active"),
        contractIds,
        adapterIds: [],
        defaultTarget: product.defaultTarget ?? null,
        onboarding: product.onboarding ?? null,
      };
      products.push(productRecord);
      brandRecord.productIds.push(productId);
      for (const adapterPath of (product.adapters ?? []).map((entry) => requirePath(entry, `${productId} adapter path`))) {
        const adapter = await readYaml(adapterPath);
        const adapterId = requireSlug(adapter.id, `${adapterPath}.id`);
        if (ids.adapters.has(adapterId)) throw new Error(`Duplicate adapter ${adapterId}.`);
        ids.adapters.add(adapterId);
        if (adapter.brand !== brandId || adapter.productId !== productId || adapter.surface !== product.surface) {
          throw new Error(`${adapterId} must match ${brandId}/${productId}/${product.surface}.`);
        }
        if (!/^[a-f0-9]{40}$/.test(adapter.verifiedRevision ?? "")) throw new Error(`${adapterId} must pin a full commit.`);
        const defaultEnvironment = String(adapter.defaultEnvironment ?? "");
        if (!defaultEnvironment || !adapter.environments?.[defaultEnvironment]) throw new Error(`${adapterId} must declare its default environment.`);
        adapters.push({
          id: adapterId,
          brandId,
          productId,
          surface: product.surface,
          name: String(adapter.product ?? adapterId),
          status: String(adapter.status ?? "reference"),
          configPath: adapterPath,
          sourceId: null,
          repository: String(adapter.repository ?? ""),
          baseBranch: String(adapter.baseBranch ?? ""),
          commit: adapter.verifiedRevision,
          defaultEnvironment,
          environments: adapter.environments,
          deliveryEnabled: adapter.delivery?.enabled === true,
          role: adapter.role ?? [],
          capabilities: adapter.capabilities ?? {},
        });
        productRecord.adapterIds.push(adapterId);
      }
      if (status === "active") {
        if (!productRecord.memoryPath || !brandMemoryPath) throw new Error(`Active product ${productId} needs memory.`);
        const activeAdapter = adapters.find((adapter) => adapter.id === productRecord.defaultTarget?.adapter);
        if (!activeAdapter?.deliveryEnabled || activeAdapter.defaultEnvironment !== productRecord.defaultTarget?.environment) {
          throw new Error(`${productId} default target must be delivery-enabled.`);
        }
      }
    }
  }
  await addWorkflowAdapters(portfolio, adapters, ids.adapters);
  return {
    schema: 1,
    generatedFrom: "portfolio.yml",
    portfolio: {
      id: requireSlug(portfolio.id, "portfolio.id"),
      name: String(portfolio.name ?? portfolio.id),
      capabilitiesPath: requirePath(portfolio.capabilities?.path, "portfolio.capabilities.path"),
      memoryPolicyPath: requirePath(portfolio.memory?.policy, "portfolio.memory.policy"),
    },
    sources: [],
    contractRegistries: [{ sourceId: null, path: "contracts/registry.yml" }],
    scenarioRegistries: [{ sourceId: null, path: "scenarios/registry.yml" }],
    brands,
    products,
    adapters,
    contracts,
  };
}

async function buildExternalCatalog(portfolio) {
  const configPath = requirePath(portfolio.contractPacks?.config, "contractPacks.config");
  const included = portfolio.contractPacks?.include ?? [];
  if (!Array.isArray(included) || included.length === 0 || new Set(included).size !== included.length) {
    throw new Error("portfolio.yml contractPacks.include must contain unique pack ids.");
  }
  const config = await readContractPackConfig(path.join(root, configPath));
  const cacheRoot = contractPackCacheRoot(config);
  await assertExternalContractCache(cacheRoot, root);
  const configured = new Map(config.packs.map((pack) => [pack.id, pack]));
  const sources = [];
  const brands = [];
  const products = [];
  const adapters = [];
  const contracts = [];
  const contractRegistries = [];
  const scenarioRegistries = [];
  const ids = { brands: new Set(), products: new Set(), adapters: new Set(), contracts: new Set() };
  for (const id of included) {
    const pack = configured.get(id);
    if (!pack) throw new Error(`Unknown contract pack ${id}.`);
    const verified = await verifyContractPack(pack, cacheRoot);
    if (verified.status !== "ok") throw new Error(`Contract pack ${id} is ${verified.status}; run npm run sync:contract-packs.`);
    const packCatalog = JSON.parse(await readFile(path.join(verified.sourcePath, verified.manifest.catalogPath), "utf8"));
    if (packCatalog?.schema !== 1 || packCatalog.generatedFrom !== "portfolio.yml" || packCatalog.sources?.length) {
      throw new Error(`${id} must contain a standalone schema-1 product catalog.`);
    }
    if (packCatalog.adapters.some((adapter) => !adapter.brandId || !adapter.productId)) {
      throw new Error(`${id} may contain only product adapters; workflow adapters belong to the Harness core.`);
    }
    if (packCatalog.brands.length !== 1 || verified.manifest.authority?.brand !== packCatalog.brands[0]?.id) {
      throw new Error(`${id} must contain exactly the brand named by contract-pack.yml authority.brand.`);
    }
    const repository = normalizeRepository(pack.repository);
    sources.push({
      id,
      repository,
      baseBranch: pack.baseBranch,
      commit: pack.revision,
      manifestPath: "contract-pack.yml",
      catalogPath: verified.manifest.catalogPath,
    });
    contractRegistries.push({ sourceId: id, path: verified.manifest.contractRegistryPath });
    scenarioRegistries.push({ sourceId: id, path: verified.manifest.scenarioRegistryPath });
    for (const [key, records] of [["brands", brands], ["products", products], ["adapters", adapters], ["contracts", contracts]]) {
      for (const record of packCatalog[key] ?? []) {
        const idSet = ids[key];
        if (idSet.has(record.id)) throw new Error(`Duplicate ${key.slice(0, -1)} ${record.id} across contract packs.`);
        idSet.add(record.id);
        records.push({
          ...record,
          sourceId: id,
          ...(key === "contracts" ? { repository, baseBranch: pack.baseBranch, commit: pack.revision } : {}),
        });
      }
    }
  }
  await addWorkflowAdapters(portfolio, adapters, ids.adapters);
  return {
    schema: 2,
    generatedFrom: "portfolio.yml",
    portfolio: {
      id: requireSlug(portfolio.id, "portfolio.id"),
      name: String(portfolio.name ?? portfolio.id),
      capabilitiesPath: requirePath(portfolio.capabilities?.path, "portfolio.capabilities.path"),
      memoryPolicyPath: requirePath(portfolio.memory?.policy, "portfolio.memory.policy"),
    },
    sources,
    contractRegistries,
    scenarioRegistries,
    brands,
    products,
    adapters,
    contracts,
  };
}

const portfolio = await readYaml("portfolio.yml");
if (![2, 3].includes(portfolio.schema)) throw new Error("portfolio.yml must use schema 2 or 3.");
const catalog = portfolio.schema === 3 ? await buildExternalCatalog(portfolio) : await buildLocalCatalog(portfolio);
const serialized = `${JSON.stringify(catalog, null, 2)}\n`;

if (checkOnly) {
  const existing = await readFile(outputPath, "utf8").catch(() => "");
  if (existing !== serialized) {
    throw new Error("config/product-catalog.generated.json is stale. Run npm run generate:catalog.");
  }
  console.log("Product catalog is current.");
} else {
  await writeFile(outputPath, serialized);
  console.log("Generated config/product-catalog.generated.json.");
}
