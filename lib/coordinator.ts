import {
  WORKFLOW_STAGE_DEFINITIONS,
  QA_POLICY_GATES,
  analyzeChangeRequest,
  deriveQaReportStatus,
  getNextWorkflowStage,
  getWorkflowStages,
  type ChangeLane,
  type RunStatus,
  type QaCheck,
  type QaPhase,
  type WorkflowArtifactKind,
  type WorkflowStage,
} from "./harness.ts";
import { assertJsonSchema } from "./schema-validation.mjs";
import type { ImplementationTargetIdentity } from "./implementation.ts";
import {
  createFigmaBackupGrant,
  normalizeFigmaDestination,
  sameFigmaBackupGrant,
  type FigmaBackupGrant,
} from "./figma-backup.ts";
import { getDefaultRunTarget, resolveRunTarget } from "./contracts.ts";

export type { FigmaBackupGrant } from "./figma-backup.ts";

export type CoordinatorMode = "proposal" | "delivery" | "dry-run";

export interface ArtifactReference {
  id: string;
  runId: string;
  stage: WorkflowStage;
  kind: WorkflowArtifactKind;
  schemaVersion: 1;
  digest: string;
  mediaType: string;
  uri: string;
  createdAt: string;
  subjectDigest?: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutionGrant {
  approvalDigest: string;
  proposalDigest: string;
  contractLockDigest: string;
  approvedBy: string;
  approvedAt: string;
}

export interface CoordinatorRunState {
  schemaVersion: 1;
  id: string;
  prompt: string;
  adapterId: string;
  environment: string;
  mode: CoordinatorMode;
  lane: ChangeLane;
  status: RunStatus;
  currentStage: WorkflowStage;
  stages: WorkflowStage[];
  attempts: Partial<Record<WorkflowStage, number>>;
  artifacts: Partial<Record<WorkflowStage, ArtifactReference>>;
  approval?: ExecutionGrant;
  implementationTarget?: ImplementationTargetIdentity;
  figmaBackupGrant?: FigmaBackupGrant;
  trace?: RunTraceEntry[];
  warnings: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateCoordinatorRunInput {
  id: string;
  prompt: string;
  adapterId?: CoordinatorRunState["adapterId"];
  environment?: string;
  mode?: CoordinatorMode;
  now?: string;
}

export interface ApprovalDecision {
  action: "approve" | "reject";
  actor: string;
  decidedAt?: string;
  proposalDigest: string;
  approvalDigest: string;
  note?: string;
}

export interface FigmaBackupAuthorization {
  fileUrl: string;
  authorizedBy: string;
  authorizedAt?: string;
}

export interface RunTraceEntry {
  type: "stage-attempt" | "approval-decision" | "lane-upgrade" | "figma-authorization";
  at: string;
  stage?: WorkflowStage;
  attempt?: number;
  outcome?: "started" | "succeeded" | "failed";
  artifactDigest?: string;
  artifactUri?: string;
  reason?: string;
  action?: "approve" | "reject";
  actor?: string;
  proposalDigest?: string;
  decisionDigest?: string;
  note?: string;
  fromLane?: ChangeLane;
  toLane?: ChangeLane;
  fileUrl?: string;
  fileKey?: string;
  productPrDigest?: string;
  grantDigest?: string;
}

export interface StageExecutionContext {
  run: Readonly<CoordinatorRunState>;
  stage: WorkflowStage;
  definition: (typeof WORKFLOW_STAGE_DEFINITIONS)[WorkflowStage];
}

export type StageExecutor = (context: StageExecutionContext) => Promise<ArtifactReference>;

export class CoordinatorInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoordinatorInvariantError";
  }
}

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const STAGE_ARTIFACT_TYPES: Partial<Record<WorkflowStage, string>> = {
  research: "research-report",
  "context-lock": "context-lock",
  "direction-lock": "direction-proposal",
  "design-lock": "design-proposal",
  "production-lock": "production-package",
  "build-proposal": "design-proposal",
  "design-qa": "design-qa-report",
  implementation: "implementation-result",
  "product-qa": "product-qa-report",
  "product-pr": "product-pr",
  "figma-backup": "figma-backup",
};

const STAGE_SCHEMA_FILES: Partial<Record<WorkflowStage, string>> = {
  research: "research-report.schema.json",
  "context-lock": "sanstudio-gate.schema.json",
  "direction-lock": "sanstudio-gate.schema.json",
  "design-lock": "design-proposal.schema.json",
  "production-lock": "sanstudio-gate.schema.json",
  "build-proposal": "design-proposal.schema.json",
  "design-qa": "design-qa-report.schema.json",
  implementation: "implementation-result.schema.json",
  "product-qa": "product-qa-report.schema.json",
  "product-pr": "product-pr.schema.json",
  "figma-backup": "figma-backup.schema.json",
};

function cloneRun(run: CoordinatorRunState): CoordinatorRunState {
  return {
    ...run,
    stages: [...run.stages],
    attempts: { ...run.attempts },
    artifacts: { ...run.artifacts },
    approval: run.approval ? { ...run.approval } : undefined,
    implementationTarget: run.implementationTarget ? { ...run.implementationTarget } : undefined,
    figmaBackupGrant: run.figmaBackupGrant ? { ...run.figmaBackupGrant } : undefined,
    trace: (run.trace ?? []).map((entry) => ({ ...entry })),
    warnings: [...run.warnings],
  };
}

