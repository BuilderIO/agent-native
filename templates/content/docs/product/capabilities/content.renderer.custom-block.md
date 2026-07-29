---
record_type: "capability"
spec_version: 2
id: "content.renderer.custom-block"
name: "Custom Blocks"
user_promise: "Name, govern, and reuse a safe renderer without making it a hidden application."
primary_user_job: "Adopt a governed renderer with explicit inputs and origin."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.renderer.typed", "content.source.adapters"]
related_features: ["content.feature.build-new-surfaces"]
roadmap_boundary: "feature"
acceptance_summary: "Custom Blocks have one catalog identity with personal or organization ownership and Content-managed, repository-backed, or provider-backed origin; typed props are optional, discovery is shared, runtime authority is origin-aware, one-off Artifacts promote explicitly, and export is deterministic."
proof_requirements:
  [
    "Ownership scope governs reuse and approval; origin says where source truth lives, and the axes remain independent.",
    "Slash discovery exposes governed metadata, optional typed inputs, provenance, availability, and a useful preview or fallback.",
    "Content-managed bundles receive explicit props only in a strict sandbox; source-backed code needs a trusted adapter renderer or visible fallback, and Artifact promotion creates a new catalog identity.",
    "Extensions retain their visible grants and identity; deterministic export never grants execution authority.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Custom Blocks

## Why this exists

Reusable components must be discoverable and governable without becoming opaque bundles of code with accidental powers. The source of a component and the people allowed to reuse it are separate questions that must remain visible.

## Example workflow

An operations lead approves a repository-backed status card, inserts it from slash search, binds typed props, and gets adapter fallback instead of repository execution.

## Product contract

- Ownership scope governs reuse and approval; origin says where source truth lives, and the axes remain independent.
- Every entry has stable identity plus name, description, aliases, category, compatibility, icon, ownership, origin, and optional preview metadata. Slash insertion searches that contract; `@` remains for references and expressions.
- Props are optional. A block may be a fixed renderer with no inputs or expose typed inputs that the editor validates and binds explicitly.
- Content-managed bundles receive explicit props only in a strict sandbox; source-backed code needs a trusted adapter renderer or visible fallback.
- **Save as Custom Block** promotes a page-owned Artifact into a new catalog entry while preserving provenance. Copying an Artifact alone never enrolls it in the catalog.
- An Extension is a more capable application with grants and is never silently presented as a Custom Block.
- Public or static output uses a deterministic declared fallback and never executes merely because the Custom Block is visible.

## Boundaries and non-goals

- Source adapters own repository/provider synchronization; the Custom Block catalog owns reusable renderer identity, governance, origin metadata, and typed props.
- Artifact Blocks own one-off page-local HTML/CSS/JS and promotion. Built-in Blocks may implement the same discovery contract but do not masquerade as editable Custom Blocks.
- Custom Blocks are renderers, not Extensions: they do not acquire arbitrary Actions, ambient Content data, filesystem, parent DOM, secrets, cookies, or network authority.

## Acceptance stories

### Keep axes independent

Given a personal repository-backed block is shared, when scope changes, then repository origin remains unchanged.

### Do not disguise Extensions

Given an Extension has grants, when embedded, then it remains a visible Extension embed.

### Promote one Artifact deliberately

Given a page-owned Artifact has no catalog record, when its owner chooses Save as Custom Block, then Content creates one governed catalog identity with provenance and leaves ordinary copied Artifacts local.

## Current evidence

`app/components/editor/extensions/LocalMdxComponentNode.tsx`, `actions/list-local-component-files.ts`, `actions/write-local-component-file.ts`, and `app/blocks/contentBlockRegistry.tsx` are donors, not a hosted catalog.

## Proof plan

1. Test managed, repository, and provider origins with no props, typed props, local aliases, and origin-preserving scope changes.
2. Test slash discovery and insertion across compatibility, permissions, preview, validation, unavailable origin, Versions, and provenance.
3. Deny ambient data, Actions, cookies, secrets, DOM, filesystem, and network; verify trusted adapter fallback without executing repository code in the sandbox.
4. Promote a one-off Artifact, copy it without promotion, export every origin deterministically, and distinguish built-ins and Extensions.

## Open questions

Catalog version/update policy and the first trusted-adapter eligibility rules still need a dedicated Shape. Network grants remain Extension territory rather than a Custom Block option.
