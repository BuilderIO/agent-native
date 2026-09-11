import type { StandardSchemaV1 } from "@standard-schema/spec";

export interface EventDefinition {
  /** Dotted event name: "calendar.booking.created", "mail.message.received" */
  name: string;
  /** Human-readable description for the agent to understand what this event means */
  description: string;
  /** Zod (or any Standard Schema) schema for the event payload */
  payloadSchema: StandardSchemaV1;
  /** Example payload for agent context (optional) */
  example?: Record<string, unknown>;
}

export interface EventSubscription {
  id: string;
  /** The event name to subscribe to (exact match) */
  event: string;
  /** Called when the event fires. Payload is already validated. */
  handler: (payload: unknown, meta: EventMeta) => void | Promise<void>;
}

export interface EventMeta {
  /** Unique ID for this emission (for deduplication) */
  eventId: string;
  /** ISO timestamp of emission */
  emittedAt: string;
  /** Owner/user email the event is scoped to (if applicable) */
  owner?: string;
}
