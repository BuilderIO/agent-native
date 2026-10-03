# Action receipts and domain events

`@agent-native/core/action-receipt` provides an opt-in contract for actions that
must prove a data mutation and its domain events committed atomically. Existing
actions and return values are unchanged.

## Contract

- `ActionReceipt` is schema-versioned JSON. `status: "committed"` is the only
  success state; failures throw and never create a receipt.
- `ActionDomainEvent` is a CloudEvents 1.0-compatible JSON event with an
  absolute `source`, stable `id`, RFC 3339 `time`, application-owned `type`, and
  optional opaque `subject` identifier.
- Receipts include the action result and event references, not event payloads.
  Delivery systems read full events from the durable staging store.
- Correlation, causation, idempotency, and Agent Native run identifiers are
  explicit provenance. They are metadata, not authorization decisions.
- Parsers reject unknown fields, unsupported versions, non-JSON values,
  non-finite numbers, cycles, invalid timestamps, and relative event sources.
  Serializers sort object keys for stable bytes.

## Atomic seam

`commitAction()` is storage-neutral. An app supplies one adapter with a
transaction runner and a `stageActionOutcome(transaction, outcome)` callback.
The mutation callback receives that same transaction plus `emit()`:

```ts
import { commitAction } from "@agent-native/core/action-receipt";

return commitAction({
  adapter: appOutboxAdapter,
  action: "create-lead",
  source: "https://example.com/actions/create-lead",
  context,
  idempotencyKey,
  mutate: async ({ transaction, emit }) => {
    const lead = await insertLead(transaction, input);
    emit({
      type: "com.example.lead.created.v1",
      subject: lead.id,
      data: { leadId: lead.id },
    });
    return { id: lead.id };
  },
});
```

The adapter must stage the receipt and events durably inside the supplied
transaction and must resolve `transaction()` only after commit. It must not
publish to a provider in that callback. A dispatcher can publish staged events
later with retries and deduplication; that outbox and delivery policy are
deliberately outside this contract.

If mutation, event validation, staging, or commit fails, `commitAction()`
rejects and returns no receipt. An adapter that stages outside its transaction
violates the interface contract and cannot claim atomicity.

Use IDs and bounded metadata in event data. Do not place credentials, raw
provider payloads, or unnecessary personal data in receipts or events.
