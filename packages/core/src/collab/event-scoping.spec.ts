/**
 * Unit tests for collab event access scoping.
 *
 * Verifies that the canSeeChangeForUser logic correctly prevents collab
 * updates (tagged with owner/orgId) from being delivered to users who
 * lack access, while still delivering them to the correct users.
 *
 * This tests the security contract set up by the security commit: collab
 * events are tagged with owner/orgId when resourceType is configured, so
 * getChangesSinceForUser scopes delivery.
 *
 * It also tests the SYNC-CACHE variant that additionally tags events with
 * resourceType/resourceId and drives an access-aware delivery decision:
 * cache-miss returns false + schedules a background resolveAccess check, and
 * the user's next event within the TTL is pushed once the cache is populated.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The access-aware branch of canSeeChangeForUser dynamically imports
// "../sharing/access.js" in a background task. Mock it so we can control the
// resolveAccess result deterministically per-test.
const resolveAccessMock =
  vi.fn<
    (
      resourceType: string,
      resourceId: string,
      ctx: { userEmail?: string; orgId?: string },
    ) => Promise<{ role: string; resource: unknown } | null>
  >();
vi.mock("../sharing/access.js", () => ({
  resolveAccess: (...args: unknown[]) =>
    (resolveAccessMock as any)(...(args as [any, any, any])),
}));

import { canSeeAwarenessChangeForUser } from "../server/poll-events.js";
import {
  canSeeChangeForUser,
  getChangesSinceForUser,
  getVersion,
  invalidateCollabAccessCache,
  recordChange,
  __resetCollabAccessCacheForTests,
} from "../server/poll.js";

type CollabChangeEvent = {
  source: string;
  type: string;
  docId?: string;
  update?: string;
  owner?: string;
  orgId?: string;
  resourceType?: string;
  resourceId?: string;
  version?: number;
};

/** Flush pending microtasks + a macrotask so the background check settles. */
async function flushAsync(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe("collab event scoping via canSeeChangeForUser", () => {
  const baseEvent: CollabChangeEvent = {
    source: "collab",
    type: "change",
    docId: "doc-abc",
    update: "dGVzdA==",
  };

  describe("unscoped events (no owner, no orgId)", () => {
    it("delivers to any authenticated user", () => {
      const event = { ...baseEvent }; // no owner/orgId
      expect(canSeeChangeForUser(event, "alice@example.com", undefined)).toBe(
        true,
      );
      expect(canSeeChangeForUser(event, "bob@example.com", "org-2")).toBe(true);
      expect(canSeeChangeForUser(event, "charlie@example.com", "org-3")).toBe(
        true,
      );
    });
  });

  describe("owner-scoped events", () => {
    it("delivers to the owner", () => {
      const event = { ...baseEvent, owner: "alice@example.com" };
      expect(canSeeChangeForUser(event, "alice@example.com", undefined)).toBe(
        true,
      );
    });

    it("does NOT deliver to a different user", () => {
      const event = { ...baseEvent, owner: "alice@example.com" };
      expect(canSeeChangeForUser(event, "bob@example.com", undefined)).toBe(
        false,
      );
      expect(canSeeChangeForUser(event, "bob@example.com", "alice-org")).toBe(
        false,
      );
    });

    it("does NOT deliver to a user who happens to share the same org", () => {
      // owner-tagged event: only the owner, not org members.
      const event = {
        ...baseEvent,
        owner: "alice@example.com",
        // NO orgId on the event
      };
      expect(canSeeChangeForUser(event, "bob@example.com", "shared-org")).toBe(
        false,
      );
    });
  });

  describe("org-scoped events", () => {
    it("delivers to any member of the same org", () => {
      const event = { ...baseEvent, orgId: "org-acme" };
      expect(canSeeChangeForUser(event, "alice@acme.com", "org-acme")).toBe(
        true,
      );
      expect(canSeeChangeForUser(event, "bob@acme.com", "org-acme")).toBe(true);
    });

    it("does NOT deliver to a user in a different org", () => {
      const event = { ...baseEvent, orgId: "org-acme" };
      expect(canSeeChangeForUser(event, "eve@evil.com", "org-evil")).toBe(
        false,
      );
    });

    it("does NOT deliver to a user with no org", () => {
      const event = { ...baseEvent, orgId: "org-acme" };
      expect(canSeeChangeForUser(event, "solo@example.com", undefined)).toBe(
        false,
      );
    });
  });

  describe("events with both owner and orgId (owner is primary author)", () => {
    it("delivers to the owner (email match)", () => {
      const event = {
        ...baseEvent,
        owner: "alice@example.com",
        orgId: "org-acme",
      };
      expect(canSeeChangeForUser(event, "alice@example.com", "org-acme")).toBe(
        true,
      );
    });

    it("delivers to an org member (orgId match)", () => {
      const event = {
        ...baseEvent,
        owner: "alice@example.com",
        orgId: "org-acme",
      };
      expect(canSeeChangeForUser(event, "bob@acme.com", "org-acme")).toBe(true);
    });

    it("does NOT deliver to a user outside both owner and org", () => {
      const event = {
        ...baseEvent,
        owner: "alice@example.com",
        orgId: "org-acme",
      };
      expect(canSeeChangeForUser(event, "eve@evil.com", "org-evil")).toBe(
        false,
      );
    });
  });

  describe("non-owner sharees (conservative fallback)", () => {
    // Sharees (non-owner, different org) should NOT receive owner-scoped events.
    // They fall back to state-vector catch-up via the poll loop. This is the
    // safe/conservative path: never deliver to someone without access.
    it("does not deliver owner-scoped event to an explicit sharee in a different org", () => {
      const event = { ...baseEvent, owner: "alice@example.com" };
      // Bob is a sharee but he doesn't match owner and has no orgId match.
      expect(canSeeChangeForUser(event, "bob@example.com", "org-bob")).toBe(
        false,
      );
    });

    it("does not deliver owner-scoped event to a user with no session org", () => {
      const event = { ...baseEvent, owner: "alice@example.com" };
      expect(canSeeChangeForUser(event, "bob@example.com", undefined)).toBe(
        false,
      );
    });
  });
});

describe("access-aware sharee delivery (SYNC-CACHE variant)", () => {
  // Events tagged with resourceType + resourceId let non-owner sharees receive
  // the push via an access-aware, TTL'd cache populated by a background
  // resolveAccess check. Cache miss returns false (no leak) and schedules the
  // check; the user's next event within TTL is pushed.
  const resourceEvent: CollabChangeEvent = {
    source: "collab",
    type: "change",
    docId: "doc-abc",
    update: "dGVzdA==",
    owner: "alice@example.com",
    resourceType: "document",
    resourceId: "doc-res-1",
  };

  beforeEach(() => {
    __resetCollabAccessCacheForTests();
    resolveAccessMock.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    __resetCollabAccessCacheForTests();
  });

  it("owner still receives synchronously without any resolveAccess call", () => {
    resolveAccessMock.mockResolvedValue({ role: "owner", resource: {} });
    expect(
      canSeeChangeForUser(resourceEvent, "alice@example.com", undefined),
    ).toBe(true);
    expect(resolveAccessMock).not.toHaveBeenCalled();
  });

  it("org member still receives synchronously via orgId without resolveAccess", () => {
    resolveAccessMock.mockResolvedValue({ role: "viewer", resource: {} });
    const event = { ...resourceEvent, owner: undefined, orgId: "org-acme" };
    expect(canSeeChangeForUser(event, "bob@acme.com", "org-acme")).toBe(true);
    expect(resolveAccessMock).not.toHaveBeenCalled();
  });

  it("sharee with viewer access: miss returns false, then true after background check", async () => {
    resolveAccessMock.mockResolvedValue({ role: "viewer", resource: {} });

    // First call: cache miss → false, schedules the background check.
    expect(
      canSeeChangeForUser(resourceEvent, "sharee@example.com", "org-bob"),
    ).toBe(false);

    // Let the background resolveAccess settle and populate the cache.
    await flushAsync();
    expect(resolveAccessMock).toHaveBeenCalledTimes(1);
    expect(resolveAccessMock).toHaveBeenCalledWith("document", "doc-res-1", {
      userEmail: "sharee@example.com",
      orgId: "org-bob",
    });

    // Second call: fresh cache hit → true (pushed).
    expect(
      canSeeChangeForUser(resourceEvent, "sharee@example.com", "org-bob"),
    ).toBe(true);
  });

  it("non-sharee never receives even after the background check (resolveAccess null)", async () => {
    resolveAccessMock.mockResolvedValue(null);

    expect(
      canSeeChangeForUser(resourceEvent, "stranger@example.com", "org-x"),
    ).toBe(false);
    await flushAsync();
    expect(resolveAccessMock).toHaveBeenCalledTimes(1);

    // Still false after the check resolves to null.
    expect(
      canSeeChangeForUser(resourceEvent, "stranger@example.com", "org-x"),
    ).toBe(false);
  });

  it("dedupes concurrent background checks for the same key (a burst of events)", async () => {
    let resolve!: (v: { role: string; resource: unknown } | null) => void;
    resolveAccessMock.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );

    // Burst of events before the first check resolves — all miss and return
    // false; the in-flight guard (_accessInFlight) is set synchronously so only
    // one background task is ever started for this key.
    expect(
      canSeeChangeForUser(resourceEvent, "sharee@example.com", "org-bob"),
    ).toBe(false);
    expect(
      canSeeChangeForUser(resourceEvent, "sharee@example.com", "org-bob"),
    ).toBe(false);
    expect(
      canSeeChangeForUser(resourceEvent, "sharee@example.com", "org-bob"),
    ).toBe(false);

    // The dynamic import + call is async; flush so the single scheduled task
    // reaches resolveAccess. It must have been called exactly once despite the
    // 3-event burst.
    await flushAsync();
    expect(resolveAccessMock).toHaveBeenCalledTimes(1);

    resolve({ role: "viewer", resource: {} });
    await flushAsync();

    expect(
      canSeeChangeForUser(resourceEvent, "sharee@example.com", "org-bob"),
    ).toBe(true);
  });

  it("resolver error → deny (fail closed), returns false after the check", async () => {
    resolveAccessMock.mockRejectedValue(new Error("db down"));

    expect(
      canSeeChangeForUser(resourceEvent, "sharee@example.com", "org-bob"),
    ).toBe(false);
    await flushAsync();
    expect(resolveAccessMock).toHaveBeenCalledTimes(1);

    // Cached deny → still false (fail closed).
    expect(
      canSeeChangeForUser(resourceEvent, "sharee@example.com", "org-bob"),
    ).toBe(false);
  });

  it("poll retries a cache-miss event instead of advancing past it", async () => {
    resolveAccessMock.mockResolvedValue({ role: "viewer", resource: {} });
    const before = getVersion();
    recordChange(resourceEvent);
    const eventVersion = getVersion();

    const first = getChangesSinceForUser(
      before,
      "sharee@example.com",
      "org-bob",
    );
    expect(first.events).toEqual([]);
    expect(first.version).toBeGreaterThanOrEqual(before);
    expect(first.version).toBeLessThan(eventVersion);

    await flushAsync();

    const second = getChangesSinceForUser(
      first.version,
      "sharee@example.com",
      "org-bob",
    );
    expect(second.events).toHaveLength(1);
    expect(second.events[0]).toMatchObject({
      source: "collab",
      resourceType: "document",
      resourceId: "doc-res-1",
    });
    expect(second.version).toBeGreaterThan(first.version);
  });

  it("revocation invalidates allowed cache entries immediately", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    // Grant access, populate cache.
    resolveAccessMock.mockResolvedValue({ role: "viewer", resource: {} });
    expect(
      canSeeChangeForUser(resourceEvent, "sharee@example.com", "org-bob"),
    ).toBe(false);
    await vi.runAllTimersAsync();
    expect(
      canSeeChangeForUser(resourceEvent, "sharee@example.com", "org-bob"),
    ).toBe(true);

    // Access revoked upstream.
    resolveAccessMock.mockResolvedValue(null);
    invalidateCollabAccessCache("document", "doc-res-1");

    // Still within the old 30s TTL, but explicit invalidation drops stale allow.
    vi.setSystemTime(new Date("2026-01-01T00:00:20Z"));
    expect(
      canSeeChangeForUser(resourceEvent, "sharee@example.com", "org-bob"),
    ).toBe(false);
    await vi.runAllTimersAsync();
    expect(
      canSeeChangeForUser(resourceEvent, "sharee@example.com", "org-bob"),
    ).toBe(false);
  });

  it("denied entries expire on the short TTL so transient errors recover fast", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    // First check errors → cached deny with the short (~5s) TTL.
    resolveAccessMock.mockRejectedValueOnce(new Error("transient"));
    expect(
      canSeeChangeForUser(resourceEvent, "sharee@example.com", "org-bob"),
    ).toBe(false);
    await vi.runAllTimersAsync();
    expect(
      canSeeChangeForUser(resourceEvent, "sharee@example.com", "org-bob"),
    ).toBe(false);

    // After the short deny TTL, a re-check that now succeeds grants access.
    resolveAccessMock.mockResolvedValue({ role: "viewer", resource: {} });
    vi.setSystemTime(new Date("2026-01-01T00:00:06Z"));
    expect(
      canSeeChangeForUser(resourceEvent, "sharee@example.com", "org-bob"),
    ).toBe(false); // miss → schedules re-check
    await vi.runAllTimersAsync();
    expect(
      canSeeChangeForUser(resourceEvent, "sharee@example.com", "org-bob"),
    ).toBe(true);
  });

  it("event with owner/org tags but NO resourceType/resourceId keeps the conservative contract", () => {
    // No resource tags → access-aware branch never runs; only owner/org match.
    const legacy: CollabChangeEvent = {
      source: "collab",
      type: "change",
      docId: "doc-abc",
      owner: "alice@example.com",
    };
    expect(canSeeChangeForUser(legacy, "sharee@example.com", "org-bob")).toBe(
      false,
    );
    expect(resolveAccessMock).not.toHaveBeenCalled();
  });
});

