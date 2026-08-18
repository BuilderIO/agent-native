---
name: crm-call-evidence
description: >-
  The narrow `prepare-crm-call-evidence` contract and the approved CRM A2A
  recipe boundary.
  Use when a CRM, sales, or A2A workflow asks for call evidence, a clip link
  for a deal, or a `clip.created` automation trigger.
---

# CRM Call Evidence

## Rule

Use `prepare-crm-call-evidence` only for a viewer-accessible recording that is
explicitly identified by a user action or by the exact approved CRM A2A recipe.
Never call it to fish for a plausible clip.

## What it returns

- An opaque clip ID.
- A durable HTTPS `/r/<id>` page.
- Optionally, the capture time for the CRM record.

## What it never returns

It never returns the event media URL, a transcript, a temporary token, a quote,
or a summary. If a CRM workflow needs more than a link, stop and ask the user
rather than widening the payload.

## Automation triggers

A CRM recipe may install a Clips-owned `clip.created` trigger only through an
exact, user-approved A2A automation definition. Do not synthesize a trigger,
broaden its filter, or reuse it for another recipe.

## Related skills

- `a2a-protocol` — how approved agent-to-agent recipes are defined and called.
- `video-sharing` — the access model behind a viewer-accessible recording and
  the `/r/<id>` share page.
- `security` — why the payload stays link-only.
