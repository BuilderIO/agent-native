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

## Action-to-event coverage

| Action | Mutation path | Event |
| --- | --- | --- |
| `create-deck` | Create a new deck | `deck.created` |
| `create-deck` | Replace an existing deck | `deck.updated` |
| `add-deck` | Insert an editor-created deck | `deck.created` |
| `save-deck` | Create a deck from a full payload | `deck.created` |
| `save-deck` | Replace an existing full payload | `deck.updated` |
| `patch-deck` | Apply any deck or slide patch | `deck.updated` |
| `duplicate-deck` | Create the copied, new deck | `deck.created` |
| `delete-deck` | Delete a deck | `deck.deleted` |
| `add-slide-comment` | Add a comment or reply | `comment.added` |
| `update-slide-comment` | Change comment text or thread resolution | `comment.updated` |

Comment deletion intentionally has no outbound event.

## Subscription API

`GET /_agent-native/slides/webhooks` lists the caller's subscriptions without secrets.

`GET /_agent-native/slides/webhooks/:id` returns one caller-owned subscription without its secret.

`POST /_agent-native/slides/webhooks` accepts `{ "url": "https://receiver.example/webhooks/slides", "events": ["deck.created"] }`. It returns the created subscription and a generated `secret` exactly once. Save that value securely; later reads never return it.

`DELETE /_agent-native/slides/webhooks` accepts `{ "id": "wh_..." }`. Deletion is immediate: queued deliveries for that subscription are cancelled before any request is sent.

## Delivery and verification

Every POST has `Content-Type: application/json` and `X-Agent-Native-Signature: sha256=<hex>`. The signature is HMAC-SHA256 over the exact raw JSON bytes. Example payload:

```json
{"id":"evt_example","event":"deck.created","createdAt":"2026-08-26T12:00:00.000Z","data":{"id":"deck_example","title":"Quarterly review","slides":[]}}
```

Verify the raw request body before parsing it. Reject a missing or mismatched signature with a non-2xx response.

```ts
const expected = createHmac("sha256", webhookSecret)
  .update(rawBody)
  .digest("hex");
const received = request.headers["x-agent-native-signature"];
if (received !== `sha256=${expected}`) throw new Error("Invalid signature");
```

## Reliability

Delivery rows are claimed atomically with a five-minute lease. Failed requests retry with exponential backoff, up to eight attempts. A subscription is automatically disabled after five consecutive failures or a terminal attempt limit; `disabledReason` is visible in list responses. URLs must be HTTPS and are SSRF-checked both when saved and before delivery.

Every processor invocation first reclaims expired `processing` leases as pending work, then claims due rows. The signed processor endpoint is self-dispatched after enqueueing, so a later processor invocation recovers work stranded by a terminated serverless invocation without requiring an external scheduler. Self-hosted Node retains its one-minute recovery sweep as an optimization.

## Placement decision

The catalog, subscriptions, and durable delivery outbox live in Slides because deck and comment lifecycle ownership belongs there. Core supplies only the shared SSRF-safe JSON delivery and signed self-dispatch primitives, so other apps can use the same safe transport without inheriting Slides event semantics.
