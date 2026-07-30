---
record_type: "capability"
spec_version: 2
id: "content.agent.skill-catalog"
name: "Skills catalog"
user_promise: "Governed reusable agent instructions and capabilities can be invoked against compatible Content targets"
primary_user_job: "Reuse approved organizational know-how against the right target while seeing what it may do before it runs."
kind: "primitive"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies: ["content.agent.action-parity", "content.template.governance"]
related_features: ["content.feature.put-your-organizations-know-how-to-work"]
roadmap_boundary: "feature"
acceptance_summary: "A Skill has stable identity, version, personal or workspace ownership, declared compatible targets, permissions, effect and mutation contract, preview, and specificity-first contextual ranking."
proof_requirements:
  [
    "Typed contract, authorization, validation, Event/history, and recovery coverage",
    "Cross-surface UI, Action, agent-context, reload, and failure-state coverage",
    "Real-interface keyboard and assistive-technology workflow coverage",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-07-29"
---

# Skills catalog

## Why this exists

Reusable guidance becomes dangerous when its scope and effect are invisible. A catalog makes durable know-how legible as a governed tool.

## Example workflow

An organization publishes a versioned meeting-summary Skill for project Pages. A member previews its declared inputs and effects, invokes it in agent chat, and sees a Version and Event receipt.

## Product contract

A Skill has stable identity, version, personal or workspace ownership, declared compatible targets, permissions, effect and mutation contract, preview, and specificity-first contextual ranking. Invocation uses agent chat and shared Actions with normal Versions and Events.

## Boundaries and non-goals

Template governance owns approval policy and action parity owns execution. This is not arbitrary hidden prompt injection, a secret capability grant, or universal auto-run.

## Acceptance stories

### Rank a compatible project skill

Given two compatible Skills, when a project Page is focused, then the more specific authorized Skill ranks first and its scope is visible.

### Preview a versioned skill before mutation

Given a Skill proposes a mutation, when a person previews it, then the declared effect and required authority appear before any Action runs.

## Current evidence

No complete catalog identity, ranking, preview, execution, and receipt proof is recorded. This Capability remains `approved_shape`.

## Proof plan

1. Test personal and workspace Skills through versioning, compatibility selection, and effect display.
2. Verify ranking, approval, denial, preview, invocation, Events, Versions, and revocation.
3. Run agent-chat discovery with incompatible targets and accessible previews.

## Open questions

The version-promotion and organization approval workflow needs design.
