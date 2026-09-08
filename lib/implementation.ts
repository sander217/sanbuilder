export interface ImplementationTargetIdentity {
  repository: string;
  baseBranch: string;
  baseCommit: string;
  workingBranch: string;
}

const FULL_COMMIT = /^[a-f0-9]{40}$/;
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_BASE_BRANCH = /^(?!\/)(?!.*(?:\.\.|\/\/|@\{|\\))[A-Za-z0-9._/-]+(?<!\/)$/;
const SAFE_RUN_ID = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const SAFE_WORKING_BRANCH = /^codex\/design-[a-z0-9][a-z0-9-]*$/;
const MAX_WORKING_BRANCH_LENGTH = 120;

export interface RecordedProductChange extends ImplementationTargetIdentity {
  headCommit: string | null;
  status: string;
}

export interface ApprovedImplementationGrant {
  approvalDigest: string;
  proposalDigest: string;
  contractLockDigest: string;
}

export interface ApprovedProposalBinding {
  id: string;
  digest: string;
  contractLockDigest: string;
  status: string;
}

export interface ApprovalRecordBinding {
  id: string;
  proposalPackageId: string;
  proposalDigest: string;
  contractLockDigest: string;
  status: string;
  decisionDigest: string | null;
}

export interface BoundProductChange extends RecordedProductChange {
  approvalId: string;
}

export interface ImplementationEvidence {
  id: string;
  digest: string;
  subjectDigest: string | null;
  content: unknown;
  metadata: unknown;
  createdAt: string;
}

/**
 * The hosted executor never selects its own repository, base, or branch. The
 * coordinator derives one stable branch from the durable run id before the
 * first implementation dispatch and persists it as a planned product change.
 */
export function planImplementationTarget({
  runId,
  repository,
  baseBranch,
  baseCommit,
}: {
  runId: string;
  repository: string;
  baseBranch: string;
  baseCommit: string;
}): ImplementationTargetIdentity {
  if (!SAFE_REPOSITORY.test(repository)) {
    throw new Error("Implementation repository must be an exact GitHub owner/repository slug.");
  }
  if (!SAFE_BASE_BRANCH.test(baseBranch)) {
    throw new Error("Implementation base branch is not a safe exact Git ref.");
  }
  if (!FULL_COMMIT.test(baseCommit)) {
    throw new Error("Implementation base commit must be a full lowercase Git commit SHA.");
  }
  if (!SAFE_RUN_ID.test(runId)) {
    throw new Error("Run id cannot be represented safely in an implementation branch.");
  }
  const workingBranch = `codex/design-${runId}`;
  if (workingBranch.length > MAX_WORKING_BRANCH_LENGTH || !SAFE_WORKING_BRANCH.test(workingBranch)) {
    throw new Error("Deterministic implementation branch is not a safe Git branch name.");
  }
  return { repository, baseBranch, baseCommit, workingBranch };
}

/**
 * Resolve the one product target authorized by the immutable contract lock and
 * the exact human decision. This must run before a hosted implementation job is
 * persisted or delivered, so the executor cannot choose its own target.
 */
export function bindApprovedImplementationTarget({
  runId,
  contractLockDigest,
  contractProduct,
  executionGrant,
  proposalPackages,
  approvalRecords,
  existingProductChange,
}: {
  runId: string;
  contractLockDigest: string;
  contractProduct: { repository: string; baseBranch: string; commit: string };
  executionGrant: ApprovedImplementationGrant;
  proposalPackages: ApprovedProposalBinding[];
  approvalRecords: ApprovalRecordBinding[];
  existingProductChange: BoundProductChange | null;
}) {
  if (executionGrant.contractLockDigest !== contractLockDigest) {
    throw new Error("Implementation grant does not match the active contract lock.");
  }
  const approvedProposal = proposalPackages.find(
    (proposal) =>
      proposal.id.length > 0 &&
      proposal.status === "approved" &&
      proposal.digest === executionGrant.proposalDigest &&
      proposal.contractLockDigest === executionGrant.contractLockDigest,
  );
  if (!approvedProposal) {
    throw new Error("Implementation grant does not match an approved proposal package.");
  }
  const approval = approvalRecords.find(
    (record) =>
      record.status === "approved" &&
      record.proposalPackageId === approvedProposal.id &&
      record.proposalDigest === executionGrant.proposalDigest &&
      record.contractLockDigest === executionGrant.contractLockDigest &&
      record.decisionDigest === executionGrant.approvalDigest,
  );
  if (!approval) {
    throw new Error("Implementation grant does not match an approved human decision.");
  }
  const target = planImplementationTarget({
    runId,
    repository: contractProduct.repository,
    baseBranch: contractProduct.baseBranch,
    baseCommit: contractProduct.commit,
  });
  if (existingProductChange) {
    if (existingProductChange.approvalId !== approval.id) {
      throw new Error("Existing product change is not bound to the approved human decision.");
    }
    assertImplementationContinuation(existingProductChange, target);
  }
  return {
    approvalId: approval.id,
    proposalPackageId: approvedProposal.id,
    target,
    productChange: existingProductChange ?? {
      approvalId: approval.id,
      ...target,
      headCommit: null,
      status: "planned",
    },
  };
}

/** A failed/partial product write is resumed in place; a retry may not fork a second branch. */
export function assertImplementationContinuation(
  existing: ImplementationTargetIdentity,
  candidate: ImplementationTargetIdentity,
) {
  for (const key of ["repository", "baseBranch", "baseCommit", "workingBranch"] as const) {
    if (candidate[key] !== existing[key]) {
      throw new Error(`Implementation retry must resume ${existing.workingBranch}; ${key} cannot change.`);
    }
  }
}

export function buildImplementationDispatchContext(
  productChange: RecordedProductChange,
  priorEvidence: ImplementationEvidence[],
) {
  return {
    mode: productChange.status === "planned"
      ? "planned-product-change" as const
      : "resume-existing-product-change" as const,
    target: {
      repository: productChange.repository,
      baseBranch: productChange.baseBranch,
      baseCommit: productChange.baseCommit,
      workingBranch: productChange.workingBranch,
      headCommit: productChange.headCommit,
    },
    status: productChange.status,
    priorEvidence,
    constraints: {
      reuseWorkingBranch: true as const,
      createReplacementBranch: false as const,
    },
  };
}

function requireInputObject(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Stored implementation input ${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

/** Revalidate an immutable retry envelope against the current approved target. */
export function assertStoredImplementationDispatchBinding(
  input: Record<string, unknown>,
  expected: {
    executionGrant: ApprovedImplementationGrant;
    proposalPackageId: string;
    target: ImplementationTargetIdentity;
  },
) {
  const grant = requireInputObject(input.executionGrant, "executionGrant");
  for (const key of ["approvalDigest", "proposalDigest", "contractLockDigest"] as const) {
    if (grant[key] !== expected.executionGrant[key]) {
      throw new Error(`Stored implementation input ${key} no longer matches the approved grant.`);
    }
  }
  const proposal = requireInputObject(input.proposalPackage, "proposalPackage");
  if (
    proposal.id !== expected.proposalPackageId ||
    proposal.digest !== expected.executionGrant.proposalDigest ||
    proposal.contractLockDigest !== expected.executionGrant.contractLockDigest
  ) {
    throw new Error("Stored implementation input no longer matches the approved proposal package.");
  }
  const continuation = requireInputObject(input.implementationContinuation, "implementationContinuation");
  const target = requireInputObject(continuation.target, "implementationContinuation.target");
  for (const key of ["repository", "baseBranch", "baseCommit", "workingBranch"] as const) {
    if (target[key] !== expected.target[key]) {
      throw new Error(`Stored implementation input ${key} no longer matches the locked product target.`);
    }
  }
  const constraints = requireInputObject(continuation.constraints, "implementationContinuation.constraints");
  if (constraints.reuseWorkingBranch !== true || constraints.createReplacementBranch !== false) {
    throw new Error("Stored implementation retry constraints permit an unsafe replacement branch.");
  }
}
