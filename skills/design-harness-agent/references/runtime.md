# Portable run coordinator

Use the local coordinator when a hosted Harness API is not connected. It stores run state outside every Git worktree by default, so intake and design work cannot dirty the product repository.

## Start or resume

Create a temporary JSON request containing `prompt` and any optional `brandId`, `productId`, `adapterId`, `environment`, `title`, `sources`, `nonGoals`, `acceptanceCriteria`, `constraints`, `locale`, and `mode`. A source has a `kind`, `label`, and either `content` or `uri`.
Write temporary request and artifact files to the operating-system temporary directory or the external run-state directory, never into a product worktree.

```json
{
  "title": "Project Assistant empty state",
  "prompt": "Improve the Project Assistant empty state without changing the existing journey.",
  "brandId": "atlas",
  "productId": "atlas-web",
  "adapterId": "atlas-web",
  "environment": "uat",
  "sources": [
    {
      "kind": "ticket",
      "label": "Product ticket",
      "uri": "https://example.invalid/ticket/123"
    }
  ],
  "nonGoals": ["Do not change navigation"],
  "mode": "delivery"
}
```

Start the run:

```bash
node <plugin-root>/scripts/design-agent-run.mjs start --request <request-json>
```

Keep the returned run ID. To resume:

```bash
node <plugin-root>/scripts/design-agent-run.mjs status --run <run-id>
```

The default state location is `~/.local/state/design-harness-agent/runs`. Override it with `DESIGN_HARNESS_AGENT_STATE` only when the chosen absolute directory is outside all Git worktrees. The legacy `SANBUILDER_AGENT_STATE` variable remains a temporary compatibility alias.

Every mutating command for one run is serialized by an exclusive lock in `<state-store>/.locks`; `status` remains readable while that lock is held. The coordinator never steals an existing or stale-looking lock. If a command reports an abandoned lock, verify that the recorded PID is no longer running, then remove only the exact lock path printed in the error and retry.

## Harness release provenance

`start` will not compile a contract lock from an unverified Harness copy:

- In a Git checkout, it records the full `HEAD` commit only when the checkout is clean, the normalized `origin` is exactly `sander217/sanbuilder`, GitHub resolves that exact commit, and it is reachable from the default branch, a published branch head, or the plugin's exact version ref. An untracked `.in_use` file or descendants are allowed because Claude may create that installation marker; every other tracked or untracked change blocks the run. A clean fork, wrong origin, or unpushed local commit is rejected.
- In a plugin cache without `.git`, it queries `sander217/sanbuilder` through GitHub's REST API. Public access requires no token. If `GITHUB_TOKEN` or `GH_TOKEN` is already configured, the request uses it for authenticated access and a higher rate limit.
- The remote fallback computes each local file's Git blob SHA and compares the complete critical inventory with one GitHub commit tree. That inventory covers the coordinator and dependency scripts, coordinator libraries and generated validators, coordinator skill, portfolio catalog, active brand/product/adapters, scoped memory, compiled contract inputs, workflow, and all artifact schemas. The exact list is exported as `HARNESS_RELEASE_CRITICAL_FILES` from `lib/release-provenance.mjs`.
- Candidate order is the repository's current default-branch commit, exact `v<manifest-version>` and `<manifest-version>` refs, then recent commits that changed `.codex-plugin/plugin.json`. Release commits should therefore be tagged `v<manifest-version>`.

Both checkout forms deliberately fail closed when GitHub cannot be reached, its API rate limit is unavailable, or the commit cannot be attributed to a published canonical ref. The no-`.git` path additionally rejects a truncated tree response, missing critical file, or any critical-byte difference. It does not attest non-critical documentation, screenshots, or installer metadata, because those files do not affect the portable execution and contract boundary. There is no environment variable that can self-assert a Harness release commit.

## Execute an internal stage

Before doing work, acquire the current stage:

```bash
node <plugin-root>/scripts/design-agent-run.mjs begin --run <run-id>
```

Perform only the returned stage and write its structured result to a temporary JSON file. Submit it using the same stage ID:

```bash
node <plugin-root>/scripts/design-agent-run.mjs submit \
  --run <run-id> \
  --stage <stage-id> \
  --artifact <artifact-json>
```

