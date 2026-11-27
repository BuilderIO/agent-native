---
record_type: "capability"
spec_version: 2
id: "content.form.shared-engine"
name: "Shared Form engine"
user_promise: "Content's Form pages, Forms shown inside other Pages, and agents use one schema, validation, permission, and idempotent submission engine over the Collection."
primary_user_job: "Collect structured input once with the same contract whether it arrives from a Form page, a Form shown inside another Page, or an agent."
kind: "surface"
state: "approved_shape"
publicness: "public"
availability: "universal"
dependencies:
  [
    "content.property.constraints",
    "content.agent.action-parity",
    "content.event.committed",
    "content.access.page-database",
    "content.author.document-editor",
  ]
related_features: ["content.feature.collect-structured-input"]
roadmap_boundary: "feature"
acceptance_summary: "Forms define questions bound to Properties, who may answer, drafts, validation, idempotency, and receipts over one submission Action."
proof_requirements:
  [
    "Typed contract, authorization, validation, Event/history, and recovery coverage",
    "Cross-surface UI, Action, agent-context, reload, and failure-state coverage",
    "Anonymous, signed-in, and agent submission without Collection read access",
    "Real-interface keyboard and assistive-technology workflow coverage",
  ]
evidence: []
superseded_by: null
last_reviewed: "2026-11-23"
---

# Shared Form engine

## Why this exists

A question should not become less trustworthy because it appears in an embed instead of a Form page, or because an agent answers it for someone. A person answering by link, and an agent answering for them, should get the same checks and the same single record as a Collection editor. One submission contract keeps duplicate and invalid input honest.

## Example workflow

A research team shares an intake Form by link. A participant with no account answers it in a browser. A teammate who cannot see the Collection starts it signed in on a laptop and finishes on a phone. Another teammate's agent reads the Form from its link and submits after the teammate confirms the answers. Each submission is validated the same way, creates exactly one record with an Event, and starts the Collection's enrichment Rule.

## Product contract

A Form belongs to one Collection and asks through question Blocks on one editor Page. The Collection owns Property types, validation, defaults, permissions, and Rules; the Form owns which questions it asks, in what order, with what help, and for whom. Form pages, Forms shown inside other Pages, Slack intake, and agents call one submission Action.

- **Who answers:** Each Form says who is answering. Anonymous and signed-in answering come first, where organization-only means signed in plus membership. An email confirmed by a one-time code, without an account, follows. An Email question is an answer, never an identity.
- **Answering does not mean reading:** A submission grant lets a person submit without access to other records, Properties, or Views of the Collection. After submitting, a signed-in person can open what they sent.
- **Drafts:** Answers save as people type, in the browser for everyone and on the server for signed-in people, so they can finish on another device. A draft is stored apart from the Collection, cleared on submit, and deleted 30 days after its last change. No record exists and no Rule runs until submit.
- **Submission:** The Action validates every answer before saving and saves nothing if any answer fails, returning every problem at once in plain words. An idempotency key makes a retry return the original receipt. The record and its committed Event are written together.
- **Receipts:** A receipt holds the submitted values, the resulting record, the Form's confirmation message, and how the sender was known. An anonymous Form stores nothing that identifies the sender, including network addresses.
- **Limits:** A flood of submissions is refused with a plain message. One answer per person is offered only when the Form requires signing in or a confirmed email, since a browser cookie cannot keep that promise.
- **Agents:** One pair of tools serves every Form. An agent reads a Form from its link, receiving the Form's own wording, help, choices, requirements, and an answer schema, then submits through the same Action under its person's identity. Tools named for individual Forms, if ever added, are aliases over this pair.

## Boundaries and non-goals

Property constraints own field rules, Page and Collection access owns who may read, and Events own committed receipts. This is not a second forms datastore, a raw endpoint bypass, or a promise that every Form is public. It shares no code with the standalone Agent-Native Forms app, which remains a separate product.

## Acceptance stories

### Return the original receipt on retry

Given the same submission is retried, when the idempotency key matches, then Content returns the original receipt and creates no duplicate record.

### Reject a hidden field from an embed

Given an unauthorized field value, when it is submitted from an embed or agent, then shared validation denies it with the same typed failure.

### Submit without reading the Collection

Given an anonymous Form shared by link, when a person without an account opens it and submits valid answers, then exactly one record is created, the person sees only the Form and its confirmation, and the record states that it was submitted anonymously.

### Keep a draft out of the Collection

Given a signed-in person who has answered part of a Form on one device, when they open it on another device, then their answers are there, and the Collection has no record and no Rule has run until they submit.

### Submit through an agent

Given a person's agent connected over MCP and a Form link, when the agent submits answers with a required value missing, then nothing is saved and every problem is returned at once; when it resends the corrected answers with the same key, then exactly one record exists and its receipt names the person.

## Current evidence

Only Collection editors can submit through today's Form View. No complete shared schema, idempotency, cross-surface permission, draft, and recovery proof is recorded. This Capability remains `approved_shape`.

## Proof plan

1. Define one Form and submit it from its Form page, from a Form shown inside another Page, and from an agent.
2. Test anonymous and signed-in answering without Collection read access, drafts across reloads and devices, validation, permissions, idempotency, receipts, limits, and Rule handoff.
3. Run keyboard, screen-reader, and phone-width completion flows with rejected-field recovery.

## Open questions

How an agent finds a Form nobody gave it a link to, whether owners can see unfinished drafts, and how file uploads work inside a draft.
