import { afterEach, describe, expect, it, vi } from "vitest";

import { AGENT_CLIENT_ID } from "./agent-identity.js";
import {
  dedupeCollabUsersByEmail,
  reconcileRemoteAwarenessStates,
  emailToColor,
  emailToName,
  isReconcileLeadClient,
} from "./client.js";

/** Minimal Awareness stand-in: isReconcileLeadClient only calls getStates(). */
function fakeAwareness(states: Map<number, unknown>): any {
  return { getStates: () => states };
}

describe("dedupeCollabUsersByEmail", () => {
  it("keeps one presence entry per email", () => {
    const users = dedupeCollabUsersByEmail([
      {
        name: "Katya",
        email: "Katya@example.com",
        color: "#f87171",
      },
      {
        name: "Katya",
        email: "katya@example.com",
        color: "#60a5fa",
      },
      {
        name: "Steve",
        email: "steve@example.com",
        color: "#34d399",
      },
      {
        name: "Katya",
        email: " katya@example.com ",
        color: "#a78bfa",
      },
    ]);

    expect(users).toEqual([
      {
        name: "Katya",
        email: "katya@example.com",
        color: "#f87171",
      },
      {
        name: "Steve",
        email: "steve@example.com",
        color: "#34d399",
      },
    ]);
  });

  it("derives name and color from the email when they are blank", () => {
    const [user] = dedupeCollabUsersByEmail([
      { name: "", email: "Kat@Example.com", color: "" },
    ]);
    // Email is normalized (lowercased/trimmed); name/color are derived from it.
    expect(user.email).toBe("kat@example.com");
    expect(user.name).toBe(emailToName("kat@example.com"));
    expect(user.color).toBe(emailToColor("kat@example.com"));
  });

  it("drops entries with an empty email entirely", () => {
    const users = dedupeCollabUsersByEmail([
      { name: "Ghost", email: "   ", color: "#fff" },
      { name: "Real", email: "real@example.com", color: "#000" },
    ]);
    expect(users).toEqual([
      { name: "Real", email: "real@example.com", color: "#000" },
    ]);
  });
});

describe("reconcileRemoteAwarenessStates", () => {
  it("removes remote clients missing from the latest server response", () => {
    const states = new Map<number, unknown>([
      [1, { user: { email: "local@example.com" } }],
      [2, { user: { email: "stale@example.com" } }],
      [3, { user: { email: "active@example.com" } }],
    ]);

    const changes = reconcileRemoteAwarenessStates(states, 1, [
      { clientId: 3, state: { user: { email: "active@example.com" } } },
      { clientId: 4, state: { user: { email: "new@example.com" } } },
    ]);

    expect(changes).toEqual({ added: [4], updated: [3], removed: [2] });
    expect(Array.from(states.keys())).toEqual([1, 3, 4]);
  });

  it("ignores non-finite client ids and the local client", () => {
    const states = new Map<number, unknown>();
    const changes = reconcileRemoteAwarenessStates(states, 1, [
      { clientId: 1, state: {} }, // self — skipped
      { clientId: NaN, state: {} }, // invalid — skipped
      { clientId: 2, state: { ok: true } },
    ]);
    expect(changes).toEqual({ added: [2], updated: [], removed: [] });
    expect(Array.from(states.keys())).toEqual([2]);
  });

  it("never removes the local client even when absent from the remote set", () => {
    const states = new Map<number, unknown>([[1, { self: true }]]);
    const changes = reconcileRemoteAwarenessStates(states, 1, []);
    expect(changes).toEqual({ added: [], updated: [], removed: [] });
    expect(states.has(1)).toBe(true);
  });
});

describe("emailToName", () => {
  it("capitalizes the local part of the email", () => {
    expect(emailToName("steve@example.com")).toBe("Steve");
  });

  it("falls back to the whole string when there is no @", () => {
    expect(emailToName("anonymous")).toBe("Anonymous");
  });

  it("handles a leading-@ email by using the original string", () => {
    // local part is "" so it falls back to the full email, then capitalizes.
    expect(emailToName("@host")).toBe("@host");
  });
});