Continue until the coordinator returns `awaiting-approval`, `blocked`, `completed`, or `completed-with-warnings`. On a real stage failure, record it instead of inventing an artifact:

```bash
node <plugin-root>/scripts/design-agent-run.mjs fail --run <run-id> --reason <concise-reason>
```

The coordinator enforces stage order, attempt limits, artifact lineage, and post-approval gates. Never bypass it by writing a later artifact directly.

If research or Context Lock discovers a material scope expansion, upgrade the run before submitting that stage:

```bash
node <plugin-root>/scripts/design-agent-run.mjs upgrade \
  --run <run-id> \
  --lane <standard-or-major> \
  --reason <scope-evidence> \
  --actor <agent-identity>
```

The command accepts only a stricter lane and records the decision in the trace. It refuses changes after Context Lock, after authorization, or after later design evidence exists. Start a new run when scope expands beyond that safe boundary.

`delivery` is the only mode that can advance into product work. `proposal` and `dry-run` stop at the recorded human decision.

## Approval

At `human-approval`, show the proposal and its exact `sha256:` digest. Do not call the approval command until the user approves that displayed proposal.

```bash
node <plugin-root>/scripts/design-agent-run.mjs approve \
  --run <run-id> \
  --proposal-digest <displayed-digest> \
  --actor <approver-identity>
```

Use `reject` with the same arguments when the user rejects it. A changed proposal receives a new digest and invalidates the older approval.

The portable command records a conversation-attested decision; `--actor` is an audit label, not authentication. For a tamper-resistant organizational approval, use the hosted Harness API, its authenticated ingress identity, and `HARNESS_APPROVER_EMAILS`.

The `implementation` begin command is the final mandatory check before editing the product repository. It fails unless the approval digest and immutable contract-lock digest match the current run. On its first acquisition it also records a deterministic `implementationTarget`, including the only allowed `workingBranch`; create or resume exactly that branch before writing any product file.

An implementation attempt always returns `implementation-result.schema.json`, including when it fails or is cancelled; the generic `fail` command is intentionally rejected for this stage. Set `writeStarted` explicitly. A successful result requires `writeStarted: true`, a `headCommit`, and at least one commit. A failure before any product write uses `writeStarted: false`, empty `files` and `commits`, and no `headCommit`; a partial write uses `writeStarted: true` and records every known file, command, and commit. On retry, obey `implementationTarget`/`implementationContinuation`: resume its exact repository, base commit, and `workingBranch`, use `priorEvidence`, and never create a replacement branch.

## Optional Figma destination grant

Product approval does not authorize a Figma write. After the draft-PR artifact advances the run to `figma-backup`, ask the human for one exact Figma design/file URL and acquire a separate grant before opening or changing that file:

```bash
node <plugin-root>/scripts/design-agent-run.mjs authorize-figma \
  --run <run-id> \
  --file-url <https://www.figma.com/design/...> \
  --actor <approver-identity>
```

The grant records a canonical file URL and key and binds them to the current product-PR digest. It is immutable for the run. A completed artifact must report that exact destination. Without a grant, begin the stage and submit only a structured `skipped` result with a reason; do not call the generic `fail` command or touch Figma. As with portable proposal approval, `--actor` is conversation-attested rather than authenticated. The hosted API derives the actor from trusted ingress.

## Artifact contracts

Use the schemas in `<plugin-root>/schemas`:

| Stage | Required artifact |
|---|---|
| research | `research-report.schema.json` |
| context-lock / direction-lock / production-lock | `sanstudio-gate.schema.json` |
| design-lock / build-proposal | `design-proposal.schema.json` |
| design-qa | `design-qa-report.schema.json` |
| implementation | `implementation-result.schema.json` |
| product-qa | `product-qa-report.schema.json` |
| product-pr | `product-pr.schema.json` |
| figma-backup | `figma-backup.schema.json` |

The proposal declares `production-code` as product truth and contains the comparable direction set. Preview HTML, images, or Figma nodes are non-authoritative references. Product QA must pass before a draft PR can be recorded; it may propose scoped memory updates but cannot publish them. The Figma backup is optional and may complete the run with a warning, but it cannot change the approved implementation or choose its own destination.