function requireDigest(value: string, label: string) {
  if (!SHA256.test(value)) {
    throw new CoordinatorInvariantError(`${label} must be a lowercase SHA-256 digest.`);
  }
}

function latestArtifact(run: CoordinatorRunState, stage: WorkflowStage) {
  return run.artifacts[stage];
}

function requireArtifact(run: CoordinatorRunState, stage: WorkflowStage) {
  const artifact = latestArtifact(run, stage);
  if (!artifact) throw new CoordinatorInvariantError(`${stage} must produce an artifact before this transition.`);
  return artifact;
}

function requireNonBlockingQa(artifact: ArtifactReference, label: string) {
  if (artifact.metadata?.status !== "passed" && artifact.metadata?.status !== "review") {
    throw new CoordinatorInvariantError(`${label} must have no blocking failure before this transition.`);
  }
}

function expectedSubjectDigest(run: CoordinatorRunState, stage: WorkflowStage) {
  if (stage === "design-qa") return requireArtifact(run, "build-proposal").digest;
  if (stage === "implementation") return requireArtifact(run, "build-proposal").digest;
  if (stage === "product-qa") return requireArtifact(run, "implementation").digest;
  if (stage === "product-pr") return requireArtifact(run, "product-qa").digest;
  if (stage === "figma-backup") return requireArtifact(run, "product-pr").digest;
  return undefined;
}

function assertExecutionGrant(run: CoordinatorRunState) {
  const approval = run.approval;
  if (!approval) throw new CoordinatorInvariantError("A digest-bound human approval is required before product work.");
  const proposal = requireArtifact(run, "build-proposal");
  const contractLock = requireArtifact(run, "compile-contract-lock");
  if (approval.proposalDigest !== proposal.digest || approval.contractLockDigest !== contractLock.digest) {
    throw new CoordinatorInvariantError("The approval does not match the current proposal and contract lock.");
  }
}

function recordValue(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CoordinatorInvariantError(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function expectEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new CoordinatorInvariantError(`${label} does not match the active run.`);
}

function requireNonEmptyString(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CoordinatorInvariantError(`${label} must be a non-empty string.`);
  }
  return value;
}

function normalizedDirectionValue(value: unknown) {
  return typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ") : "";
}

export function assertMeaningfullyDifferentDirections(value: unknown, minimumDirections: number) {
  if (!Array.isArray(value) || value.length < minimumDirections) {
    throw new CoordinatorInvariantError(
      `directionSet must include at least ${minimumDirections} product-native direction${minimumDirections === 1 ? "" : "s"}.`,
    );
  }
  const fingerprints = value.map((entry, index) => {
    const direction = recordValue(entry, `directionSet.directions[${index}]`);
    const axes = Array.isArray(direction.differenceAxes)
      ? direction.differenceAxes.map(normalizedDirectionValue).filter(Boolean).sort()
      : [];
    const tradeoffs = Array.isArray(direction.tradeoffs)
      ? direction.tradeoffs.map(normalizedDirectionValue).filter(Boolean).sort()
      : [];
    const mockups = Array.isArray(direction.mockups)
      ? direction.mockups.map((mockup, mockupIndex) => {
          const record = recordValue(mockup, `directionSet.directions[${index}].mockups[${mockupIndex}]`);
          return [record.state, record.viewport, record.format, record.artifactDigest]
            .map(normalizedDirectionValue)
            .join("|");
        }).sort()
      : [];
    if (axes.length === 0 || mockups.length === 0) {
      throw new CoordinatorInvariantError("Every direction must declare differenceAxes and mockup evidence.");
    }
    return JSON.stringify({
      axes,
      optimizes: normalizedDirectionValue(direction.optimizes),
      brandFit: normalizedDirectionValue(direction.brandFit),
      productFit: normalizedDirectionValue(direction.productFit),
      tradeoffs,
      mockups,
    });
  });
  if (new Set(fingerprints).size !== fingerprints.length) {
    throw new CoordinatorInvariantError(
      "Directions must differ in declared product axes, decision tradeoffs, and/or digest-bound mockup evidence—not only ids or names.",
    );
  }
}

