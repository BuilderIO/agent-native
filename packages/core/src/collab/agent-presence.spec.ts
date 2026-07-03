import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSearchAndReplace = vi.fn();
const mockApplyPatchOps = vi.fn();

vi.mock("./ydoc-manager.js", () => ({
  searchAndReplace: (...args: unknown[]) => mockSearchAndReplace(...args),
  applyPatchOps: (...args: unknown[]) => mockApplyPatchOps(...args),
}));

import { AGENT_CLIENT_ID, DEFAULT_AGENT_IDENTITY } from "./agent-identity.js";
import {
  AGENT_PRESENCE_LINGER_MS,
  agentEnterDocument,
  agentLeaveDocument,
  agentTouchDocument,
  agentUpdateSelection,
  agentApplyEditsIncrementally,
  agentApplyPatchesIncrementally,
} from "./agent-presence.js";
import {
  AWARENESS_CHANGE_EVENT,
  getAwarenessEmitter,
  getDocAwareness,
  rememberAwarenessScope,
  type AwarenessChangeEvent,
} from "./awareness.js";
import { RECENT_EDITS_MAX } from "./recent-edits.js";

function agentState(docId: string): Record<string, any> | undefined {
  const entry = getDocAwareness(docId).get(AGENT_CLIENT_ID);
  return entry ? JSON.parse(entry.state) : undefined;
}

/** Fire any pending linger removal for deterministic cleanup. */
function flushLinger(): void {
  vi.advanceTimersByTime(AGENT_PRESENCE_LINGER_MS + 1);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  mockSearchAndReplace.mockReset();
  mockApplyPatchOps.mockReset();
});

describe("agentEnterDocument / agentLeaveDocument", () => {
  it("sets an awareness entry with the agent identity on enter", () => {
    const docId = "presence-enter";
    agentEnterDocument(docId);

    const entry = getDocAwareness(docId).get(AGENT_CLIENT_ID);
    expect(entry?.clientId).toBe(AGENT_CLIENT_ID);
    expect(agentState(docId)).toEqual({
      user: {
        name: DEFAULT_AGENT_IDENTITY.name,
        email: DEFAULT_AGENT_IDENTITY.email,
        color: DEFAULT_AGENT_IDENTITY.color,
      },
    });

    agentLeaveDocument(docId);
    flushLinger();
  });

  it("merges extra metadata into the awareness state", () => {
    const docId = "presence-meta";
    agentEnterDocument(docId, { selection: { trackId: "t1" } });
    expect(agentState(docId)).toMatchObject({
      user: { name: DEFAULT_AGENT_IDENTITY.name },
      selection: { trackId: "t1" },
    });
    agentLeaveDocument(docId);
    flushLinger();
  });

  it("ref-counts: stays present until the last leave drains the count", () => {
    const docId = "presence-refcount";
    agentEnterDocument(docId);
    agentEnterDocument(docId);

    agentLeaveDocument(docId); // count 2 -> 1, still present
    flushLinger();
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(true);

    agentLeaveDocument(docId); // count 1 -> 0, linger then removed
    flushLinger();
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(false);
  });

  it("lingers after the final leave, then clears", () => {
    const docId = "presence-linger";
    agentEnterDocument(docId);
    agentLeaveDocument(docId);

    // Still present immediately after leave — viewers get a beat to see it.
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(true);

    vi.advanceTimersByTime(AGENT_PRESENCE_LINGER_MS - 1000);
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(true);

    vi.advanceTimersByTime(2000);
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(false);
  });

  it("clears immediately when lingerMs is 0", () => {
    const docId = "presence-no-linger";
    agentEnterDocument(docId);
    agentLeaveDocument(docId, { lingerMs: 0 });
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(false);
  });

  it("re-entering during the linger window cancels the removal", () => {
    const docId = "presence-relinger";
    agentEnterDocument(docId);
    agentLeaveDocument(docId);

    vi.advanceTimersByTime(AGENT_PRESENCE_LINGER_MS - 1000);
    agentEnterDocument(docId); // back in before the linger fires

    vi.advanceTimersByTime(AGENT_PRESENCE_LINGER_MS * 2);
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(true);

    agentLeaveDocument(docId);
    flushLinger();
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(false);
  });

  it("reuses a single heartbeat interval across nested enters", () => {
    const docId = "presence-heartbeat";
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const before = setIntervalSpy.mock.calls.length;

    agentEnterDocument(docId);
    agentEnterDocument(docId);

    // Only one interval was created despite two enters.
    expect(setIntervalSpy.mock.calls.length - before).toBe(1);

    agentLeaveDocument(docId);
    agentLeaveDocument(docId);
    flushLinger();
    setIntervalSpy.mockRestore();
  });

  it("heartbeat refreshes lastSeen while present (including linger)", () => {
    const docId = "presence-tick";
    vi.setSystemTime(0);
    agentEnterDocument(docId);
    expect(getDocAwareness(docId).get(AGENT_CLIENT_ID)?.lastSeen).toBe(0);

    // Advancing past the 10s interval fires the heartbeat, which stamps
    // lastSeen with Date.now() at fire time (the advanced fake clock).
    vi.advanceTimersByTime(10_000);
    expect(getDocAwareness(docId).get(AGENT_CLIENT_ID)?.lastSeen).toBe(10_000);

    agentLeaveDocument(docId);
    flushLinger();
  });

  it("leave on a never-entered doc does not throw and leaves no entry", () => {
    const docId = "presence-never-entered";
    expect(() => agentLeaveDocument(docId)).not.toThrow();
    flushLinger();
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(false);
  });
});

