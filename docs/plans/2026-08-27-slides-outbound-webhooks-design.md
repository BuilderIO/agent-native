# Slides Outbound Webhooks Design

**Goal:** Deliver generic, signed outbound Slides events to subscriber-owned HTTP endpoints without changing existing action request or response shapes.

## Placement decision

Slides owns the first consumer’s event catalog, subscription persistence, transactional outbox, and public contract. Core remains the shared transport and deferred-execution substrate.

This avoids coupling a new outbound delivery domain to core’s `integration_pending_tasks` queue, which is specifically shaped around inbound provider messages, agent dispatch, provider threads, and replies. Slides reuses `deliverJsonWebhook` for SSRF-safe, timeout-bounded HTTP delivery and `fireInternalDispatch` for portable serverless self-dispatch. A future second consumer can promote the durable outbound model to core once its common semantics are proven.

## Event contract

Slides declares the following event names:

- `deck.created`
- `deck.updated`
- `deck.deleted`
- `comment.added`
- `comment.updated`

Each envelope is serialized once as raw JSON:

```json
{
  "id": "evt_...",
  "event": "deck.updated",
  "createdAt": "2026-08-27T12:00:00.000Z",
  "data": {}
}
```

`data` reuses the existing Slides action API deck or comment entity shapes. No webhook-specific entity types and no existing action response changes are introduced.

## Persistence and exactly-once behavior

New Slides tables persist subscriptions and delivery attempts. A write action adds an immutable event record and one delivery row per active matching subscription inside the same transaction as its database mutation. This is the transactional outbox.

The processor atomically claims a delivery row before sending it. A successful response completes it; a failed response stores the attempt details and next retry time. Unique delivery rows prevent a mutation from being fanned out twice to the same subscription. Transport-level delivery is at-least-once under ambiguous network failures, so webhook recipients must de-duplicate on envelope `id`; the server guarantees one logical event/outbox row per successful mutation path.

Deck creation, update, duplication, and deletion actions, plus comment creation and update actions, are emission points. UI, agent, MCP, and HTTP callers already converge on these actions, preventing transport-specific duplicate emission. Delete-comment is intentionally not emitted because it is outside the requested minimum catalog.

## Subscriptions

Bearer-authenticated endpoints under `/_agent-native/` create, list, read, and delete subscriptions. Rows are scoped by authenticated owner and organization using the same ownership rules as existing resources.

Create accepts a target HTTPS URL and the declared event list. The service creates a random per-subscription HMAC secret and returns it only in that create response. Stored state contains only a secure verifier/derived representation; subsequent list/get responses never reveal it.

List/get expose target URL, events, enabled status, disable reason, failure streak, and delivery timing fields. Delete makes a subscription immediately ineligible for new deliveries and processor claims.

## Delivery, retry, and serverless behavior

A claimed row POSTs the raw envelope body to the subscriber with `Content-Type: application/json` and a documented HMAC-SHA256 signature header. The signature is computed from the exact UTF-8 body bytes using the subscription secret.

Each attempt has a bounded timeout and redirects remain governed by core’s SSRF-safe transport. Retry timing follows bounded exponential backoff and a bounded attempt count. A fully failed delivery increments a consecutive-failure counter; after the configured threshold, the subscription is disabled and records an actionable reason. A success resets the failure streak.

After a mutation commits, Slides invokes core’s HMAC-authenticated self-dispatch route. That starts processing in a new execution on serverless and works in long-lived Node. Recovery invokes a bounded due-delivery sweep: local Node runs it via the established interval-job convention, while serverless requires the existing durable recovery/scheduler invocation pattern. Documentation will state this hosting requirement rather than claiming an in-process timer survives serverless requests.

## Security

- Validate delivery targets with core’s SSRF-safe webhook URL policy at create time and again at send time.
- Never return the per-subscription HMAC secret after creation.
- Require bearer auth for subscription CRUD; processor routes use resource-bound internal HMAC credentials.
- Use constant-time comparison only on server-controlled internal dispatch tokens; subscribers independently verify delivered signatures.
- Avoid webhook delivery for events that do not belong to the requesting owner/org.

## Documentation and tests

A Slides docs page will publish the event catalog, payload examples, endpoint reference, HMAC verification snippet, retry/disable policy, and serverless recovery constraint. `templates/slides/AGENTS.md` and `DEVELOPMENT.md` will register the endpoints and events as versioned public contract surfaces. A dated Slides changelog entry will announce additions.

Tests will cover event fan-out, signature validation, unsubscribed events, immediate deletion, retry/backoff, auto-disable visibility, transactional emission across all action transports, request authentication, and processor claiming.
