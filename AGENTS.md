# Sanbuilder Design Harness

This repository is a portfolio-level control plane and installable `design-harness-agent` plugin. It is a design pipeline, not a product repository.

## Authority

- A private Contract Pack owns brand/product contracts, adapters, scenarios, and durable memory for one access domain.
- A product repository may bind exactly one pack at one immutable commit through `.design-harness/target.yml`.
- The bundled `portfolio.yml` is a neutral example and fallback for unbound evaluation.
- A brand owns identity, visual language, voice, taste, and brand memory.
- A product inherits its brand and owns platform-specific experience, QA, and product memory.
- An adapter binds one product to an exact repository, base branch, revision, runtime, and environment.
- Production code remains product truth. Mockups and Figma are optional proposal and review surfaces.

## Entry point

Treat `Use the connected Design Harness.` as the canonical request. Use `skills/design-harness-agent/SKILL.md`; do not require the user to invoke internal stages separately.

When a product binding exists, validate and sync it with `scripts/sync-contract-packs.mjs`, then resolve the target from that pack's generated catalog. Read only that returned read-only checkout; never enumerate or fall back to another private pack. Without a binding, resolve the neutral example from `config/product-catalog.generated.json`. Verify immutable external dependencies before use. Connected MCP credentials are client configuration; never store credentials in this repository.

The included Atlas portfolio and `example/atlas-web` adapter are fictional. Refuse delivery until the adopter replaces them with exact, verified product configuration.

## Workflow

1. Resolve brand, product, adapter, and environment and compile an immutable contract lock.
2. Read brand taste, scoped memory, product contracts, production code, and supplied evidence.
3. Use connected research and visual-reference tools only when they can change the decision.
4. When a meaningful choice exists, normally create three product-native directions that differ in composition, interaction, hierarchy, or information architecture.
5. Convert the selected direction into one digest-bound proposal and run design QA.
6. Wait for explicit approval of that exact proposal before writing product code.
7. Implement only the approved scope on an isolated product branch.
8. Run repository-native tests and journey QA; record evidence and proposed memory updates.
9. Open a draft product PR only when requested. Never merge without separate authorization.
10. Create an optional Figma backup only with an exact destination grant after product QA and PR recording.

## Change lanes

- Fast Lane: existing journey and patterns, no new contract rule or material direction choice.
- Standard: meaningful design choice, new state, responsive or accessibility behavior, or compatible contract addition.
- Major: new product object, route, navigation model, state owner, or breaking journey change.

Upgrade the lane if scope expands. Never downgrade it to bypass a gate.

## Safety

- Agents may propose contract and memory diffs; they may not silently publish official changes.
- Initial implementation intent is not approval of a proposal that did not yet exist.
- Material proposal changes invalidate approval.
- Figma writes require a second human grant for one exact file and the current product-PR digest.
- During product delivery, only the catalog-resolved active product repository may become writable, and only after approval and coordinator authorization.