describe("emailToColor", () => {
  it("is deterministic for the same email", () => {
    expect(emailToColor("kat@example.com")).toBe(
      emailToColor("kat@example.com"),
    );
  });

  it("always returns a color from the fixed palette", () => {
    const palette = new Set([
      "#f87171",
      "#fb923c",
      "#fbbf24",
      "#a3e635",
      "#34d399",
      "#22d3ee",
      "#60a5fa",
      "#14b8a6",
      "#f472b6",
      "#e879f9",
    ]);
    for (const email of ["a@b.com", "z@y.com", "long.name@corp.io", ""]) {
      expect(palette.has(emailToColor(email))).toBe(true);
    }
  });
});

describe("isReconcileLeadClient (CRDT snapshot leader election)", () => {
  it("returns false when the local client id is null", () => {
    expect(isReconcileLeadClient(fakeAwareness(new Map()), null)).toBe(false);
    expect(isReconcileLeadClient(fakeAwareness(new Map()), undefined)).toBe(
      false,
    );
  });

  it("acts alone when there is no awareness instance", () => {
    expect(isReconcileLeadClient(null, 5)).toBe(true);
  });

  it("is the sole applier when no real peers are present", () => {
    // Only the agent and stale (no user) entries — not real peers.
    const states = new Map<number, unknown>([
      [AGENT_CLIENT_ID, { user: { name: "AI" } }],
      [9, { user: undefined }],
    ]);
    expect(isReconcileLeadClient(fakeAwareness(states), 100)).toBe(true);
  });

  it("the agent client id can never be the lead even if lowest", () => {
    // A visible human peer exists; local IS the agent. Agent must yield.
    const states = new Map<number, unknown>([
      [AGENT_CLIENT_ID, { user: { name: "AI" } }],
      [50, { user: { name: "Human" } }],
    ]);
    // Local = agent id (max int) and there is a visible peer (50) lower than it.
    expect(isReconcileLeadClient(fakeAwareness(states), AGENT_CLIENT_ID)).toBe(
      false,
    );
  });

  it("the lowest-id visible client leads when peers are present", () => {
    const states = new Map<number, unknown>([
      [3, { user: { name: "A" } }],
      [7, { user: { name: "B" } }],
    ]);
    // Local 3 is lowest among visible → leads.
    expect(isReconcileLeadClient(fakeAwareness(states), 3)).toBe(true);
    // Local 7 is not lowest → yields to 3.
    expect(isReconcileLeadClient(fakeAwareness(states), 7)).toBe(false);
  });

  it("skips peers that published visible:false when electing", () => {
    // Peer 2 is backgrounded (visible:false); only peer 8 is visible.
    const states = new Map<number, unknown>([
      [2, { user: { name: "Bg" }, visible: false }],
      [8, { user: { name: "Fg" } }],
    ]);
    // Local 5: lower than the only visible peer (8), so it leads despite the
    // hidden peer 2 having a lower id.
    expect(isReconcileLeadClient(fakeAwareness(states), 5)).toBe(true);
  });

  it("treats a peer without a visible field as visible", () => {
    const states = new Map<number, unknown>([
      [1, { user: { name: "Peer" } }], // no visible field → visible
    ]);
    // Local 4 is higher than visible peer 1 → yields.
    expect(isReconcileLeadClient(fakeAwareness(states), 4)).toBe(false);
  });

  describe("when the local tab is hidden", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("yields leadership to a visible peer even though it would otherwise lead", () => {
      // Node has no `document`; stub a hidden one so the localHidden branch runs.
      vi.stubGlobal("document", { visibilityState: "hidden" });
      const states = new Map<number, unknown>([
        [3, { user: { name: "Peer" } }],
      ]);
      // Local 1 is the lowest id and would normally lead, but its tab is hidden
      // and a visible peer (3) exists — a backgrounded tab pauses its poll and
      // must not hold the applier role, or the agent edit never reaches the
      // visible tab. So it yields.
      expect(isReconcileLeadClient(fakeAwareness(states), 1)).toBe(false);
    });

    it("still leads as the sole client even when hidden", () => {
      vi.stubGlobal("document", { visibilityState: "hidden" });
      // No real peers → the !hasPeer short-circuit fires before the hidden
      // check, so a single-user hidden tab still applies its own agent edits.
      const states = new Map<number, unknown>([
        [AGENT_CLIENT_ID, { user: { name: "AI" } }],
      ]);
      expect(isReconcileLeadClient(fakeAwareness(states), 100)).toBe(true);
    });
  });
});