function requireFigmaBackupGrant(run: CoordinatorRunState, productPrDigest: string) {
  const grant = run.figmaBackupGrant;
  if (!grant) {
    throw new CoordinatorInvariantError(
      "Figma backup was not authorized; without a destination grant only a skipped result is allowed.",
    );
  }
  if (grant.runId !== run.id || grant.productPrDigest !== productPrDigest) {
    throw new CoordinatorInvariantError("Figma backup authorization is stale or belongs to a different run.");
  }
  requireDigest(grant.grantDigest, "Figma backup grant digest");
  try {
    const destination = normalizeFigmaDestination(grant.fileUrl, grant.fileKey);
    if (destination.fileUrl !== grant.fileUrl || destination.fileKey !== grant.fileKey) {
      throw new CoordinatorInvariantError("Figma backup authorization contains a non-canonical destination.");
    }
  } catch (error) {
    if (error instanceof CoordinatorInvariantError) throw error;
    throw new CoordinatorInvariantError(
      `Figma backup authorization destination is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return grant;
}

function expectDigestMap(actualValue: unknown, expected: Record<string, string | undefined>, label: string) {
  const actual = recordValue(actualValue, label);
  const expectedEntries = Object.entries(expected).filter((entry): entry is [string, string] => Boolean(entry[1]));
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = expectedEntries.map(([key]) => key).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new CoordinatorInvariantError(`${label} keys do not match the active lane.`);
  }
  for (const [key, digest] of expectedEntries) expectEqual(actual[key], digest, `${label}.${key}`);
}

/** Validate the exact, versioned QA gate set in every coordinator runtime. */
export function assertQaPolicyChecks(value: unknown, phase: QaPhase): QaCheck[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new CoordinatorInvariantError(`${phase} QA checks must be a non-empty list of at most 50 checks.`);
  }
  const expectedGates = QA_POLICY_GATES[phase];
  const checks = value.map((item, index) => {
    const check = recordValue(item, `${phase} QA checks[${index}]`);
    const id = requireNonEmptyString(check.id, `${phase} QA checks[${index}].id`);
    const policyGateId = requireNonEmptyString(
      check.policyGateId,
      `${phase} QA checks[${index}].policyGateId`,
    );
    const label = requireNonEmptyString(check.label, `${phase} QA checks[${index}].label`);
    const summary = requireNonEmptyString(check.summary, `${phase} QA checks[${index}].summary`);
    if (!(policyGateId in expectedGates)) {
      throw new CoordinatorInvariantError(`${policyGateId} is not a ${phase} QA policy gate.`);
    }
    if (check.severity !== expectedGates[policyGateId]) {
      throw new CoordinatorInvariantError(`${policyGateId} severity does not match the ${phase} QA policy.`);
    }
    if (!['passed', 'failed', 'partial', 'skipped'].includes(String(check.status))) {
      throw new CoordinatorInvariantError(`${phase} QA checks[${index}].status is invalid.`);
    }
    return {
      id,
      policyGateId,
      label,
      severity: check.severity as QaCheck['severity'],
      status: check.status as QaCheck['status'],
      summary,
      detail: summary,
    } satisfies QaCheck;
  });
  const gateIds = checks.map((check) => check.policyGateId as string);
  if (new Set(gateIds).size !== gateIds.length) {
    throw new CoordinatorInvariantError(`${phase} QA checks must include each policy gate exactly once.`);
  }
  const missing = Object.keys(expectedGates).filter((gateId) => !gateIds.includes(gateId));
  if (missing.length > 0) {
    throw new CoordinatorInvariantError(`${phase} QA checks are missing policy gates: ${missing.join(', ')}.`);
  }
  return checks;
}

/** Runtime-critical validation shared by the portable and hosted coordinators. */
export function assertStageArtifactContent(
  run: CoordinatorRunState,
  stage: WorkflowStage,
  value: unknown,
) {
  const schemaFile = STAGE_SCHEMA_FILES[stage];
  if (schemaFile) {
    try {
      assertJsonSchema(schemaFile, value);
    } catch (error) {
      throw new CoordinatorInvariantError(error instanceof Error ? error.message : `${schemaFile} validation failed.`);
    }
  }
  const content = recordValue(value, `${stage} artifact`);
  const artifactType = STAGE_ARTIFACT_TYPES[stage];
  if (!artifactType) return content;
  expectEqual(content.schemaVersion, 1, `${stage} schemaVersion`);
  expectEqual(content.artifactType, artifactType, `${stage} artifactType`);
  expectEqual(content.runId, run.id, `${stage} runId`);

  const intakeDigest = run.artifacts.intake?.digest;
  const contractLock = requireArtifact(run, "compile-contract-lock");
  const researchDigest = run.artifacts.research?.digest;
  const proposalDigest = run.artifacts["build-proposal"]?.digest;
  const implementationDigest = run.artifacts.implementation?.digest;
  const productQaDigest = run.artifacts["product-qa"]?.digest;
  const productPrDigest = run.artifacts["product-pr"]?.digest;
  const runTarget = resolveRunTarget({
    adapterId: run.adapterId,
    environment: run.environment,
    requireDelivery: ["implementation", "product-qa", "product-pr", "figma-backup"].includes(stage),
  });
  const productTarget = runTarget.adapter;

  if (stage === "research") {
    expectEqual(content.intakeDigest, intakeDigest, "research intakeDigest");
    const dependency = recordValue(content.researchDependency, "research researchDependency");
    expectEqual(dependency.repository, "sander217/research-synthesis", "research dependency repository");
    if (contractLock.metadata?.researchCommit) {
      expectEqual(dependency.revision, contractLock.metadata.researchCommit, "research dependency revision");
    }
  }
  if (stage === "context-lock" || stage === "direction-lock" || stage === "production-lock") {
    expectEqual(content.stage, stage, `${stage} stage`);
    const dependency = recordValue(content.sanstudioDependency, `${stage} sanstudioDependency`);
    expectEqual(dependency.repository, "sander217/sanstudio", `${stage} SanStudio repository`);
    if (contractLock.metadata?.sanstudioCommit) {
      expectEqual(dependency.revision, contractLock.metadata.sanstudioCommit, `${stage} SanStudio revision`);
    }
    if (stage === "context-lock") {
      expectDigestMap(
        content.inputDigests,
        { intake: intakeDigest, contractLock: contractLock.digest, researchReport: researchDigest },
        "context-lock inputDigests",
      );
    }
    if (stage === "direction-lock") {
      expectDigestMap(
        content.inputDigests,
        { contextLock: run.artifacts["context-lock"]?.digest, researchReport: researchDigest },
        "direction-lock inputDigests",
      );
    }
    if (stage === "production-lock") {
      expectDigestMap(
        content.inputDigests,
        { designProposal: run.artifacts["design-lock"]?.digest, contractLock: contractLock.digest },
        "production-lock inputDigests",
      );
    }
  }
  if (stage === "design-lock" || stage === "build-proposal") {
    const locks = recordValue(content.inputLocks, `${stage} inputLocks`);
    expectEqual(locks.intake, intakeDigest, `${stage} intake lock`);
    expectEqual(locks.contractLock, contractLock.digest, `${stage} contract lock`);
    expectEqual(locks.researchReport, researchDigest, `${stage} research lock`);
    if (contractLock.metadata?.productCommit) {
      expectEqual(locks.productBaseCommit, contractLock.metadata.productCommit, `${stage} product base commit`);
    }
    if (contractLock.metadata?.productAdapterRevision) {
      expectEqual(
        locks.productAdapterRevision,
        contractLock.metadata.productAdapterRevision,
        `${stage} product adapter revision`,
      );
    }
    if (contractLock.metadata?.sanstudioCommit) {
      expectEqual(locks.sanstudioRevision, contractLock.metadata.sanstudioCommit, `${stage} SanStudio revision`);
    }
    const laneArtifacts = stage === "design-lock"
      ? {
          contextLock: run.artifacts["context-lock"]?.digest,
          directionProposal: run.artifacts["direction-lock"]?.digest,
        }
      : {
          contextLock: run.artifacts["context-lock"]?.digest,
          directionProposal: run.artifacts["direction-lock"]?.digest,
          designProposal: run.artifacts["design-lock"]?.digest,
          productionPackage: run.artifacts["production-lock"]?.digest,
        };
    expectDigestMap(locks.laneDesignArtifacts, laneArtifacts, `${stage} laneDesignArtifacts`);
    const directionSet = recordValue(content.directionSet, `${stage} directionSet`);
    const directions = Array.isArray(directionSet.directions) ? directionSet.directions : [];
    const minimumDirections = run.lane === "Fast Lane" ? 1 : 3;
    if (directions.length < minimumDirections) {
      throw new CoordinatorInvariantError(
        `${stage} must include at least ${minimumDirections} product-native direction${minimumDirections === 1 ? "" : "s"} for ${run.lane}.`,
      );
    }
    assertMeaningfullyDifferentDirections(directions, minimumDirections);
    const directionIds = directions.map((entry, index) =>
      requireNonEmptyString(recordValue(entry, `${stage} directionSet.directions[${index}]`).id, `${stage} direction id`),
    );
    if (new Set(directionIds).size !== directionIds.length) {
      throw new CoordinatorInvariantError(`${stage} direction ids must be unique.`);
    }
    if (!directionIds.includes(String(directionSet.recommendedDirectionId))) {
      throw new CoordinatorInvariantError(`${stage} recommendedDirectionId must identify one supplied direction.`);
    }
  }
  if (stage === "design-lock" || stage === "build-proposal") {
    expectEqual(content.productTruth, "production-code", `${stage} productTruth`);
    expectEqual(content.status, "ready-for-approval", `${stage} status`);
  }
  if (stage === "design-qa") {
    expectEqual(content.proposalDigest, proposalDigest, "design QA proposalDigest");
    const qaPolicy = recordValue(content.qaPolicy, "design QA qaPolicy");
    if (contractLock.metadata?.qaPolicyDigest) {
      expectEqual(qaPolicy.digest, contractLock.metadata.qaPolicyDigest, "design QA policy digest");
    }
    if (contractLock.metadata?.qaPolicyRef) {
      expectEqual(qaPolicy.ref, contractLock.metadata.qaPolicyRef, "design QA policy ref");
    }
    const checks = assertQaPolicyChecks(content.checks, "design");
    expectEqual(content.status, deriveQaReportStatus(checks), "design QA normalized status");
  }
  if (stage === "implementation") {
    expectEqual(content.proposalDigest, proposalDigest, "implementation proposalDigest");
    expectEqual(content.approvalDigest, run.approval?.approvalDigest, "implementation approvalDigest");
    expectEqual(content.repository, productTarget.repository, "implementation repository");
    expectEqual(content.baseBranch, productTarget.baseBranch, "implementation baseBranch");
    expectEqual(content.isolatedBranch, true, "implementation isolatedBranch");
    if (contractLock.metadata?.productCommit) {
      expectEqual(content.baseCommit, contractLock.metadata.productCommit, "implementation baseCommit");
    }
    if (typeof content.workingBranch !== "string" || !content.workingBranch.startsWith("codex/")) {
      throw new CoordinatorInvariantError("implementation workingBranch must use the codex/ prefix.");
    }
    const files = Array.isArray(content.files) ? content.files : [];
    const paths = files.map((entry, index) => {
      const file = recordValue(entry, `implementation files[${index}]`);
      const filePath = requireNonEmptyString(file.path, `implementation files[${index}].path`);
      if (
        filePath.startsWith("/") ||
        filePath.includes("\\") ||
        filePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
      ) {
        throw new CoordinatorInvariantError("implementation file paths must be safe repository-relative POSIX paths.");
      }
      return filePath;
    });
    if (new Set(paths).size !== paths.length) {
      throw new CoordinatorInvariantError("implementation changed-file paths must be unique.");
    }
    if (content.writeStarted === true && paths.length === 0) {
      throw new CoordinatorInvariantError("An implementation that started product writes must report changed-file evidence.");
    }
    const commits = Array.isArray(content.commits) ? content.commits : [];
    if (commits.length > 0) {
      const finalCommit = recordValue(commits[commits.length - 1], "implementation final commit");
      if (finalCommit.sha !== content.headCommit) {
        throw new CoordinatorInvariantError("implementation headCommit must equal the final reported commit SHA.");
      }
    }
    if (content.status === "succeeded" && paths.length === 0) {
      throw new CoordinatorInvariantError("A succeeded implementation must report at least one changed file.");
    }
  }
  if (stage === "product-qa") {
    expectEqual(content.proposalDigest, proposalDigest, "product QA proposalDigest");
    expectEqual(content.implementationResultDigest, implementationDigest, "product QA implementationResultDigest");
    const qaPolicy = recordValue(content.qaPolicy, "product QA qaPolicy");
    if (contractLock.metadata?.qaPolicyDigest) {
      expectEqual(qaPolicy.digest, contractLock.metadata.qaPolicyDigest, "product QA policy digest");
    }
    if (contractLock.metadata?.qaPolicyRef) {
      expectEqual(qaPolicy.ref, contractLock.metadata.qaPolicyRef, "product QA policy ref");
    }
    const checks = assertQaPolicyChecks(content.checks, "product");
    expectEqual(content.status, deriveQaReportStatus(checks), "product QA normalized status");
    const target = recordValue(content.target, "product QA target");
    expectEqual(target.repository, productTarget.repository, "product QA repository");
    expectEqual(target.baseBranch, productTarget.baseBranch, "product QA baseBranch");
    if (contractLock.metadata?.productCommit) {
      expectEqual(target.baseCommit, contractLock.metadata.productCommit, "product QA baseCommit");
    }
    expectEqual(target.headCommit, run.artifacts.implementation?.metadata?.headCommit, "product QA headCommit");
    if (content.memoryProposals !== undefined) {
      if (!Array.isArray(content.memoryProposals)) {
        throw new CoordinatorInvariantError("product QA memoryProposals must be an array.");
      }
      for (const [index, value] of content.memoryProposals.entries()) {
        const proposal = recordValue(value, `product QA memoryProposals[${index}]`);
        const expectedSubject = proposal.scope === "brand" ? runTarget.brand.id : runTarget.product.id;
        expectEqual(proposal.subject, expectedSubject, `product QA memoryProposals[${index}].subject`);
        expectEqual(proposal.status, "proposed", `product QA memoryProposals[${index}].status`);
      }
    }
  }
  if (stage === "product-pr") {
    expectEqual(content.proposalDigest, proposalDigest, "product PR proposalDigest");
    expectEqual(content.approvalDigest, run.approval?.approvalDigest, "product PR approvalDigest");
    expectEqual(content.implementationResultDigest, implementationDigest, "product PR implementationResultDigest");
    expectEqual(content.qaReportDigest, productQaDigest, "product PR qaReportDigest");
    expectEqual(content.repository, productTarget.repository, "product PR repository");
    expectEqual(content.baseBranch, productTarget.baseBranch, "product PR baseBranch");
    expectEqual(content.draft, true, "product PR draft flag");
    expectEqual(content.autoMerge, false, "product PR autoMerge flag");
    expectEqual(content.mergeAuthority, "human", "product PR merge authority");
    expectEqual(content.status, "draft", "product PR status");
    if (typeof content.headBranch !== "string" || !content.headBranch.startsWith("codex/")) {
      throw new CoordinatorInvariantError("product PR headBranch must use the codex/ prefix.");
    }
    if (run.artifacts.implementation?.metadata?.workingBranch) {
      expectEqual(content.headBranch, run.artifacts.implementation.metadata.workingBranch, "product PR headBranch");
    }
    expectEqual(content.headCommit, run.artifacts.implementation?.metadata?.headCommit, "product PR headCommit");
    if (!Number.isInteger(content.number) || Number(content.number) < 1) {
      throw new CoordinatorInvariantError("product PR number must be a positive integer.");
    }
    const prUrl = requireNonEmptyString(content.url, "product PR url");
    try {
      const parsed = new URL(prUrl);
      if (
        parsed.protocol !== "https:" ||
        parsed.hostname !== "github.com" ||
        parsed.pathname !== `/${productTarget.repository}/pull/${String(content.number)}`
      ) {
        throw new Error("not the expected GitHub pull request");
      }
    } catch {
      throw new CoordinatorInvariantError("product PR url must be an HTTPS URL.");
    }
  }
  if (stage === "figma-backup") {
    expectEqual(content.proposalDigest, proposalDigest, "Figma proposalDigest");
    expectEqual(content.implementationResultDigest, implementationDigest, "Figma implementationResultDigest");
    expectEqual(content.productPrDigest, productPrDigest, "Figma productPrDigest");
    expectEqual(content.backupOnly, true, "Figma backupOnly flag");
    expectEqual(content.authority, "non-authoritative", "Figma authority");
    if (!["completed", "failed", "skipped"].includes(String(content.status))) {
      throw new CoordinatorInvariantError("Figma status must be completed, failed, or skipped.");
    }
    if (content.status === "skipped") {
      requireNonEmptyString(content.reason, "Figma reason");
      if (content.figma !== undefined) {
        throw new CoordinatorInvariantError("A skipped Figma backup cannot report destination write evidence.");
      }
    } else {
      const grant = requireFigmaBackupGrant(run, productPrDigest as string);
      if (content.status === "failed") requireNonEmptyString(content.reason, "Figma reason");
      if (content.status === "completed" || content.figma !== undefined) {
        const figma = recordValue(content.figma, "Figma destination");
        expectEqual(figma.fileKey, grant.fileKey, "Figma fileKey");
        expectEqual(figma.fileUrl, grant.fileUrl, "Figma fileUrl");
        expectEqual(content.productPrDigest, grant.productPrDigest, "Figma authorized productPrDigest");
      }
    }
  }
  return content;
}

export function createCoordinatorRun(input: CreateCoordinatorRunInput): CoordinatorRunState {
  const prompt = input.prompt.trim();
  if (!prompt) throw new CoordinatorInvariantError("A non-empty prompt is required.");
  const analysis = analyzeChangeRequest(prompt);
  const now = input.now ?? new Date().toISOString();
  const stages = getWorkflowStages(analysis.lane);
  const fallback = getDefaultRunTarget();
  return {
    schemaVersion: 1,
    id: input.id,
    prompt,
    adapterId: input.adapterId ?? fallback.adapter.id,
    environment: input.environment ?? fallback.adapter.defaultEnvironment,
    mode: input.mode ?? "delivery",
    lane: analysis.lane,
    status: "in-progress",
    currentStage: stages[0],
    stages: [...stages],
    attempts: {},
    artifacts: {},
    trace: [],
    warnings: [],
    createdAt: now,
    updatedAt: now,
  };
}

const LANE_RANK: Record<ChangeLane, number> = {
  "Fast Lane": 0,
  Standard: 1,
  Major: 2,
};

const LANE_UPGRADE_STAGES = new Set<WorkflowStage>([
  "intake",
  "analyze",
  "compile-contract-lock",
  "research",
  "context-lock",
]);

/**
 * Upgrade a run when research discovers broader scope. This is deliberately
 * one-way and early: after Context Lock, a broader lane would require
 * invalidating already-produced design evidence, so callers must start a new
 * run instead of silently skipping or replaying gates.
 */
export function upgradeCoordinatorLane(
  run: CoordinatorRunState,
  toLane: ChangeLane,
  reason: string,
  actor: string,
  now = new Date().toISOString(),
) {
  const normalizedReason = reason.trim();
  const normalizedActor = actor.trim();
  if (!normalizedReason) throw new CoordinatorInvariantError("A lane upgrade requires a non-empty reason.");
  if (!normalizedActor) throw new CoordinatorInvariantError("A lane upgrade requires an actor identity.");
  if (LANE_RANK[toLane] <= LANE_RANK[run.lane]) {
    throw new CoordinatorInvariantError(`Lane changes must upgrade beyond ${run.lane}; downgrades and no-ops are forbidden.`);
  }
  if (run.status !== "in-progress" || !LANE_UPGRADE_STAGES.has(run.currentStage)) {
    throw new CoordinatorInvariantError(
      "Lane upgrades are allowed only during intake, analysis, contract compilation, research, or Context Lock; start a new run for later scope expansion.",
    );
  }
  if (run.approval || run.implementationTarget) {
    throw new CoordinatorInvariantError("A run with product authorization or a product target cannot change lanes.");
  }
  const laterEvidence = [
    "direction-lock",
    "design-lock",
    "production-lock",
    "build-proposal",
    "design-qa",
    "implementation",
    "product-qa",
    "product-pr",
    "figma-backup",
  ].find((stage) => run.artifacts[stage as WorkflowStage]);
  if (laterEvidence) {
    throw new CoordinatorInvariantError(`Lane upgrade is unsafe because ${laterEvidence} evidence already exists.`);
  }

  const next = cloneRun(run);
  const fromLane = run.lane;
  next.lane = toLane;
  next.stages = [...getWorkflowStages(toLane)];
  next.trace?.push({
    type: "lane-upgrade",
    fromLane,
    toLane,
    reason: normalizedReason,
    actor: normalizedActor,
    at: now,
  });
  next.updatedAt = now;
  return next;
}

/** Authorize one exact, non-authoritative Figma backup destination for the current product PR. */
export async function authorizeFigmaBackup(
  run: CoordinatorRunState,
  authorization: FigmaBackupAuthorization,
) {
  if (run.currentStage !== "figma-backup" || run.status !== "in-progress") {
    throw new CoordinatorInvariantError("Figma backup can be authorized only at the active figma-backup stage.");
  }
  const productPr = requireArtifact(run, "product-pr");
  requireDigest(productPr.digest, "product PR digest");
  let grant: FigmaBackupGrant;
  try {
    grant = await createFigmaBackupGrant({
      runId: run.id,
      productPrDigest: productPr.digest,
      fileUrl: authorization.fileUrl,
      authorizedBy: authorization.authorizedBy,
      ...(authorization.authorizedAt ? { authorizedAt: authorization.authorizedAt } : {}),
    });
  } catch (error) {
    throw new CoordinatorInvariantError(error instanceof Error ? error.message : String(error));
  }
  if (run.figmaBackupGrant) {
    if (!sameFigmaBackupGrant(run.figmaBackupGrant, grant)) {
      throw new CoordinatorInvariantError(
        "Figma backup already has a destination grant; a different destination or product PR requires a new run.",
      );
    }
    return cloneRun(run);
  }
  const next = cloneRun(run);
  next.figmaBackupGrant = grant;
  next.trace?.push({
    type: "figma-authorization",
    actor: grant.authorizedBy,
    fileUrl: grant.fileUrl,
    fileKey: grant.fileKey,
    productPrDigest: grant.productPrDigest,
    grantDigest: grant.grantDigest,
    at: grant.authorizedAt,
  });
  next.updatedAt = grant.authorizedAt;
  return next;
}

export function beginCurrentStage(run: CoordinatorRunState, now = new Date().toISOString()) {
  if (["blocked", "rejected", "completed", "completed-with-warnings"].includes(run.status)) {
    throw new CoordinatorInvariantError(`Cannot start ${run.currentStage} while run status is ${run.status}.`);
  }
  const definition = WORKFLOW_STAGE_DEFINITIONS[run.currentStage];
  if (definition.humanGate) {
    throw new CoordinatorInvariantError("Human approval must be recorded with approveCoordinatorRun.");
  }
  if (definition.requiresApproval) assertExecutionGrant(run);
  const attempts = run.attempts[run.currentStage] ?? 0;
  if (attempts >= definition.maxAttempts) {
    throw new CoordinatorInvariantError(`${run.currentStage} exhausted its ${definition.maxAttempts} allowed attempts.`);
  }
  const next = cloneRun(run);
  next.attempts[run.currentStage] = attempts + 1;
  next.trace?.push({
    type: "stage-attempt",
    stage: run.currentStage,
    attempt: attempts + 1,
    outcome: "started",
    at: now,
  });
  next.status = "in-progress";
  next.updatedAt = now;
  return next;
}

export function completeCurrentStage(
  run: CoordinatorRunState,
  artifact: ArtifactReference,
  now = new Date().toISOString(),
) {
  const stage = run.currentStage;
  const definition = WORKFLOW_STAGE_DEFINITIONS[stage];
  if (definition.humanGate) {
    throw new CoordinatorInvariantError("Human approval cannot be completed by an agent artifact.");
  }
  if ((run.attempts[stage] ?? 0) < 1) {
    throw new CoordinatorInvariantError(`${stage} must be started before it can complete.`);
  }
  if (artifact.runId !== run.id || artifact.stage !== stage || artifact.kind !== definition.output) {
    throw new CoordinatorInvariantError(`${stage} returned an artifact that does not match this run or stage contract.`);
  }
  requireDigest(artifact.digest, `${stage} artifact digest`);
  const subjectDigest = expectedSubjectDigest(run, stage);
  if (subjectDigest && artifact.subjectDigest !== subjectDigest) {
    throw new CoordinatorInvariantError(`${stage} artifact is not bound to the required upstream digest.`);
  }
  if (stage === "build-proposal") {
    const lock = requireArtifact(run, "compile-contract-lock");
    if (artifact.metadata?.contractLockDigest !== lock.digest) {
      throw new CoordinatorInvariantError("The proposal package must be bound to the immutable contract lock.");
    }
  }
  if (stage === "design-qa" || stage === "product-qa") requireNonBlockingQa(artifact, stage);
  if (stage === "implementation" && artifact.metadata?.status !== "succeeded") {
    throw new CoordinatorInvariantError("Only a succeeded implementation may advance to product QA.");
  }
  if (stage === "product-pr" && artifact.metadata?.draft !== true) {
    throw new CoordinatorInvariantError("The product PR must be created as a draft.");
  }

  const next = cloneRun(run);
  next.artifacts[stage] = { ...artifact, metadata: artifact.metadata ? { ...artifact.metadata } : undefined };
  if ((stage === "design-qa" || stage === "product-qa") && artifact.metadata?.status === "review") {
    next.warnings.push(`${stage}: review-severity QA evidence needs human attention.`);
  }
  next.trace?.push({
    type: "stage-attempt",
    stage,
    attempt: run.attempts[stage] ?? 0,
    outcome: "succeeded",
    artifactDigest: artifact.digest,
    artifactUri: artifact.uri,
    at: now,
  });
  const nextStage = getNextWorkflowStage(run.lane, stage);
  next.updatedAt = now;
  if (!nextStage) {
    if (stage === "figma-backup" && artifact.metadata?.status !== "completed") {
      next.warnings.push(`figma-backup: ${String(artifact.metadata?.status ?? "not completed")}`);
      next.status = "completed-with-warnings";
    } else {
      next.status = next.warnings.length > 0 ? "completed-with-warnings" : "completed";
    }
    return next;
  }
  next.currentStage = nextStage;
  next.status = nextStage === "human-approval" ? "awaiting-approval" : "in-progress";
  return next;
}

export function failCurrentStage(
  run: CoordinatorRunState,
  reason: string,
  now = new Date().toISOString(),
  evidence?: ArtifactReference,
) {
  const stage = run.currentStage;
  const definition = WORKFLOW_STAGE_DEFINITIONS[stage];
  if (stage === "figma-backup" && !run.figmaBackupGrant) {
    throw new CoordinatorInvariantError(
      "Figma backup was not authorized; submit a structured skipped result instead of recording a failed write.",
    );
  }
  const next = cloneRun(run);
  next.updatedAt = now;
  next.trace?.push({
    type: "stage-attempt",
    stage,
    attempt: run.attempts[stage] ?? 0,
    outcome: "failed",
    ...(evidence ? { artifactDigest: evidence.digest, artifactUri: evidence.uri } : {}),
    reason,
    at: now,
  });
  if (definition.optional) {
    next.warnings.push(`${stage}: ${reason}`);
    const nextStage = getNextWorkflowStage(run.lane, stage);
    if (nextStage) {
      next.currentStage = nextStage;
      next.status = "in-progress";
    } else {
      next.status = "completed-with-warnings";
    }
    return next;
  }
  if ((run.attempts[stage] ?? 0) < definition.maxAttempts) {
    if (definition.retryFrom) next.currentStage = definition.retryFrom;
    next.status = "in-progress";
    return next;
  }
  next.status = "blocked";
  next.warnings.push(`${stage}: ${reason}`);
  return next;
}

export function approveCoordinatorRun(
  run: CoordinatorRunState,
  decision: ApprovalDecision,
) {
  if (run.currentStage !== "human-approval" || run.status !== "awaiting-approval") {
    throw new CoordinatorInvariantError("This run is not awaiting human approval.");
  }
  const proposal = requireArtifact(run, "build-proposal");
  const designQa = requireArtifact(run, "design-qa");
  const contractLock = requireArtifact(run, "compile-contract-lock");
  requireNonBlockingQa(designQa, "design-qa");
  if (designQa.subjectDigest !== proposal.digest) {
    throw new CoordinatorInvariantError("Design QA is stale for the current proposal.");
  }
  if (decision.proposalDigest !== proposal.digest) {
    throw new CoordinatorInvariantError("The approval decision does not match the current proposal digest.");
  }
  requireDigest(decision.approvalDigest, "approval digest");
  const next = cloneRun(run);
  const decidedAt = decision.decidedAt ?? new Date().toISOString();
  next.updatedAt = decidedAt;
  next.trace?.push({
    type: "approval-decision",
    action: decision.action,
    actor: decision.actor,
    proposalDigest: decision.proposalDigest,
    decisionDigest: decision.approvalDigest,
    ...(decision.note ? { note: decision.note } : {}),
    at: decidedAt,
  });
  if (decision.action === "reject") {
    next.status = "rejected";
    return next;
  }
  next.approval = {
    approvalDigest: decision.approvalDigest,
    proposalDigest: proposal.digest,
    contractLockDigest: contractLock.digest,
    approvedBy: decision.actor,
    approvedAt: decidedAt,
  };
  if (run.mode !== "delivery") {
    next.status = "completed";
    return next;
  }
  const nextStage = getNextWorkflowStage(run.lane, "human-approval");
  if (!nextStage) throw new CoordinatorInvariantError("Workflow has no post-approval implementation stage.");
  next.currentStage = nextStage;
  next.status = "approved";
  return next;
}

export async function runUntilPause(run: CoordinatorRunState, execute: StageExecutor) {
  let current = cloneRun(run);
  while (!current.currentStage.startsWith("human-") && !["blocked", "rejected", "completed", "completed-with-warnings"].includes(current.status)) {
    current = beginCurrentStage(current);
    try {
      const artifact = await execute({
        run: current,
        stage: current.currentStage,
        definition: WORKFLOW_STAGE_DEFINITIONS[current.currentStage],
      });
      current = completeCurrentStage(current, artifact);
    } catch (error) {
      current = failCurrentStage(current, error instanceof Error ? error.message : "Stage execution failed.");
      if (current.status === "blocked" || current.status === "completed-with-warnings") break;
    }
  }
  return current;
}
