# Content product knowledge

This folder is the repository source of truth for Agent Native Content's accepted
product direction. It gives contributors and coding agents enough context to
change Content without relying on private conversations or a particular
person's computer.

Start with:

- [Architecture](architecture.md) for the product invariants.
- [Roadmap](roadmap.md) for the six public Chapters and their complete user
  workflows.
- [Capability encyclopedia](encyclopedia.md) for the atomic contracts and
  dependency graph beneath those workflows.

The roadmap and encyclopedia are deterministic projections. Edit the atomic
records in `chapters/`, `features/`, and `capabilities/`, then run:

```sh
pnpm guard:content-product-docs --write
pnpm guard:content-product-docs
```

## The record hierarchy

| Record     | Meaning                                                               |
| ---------- | --------------------------------------------------------------------- |
| Chapter    | A large public promise and ordering boundary.                         |
| Feature    | A complete workflow an audience can understand and use.               |
| Capability | One reusable primitive, surface, or workflow with its own proof gate. |
| Increment  | A named deepening of one Feature, stored with that Feature.           |

A Feature can require several Capabilities, and one Capability can enable
several Features. Completion therefore forms a graph rather than a ceremonial
checklist. Dependencies describe the complete logical contract even when the
dependency already exists.

## Capability mini-specs

A Capability record must stand on its own. Frontmatter makes the graph
queryable; the body teaches a source-blind contributor what the contract
actually means. Version 2 records include:

- **Why this exists:** the human problem, not an architectural noun.
- **Example workflow:** one concrete end-to-end use case.
- **Product contract:** settled interactions, identities, authority, failure,
  deletion, retry, concurrency, or degraded-state behavior that matters for
  this Capability.
- **Boundaries and non-goals:** which adjacent Capability owns neighboring
  concerns and which tempting parallel systems must not be created.
- **Acceptance stories:** at least two independently named Given/when/then
  scenarios a developer can execute.
- **Current evidence:** what the repository actually proves today, what is only
  reusable donor machinery, and what is missing.
- **Proof plan:** the deterministic and real-interface evidence required to
  change the state.
- **Open questions:** only decisions that are genuinely unresolved. A settled
  decision omitted by an old summary is not an open question.

Use `primary_user_job` to make the record discoverable by intent. Use several
concrete `proof_requirements`, not one comma-heavy sentence pretending to be a
test plan. A mini-spec may add relevant sections, but it must not omit the core
ones above. These records preserve public product conclusions; private
conversations, review mechanics, names, local paths, and source links stay out
of the repository.

## Truthful status

Roadmap status describes a whole Feature:

- `available`: the complete example workflow has current end-to-end proof.
- `in_validation`: the workflow exists and is being hardened.
- `partially_implemented`: useful pieces exist, but the workflow is incomplete.
- `planned`: the shape is approved and ordered.
- `paused`: work deliberately stopped while its context remains preserved.

Capability state describes one atomic contract:

- `verified`, `failing`, `stale`, `in_progress`, `approved_shape`, `exploring`,
  `deferred`, or `superseded`.

Donor code and finished dependencies do not make a Feature complete. A Feature
becomes `available` only when every required Capability is verified and the
Feature's own example workflow passes end to end.

## Normalization ledger

The original research used a few provisional or partial names. This repository
normalizes them deliberately:

- The incomplete `content.diff` token and the provisional
  `content.diff.in-place-review` name resolve to `content.diff.in-place`.
- The provisional `content.query.typed` name resolves to
  `content.query.object` for the durable object and `content.view.source-query`
  for cross-source composition.
- Presets collapsed into Templates. `content.preset.catalog` remains only as a
  superseded lineage record.
- Separate PDF and EPUB product identity collapsed into the shared Reader.
  `content.reader.documents` points to `content.reader.surface`.
- Local mode collapsed into governed Sources. `content.source.local-project`
  points to `content.source.adapters`.
- The materialized multi-source row-union interface is donor machinery rather
  than the future product model. `content.source.row-union` points to
  `content.view.source-query`.

## Change policy

Repairing a bug against an accepted record does not require a new product
debate. A change to identity, permissions, source truth, shared primitives, or
the user promise does. Preserve the concrete problem and tradeoff in the pull
request, then update these records when the decision is accepted.

The catalog is a compass, not a velvet rope. Good small fixes and new ideas are
welcome; they simply should not arrive disguised as architecture that everyone
already agreed to.
