---
name: design-harness-agent
description: Run an end-to-end product-design pipeline for a registered brand and product from prompts, screenshots, conversations, research, or tickets through evidence, taste-aware alternatives, human selection, approved production implementation, QA, and a draft pull request. Use when the user says "Use the connected Design Harness" or asks the Harness to design or improve a registered product.
---

# Design Harness Agent

Operate the Harness as one intelligent design pipeline. The user supplies a need and evidence; the coordinator selects the relevant internal work, tools, and depth. Do not make the user invoke each stage separately or manually maintain workflow artifacts.

Treat `Use the connected Design Harness.` as the canonical entrypoint. The remaining message supplies the request, evidence, desired output, and any limits.

The pipeline must stay adaptive. Stage boundaries preserve evidence, approval, and write safety; they are not a substitute for judgment. Infer ordinary design details from the active brand, product, production code, and remembered decisions. Ask only when a missing choice would materially change the result.

## Resolve the installed Harness

Locate the plugin root by walking upward from this file until `portfolio.yml`, `config/agent-dependencies.json`, and `workflows/change-run.yml` are present. Do not assume a user-specific install path.

In the active product repository, look for `.design-harness/target.yml`. When present, it is the only contract-pack connection for that product session:

1. Validate that it names one exact GitHub repository, full commit, brand, product, adapter, and environment.
2. Run `node <plugin-root>/scripts/sync-contract-packs.mjs check --binding <binding-path> --json`; if missing, run `sync` once and check again.
3. Read only the returned immutable, read-only checkout. Never enumerate or load a different private pack merely because the authoring portfolio knows it exists.
4. Pass `--binding <binding-path>` when starting the portable coordinator.

The binding may not point at a branch or floating tag. A product repository can update its pinned contract revision through normal review, but an agent may not silently advance it.

Read the active product repository instructions, then resolve four coordinates:

- `brand`: the shared identity and taste authority;
- `product`: one deliverable application under that brand;
- `adapter`: its exact repository/runtime bridge;
- `environment`: the revision and runtime being evaluated.

Without a product binding, read `portfolio.yml` and `config/product-catalog.generated.json`; authoring installations may aggregate separately pinned contract packs. The generated catalog must match its YAML and pack pins. Refuse a delivery run for an `onboarding` brand/product, a reference-only adapter, an unknown environment, or an unpinned repository revision. Read [references/architecture.md](references/architecture.md) when onboarding a brand/product, changing inheritance, managing a contract pack, or selecting among multiple adapters.

Treat repositories under the reserved `example/` owner and adapter restrictions beginning with `replace-this-sample` as documentation fixtures. Refuse delivery until the maintainer replaces the fixture with an exact repository, base branch, immutable revision, runtime, and approved environment.

## Resolve dependencies and tools

Before interpreting evidence or invoking a SanStudio gate:

1. Run `node <plugin-root>/scripts/sync-agent-dependencies.mjs check --json`.
2. If a pinned dependency is absent, run the command with `sync`, then check again.
3. Use only the returned immutable Research Synthesis and SanStudio paths.
4. Never edit, commit, pull, reset, or generate artifacts inside dependency checkouts.

Read `config/design-capabilities.yml` to select connected tools. Use Mobbin for relevant interaction precedents and A1 Gallery or image search for art-direction evidence when available. Missing optional design tools are evidence gaps, not reasons to invent findings or block otherwise sufficient work. MCP credentials belong to the client, never to Harness, brand, product, or adapter files.

Use [references/runtime.md](references/runtime.md) for portable coordinator commands. Acquire every executable stage before doing its work and submit its structured artifact afterward. Do not simulate a completed stage in prose.

## Compile brand, product, taste, and memory

Every run separately pins the Harness source, contract-pack source, brand profile, product profile, brand design contract, brand taste profile, brand memory, product memory, product experience contract, adapter revision, QA policy, Research Synthesis revision, and SanStudio revision.

Apply authority in this order:

1. Harness safety and workflow policy;
2. brand design and taste;
3. product experience, platform rules, and reviewed product overrides;
4. exact adapter/environment and production code;
5. current run evidence and explicit user direction.

Production code remains implementation truth. A lower layer may extend a higher one. A conflict requires an explicit, reviewable override; never create a silent product fork.

Read [references/memory-and-taste.md](references/memory-and-taste.md) whenever using prior preference, recording feedback, comparing directions, or proposing durable memory.

## Run the design pipeline

### Intake and decision framing

Capture prompts, screenshots, conversations, tickets, URLs, research, and observed production state. Separate facts, interpretations, hypotheses, constraints, acceptance criteria, and explicit non-goals. Classify the change lane and compile the immutable lock before creating design artifacts.

Use the pinned Research Synthesis skill to identify the decision, evidence quality, uncertainty, and relevant user behavior. Research only questions that could change a direction or acceptance criterion.

### Taste-aware direction exploration

Inspect the brand taste profile, brand memory, product memory, current production UI, and connected precedent tools. Turn them into concrete visual constraints for this problem: hierarchy, density, geometry, typography, color, imagery, motion, content tone, and interaction feedback.

Unless the user asks for one direction or the change is mechanically constrained, present multiple meaningfully different solutions. Normally produce three; use fewer or more when the decision warrants it. Alternatives must differ in information architecture, interaction, composition, or visual emphasis—not merely colors. Each direction must declare `differenceAxes` and carry its own digest-bound mockup evidence; changing only its id or name does not count as a distinct direction.

For each direction include:

- a mockup or visual comparison at the most decision-relevant state and viewport;
- the user problem it optimizes;
- its fit with remembered brand taste and product behavior;
- important tradeoffs, implementation impact, and risks;
- evidence used and unresolved assumptions.

Mockups are proposal evidence. Generate them as run artifacts outside the product worktree before approval. Do not duplicate production UI into the Harness or present SanStudio HTML, screenshots, generated images, or Figma nodes as product truth.

Let the human select, combine, or reject directions. Record the reason when provided. A selected direction still becomes one production-oriented proposal and passes design QA before approval.

### Production proposal and approval

The proposal must define affected journeys and scenarios, state and responsive matrices, accessibility and content behavior, motion intent, components to reuse/extend/add, contract diffs, implementation outline, acceptance criteria, QA plan, and non-goals. Bind the proposal to its inputs and exact digest.

Wait for explicit human approval of that exact proposal. Earlier implementation intent, selection of a rough direction, or approval of a different digest is insufficient. Material changes invalidate the decision.

Only a `delivery` run can continue. Acquire the coordinator's `implementation` stage immediately before the first product write.

### Implementation, QA, and delivery

Write only the active approved product repository, on the coordinator-supplied `codex/*` branch, and only within approved scope. Reuse product-native components and design tokens. Complete relevant states, responsive behavior, accessibility, content, and motion rather than implementing only the showcased mockup.

Run repository-native checks plus affected Harness journey, browser, accessibility, and visual QA. Record all implementation and QA evidence. Blocking failures stop advancement. A fix that materially changes the approved direction returns to proposal review.

When requested, open a draft product PR after QA passes. Never merge without separate authorization. Figma backup remains optional and requires its separate exact-file, product-PR-digest-bound human grant.

## Durable memory

At completion, classify useful learning as run-only, product, or brand scope. Keep raw observations in the run trace. Propose durable product/brand memory only when supported by explicit human feedback, an approved proposal, or shipped QA evidence. Never let the agent silently turn its own preference into taste authority.

A successful handoff reports the selected direction, exact approval, product commit or draft PR, QA status, run ID, locked revisions, proposed memory updates, and remaining risks.
