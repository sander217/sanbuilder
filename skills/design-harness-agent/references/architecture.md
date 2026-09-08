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

Versions and references are adapters or authorities, not automatically separate brands. For example, Atlas Legacy may remain a visual reference adapter while Atlas Web is the active Atlas Web delivery adapter.

## Onboarding

Create the brand and product profiles before enabling delivery. An active brand needs an approved design contract, taste profile, and brand memory file. An active product needs its inherited brand contract, product experience contract, QA policy, product memory, and at least one exact adapter. A delivery adapter needs an exact repository, base branch, full commit, supported environment, native commands, pre-approval read-only policy, isolated `codex/*` write policy, draft-only PR policy, and human merge authority.

Keep incomplete products in `onboarding`. They may appear in the catalog and Contract Studio, but they cannot compile a delivery contract lock.

## Multi-app repositories

Use one product profile per independently designed and released application. If several applications share a monorepo, give each adapter a non-overlapping path scope and its own journeys and QA commands. Cross-product work requires one proposal that names every affected product and separate implementation targets; never infer permission to write sibling products.

## Contract change ownership

Brand changes affect every child product and use a brand-scoped contract proposal. Product journey, platform, state, or QA changes remain product-scoped. Adapters contain operational mappings, never brand taste. Credentials and MCP endpoints remain client configuration.
