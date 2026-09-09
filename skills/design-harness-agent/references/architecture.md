# Brand and product architecture

Use this reference when adding products, resolving a multi-app repository, or changing contract inheritance.

## Hierarchy

```text
portfolio
└── brand
    ├── brand design contract
    ├── taste profile and brand memory
    └── product
        ├── product experience and QA contracts
        ├── product memory
        └── adapter
            └── environment
```

A brand owns cross-product identity: visual language, voice, shared tokens, signature behavior, taste, and anti-patterns. A product is one application users operate, such as a Web App, Mobile App, or Management Console. An adapter binds that product to one exact repository, base branch, immutable revision, runtime, test suite, and environment.

## Contract packs and access boundaries

The Harness engine and design data are separate authorities. One engine may load many contract packs in the private authoring environment, but each product session binds to exactly one pack at one commit.

Use one contract-pack repository per real access domain—not one per screen or feature. One team pack may contain that brand's Web, Mobile, and Console products. A separately owned brand belongs in another private pack when the first team must not read it. GitHub repository access, not folders or `CODEOWNERS`, is the confidentiality boundary.

The product repository stores `.design-harness/target.yml`:

```yaml
schema: 1
contractPack:
  id: example-brand
  repository: example-org/example-brand-design-contracts
  baseBranch: main
  revision: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
target:
  brand: example-brand
  product: example-web
  adapter: example-web-uat
  environment: uat
```

The revision must be a full commit. The client fetches it to an external read-only cache. Never store credentials in the binding, copy one pack into another, or let a product session fall back to another pack when access fails.

Contract updates are ordinary reviewed pull requests in the pack repository. After merge, separately review and update product bindings and any private authoring pin. This prevents an unreviewed contract change from silently changing an existing run.

Versions and references are adapters or authorities, not automatically separate brands. For example, Atlas Legacy may remain a visual reference adapter while Atlas Web is the active Atlas Web delivery adapter.

## Onboarding

Create the brand and product profiles before enabling delivery. An active brand needs an approved design contract, taste profile, and brand memory file. An active product needs its inherited brand contract, product experience contract, QA policy, product memory, and at least one exact adapter. A delivery adapter needs an exact repository, base branch, full commit, supported environment, native commands, pre-approval read-only policy, isolated `codex/*` write policy, draft-only PR policy, and human merge authority.

Keep incomplete products in `onboarding`. They may appear in the catalog and Contract Studio, but they cannot compile a delivery contract lock.

## Multi-app repositories

Use one product profile per independently designed and released application. If several applications share a monorepo, give each adapter a non-overlapping path scope and its own journeys and QA commands. Cross-product work requires one proposal that names every affected product and separate implementation targets; never infer permission to write sibling products.

## Contract change ownership

Brand changes affect every child product and use a brand-scoped contract proposal. Product journey, platform, state, or QA changes remain product-scoped. Adapters contain operational mappings, never brand taste. Credentials and MCP endpoints remain client configuration.
