# Sanbuilder

Sanbuilder is the public, product-neutral distribution of Design Harness: one installable design-agent plugin that turns a request into research, meaningfully different directions, an approval-bound proposal, product implementation, QA evidence, and an optional draft PR.

Production code remains product truth. Mockups and Figma are review surfaces. The agent cannot write a product repository until a human approves the exact proposal digest.

## What ships here

- one `design-harness-agent` plugin for Codex and Claude
- brand → product → adapter configuration and scoped design memory
- a portable local coordinator with digest-bound approval gates
- configurable Mobbin, visual-reference, GitHub, browser, and Figma capabilities
- a deliberately fictional Atlas example that makes the configuration inspectable

The Atlas adapter is not a live delivery target. Keep it as documentation or replace it in a private fork. For team use, the recommended setup is a separate private Contract Pack and one immutable product binding.

## Install and connect

Clone or install this repository as a plugin in your agent client. Add `.design-harness/target.yml` to each product repository:

```yaml
schema: 1
contractPack:
  id: your-brand
  repository: your-org/your-brand-design-contracts
  baseBranch: main
  revision: <full 40-character commit>
target:
  brand: your-brand
  product: your-product
  adapter: your-adapter
  environment: uat
```

Then add this to `AGENTS.md` (or the equivalent instruction file):

```md
## Design Harness

Before handling design or UX work, use the installed Sanbuilder plugin and this repository's `.design-harness/target.yml`.

Treat the Harness as read-only.
Treat this product repository as the only writable repository after approval.
```

Then begin a task with:

```text
Use the connected Design Harness.
```

MCP credentials stay in Codex, Claude, or your MCP client. Do not commit them here. Capability aliases are declared in `config/design-capabilities.yml`.

## Configure a Contract Pack

1. Create one private Contract Pack repository for each real access domain.
2. Add `contract-pack.yml`, its brand/product portfolio, contracts, adapters, scenarios, and scoped memory.
3. Generate and commit its `config/product-catalog.generated.json`.
4. Pin the resulting commit in the product's `.design-harness/target.yml`.
5. Run `npm run sync:contract-pack -- --binding /product/.design-harness/target.yml`.

The fetched pack is kept in an external read-only cache. A product session reads only its bound pack and never falls back to another private brand. Run state also belongs outside Git worktrees. Use `npm run design-agent -- --help` for the local coordinator. Add the optional [Sanbuilder GameKit](https://github.com/sander217/sanbuilder-gamekit) when designing H5 mobile games.

## Generated distribution

This repository is generated from a private authoring source through an allowlist and privacy scan. Propose core changes upstream; do not maintain a second divergent implementation here.

No open-source license has been declared yet. Public visibility permits inspection but does not grant reuse rights beyond applicable law.
