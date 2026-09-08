# Sanbuilder

Sanbuilder is the public, product-neutral distribution of Design Harness: one installable design-agent plugin that turns a request into research, meaningfully different directions, an approval-bound proposal, product implementation, QA evidence, and an optional draft PR.

Production code remains product truth. Mockups and Figma are review surfaces. The agent cannot write a product repository until a human approves the exact proposal digest.

## What ships here

- one `design-harness-agent` plugin for Codex and Claude
- brand → product → adapter configuration and scoped design memory
- a portable local coordinator with digest-bound approval gates
- configurable Mobbin, visual-reference, GitHub, browser, and Figma capabilities
- a deliberately fictional Atlas example that makes the configuration inspectable

The Atlas adapter is not a live delivery target. Replace every sample contract, repository pin, environment, and memory file with your own before enabling product writes.

## Install and connect

Clone or install this repository as a plugin in your agent client. In each product repository, add this to `AGENTS.md` (or the equivalent instruction file):

```md
## Design Harness

Before handling design or UX work, read the installed Sanbuilder plugin.

Resolve this repository as:

- product: <product id>
- adapter: <adapter id>
- environment: <environment id>

Treat the Harness as read-only.
Treat this product repository as the only writable repository after approval.
```

Then begin a task with:

```text
Use the connected Design Harness.
```

MCP credentials stay in Codex, Claude, or your MCP client. Do not commit them here. Capability aliases are declared in `config/design-capabilities.yml`.

## Configure a portfolio

1. Replace the Atlas sample under `brands/`, `products/`, `adapters/`, `contracts/`, and `memory/`.
2. Register the hierarchy in `portfolio.yml`.
3. Pin each writable adapter to an exact repository, base branch, commit, and environment.
4. Run `npm run generate:catalog` and commit the generated catalog.
5. Run `npm test`.

Run state belongs outside Git worktrees. Use `npm run design-agent -- --help` for the local coordinator. Add the optional [Sanbuilder GameKit](https://github.com/sander217/sanbuilder-gamekit) when designing H5 mobile games.

## Generated distribution

This repository is generated from a private authoring source through an allowlist and privacy scan. Propose core changes upstream; do not maintain a second divergent implementation here.

No open-source license has been declared yet. Public visibility permits inspection but does not grant reuse rights beyond applicable law.
