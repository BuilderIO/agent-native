import { z } from "zod";

import type { EventDefinition } from "./types.js";

const REGISTRY_KEY = Symbol.for("@agent-native/core/event-bus.registry");
interface GlobalWithRegistry {
  [REGISTRY_KEY]?: Map<string, EventDefinition>;
}
const registry: Map<string, EventDefinition> = ((
  globalThis as unknown as GlobalWithRegistry
)[REGISTRY_KEY] ??= new Map());

export function registerEvent(def: EventDefinition): void {
  if (!def || typeof def.name !== "string" || !def.name) {
    throw new Error("registerEvent: def.name is required");
  }
  if (typeof def.description !== "string" || !def.description) {
    throw new Error("registerEvent: def.description is required");
  }
  if (!def.payloadSchema) {
    throw new Error("registerEvent: def.payloadSchema is required");
  }
  registry.set(def.name, def);
}

export function listEvents(): EventDefinition[] {
  return Array.from(registry.values());
}

export function getEvent(name: string): EventDefinition | undefined {
  return registry.get(name);
}

export function __resetEventRegistry(): void {
  registry.clear();
  registerBuiltInEvents();
}

function registerBuiltInEvents(): void {
  registerEvent({
    name: "test.event.fired",
    description:
      "Developer test event — fired manually from the Automations UI or via the test-event action.",
    payloadSchema: z
      .object({ data: z.record(z.string(), z.unknown()).optional() })
      .optional() as unknown as EventDefinition["payloadSchema"],
  });

  registerEvent({
    name: "agent.turn.completed",
    description: "Fires after the agent completes a conversational turn.",
    payloadSchema: z.object({
      threadId: z.string().optional(),
      turnIndex: z.number().optional(),
      model: z.string().optional(),
    }) as unknown as EventDefinition["payloadSchema"],
  });
}

registerBuiltInEvents();
