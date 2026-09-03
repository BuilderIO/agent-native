---
record_type: "capability"
spec_version: 2
id: "content.system.research-workspace"
name: "Research workspace Template"
user_promise: "A blessed editable research template composes Sources, Notes, Projects, reading queues, citations, capture, and synthesis views over one Content datastore"
primary_user_job: "Adapt a research system to my practice while keeping sources, notes, citations, and synthesis connected to their canonical evidence."
kind: "workflow"
state: "exploring"
publicness: "public"
availability: "universal"
dependencies:
  [
    "content.template.graph",
    "content.research.annotation",
    "content.research.citation",
  ]
related_features: []
roadmap_boundary: "supporting"
acceptance_summary: "An editable research Template composes generic sources, notes, projects, reading queues, citations, capture, and synthesis Views without a parallel research engine."
proof_requirements:
  [
    "Template instantiation, editable provenance, and source/note/project/citation composition coverage",
    "Access-scoped search, capture, annotation, citation, links, backlinks, and source-policy coverage",
    "Real-interface reading, synthesis, export, unavailable-source, and recovery workflow",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Research workspace Template

## Why this exists

Research benefits from a coherent starting shape, but the shape must remain editable and
must not seize custody of connected originals.

## Example workflow

A researcher instantiates the Template, captures a source-backed note, adds an annotation
and citation, connects it to a project, and opens a synthesis View with provenance intact.

## Product contract

- The research workspace is an editable Template composition over generic Content primitives.
- Sources declare truth and write-back policy; notes, citations, annotations, links, and Views retain canonical identity.
- Search, capture, synthesis, export, and agent context are access-scoped and provenance-aware.
- Source unavailability, sync staleness, deletion, and citation failure report honestly and recoverably.

## Boundaries and non-goals

Research primitives own annotations and citations; the Template is not a new research
database, provider lock-in, or a claim that every source can be written back.

## Acceptance stories

### Adapt without losing provenance

Given an instantiated research Template, when a researcher changes its Views or schema,
then source notes and citations retain their canonical provenance and policy.

### Synthesize authorized evidence

Given mixed-access sources, when a researcher opens a synthesis View or asks an agent,
then only authorized evidence and citations are available to the result.

## Current evidence

This record remains `exploring`; no complete generic research composition is proven.

## Proof plan

1. Test Template instantiation, edits, provenance, Sources, notes, citations, and projects.
2. Verify access, source policy, search, export, agents, stale data, and recovery.
3. Exercise capture-to-synthesis and unavailable-source workflows in the real interface.

## Open questions

The initial blessed template contents and source-adapter selection remain exploratory.