describe("agentUpdateSelection", () => {
  it("merges selection onto the existing state, preserving user identity", () => {
    const docId = "presence-select";
    agentEnterDocument(docId);
    agentUpdateSelection(docId, { selection: { panel: "left" } });

    expect(agentState(docId)).toMatchObject({
      user: { name: DEFAULT_AGENT_IDENTITY.name },
      selection: { panel: "left" },
    });

    agentLeaveDocument(docId);
    flushLinger();
    getDocAwareness(docId).clear();
  });

  it("falls back to default identity when there is no existing entry", () => {
    const docId = "presence-select-fresh";
    agentUpdateSelection(docId, { selection: { panel: "right" } });
    expect(agentState(docId)).toEqual({
      user: {
        name: DEFAULT_AGENT_IDENTITY.name,
        email: DEFAULT_AGENT_IDENTITY.email,
        color: DEFAULT_AGENT_IDENTITY.color,
      },
      selection: { panel: "right" },
    });
    getDocAwareness(docId).clear();
  });

  it("recovers from a corrupt stored state by using defaults", () => {
    const docId = "presence-select-corrupt";
    getDocAwareness(docId).set(AGENT_CLIENT_ID, {
      clientId: AGENT_CLIENT_ID,
      state: "{not valid json",
      lastSeen: Date.now(),
    });

    agentUpdateSelection(docId, { selection: { focused: true } });
    expect(agentState(docId)).toEqual({
      user: {
        name: DEFAULT_AGENT_IDENTITY.name,
        email: DEFAULT_AGENT_IDENTITY.email,
        color: DEFAULT_AGENT_IDENTITY.color,
      },
      selection: { focused: true },
    });
    getDocAwareness(docId).clear();
  });
});

