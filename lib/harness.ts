export type ChangeLane = "Fast Lane" | "Standard" | "Major";

export type WorkflowStage =
  | "intake"
  | "analyze"
  | "compile-contract-lock"
  | "research"
  | "context-lock"
  | "direction-lock"
  | "design-lock"
  | "production-lock"
  | "build-proposal"
  | "design-qa"
  | "human-approval"
  | "implementation"
  | "product-qa"
  | "product-pr"
  | "figma-backup";

export type WorkflowArtifactKind =
  | "intake"
  | "change-analysis"
  | "contract-lock"
  | "research-report"
  | "context-lock"
  | "direction-proposal"
  | "design-proposal"
  | "production-package"
  | "proposal-package"
  | "design-qa-report"
  | "approval-record"
  | "implementation-result"
  | "product-qa-report"
  | "product-pr"
  | "figma-backup";

export type StageOwner = "coordinator" | "research" | "sanstudio" | "quality" | "human" | "product" | "github" | "figma";

export interface WorkflowStageDefinition {
  id: WorkflowStage;
  owner: StageOwner;
  output: WorkflowArtifactKind;
  blocking: boolean;
  maxAttempts: number;
  humanGate?: boolean;
  requiresApproval?: boolean;
  mutatesProduct?: boolean;
  optional?: boolean;
  retryFrom?: WorkflowStage;
}

export type RunStatus =
  | "ready-for-proposal"
  | "in-progress"
  | "awaiting-approval"
  | "approved"
  | "blocked"
  | "rejected"
  | "completed"
  | "completed-with-warnings";

export type AgentJobStatus = "queued" | "dispatching" | "dispatched" | "running" | "processing" | "succeeded" | "failed" | "cancelled" | "dispatch-failed";
export type ApprovalStatus = "pending" | "deciding" | "approved" | "rejected";
export type QaPhase = "design" | "product";
export type QaReportStatus = "passed" | "failed" | "review";
export type QaGateSeverity = "blocking" | "review";
export type QaCheckStatus = "passed" | "failed" | "partial" | "skipped";

export interface QaCheck {
  id: string;
  policyGateId?: string;
  label: string;
  severity: QaGateSeverity;
  status: QaCheckStatus;
  summary?: string;
  detail?: string;
}

export const QA_POLICY_GATES: Record<QaPhase, Readonly<Record<string, QaGateSeverity>>> = {
  design: {
    "contract-lint": "blocking",
    "experience-completeness": "blocking",
    accessibility: "blocking",
    responsive: "blocking",
    "visual-comparison": "review",
  },
  product: {
    accessibility: "blocking",
    responsive: "blocking",
    "native-suites": "blocking",
    "visual-comparison": "review",
    "uat-release": "blocking",
  },
};

export interface ContractLockSnapshot {
  runId: string;
  repository: string;
  sourceCommit: string;
  brand: { id: string; ref: string; digest: string };
  productProfile: { id: string; surface: string; ref: string; digest: string };
  design: { ref: string; digest: string };
  taste: { ref: string; digest: string };
  memory: {
    policy: { ref: string; digest: string };
    brand: { ref: string; digest: string };
    product: { ref: string; digest: string };
  };
  experience: { ref: string; digest: string };
  productAdapter: { id: string; revision: string };
  product?: { repository: string; baseBranch: string; commit: string };
  dependencies?: {
    research: { repository: string; commit: string };
    sanstudio: { repository: string; commit: string };
  };
  qaPolicy: { ref: string; digest: string };
}

export interface ChangeAnalysis {
  lane: ChangeLane;
  evidence: string[];
  contracts: string[];
  journeys: string[];
  qa: string[];
}

export interface JourneyRoutingRule {
  id: string;
  keywords: string[];
}

