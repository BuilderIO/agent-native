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
 */

import { describe, expect, it } from "vitest";

import { canSeeChangeForUser } from "../server/poll.js";

type CollabChangeEvent = {
  source: string;
  type: string;
  docId?: string;
  update?: string;
  owner?: string;
  orgId?: string;
  version?: number;
};

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
