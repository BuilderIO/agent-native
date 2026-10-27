---
name: crm-call-evidence
description: >-
  The narrow `prepare-crm-call-evidence` contract and CRM call automation
  availability.
  Use when a CRM, sales, or A2A workflow asks for call evidence, a clip link
  for a deal, or a `clip.created` automation trigger.
---

# CRM Call Evidence

## Rule

Use `prepare-crm-call-evidence` only for a viewer-accessible recording that is
explicitly identified by a user action.
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

Setting up CRM-to-Clips call automations isn't available yet. If CRM or a user
asks for setup, say this and stop. Do not define or enable the automation,
delegate setup back to CRM, or direct the user to set it up manually.

## Related skills

- `a2a-protocol` — how approved agent-to-agent recipes are defined and called.
- `video-sharing` — the access model behind a viewer-accessible recording and
  the `/r/<id>` share page.
- `security` — why the payload stays link-only.
