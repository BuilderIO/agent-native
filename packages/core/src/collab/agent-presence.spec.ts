import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSearchAndReplace = vi.fn();
const mockApplyPatchOps = vi.fn();

vi.mock("./ydoc-manager.js", () => ({
  searchAndReplace: (...args: unknown[]) => mockSearchAndReplace(...args),
  applyPatchOps: (...args: unknown[]) => mockApplyPatchOps(...args),
}));

import { AGENT_CLIENT_ID, DEFAULT_AGENT_IDENTITY } from "./agent-identity.js";
import {
  agentEnterDocument,
  agentLeaveDocument,
  agentUpdateSelection,
  agentApplyEditsIncrementally,
  agentApplyPatchesIncrementally,
} from "./agent-presence.js";
import { getDocAwareness } from "./awareness.js";

function agentState(docId: string): Record<string, any> | undefined {
  const entry = getDocAwareness(docId).get(AGENT_CLIENT_ID);
  return entry ? JSON.parse(entry.state) : undefined;
}

afterEach(() => {
  mockSearchAndReplace.mockReset();
  mockApplyPatchOps.mockReset();
});

describe("agentEnterDocument / agentLeaveDocument", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

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
  });

  it("merges extra metadata into the awareness state", () => {
    const docId = "presence-meta";
    agentEnterDocument(docId, { selection: { trackId: "t1" } });
    expect(agentState(docId)).toMatchObject({
      user: { name: DEFAULT_AGENT_IDENTITY.name },
      selection: { trackId: "t1" },
    });
    agentLeaveDocument(docId);
  });

  it("ref-counts: stays present until the last leave drains the count", () => {
    const docId = "presence-refcount";
    agentEnterDocument(docId);
    agentEnterDocument(docId);

    agentLeaveDocument(docId); // count 2 -> 1, still present
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(true);

    agentLeaveDocument(docId); // count 1 -> 0, removed
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
    setIntervalSpy.mockRestore();
  });

  it("heartbeat refreshes lastSeen while present", () => {
    const docId = "presence-tick";
    vi.setSystemTime(0);
    agentEnterDocument(docId);
    expect(getDocAwareness(docId).get(AGENT_CLIENT_ID)?.lastSeen).toBe(0);

    // Advancing past the 10s interval fires the heartbeat, which stamps
    // lastSeen with Date.now() at fire time (the advanced fake clock).
    vi.advanceTimersByTime(10_000);
    expect(getDocAwareness(docId).get(AGENT_CLIENT_ID)?.lastSeen).toBe(10_000);

    agentLeaveDocument(docId);
  });

  it("leave on a never-entered doc does not throw and leaves no entry", () => {
    const docId = "presence-never-entered";
    expect(() => agentLeaveDocument(docId)).not.toThrow();
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
    agentLeaveDocument(docId); // drain both refs (enter + leave symmetry)
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

describe("agentApplyEditsIncrementally", () => {
  it("enters, applies each edit via searchAndReplace, then leaves", async () => {
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
    // Presence cleaned up after completion.
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(false);
  });

  it("leaves the document even if an edit throws", async () => {
    const docId = "presence-edits-error";
    mockSearchAndReplace.mockRejectedValue(new Error("boom"));

    await expect(
      agentApplyEditsIncrementally(docId, [{ find: "x", replace: "y" }], {
        delayMs: 0,
      }),
    ).rejects.toThrow("boom");

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
    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(false);
  });

  it("leaves the document even if a patch throws", async () => {
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

    expect(getDocAwareness(docId).has(AGENT_CLIENT_ID)).toBe(false);
  });
});