export const WORKFLOW_STAGE_DEFINITIONS: Record<WorkflowStage, WorkflowStageDefinition> = {
  intake: { id: "intake", owner: "coordinator", output: "intake", blocking: true, maxAttempts: 1 },
  analyze: { id: "analyze", owner: "coordinator", output: "change-analysis", blocking: true, maxAttempts: 1 },
  "compile-contract-lock": {
    id: "compile-contract-lock",
    owner: "coordinator",
    output: "contract-lock",
    blocking: true,
    maxAttempts: 2,
  },
  research: { id: "research", owner: "research", output: "research-report", blocking: true, maxAttempts: 2 },
  "context-lock": {
    id: "context-lock",
    owner: "sanstudio",
    output: "context-lock",
    blocking: true,
    maxAttempts: 2,
  },
  "direction-lock": {
    id: "direction-lock",
    owner: "sanstudio",
    output: "direction-proposal",
    blocking: true,
    maxAttempts: 2,
  },
  "design-lock": {
    id: "design-lock",
    owner: "sanstudio",
    output: "design-proposal",
    blocking: true,
    maxAttempts: 2,
  },
  "production-lock": {
    id: "production-lock",
    owner: "sanstudio",
    output: "production-package",
    blocking: true,
    maxAttempts: 2,
  },
  "build-proposal": {
    id: "build-proposal",
    owner: "coordinator",
    output: "proposal-package",
    blocking: true,
    maxAttempts: 2,
  },
  "design-qa": {
    id: "design-qa",
    owner: "quality",
    output: "design-qa-report",
    blocking: true,
    maxAttempts: 2,
    retryFrom: "build-proposal",
  },
  "human-approval": {
    id: "human-approval",
    owner: "human",
    output: "approval-record",
    blocking: true,
    maxAttempts: 1,
    humanGate: true,
  },
  implementation: {
    id: "implementation",
    owner: "product",
    output: "implementation-result",
    blocking: true,
    maxAttempts: 2,
    requiresApproval: true,
    mutatesProduct: true,
  },
  "product-qa": {
    id: "product-qa",
    owner: "quality",
    output: "product-qa-report",
    blocking: true,
    maxAttempts: 2,
    requiresApproval: true,
    retryFrom: "implementation",
  },
  "product-pr": {
    id: "product-pr",
    owner: "github",
    output: "product-pr",
    blocking: true,
    maxAttempts: 2,
    requiresApproval: true,
    mutatesProduct: true,
  },
  "figma-backup": {
    id: "figma-backup",
    owner: "figma",
    output: "figma-backup",
    blocking: false,
    maxAttempts: 1,
    requiresApproval: true,
    optional: true,
  },
};

export const WORKFLOW_STAGES: Record<ChangeLane, WorkflowStage[]> = {
  "Fast Lane": [
    "intake",
    "analyze",
    "compile-contract-lock",
    "research",
    "context-lock",
    "build-proposal",
    "design-qa",
    "human-approval",
    "implementation",
    "product-qa",
    "product-pr",
    "figma-backup",
  ],
  Standard: [
    "intake",
    "analyze",
    "compile-contract-lock",
    "research",
    "context-lock",
    "direction-lock",
    "design-lock",
    "build-proposal",
    "design-qa",
    "human-approval",
    "implementation",
    "product-qa",
    "product-pr",
    "figma-backup",
  ],
  Major: [
    "intake",
    "analyze",
    "compile-contract-lock",
    "research",
    "context-lock",
    "direction-lock",
    "design-lock",
    "production-lock",
    "build-proposal",
    "design-qa",
    "human-approval",
    "implementation",
    "product-qa",
    "product-pr",
    "figma-backup",
  ],
};

const NON_AGENT_STAGES = new Set<WorkflowStage>([
  "intake",
  "analyze",
  "compile-contract-lock",
  "human-approval",
]);

export function getWorkflowStages(lane: ChangeLane) {
  return WORKFLOW_STAGES[lane];
}

export function getAgentStages(lane: ChangeLane) {
  return getWorkflowStages(lane).filter((stage) => !NON_AGENT_STAGES.has(stage));
}

