/**
 * Typed pub/sub bus for framework events.
 *
 * Wraps Node's EventEmitter with payload validation against the registered
 * Standard Schema for each event. Handler errors are caught and logged so a
 * misbehaving subscriber can never crash the emitter.
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { getEvent } from "./registry.js";
import type { EventMeta } from "./types.js";

type Handler = (payload: unknown, meta: EventMeta) => void | Promise<void>;

interface BusState {
  emitter: EventEmitter;
  subscriptions: Map<string, { event: string; handler: Handler }>;
}

const BUS_KEY = Symbol.for("@agent-native/core/event-bus.bus");
interface GlobalWithBus {
  [BUS_KEY]?: BusState;
}

function getBus(): BusState {
  const g = globalThis as unknown as GlobalWithBus;
  if (!g[BUS_KEY]) {
    const emitter = new EventEmitter();
    // Many integrations may subscribe to the same event; lift the warning
    // ceiling rather than printing MaxListenersExceededWarning at runtime.
    emitter.setMaxListeners(0);
    g[BUS_KEY] = { emitter, subscriptions: new Map() };
  }
  return g[BUS_KEY]!;
}

export function subscribe(event: string, handler: Handler): string {
  if (typeof event !== "string" || !event) {
    throw new Error("subscribe: event name is required");
  }
  if (typeof handler !== "function") {
    throw new Error("subscribe: handler must be a function");
  }
  const bus = getBus();
  const id = randomUUID();
  bus.subscriptions.set(id, { event, handler });
  bus.emitter.on(event, handler);
  return id;
}

export function unsubscribe(id: string): boolean {
  const bus = getBus();
  const sub = bus.subscriptions.get(id);
  if (!sub) return false;
  bus.emitter.off(sub.event, sub.handler);
  bus.subscriptions.delete(id);
  return true;
}

export function emit(
  event: string,
  payload: unknown,
  meta?: Partial<EventMeta>,
): void {
  if (typeof event !== "string" || !event) {
    throw new Error("emit: event name is required");
  }
  const bus = getBus();
  const def = getEvent(event);

  let validated: unknown = payload;
  if (def) {
    const result = def.payloadSchema["~standard"].validate(payload);
    if (result instanceof Promise) {
      console.warn(
        `[event-bus] Payload schema for "${event}" returned a Promise — ` +
          `async validation is not supported. Dispatching unvalidated payload.`,
      );
    } else if (result.issues) {
      console.warn(
        `[event-bus] Payload validation failed for "${event}":`,
        result.issues,
      );
      return;
    } else {
      validated = (result as { value: unknown }).value;
    }
  } else {
    console.warn(
      `[event-bus] Emitting unregistered event "${event}". ` +
        `Call registerEvent() to declare it.`,
    );
  }

  const fullMeta: EventMeta = {
    eventId: meta?.eventId ?? randomUUID(),
    emittedAt: meta?.emittedAt ?? new Date().toISOString(),
    owner: meta?.owner,
  };

  // Snapshot listeners so a handler that subscribes/unsubscribes during
  // dispatch doesn't perturb this emission.
  const listeners = bus.emitter.listeners(event) as Handler[];
  for (const listener of listeners) {
    try {
      const r = listener(validated, fullMeta);
      if (r && typeof (r as Promise<void>).catch === "function") {
        (r as Promise<void>).catch((err) => {
          console.error(
            `[event-bus] Async handler for "${event}" rejected:`,
            err,
          );
        });
      }
    } catch (err) {
      console.error(`[event-bus] Handler for "${event}" threw:`, err);
    }
  }
}

export function listSubscriptions(
  event?: string,
): { id: string; event: string }[] {
  const bus = getBus();
  const out: { id: string; event: string }[] = [];
  for (const [id, sub] of bus.subscriptions) {
    if (event && sub.event !== event) continue;
    out.push({ id, event: sub.event });
  }
  return out;
}

/** Test helper — drops all subscriptions. */
export function __resetEventBus(): void {
  const bus = getBus();
  bus.emitter.removeAllListeners();
  bus.subscriptions.clear();
}
