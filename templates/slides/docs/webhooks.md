# Slides outbound webhooks

Slides delivers signed outbound events to HTTPS endpoints. The subscription API is authenticated with the normal Slides bearer token or browser session and is scoped to the current owner and organization.

## Event catalog

| Event | When it is emitted | `data` |
| --- | --- | --- |
| `deck.created` | A deck is created, including copies. | The saved deck entity payload. |
| `deck.updated` | A deck is replaced or patched. | The saved deck entity payload. |
| `deck.deleted` | A deck is deleted. | The deleted deck entity. |
| `comment.added` | A slide comment or reply is added. | The created comment entity. |
| `comment.updated` | Comment text or thread resolution changes. | The changed comment entity. |

Comment deletion intentionally has no outbound event.

## Subscription API

`GET /_agent-native/slides/webhooks` lists the caller's subscriptions without secrets.

`POST /_agent-native/slides/webhooks` accepts `{ "url": "https://receiver.example/webhooks/slides", "events": ["deck.created"] }`. It returns the created subscription and a generated `secret` exactly once. Save that value securely; later reads never return it.

`PATCH /_agent-native/slides/webhooks` accepts an `id` plus one or more of `url`, `events`, and `enabled`. It returns the updated subscription without a secret.

`DELETE /_agent-native/slides/webhooks` accepts `{ "id": "wh_..." }`. Deletion is immediate: queued deliveries for that subscription are cancelled before any request is sent.

## Delivery and verification

Every POST has `Content-Type: application/json` and `X-Agent-Native-Signature: sha256=<hex>`. The signature is HMAC-SHA256 over the exact raw JSON bytes. Example payload:

```json
{"id":"evt_example","event":"deck.created","createdAt":"2026-08-26T12:00:00.000Z","data":{"id":"deck_example","title":"Quarterly review","slides":[]}}
```

Verify the raw request body before parsing it. Reject a missing or mismatched signature with a non-2xx response.

## Reliability

Delivery rows are claimed atomically. Failed requests retry with exponential backoff, up to eight attempts. A subscription is automatically disabled after five consecutive failures or a terminal attempt limit; `disabledReason` is visible in list responses. URLs must be HTTPS and are SSRF-checked both when saved and before delivery.

The signed processor endpoint is self-dispatched after enqueueing. Self-hosted Node runs a one-minute recovery sweep. Serverless deployments retain the durable outbox and callable processor but require an external signed scheduler to invoke recovery if a self-dispatch is interrupted.

## Placement decision

The catalog, subscriptions, and durable delivery outbox live in Slides because deck and comment lifecycle ownership belongs there. Core supplies only the shared SSRF-safe JSON delivery and signed self-dispatch primitives, so other apps can use the same safe transport without inheriting Slides event semantics.
