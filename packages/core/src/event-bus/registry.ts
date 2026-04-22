/**
 * In-process registry of event definitions.
 *
 * Integrations and templates call `registerEvent()` at module load to declare
 * the event types they emit. The bus uses these definitions to validate
 * payloads, and the Automations UI lists them so users can build triggers.
 */

import { z } from "zod";
import type { EventDefinition } from "./types.js";

// Pin to globalThis so multiple ESM graphs (dev-mode Vite + Nitro, symlinks,
// dist/ vs src/) share a single registry. Same pattern as secrets/register.ts.
const REGISTRY_KEY = Symbol.for("@agent-native/core/event-bus.registry");
interface GlobalWithRegistry {
  [REGISTRY_KEY]?: Map<string, EventDefinition>;
}
const registry: Map<string, EventDefinition> = ((
  globalThis as unknown as GlobalWithRegistry
)[REGISTRY_KEY] ??= new Map());

/**
 * Register (or replace) an event definition.
 *
 * Subsequent registrations with the same `name` replace the previous
 * definition — later plugins can override built-in defaults.
 */
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

/** Return all registered events in registration order. */
export function listEvents(): EventDefinition[] {
  return Array.from(registry.values());
}

/** Look up a single registered event by name. */
export function getEvent(name: string): EventDefinition | undefined {
  return registry.get(name);
}

/** Test helper — clears the registry between runs. */
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
      .object({ data: z.record(z.unknown()).optional() })
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
