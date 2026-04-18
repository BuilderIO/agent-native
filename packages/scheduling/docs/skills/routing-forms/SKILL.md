---
name: routing-forms
description: ChiliPiper-style pre-booking forms that route prospects to the right event type based on their answers.
---

# Routing forms

## Shape

- **Fields** — text, email, phone, number, select, multi
- **Rules** — ordered list of `{conditions, action}`
- **Fallback** — action taken when no rule matches

## Rule conditions

`conditions: [{fieldId, op, value}, …]` — all ANDed together. Ops:
- `equals`, `not-equals`, `contains`, `starts-with`, `in` (value is array)

## Rule actions

- `{kind: "event-type", eventTypeId, teamId?}` → redirect to Booker
- `{kind: "external-url", url}` → redirect off-site
- `{kind: "custom-message", message}` → render message, no booking

## Public URL

`/forms/:formId` renders the form. On submit:
1. Walk rules in order; first match wins.
2. If none match, use `fallback`.
3. Record the response in `routing_form_responses` with `matchedRuleId`.
4. If the action is `event-type`, redirect to Booker with prefilled
   `name` / `email` / custom-field values from the form answers.

## Common tasks

| User | Action |
|---|---|
| "Route enterprise prospects to Bob" | `create-routing-form` with a rule matching company size → Bob's event type |
| "See submissions" | `list-routing-form-responses --formId <id>` |
