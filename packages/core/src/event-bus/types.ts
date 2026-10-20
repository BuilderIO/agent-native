import type { StandardSchemaV1 } from "@standard-schema/spec";

export interface EventDefinition {
  name: string;
  description: string;
  payloadSchema: StandardSchemaV1;
  example?: Record<string, unknown>;
}

export interface EventSubscription {
  id: string;
  event: string;
  handler: (payload: unknown, meta: EventMeta) => void | Promise<void>;
}

export interface EventMeta {
  eventId: string;
  emittedAt: string;
  owner?: string;
}
