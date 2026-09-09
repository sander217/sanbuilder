import generatedCatalog from "../config/product-catalog.generated.json" with { type: "json" };
import dependencyConfig from "../config/agent-dependencies.json" with { type: "json" };
import releaseProvenance from "../config/release-provenance.json" with { type: "json" };

export type CatalogStatus = "active" | "reference" | "onboarding" | "workflow";

export interface BrandRecord {
  id: string;
  name: string;
  status: CatalogStatus;
  configPath: string;
  sourceId: string | null;
  designContractId: string | null;
  tasteProfile: { ref: string; path: string } | null;
  memoryPath: string | null;
  productIds: string[];
  onboarding: { required?: string[]; evidenceRoots?: string[] } | null;
}

export interface ProductRecord {
  id: string;
  brandId: string;
  name: string;
  surface: string;
  status: CatalogStatus;
  configPath: string;
  sourceId: string | null;
  memoryPath: string | null;
  journeyRouting: Array<{ id: string; keywords: string[] }>;
  contractIds: { design: string | null; experience: string | null; qa: string | null };
  adapterIds: string[];
  defaultTarget: { adapter: string; environment: string } | null;
  onboarding: { required?: string[] } | null;
}

export interface AdapterTarget {
  id: string;
  brandId: string | null;
  productId: string | null;
  surface: string;
  name: string;
  status: CatalogStatus;
  configPath: string;
  sourceId: string | null;
  repository: string;
  baseBranch: string;
  commit: string;
  defaultEnvironment: string;
  environments: Record<string, { baseUrl?: string; writable: boolean | string }>;
  deliveryEnabled: boolean;
  role: string[];
  capabilities: Record<string, unknown>;
}

export interface ContractTarget {
  id: string;
  name: string;
  owner: string;
  description: string;
  repository: string;
  baseBranch: string;
  commit: string;
  sourceId: string | null;
  path: string;
  reference: string;
  kind: "design" | "experience" | "qa";
  scope: "brand" | "product";
  brandId: string;
  productId: string | null;
}

interface ProductCatalog {
  schema: 1 | 2;
  generatedFrom: string;
  portfolio: { id: string; name: string; capabilitiesPath: string; memoryPolicyPath: string };
  sources: Array<{
    id: string;
    repository: string;
    baseBranch: string;
    commit: string;
    manifestPath: string;
    catalogPath: string;
  }>;
  contractRegistries: Array<{ sourceId: string | null; path: string }>;
  scenarioRegistries: Array<{ sourceId: string | null; path: string }>;
  brands: BrandRecord[];
  products: ProductRecord[];
  adapters: AdapterTarget[];
  contracts: Array<{
    id: string;
    ref: string;
    path: string;
    owner: string;
    description: string;
    kind: "design" | "experience" | "qa";
    scope: "brand" | "product";
    brandId: string;
    productId: string | null;
    sourceId: string | null;
    repository?: string;
    baseBranch?: string;
    commit?: string;
  }>;
}

export const PRODUCT_CATALOG = generatedCatalog as unknown as ProductCatalog;
export const BRANDS = PRODUCT_CATALOG.brands;
export const PRODUCTS = PRODUCT_CATALOG.products;
export const CONTRACT_SOURCES = Object.fromEntries(
  (PRODUCT_CATALOG.sources ?? []).map((source) => [source.id, source]),
);

export const CONTRACT_TARGETS = Object.fromEntries(
  PRODUCT_CATALOG.contracts.map((contract) => [
    contract.id,
    {
      id: contract.id,
      name: contract.path.split("/").at(-1) ?? contract.id,
      owner: contract.owner,
      description: contract.description,
      repository: contract.repository ?? releaseProvenance.repository,
      baseBranch: contract.baseBranch ?? "main",
      commit: contract.commit ?? "",
      sourceId: contract.sourceId ?? null,
      path: contract.path,
      reference: contract.ref,
      kind: contract.kind,
      scope: contract.scope,
      brandId: contract.brandId,
      productId: contract.productId,
    } satisfies ContractTarget,
  ]),
) as Record<string, ContractTarget>;

export const CONTRACT_IDS = Object.freeze(Object.keys(CONTRACT_TARGETS));
export type ContractId = string;

export const ADAPTER_TARGETS = Object.fromEntries(
  PRODUCT_CATALOG.adapters.map((adapter) => [adapter.id, adapter]),
) as Record<string, AdapterTarget>;

export const ADAPTER_REVISIONS = Object.fromEntries(
  PRODUCT_CATALOG.adapters.map((adapter) => [adapter.id, `${adapter.baseBranch}@${adapter.commit}`]),
) as Record<string, string>;