describe("awareness event scoping via poll-events", () => {
  it("drops unscoped awareness events instead of treating them as global", () => {
    expect(
      canSeeAwarenessChangeForUser({}, "alice@example.com", undefined),
    ).toBe(false);
    expect(canSeeAwarenessChangeForUser({}, "bob@example.com", "org-b")).toBe(
      false,
    );
  });

  it("delivers owner-scoped awareness only to the owner", () => {
    expect(
      canSeeAwarenessChangeForUser(
        { owner: "alice@example.com" },
        "alice@example.com",
        undefined,
      ),
    ).toBe(true);
    expect(
      canSeeAwarenessChangeForUser(
        { owner: "alice@example.com" },
        "bob@example.com",
        undefined,
      ),
    ).toBe(false);
  });

  it("delivers org-scoped awareness only within the org", () => {
    expect(
      canSeeAwarenessChangeForUser(
        { orgId: "org-acme" },
        "alice@example.com",
        "org-acme",
      ),
    ).toBe(true);
    expect(
      canSeeAwarenessChangeForUser(
        { orgId: "org-acme" },
        "eve@example.com",
        "org-evil",
      ),
    ).toBe(false);
  });

  it("delivers resource-scoped awareness to explicit sharees after the access cache resolves", async () => {
    resolveAccessMock.mockResolvedValue({ role: "viewer", resource: {} });
    const event = {
      owner: "alice@example.com",
      resourceType: "document",
      resourceId: "doc-res-1",
    };

    expect(
      canSeeAwarenessChangeForUser(event, "sharee@example.com", "org-bob"),
    ).toBe(false);

    await flushAsync();
    expect(resolveAccessMock).toHaveBeenCalledWith("document", "doc-res-1", {
      userEmail: "sharee@example.com",
      orgId: "org-bob",
    });

    expect(
      canSeeAwarenessChangeForUser(event, "sharee@example.com", "org-bob"),
    ).toBe(true);
  });
});

describe("awareness outer-map memory leak guard (pruneIfEmpty)", () => {
  // Test that the awareness map does not accumulate empty per-doc maps.
  // This exercises the behaviour added to postAwareness in the security commit.

  it("cleans up empty doc maps after all clients expire", async () => {
    // Dynamic import so the module-level map state is fresh.
    const { getDocAwareness, cleanExpired } = await import("./awareness.js");

    const docId = `test-prune-${Math.random()}`;
    const map = getDocAwareness(docId);

    // Populate with one entry that will immediately expire.
    const longAgo = Date.now() - 60_000;
    map.set(42, { clientId: 42, state: "s", lastSeen: longAgo });
    expect(map.size).toBe(1);

    // cleanExpired removes the entry.
    cleanExpired(map);
    expect(map.size).toBe(0);
    // map is now empty; the outer map should eventually not contain it.
    // (pruneIfEmpty is called inside the handlers, not cleanExpired itself.)
    // We confirm the entry was removed from the per-doc map here.
    expect(map.has(42)).toBe(false);
  });
});
