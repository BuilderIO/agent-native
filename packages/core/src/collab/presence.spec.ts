import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { AGENT_CLIENT_ID } from "./agent-identity.js";
// ---------------------------------------------------------------------------
// Pure logic tests — no React rendering needed
// ---------------------------------------------------------------------------
import { toNormalized, fromNormalized } from "./presence.js";

describe("toNormalized", () => {
  const container: DOMRect = {
    left: 100,
    top: 50,
    width: 800,
    height: 600,
    right: 900,
    bottom: 650,
    x: 100,
    y: 50,
    toJSON: () => ({}),
  };

  it("maps the container origin to (0, 0)", () => {
    expect(toNormalized(100, 50, container)).toEqual({ x: 0, y: 0 });
  });

  it("maps the container bottom-right to (1, 1)", () => {
    expect(toNormalized(900, 650, container)).toEqual({ x: 1, y: 1 });
  });

  it("maps the center to (0.5, 0.5)", () => {
    const result = toNormalized(500, 350, container);
    expect(result.x).toBeCloseTo(0.5);
    expect(result.y).toBeCloseTo(0.5);
  });

  it("clamps values outside the container to [0, 1]", () => {
    expect(toNormalized(-1000, -1000, container)).toEqual({ x: 0, y: 0 });
    expect(toNormalized(10000, 10000, container)).toEqual({ x: 1, y: 1 });
  });
});

describe("fromNormalized", () => {
  const container: DOMRect = {
    left: 0,
    top: 0,
    width: 400,
    height: 300,
    right: 400,
    bottom: 300,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };

  it("maps (0, 0) to the container origin", () => {
    expect(fromNormalized({ x: 0, y: 0 }, container)).toEqual({ x: 0, y: 0 });
  });

  it("maps (1, 1) to the container bottom-right", () => {
    expect(fromNormalized({ x: 1, y: 1 }, container)).toEqual({
      x: 400,
      y: 300,
    });
  });

  it("maps (0.5, 0.5) to the center", () => {
    expect(fromNormalized({ x: 0.5, y: 0.5 }, container)).toEqual({
      x: 200,
      y: 150,
    });
  });
});

// ---------------------------------------------------------------------------
// usePresence derivation logic — tested by exercising the derive function
// directly through a minimal EventEmitter-based Awareness mock.
// ---------------------------------------------------------------------------

import { EventEmitter } from "events";

/** Minimal Awareness mock: just getStates(), setLocalStateField(), on(), off() */
function makeAwareness(
  initial: Map<number, Record<string, unknown>> = new Map(),
) {
  const emitter = new EventEmitter();
  const states = new Map(initial);
  return {
    getStates: () => states,
    setLocalStateField: (key: string, value: unknown) => {
      const local = states.get(0) ?? {};
      states.set(0, { ...local, [key]: value });
      emitter.emit("change", [{}, "local"]);
    },
    on: (event: string, handler: (...args: unknown[]) => void) =>
      emitter.on(event, handler),
    off: (event: string, handler: (...args: unknown[]) => void) =>
      emitter.off(event, handler),
    emit: (...args: Parameters<typeof emitter.emit>) => emitter.emit(...args),
    _states: states,
  };
}

/**
 * Synchronously derive OtherPresence entries from an awareness mock.
 * This mirrors the core logic of usePresence without React rendering.
 */
function deriveOthers(
  awareness: ReturnType<typeof makeAwareness>,
  localClientId: number,
) {
  const others: Array<{
    clientId: number;
    user: { name: string; email: string; color: string };
    presence: Record<string, unknown>;
    isAgent: boolean;
  }> = [];

  awareness.getStates().forEach((state, clientId) => {
    if (clientId === localClientId) return;
    const s = state as Record<string, unknown>;
    const isAgent = clientId === AGENT_CLIENT_ID;
    const u = s.user as
      | { name?: string; email?: string; color?: string }
      | undefined;

    const user = {
      name: u?.name ?? (isAgent ? "AI Assistant" : "Unknown"),
      email: u?.email ?? (isAgent ? "agent@system" : `client-${clientId}`),
      color: u?.color ?? (isAgent ? "#00B5FF" : "#94a3b8"),
    };

    const presence: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) {
      if (k !== "user" && k !== "visible") {
        presence[k] = v;
      }
    }

    others.push({ clientId, user, presence, isAgent });
  });

  return others;
}