describe("agentTouchDocument", () => {
  it("emits awareness-change events for agent presence updates and removal", () => {
    const docId = "touch-emits";
    rememberAwarenessScope(docId, {
      owner: "owner@example.com",
      resourceType: "document",
      resourceId: "doc-1",
    });
    const received: AwarenessChangeEvent[] = [];
    const onEvent = (event: AwarenessChangeEvent) => received.push(event);
    getAwarenessEmitter().on(AWARENESS_CHANGE_EVENT, onEvent);

    agentTouchDocument(docId, { edit: { descriptor: { kind: "doc" } } });
    flushLinger();

    getAwarenessEmitter().off(AWARENESS_CHANGE_EVENT, onEvent);
    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({
      docId,
      owner: "owner@example.com",
      resourceType: "document",
      resourceId: "doc-1",
    });
    expect(received[0].states.some((s) => s.clientId === AGENT_CLIENT_ID)).toBe(
      true,
    );
    expect(received[1].states.some((s) => s.clientId === AGENT_CLIENT_ID)).toBe(
      false,
    );
  });

  it("creates presence with a recentEdits entry and lastEditAt", () => {
    const docId = "touch-basic";
    vi.setSystemTime(1000);

    agentTouchDocument(docId, {
      edit: { descriptor: { kind: "text", quote: "hello" }, label: "Intro" },
    });

    const state = agentState(docId);
    expect(state).toMatchObject({
      user: { email: DEFAULT_AGENT_IDENTITY.email },
      lastEditAt: 1000,
    });
    expect(state?.recentEdits).toEqual([
      {
        descriptor: { kind: "text", quote: "hello" },
        label: "Intro",
        at: 1000,
      },
    ]);

    flushLinger();
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(false);
  });

  it("caps the recentEdits ring", () => {
    const docId = "touch-ring";
    for (let i = 0; i < RECENT_EDITS_MAX + 3; i++) {
      agentTouchDocument(docId, {
        edit: { descriptor: { kind: "text", quote: `edit-${i}` } },
      });
    }
    const ring = agentState(docId)?.recentEdits as Array<{
      descriptor: { quote: string };
    }>;
    expect(ring).toHaveLength(RECENT_EDITS_MAX);
    expect(ring[ring.length - 1].descriptor.quote).toBe(
      `edit-${RECENT_EDITS_MAX + 2}`,
    );
    flushLinger();
  });

  it("does not auto-clear while an explicit enter/leave pair is active", () => {
    const docId = "touch-during-enter";
    agentEnterDocument(docId);
    agentTouchDocument(docId, {
      edit: { descriptor: { kind: "doc" } },
    });

    flushLinger();
    // Still present: the explicit operation owns the lifecycle.
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(true);

    agentLeaveDocument(docId);
    flushLinger();
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(false);
  });

  it("successive touches keep refreshing the linger window", () => {
    const docId = "touch-refresh";
    agentTouchDocument(docId, { edit: { descriptor: { kind: "doc" } } });

    vi.advanceTimersByTime(AGENT_PRESENCE_LINGER_MS - 500);
    agentTouchDocument(docId, { edit: { descriptor: { kind: "doc" } } });

    vi.advanceTimersByTime(AGENT_PRESENCE_LINGER_MS - 500);
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(false);
  });
});

describe("agentApplyEditsIncrementally", () => {
  it("enters, applies each edit via searchAndReplace, then lingers and leaves", async () => {
    const docId = "presence-edits";
    mockSearchAndReplace.mockResolvedValue({
      found: true,
      update: new Uint8Array(),
    });

    await agentApplyEditsIncrementally(
      docId,
      [
        { find: "a", replace: "b" },
        { find: "c", replace: "d" },
      ],
      { delayMs: 0 },
    );

    expect(mockSearchAndReplace).toHaveBeenCalledTimes(2);
    expect(mockSearchAndReplace).toHaveBeenNthCalledWith(
      1,
      docId,
      "a",
      "b",
      "agent",
    );
    expect(mockSearchAndReplace).toHaveBeenNthCalledWith(
      2,
      docId,
      "c",
      "d",
      "agent",
    );
    // Presence lingers after completion so viewers see who edited…
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(true);
    // …then clears.
    flushLinger();
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(false);
  });

  it("clears presence (after linger) even if an edit throws", async () => {
    const docId = "presence-edits-error";
    mockSearchAndReplace.mockRejectedValue(new Error("boom"));

    await expect(
      agentApplyEditsIncrementally(docId, [{ find: "x", replace: "y" }], {
        delayMs: 0,
      }),
    ).rejects.toThrow("boom");

    flushLinger();
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(false);
  });
});

describe("agentApplyPatchesIncrementally", () => {
  it("applies each patch via applyPatchOps with the field name and agent origin", async () => {
    const docId = "presence-patches";
    mockApplyPatchOps.mockResolvedValue(undefined);

    const patches = [
      { op: "set", path: "a", value: 1 },
      { op: "delete", path: "b" },
    ];
    await agentApplyPatchesIncrementally(docId, "data", patches, {
      delayMs: 0,
    });

    expect(mockApplyPatchOps).toHaveBeenCalledTimes(2);
    expect(mockApplyPatchOps).toHaveBeenNthCalledWith(
      1,
      docId,
      [patches[0]],
      "data",
      "agent",
    );
    flushLinger();
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(false);
  });

  it("clears presence (after linger) even if a patch throws", async () => {
    const docId = "presence-patches-error";
    mockApplyPatchOps.mockRejectedValue(new Error("patch failed"));

    await expect(
      agentApplyPatchesIncrementally(
        docId,
        "data",
        [{ op: "set", path: "a", value: 1 }],
        { delayMs: 0 },
      ),
    ).rejects.toThrow("patch failed");

    flushLinger();
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(false);
  });
});
