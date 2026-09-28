# Taste and memory discipline

Use this reference when interpreting preferences, producing alternatives, or proposing a durable memory update.

## Three memory scopes

- Run memory stores exact inputs, research, artifacts, approval, implementation, QA, and remaining uncertainty. It is immutable evidence and does not automatically change future behavior.
- Product memory stores platform and journey decisions that should recur only in one application.
- Brand memory stores stable cross-product taste, voice, signature patterns, and anti-patterns.

Read `config/memory-policy.yml`, the active brand memory, and the active product memory. Treat accepted items as prior decisions, not universal laws. Honor their `appliesTo` and `reviewWhen` boundaries.

## Learning from choices

When the human selects or rejects a direction, record the selected direction, rejected alternatives, their meaningful differences, and the human's stated reason in the run trace. A durable memory proposal needs:

- one atomic statement;
- `brand` or `product` scope;
- evidence source and proposal/QA digest;
- confidence;
- where it applies;
- a review trigger;
- accepted, proposed, superseded, or rejected status.

Selection without a reason is weak evidence. Repetition across approved work can raise confidence, but only an explicit human decision can promote it to brand authority. Never infer broad taste from one local compromise, deadline, technical limitation, or A/B test.

## Producing alternatives

Use remembered taste to set boundaries, then explore within them. Show meaningful choices instead of many cosmetic permutations. A useful comparison makes it possible to answer:

- Which user behavior does this direction prioritize?
- What makes it recognizably part of the brand?
- Which existing product patterns does it reuse or challenge?
- What becomes easier or harder to implement and maintain?
- Which assumption would most change the choice?

The chosen result becomes a digest-bound proposal. Memory changes are explicit proposal children; they never mutate because the model liked its own output.
