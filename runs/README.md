# Run artifacts

One design request creates one ordered, digest-linked run. Do not create separate runs for internal agents, reuse a mutable contract lock, or copy run state into a product repository.

The portable coordinator stores generated runs outside Git by default:

```text
~/.local/state/design-harness-agent/runs/<run-id>/
├── run.json
└── artifacts/
    ├── intake-<digest>.json
    ├── analyze-<digest>.json
    ├── compile-contract-lock-<digest>.json
    ├── research-<digest>.json
    ├── context-lock-<digest>.json          # Standard and Major
    ├── direction-lock-<digest>.json        # Standard and Major
    ├── design-lock-<digest>.json           # Standard and Major
    ├── production-lock-<digest>.json       # Major only
    ├── build-proposal-<digest>.json
    ├── design-qa-<digest>.json
    ├── implementation-<digest>.json
    ├── product-qa-<digest>.json
    ├── product-pr-<digest>.json
    └── figma-backup-<digest>.json
```

`run.json` records the lane, current stage, attempts, warnings, artifacts, and digest-bound approval. The contract lock pins the Harness source, brand profile, product profile, brand design and taste, scoped memory, product experience, product adapter and source commit, QA policy, Research Synthesis commit, and SanStudio commit.

## Gate and lineage rules

- Research is derived from the intake and immutable dependency pins.
- The final `build-proposal` artifact declares `production-code` as product truth, includes the reviewed direction set, and must be `ready-for-approval`.
- Design QA names the current proposal digest and must pass before the human gate.
- Human approval records the exact proposal and contract-lock digests. A changed proposal cannot reuse it.
- No product file may be written before the coordinator grants `implementation`.
- The implementation result names the approved proposal and approval digests.
- Product QA names the implementation-result digest and must pass. It may contain brand/product memory proposals, but cannot publish them.
- The product PR names the passing QA digest and must remain a draft.
- Figma backup names the product PR digest. It is optional and non-authoritative. A completed write must match a separate, immutable human grant for one exact Figma file; with no grant, only a `skipped` result is valid.

Use the JSON schemas in `schemas/` for every submitted stage artifact. See `skills/design-harness-agent/references/runtime.md` for the coordinator commands used to start, acquire, submit, approve, reject, fail, and resume a run.