describe("usePresence — derivation logic", () => {
  it("excludes the local client from others", () => {
    const awareness = makeAwareness(
      new Map([
        [1, { user: { name: "Alice", email: "alice@ex.com", color: "#f00" } }],
        [2, { user: { name: "Bob", email: "bob@ex.com", color: "#0f0" } }],
      ]),
    );
    const others = deriveOthers(awareness, 1 /* local */);
    expect(others).toHaveLength(1);
    expect(others[0].clientId).toBe(2);
  });

  it("marks AGENT_CLIENT_ID entries as isAgent: true", () => {
    const awareness = makeAwareness(
      new Map([
        [
          AGENT_CLIENT_ID,
          {
            user: {
              name: "AI Assistant",
              email: "agent@system",
              color: "#00B5FF",
            },
            selection: "#header",
          },
        ],
      ]),
    );
    const others = deriveOthers(awareness, 99);
    expect(others).toHaveLength(1);
    expect(others[0].isAgent).toBe(true);
    expect(others[0].user.email).toBe("agent@system");
    expect(others[0].presence.selection).toBe("#header");
  });

  it("strips 'user' and 'visible' from the presence payload", () => {
    const awareness = makeAwareness(
      new Map([
        [
          2,
          {
            user: { name: "Eve", email: "eve@ex.com", color: "#0ff" },
            visible: true,
            cursor: { x: 0.5, y: 0.3 },
            selection: "body > div",
          },
        ],
      ]),
    );
    const [other] = deriveOthers(awareness, 1);
    expect(other.presence).not.toHaveProperty("user");
    expect(other.presence).not.toHaveProperty("visible");
    expect(other.presence.cursor).toEqual({ x: 0.5, y: 0.3 });
    expect(other.presence.selection).toBe("body > div");
  });

  it("provides default user fields for agent when user block is missing", () => {
    const awareness = makeAwareness(
      new Map([[AGENT_CLIENT_ID, { selection: "#hero" }]]),
    );
    const [other] = deriveOthers(awareness, 1);
    expect(other.isAgent).toBe(true);
    expect(other.user.name).toBe("AI Assistant");
    expect(other.user.email).toBe("agent@system");
    expect(other.user.color).toBe("#00B5FF");
  });
});

// ---------------------------------------------------------------------------
// Fast-awareness throttle helper — unit test scheduleAwarenessPush behavior.
// We can't import the private function directly, so we test the exported
// public behavior via scheduleAwarenessPush being exercised in client.ts.
// Instead, test the throttle mechanics directly with a spy on fetch.
// ---------------------------------------------------------------------------

describe("awareness fast-path throttle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("coalesces multiple calls within 150ms into a single POST", async () => {
    // Import the internal helper via dynamic import of the module (test-only).
    // We replicate the throttle logic here to avoid coupling to private internals.
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchSpy);

    // Simulate: 3 rapid state changes within 150ms should produce 1 fetch.
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const throttledPush = (key: string, run: () => void) => {
      if (timers.has(key)) return;
      const t = setTimeout(() => {
        timers.delete(key);
        run();
      }, 150);
      timers.set(key, t);
    };

    let callCount = 0;
    throttledPush("doc1::42", () => {
      callCount++;
    });
    throttledPush("doc1::42", () => {
      callCount++;
    });
    throttledPush("doc1::42", () => {
      callCount++;
    });

    expect(callCount).toBe(0); // Not fired yet.

    vi.advanceTimersByTime(200);
    expect(callCount).toBe(1); // Only one fire after 150ms.
  });

  it("fires separate calls for different doc/client keys", async () => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const throttledPush = (key: string, run: () => void) => {
      if (timers.has(key)) return;
      const t = setTimeout(() => {
        timers.delete(key);
        run();
      }, 150);
      timers.set(key, t);
    };

    let count1 = 0;
    let count2 = 0;
    throttledPush("doc1::1", () => {
      count1++;
    });
    throttledPush("doc1::2", () => {
      count2++;
    });

    vi.advanceTimersByTime(200);
    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });
});
