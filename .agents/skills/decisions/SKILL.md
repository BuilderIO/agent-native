---
name: decisions
description: >-
  How to use `@agent-native/core/decisions` for capability-aware classification
  and scoring. Use when implementing or reviewing decision evaluation, provider
  ordering, per-provider thresholds, or decision-result caches.
scope: dev
metadata:
  internal: true
---

# Decisions

## Rule

Use `decide()` to classify or score supplied inputs. It returns a result and
never performs, authorizes, or replaces the action selected from that result.

## How

Pass an explicit `ownerEmail`, an `input` string or array of parts, and named
`questions` to `decide()` from `@agent-native/core/decisions`:

```ts
import { decide } from "@agent-native/core/decisions";

const result = await decide({
  ownerEmail: "owner@example.com",
  input: [{ type: "text", text: "Please cancel Friday's lunch reservation." }],
  questions: [
    {
      type: "predicate",
      name: "isCancellationRequest",
      instructions: "Does the message ask to cancel a reservation?",
    },
  ],
});
```

`input` can be a plain string or contain text, structured JSON, or an image URL.
Questions are named and use one of these shapes:

| Type | Fields | Use |
| --- | --- | --- |
| `predicate` | `name`, `instructions` | Evaluate one stated predicate |
| `choice` | `name`, `instructions`, `choices: { value: string, description: string }[]` | Choose among the supplied string values |
| `score` | `name`, `instructions`, `levels: { label: string, description: string }[]` | Score against 2–10 ordered levels |

Provider and model capabilities can differ. Treat question support as
capability-aware. Only claim a provider/model supports a question type after
that combination has been verified. An `ok` result includes `provider`, `model`, and `answers` keyed by question name;
`cached` and `usage` are optional. A `not_configured` result includes the
`missing_credentials` reason and configured provider list. A `failed` result has
a typed reason and may include `provider` and `questionNames`. Handle these
statuses as distinct outcomes; never turn a failure into an answer.

## Provider routing and caches

Provider order is configurable per workspace. New customer workspaces try
Builder Jev first, then a personal Jev key, then OpenAI. Within Jev, the
Builder gateway is tried before falling back to a direct key. If no provider
is configured, `decide()` returns `not_configured`.

Key any per-provider threshold or cache by both provider and model. `cacheKey`
enables caching only when supplied. Cache identity includes the owner,
organization, provider, model, cache key, input, and questions. The in-memory
cache has a 60-second TTL and a 256-entry cap.

## Related skills

- **actions** — keep action behavior focused and deterministic.
