import { afterEach, describe, expect, it, vi } from "vitest";

import { AGENT_CLIENT_ID } from "./agent-identity.js";
import {
  isReconcileLeadClient,
  reconcileRemoteAwarenessStates,
} from "./client.js";

/** Minimal Awareness stand-in: isReconcileLeadClient only calls getStates(). */
function fakeAwareness(states: Map<number, unknown>): any {
  return { getStates: () => states };
}

/**
 * Adversarial coverage for the CRDT snapshot leader election + awareness
 * reconciliation. The danger here is DUPLICATION: if two clients both believe
 * they are the reconcile lead, an authoritative external snapshot (agent/source
 * edit) gets diffed into the CRDT by BOTH, inserting the changed region twice.
 * So the central invariant is: across every client's view of a shared awareness
 * set, AT MOST ONE returns true.
 */
describe("isReconcileLeadClient — split-brain / duplication safety", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("elects EXACTLY ONE lead across all visible peers (no split-brain)", () => {
    // Three visible human peers see the same awareness set. Each evaluates
    // locally; exactly one must claim leadership.
    const ids = [12, 4, 77];
    const states = new Map<number, unknown>(
      ids.map((id) => [id, { user: { name: `U${id}` } }] as const),
    );
    const leads = ids.filter((id) =>
      isReconcileLeadClient(fakeAwareness(states), id),
    );
    expect(leads).toEqual([4]); // lowest visible id, and only it
    expect(leads.length).toBe(1);
  });

  it("with no document present (Node/SSR), a present lower peer still wins (no double-apply)", () => {
    // `typeof document === "undefined"` so localHidden is false. The lowest id
    // among visible peers leads; a higher id yields. Verifies the !document
    // branch can't make two clients both lead.
    expect(typeof document).toBe("undefined");
    const states = new Map<number, unknown>([
      [2, { user: { name: "Low" } }],
      [9, { user: { name: "High" } }],
    ]);
    expect(isReconcileLeadClient(fakeAwareness(states), 2)).toBe(true);
    expect(isReconcileLeadClient(fakeAwareness(states), 9)).toBe(false);
  });

  it("does not count the agent as a peer that suppresses the sole human lead", () => {
    // Only the agent + local human: human must lead so agent edits actually
    // reconcile into the visible editor.
    const states = new Map<number, unknown>([
      [AGENT_CLIENT_ID, { user: { name: "AI" } }],
      [3, { user: { name: "Human" } }],
    ]);
    expect(isReconcileLeadClient(fakeAwareness(states), 3)).toBe(true);
  });

  it("DANGER CASE: when the lowest visible peer's tab is hidden, leadership must still resolve to exactly one client", () => {
    // Peer 2 is the lowest id and visible-by-default, but THIS client (id 5) is
    // hidden. A hidden local tab yields. The risk: if peer 2 ALSO yields for
    // some reason, no one leads and the agent edit never lands. Here we only
    // assert the LOCAL hidden client yields when a visible lower peer exists —
    // pairs with client.spec's visible-peer test to bound the election.
    vi.stubGlobal("document", { visibilityState: "hidden" });
    const states = new Map<number, unknown>([[2, { user: { name: "Peer" } }]]);
    expect(isReconcileLeadClient(fakeAwareness(states), 5)).toBe(false);
  });

  it("handles clientId 0 as a legitimate lead candidate (not falsy-skipped)", () => {
    // Yjs client ids can be 0. The election uses `clientId < minVisible` and
    // `localClientId <= minVisible` — make sure id 0 is treated as the lowest
    // and leads, rather than being dropped by a truthiness check somewhere.
    const states = new Map<number, unknown>([
      [0, { user: { name: "Zero" } }],
      [5, { user: { name: "Five" } }],
    ]);
    expect(isReconcileLeadClient(fakeAwareness(states), 0)).toBe(true);
    expect(isReconcileLeadClient(fakeAwareness(states), 5)).toBe(false);
  });
});

describe("reconcileRemoteAwarenessStates — adversarial presence sync", () => {
  it("last-write-wins on duplicate remote clientIds (no double-add)", () => {
    const states = new Map<number, unknown>();
    const changes = reconcileRemoteAwarenessStates(states, 99, [
      { clientId: 7, state: { user: { name: "first" } } },
      { clientId: 7, state: { user: { name: "second" } } },
    ]);
    // Second occurrence is an UPDATE of the first, not a second ADD.
    expect(changes.added).toEqual([7]);
    expect(changes.updated).toEqual([7]);
    expect((states.get(7) as any).user.name).toBe("second");
  });

  it("removes ALL stale clients when the remote set empties (presence cleanup)", () => {
    const states = new Map<number, unknown>([
      [1, { user: { name: "Me" } }],
      [2, { user: { name: "GoneA" } }],
      [3, { user: { name: "GoneB" } }],
    ]);
    const changes = reconcileRemoteAwarenessStates(states, 1, []);
    expect(changes.removed.sort()).toEqual([2, 3]);
    expect(Array.from(states.keys())).toEqual([1]); // local always retained
  });

  it("ignores Infinity / -Infinity / NaN client ids (malicious presence payload)", () => {
    const states = new Map<number, unknown>();
    const changes = reconcileRemoteAwarenessStates(states, 1, [
      { clientId: Infinity, state: {} },
      { clientId: -Infinity, state: {} },
      { clientId: NaN, state: {} },
      { clientId: 8, state: { ok: true } },
    ]);
    expect(changes.added).toEqual([8]);
    expect(Array.from(states.keys())).toEqual([8]);
  });
});
