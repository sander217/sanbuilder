import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import YAML from "yaml";

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

const portfolio = await readYaml("portfolio.yml");
if (portfolio.schema !== 2) throw new Error("portfolio.yml must use schema 2.");

const brands = [];
const products = [];
const adapters = [];
const contracts = [];
const ids = {
  brands: new Set(),
  products: new Set(),
  adapters: new Set(),
  contracts: new Set(),
};

for (const brandEntry of portfolio.brands ?? []) {
  const configPath = requirePath(brandEntry.path, "portfolio brand path");
  const brand = await readYaml(configPath);
  const brandId = requireSlug(brand.id, `${configPath}.id`);
  if (ids.brands.has(brandId)) throw new Error(`Duplicate brand ${brandId}.`);
  ids.brands.add(brandId);
  const productPaths = (brand.products ?? []).map((entry) => requirePath(entry.path, `${brandId} product path`));
  let designContractId = null;
  if (brand.status === "active") {
    const designContract = requireContract(
      brand.designContract,
      `${brandId}.designContract`,
      "design",
      "brand",
      brandId,
    );
    if (ids.contracts.has(designContract.id)) throw new Error(`Duplicate contract ${designContract.id}.`);
    ids.contracts.add(designContract.id);
    contracts.push(designContract);
    designContractId = designContract.id;
  }
  const tasteProfile = brand.tasteProfile
    ? {
        ref: String(brand.tasteProfile.ref ?? "").trim(),
        path: requirePath(brand.tasteProfile.path, `${brandId}.tasteProfile.path`),
      }
    : null;
  const brandMemoryPath = brand.memory?.path
    ? requirePath(brand.memory.path, `${brandId}.memory.path`)
    : null;
  if (brand.status === "active" && (!tasteProfile?.ref || !tasteProfile?.path)) {
    throw new Error(`Active brand ${brandId} must define a versioned taste profile.`);
  }
  brands.push({
    id: brandId,
    name: String(brand.name ?? brandId),
    status: String(brand.status ?? "onboarding"),
    configPath,
    designContractId,
    tasteProfile,
    memoryPath: brandMemoryPath,
    productIds: [],
    onboarding: brand.onboarding ?? null,
  });

  for (const productPath of productPaths) {
    const product = await readYaml(productPath);
    const productId = requireSlug(product.id, `${productPath}.id`);
    if (ids.products.has(productId)) throw new Error(`Duplicate product ${productId}.`);
    ids.products.add(productId);
    if (product.brand !== brandId) throw new Error(`${productId} must belong to brand ${brandId}.`);
    const status = String(product.status ?? "onboarding");
    const contractIds = { design: product.contracts?.design ?? designContractId, experience: null, qa: null };
    if (status === "active") {
      if (contractIds.design !== designContractId) {
        throw new Error(`${productId} must inherit the active ${brandId} brand design contract.`);
      }
      for (const kind of ["experience", "qa"]) {
        const contract = requireContract(
          product.contracts?.[kind],
          `${productId}.contracts.${kind}`,
          kind,
          "product",
          brandId,
          productId,
        );
        if (ids.contracts.has(contract.id)) throw new Error(`Duplicate contract ${contract.id}.`);
        ids.contracts.add(contract.id);
        contracts.push(contract);
        contractIds[kind] = contract.id;
      }
    }
    const adapterPaths = (product.adapters ?? []).map((entry) => requirePath(entry, `${productId} adapter path`));
    const productRecord = {
      id: productId,
      brandId,
      name: String(product.name ?? productId),
      surface: requireSlug(product.surface, `${productId}.surface`),
      status,
      configPath: productPath,
      memoryPath: product.memory?.path ? requirePath(product.memory.path, `${productId}.memory.path`) : null,
      journeyRouting: journeyRouting(product.routing, `${productId}.routing`, status === "active"),
      contractIds,
      adapterIds: [],
      defaultTarget: product.defaultTarget ?? null,
      onboarding: product.onboarding ?? null,
    };
    products.push(productRecord);
    brands.at(-1).productIds.push(productId);

    for (const adapterPath of adapterPaths) {
      const adapter = await readYaml(adapterPath);
      const adapterId = requireSlug(adapter.id, `${adapterPath}.id`);
      if (ids.adapters.has(adapterId)) throw new Error(`Duplicate adapter ${adapterId}.`);
      ids.adapters.add(adapterId);
      if (adapter.brand !== brandId || adapter.productId !== productId || adapter.surface !== product.surface) {
        throw new Error(`${adapterId} must match ${brandId}/${productId}/${product.surface}.`);
      }
      if (!/^[a-f0-9]{40}$/.test(adapter.verifiedRevision ?? "")) {
        throw new Error(`${adapterId} must pin a full lowercase verifiedRevision.`);
      }
      const environments = adapter.environments ?? {};
      const defaultEnvironment = String(adapter.defaultEnvironment ?? "");
      if (!defaultEnvironment || !environments[defaultEnvironment]) {
        throw new Error(`${adapterId} must declare its default environment.`);
      }
      adapters.push({
        id: adapterId,
        brandId,
        productId,
        surface: product.surface,
        name: String(adapter.product ?? adapterId),
        status: String(adapter.status ?? "reference"),
        configPath: adapterPath,
        repository: String(adapter.repository ?? ""),
        baseBranch: String(adapter.baseBranch ?? ""),
        commit: adapter.verifiedRevision,
        defaultEnvironment,
        environments,
        deliveryEnabled: adapter.delivery?.enabled === true,
        role: adapter.role ?? [],
        capabilities: adapter.capabilities ?? {},
      });
      productRecord.adapterIds.push(adapterId);
    }
    if (status === "active") {
      if (!productRecord.memoryPath || !brandMemoryPath) {
        throw new Error(`Active product ${productId} must define brand and product memory stores.`);
      }
      const target = productRecord.defaultTarget;
      const activeAdapter = adapters.find((adapter) => adapter.id === target?.adapter);
      if (!activeAdapter?.deliveryEnabled || activeAdapter.defaultEnvironment !== target?.environment) {
        throw new Error(`${productId} default target must be a delivery-enabled adapter environment.`);
      }
    }
  }
}

for (const adapterPath of portfolio.workflowAdapters ?? []) {
  const resolvedPath = requirePath(adapterPath, "workflow adapter path");
  const adapter = await readYaml(resolvedPath);
  const adapterId = requireSlug(adapter.id, `${resolvedPath}.id`);
  if (ids.adapters.has(adapterId)) throw new Error(`Duplicate adapter ${adapterId}.`);
  ids.adapters.add(adapterId);
  adapters.push({
    id: adapterId,
    brandId: null,
    productId: null,
    surface: "workflow",
    name: String(adapter.product ?? adapterId),
    status: String(adapter.status ?? "workflow"),
    configPath: resolvedPath,
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

const catalog = {
  schema: 1,
  generatedFrom: "portfolio.yml",
  portfolio: {
    id: requireSlug(portfolio.id, "portfolio.id"),
    name: String(portfolio.name ?? portfolio.id),
    capabilitiesPath: requirePath(portfolio.capabilities?.path, "portfolio.capabilities.path"),
    memoryPolicyPath: requirePath(portfolio.memory?.policy, "portfolio.memory.policy"),
  },
  brands,
  products,
  adapters,
  contracts,
};
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