export function isWorkflowStage(value: string): value is WorkflowStage {
  return value in WORKFLOW_STAGE_DEFINITIONS;
}

export function getWorkflowStageDefinition(stage: WorkflowStage) {
  return WORKFLOW_STAGE_DEFINITIONS[stage];
}

export function getNextWorkflowStage(lane: ChangeLane, stage: WorkflowStage) {
  const stages = getWorkflowStages(lane);
  const index = stages.indexOf(stage);
  return index >= 0 ? stages[index + 1] : undefined;
}

export function requiresHumanApproval(lane: ChangeLane, stage: WorkflowStage) {
  const stages = getWorkflowStages(lane);
  return stages.indexOf(stage) > stages.indexOf("human-approval");
}

export function deriveQaReportStatus(checks: QaCheck[]): QaReportStatus {
  if (checks.some((check) => check.severity === "blocking" && check.status !== "passed")) {
    return "failed";
  }
  if (checks.some((check) => check.status !== "passed")) {
    return "review";
  }
  return "passed";
}

const MAJOR_SIGNALS = [
  "new route",
  "route structure",
  "navigation model",
  "information architecture",
  "new product object",
  "state ownership",
  "replace journey",
  "breaking",
  "新路由",
  "導覽架構",
  "資訊架構",
  "新產品物件",
  "狀態歸屬",
  "重新設計整個流程",
];

const STANDARD_SIGNALS = [
  "new state",
  "loading state",
  "empty state",
  "error state",
  "approval",
  "new mobile",
  "mobile layout",
  "responsive rule",
  "breakpoint behavior",
  "accessibility",
  "a11y",
  "i18n",
  "token",
  "contract",
  "journey",
  "新狀態",
  "錯誤狀態",
  "空狀態",
  "新增手機",
  "手機版面",
  "響應式規則",
  "設計規則",
  "體驗合約",
];

function includesAnyAffirmative(value: string, signals: string[]) {
  return signals.some((signal) => {
    let cursor = value.indexOf(signal);
    while (cursor >= 0) {
      const context = value.slice(Math.max(0, cursor - 36), cursor);
      if (!/(?:do not|don't|without|must not|不要|不需|不得|不可)/.test(context)) {
        return true;
      }
      cursor = value.indexOf(signal, cursor + signal.length);
    }
    return false;
  });
}

export function analyzeChangeRequest(prompt: string, journeyRouting: JourneyRoutingRule[] = []): ChangeAnalysis {
  const normalized = prompt.trim().toLowerCase();
  const major = includesAnyAffirmative(normalized, MAJOR_SIGNALS);
  const standard = !major && includesAnyAffirmative(normalized, STANDARD_SIGNALS);

  const lane: ChangeLane = major ? "Major" : standard ? "Standard" : "Fast Lane";
  const evidence = major
    ? [
        "The request changes product structure, navigation, or state ownership.",
        "A full contract diff and SanStudio gate sequence are required.",
      ]
    : standard
      ? [
          "The request expands an existing journey, state, or cross-viewport rule.",
          "Affected contract sections need review before development.",
        ]
      : [
          "The request stays inside an existing journey and interaction pattern.",
          "No new product object, route, or state owner was detected.",
        ];

  const journeys = new Set<string>();
  for (const route of journeyRouting) {
    if (includesAnyAffirmative(normalized, route.keywords)) journeys.add(route.id);
  }
  if (journeys.size === 0) {
    journeys.add("needs-journey-resolution");
  }

  return {
    lane,
    evidence,
    contracts:
      lane === "Fast Lane"
        ? ["brand-design", "product-qa"]
        : ["brand-design", "brand-taste", "product-experience", "product-qa"],
    journeys: [...journeys],
    qa: [
      "Contract lint",
      "Affected scenario assertions",
      "Responsive behavior",
      "Accessibility",
      "Visual comparison",
    ],
  };
}
