---
record_type: "capability"
spec_version: 2
id: "content.author.code"
name: "Executable Code blocks"
user_promise: "Let me author, inspect, and deliberately run code in an ordinary document without hidden notebook state."
primary_user_job: "Author and run bounded code with explicit inputs and inspectable output."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.object.block", "content.author.media"]
related_features: ["content.feature.build-new-surfaces"]
roadmap_boundary: "feature"
acceptance_summary: "Code blocks keep portable source and optional typed rendering or execution; runs are explicit, isolated, bounded, receipted, and their approved output can become stale."
proof_requirements:
  [
    "Source/highlighting is universal; compatible renderers and runtimes are declared rather than inferred.",
    "Run never happens on paste, load, collaboration, or public reading; each run pins explicit page-scoped source references.",
    "Outputs are bounded handles with receipts; changing source or a referenced tab marks prior output stale without erasing history.",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Executable Code blocks

## Why this exists

Code belongs beside an explanation, but ordinary document code must not inherit the hidden state, ambient authority, or unreadable output of a notebook. Authors need to see exactly what source was run, with which inputs, and whether a displayed result is still trustworthy.

## Example workflow

Ava adds a Mermaid Code block to a design Page, changes a referenced Code tab, and sees the prior approved diagram marked stale until a deliberate new run.

## Product contract

- Source/highlighting is universal; compatible renderers and runtimes are declared rather than inferred.
- Run never happens on paste, load, collaboration, or public reading; each run pins explicit page-scoped source references.
- Outputs are bounded handles with receipts; changing source or a referenced tab marks prior output stale without erasing history.

## Boundaries and non-goals

- `content.object.block` owns Code Block identity and portable source; renderer and runtime adapters add capabilities without changing that identity.
- Code Blocks do not create an ambient kernel, execute on open/paste/public render, or turn successful runs into Custom Blocks automatically.

## Acceptance stories

### Reject ambient execution

Given pasted JavaScript, when another collaborator or a public reader opens the Page, then no runtime starts.

### Pin source inputs

Given a run with referenced tabs, when one tab changes, then the receipt keeps the original revisions and the output becomes stale.

## Current evidence

`app/components/editor/extensions/CodeBlockNode.tsx` provides Lowlight Code source; no tabs, isolated runtime, receipts, or approved-output state exists.

## Proof plan

1. Test Source/Rendered/Console/Split capability gating.
2. Run explicit tabs and verify hashes, stale invalidation, and cycles.
3. Deny network, secrets, filesystem, DOM, worker, timeout, and oversized output.
4. Test manual Run, preview rerun, saved output, export fallback, and fences.

## Open questions

First runtime scope is open; a shared notebook kernel is not.