export type AdapterId = string;

function dependencyTarget(id: string) {
  const dependency = dependencyConfig.dependencies.find((entry) => entry.id === id);
  if (!dependency) throw new Error(`Missing required agent dependency ${id}.`);
  return {
    repository: dependency.repository.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, ""),
    commit: dependency.revision,
  };
}

export const AGENT_DEPENDENCIES = {
  research: dependencyTarget("research-synthesis"),
  sanstudio: dependencyTarget("sanstudio"),
};

export function isContractId(value: string): value is ContractId {
  return Object.hasOwn(CONTRACT_TARGETS, value);
}

export function getContractDigest(
  lock: { designDigest: string; experienceDigest: string; qaPolicyDigest: string },
  contractId: ContractId,
) {
  const kind = CONTRACT_TARGETS[contractId]?.kind;
  if (kind === "design") return lock.designDigest;
  if (kind === "experience") return lock.experienceDigest;
  if (kind === "qa") return lock.qaPolicyDigest;
  throw new Error(`Unknown design contract ${contractId}.`);
}

export function isAdapterId(value: string): value is AdapterId {
  return Object.hasOwn(ADAPTER_TARGETS, value);
}

export function getBrand(brandId: string) {
  return BRANDS.find((brand) => brand.id === brandId);
}

export function getProduct(productId: string) {
  return PRODUCTS.find((product) => product.id === productId);
}

export function getAdapter(adapterId: string) {
  return ADAPTER_TARGETS[adapterId];
}

export function getCatalogContractsForProduct(productId: string) {
  const product = getProduct(productId);
  if (!product) return [];
  const ids = new Set(Object.values(product.contractIds).filter((id): id is string => Boolean(id)));
  return PRODUCT_CATALOG.contracts.filter((contract) => ids.has(contract.id));
}

export function getProductContractTargets(productId: string) {
  const product = getProduct(productId);
  if (!product || product.status !== "active") {
    throw new Error(`Product ${productId} is not active in the Harness catalog.`);
  }
  const ids = product.contractIds;
  const design = ids.design ? CONTRACT_TARGETS[ids.design] : undefined;
  const experience = ids.experience ? CONTRACT_TARGETS[ids.experience] : undefined;
  const qa = ids.qa ? CONTRACT_TARGETS[ids.qa] : undefined;
  if (!design || !experience || !qa) {
    throw new Error(`Product ${productId} does not have a complete contract set.`);
  }
  return { design, experience, qa };
}

export function resolveRunTarget({
  adapterId,
  environment,
  brandId,
  productId,
  requireDelivery = true,
}: {
  adapterId: string;
  environment: string;
  brandId?: string;
  productId?: string;
  requireDelivery?: boolean;
}) {
  const adapter = getAdapter(adapterId);
  if (!adapter) throw new Error(`Unknown product adapter ${adapterId}.`);
  if (!adapter.brandId || !adapter.productId) {
    throw new Error(`${adapterId} is a workflow dependency, not a product adapter.`);
  }
  const brand = getBrand(adapter.brandId);
  const product = getProduct(adapter.productId);
  if (!brand || !product || brand.status !== "active" || product.status !== "active") {
    throw new Error(`${adapter.brandId}/${adapter.productId} is still onboarding and cannot start a run.`);
  }
  if (brandId && brandId !== brand.id) throw new Error(`${adapterId} does not belong to brand ${brandId}.`);
  if (productId && productId !== product.id) throw new Error(`${adapterId} does not belong to product ${productId}.`);
  const environmentRecord = adapter.environments[environment];
  if (!environmentRecord) throw new Error(`${adapterId} does not define environment ${environment}.`);
  if (requireDelivery && (!adapter.deliveryEnabled || environmentRecord.writable !== "approval-gated")) {
    throw new Error(`${adapterId}/${environment} is reference-only and cannot create a delivery run.`);
  }
  const contracts = getProductContractTargets(product.id);
  if (!brand.tasteProfile) throw new Error(`Brand ${brand.id} has no active taste profile.`);
  if (!brand.memoryPath || !product.memoryPath) {
    throw new Error(`${brand.id}/${product.id} has no complete scoped memory configuration.`);
  }
  return { brand, product, adapter, environment: environmentRecord, contracts };
}

export function getDefaultRunTarget() {
  const product = PRODUCTS.find((entry) => entry.status === "active" && entry.defaultTarget);
  if (!product?.defaultTarget) throw new Error("The Harness has no active default product target.");
  return resolveRunTarget({
    adapterId: product.defaultTarget.adapter,
    environment: product.defaultTarget.environment,
    productId: product.id,
  });
}
