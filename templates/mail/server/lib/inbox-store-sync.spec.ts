import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyLocalLabelDelta: vi.fn(),
  findThreadIdsByMessageIds: vi.fn(),
  invalidateListCacheForOwner: vi.fn(),
}));

vi.mock("./google-auth.js", () => ({
  invalidateListCacheForOwner: mocks.invalidateListCacheForOwner,
}));

vi.mock("./inbox-store.js", () => ({
  applyLocalLabelDelta: mocks.applyLocalLabelDelta,
  findThreadIdsByMessageIds: mocks.findThreadIdsByMessageIds,
}));

import {
  syncInboxLabelDelta,
  syncInboxLabelDeltaForTargets,
} from "./inbox-store-sync.js";

describe("syncInboxLabelDelta", () => {
  beforeEach(() => vi.clearAllMocks());

  it("no-ops on an empty thread id list", async () => {
    await syncInboxLabelDelta("owner@example.com", "acct@example.com", [], {
      add: ["STARRED"],
    });
    expect(mocks.applyLocalLabelDelta).not.toHaveBeenCalled();
    expect(mocks.invalidateListCacheForOwner).not.toHaveBeenCalled();
  });

  it("applies the delta and invalidates the list cache", async () => {
    await syncInboxLabelDelta("owner@example.com", "acct@example.com", ["t1"], {
      remove: ["INBOX"],
    });
    expect(mocks.applyLocalLabelDelta).toHaveBeenCalledWith(
      "owner@example.com",
      "acct@example.com",
      ["t1"],
      { remove: ["INBOX"] },
    );
    expect(mocks.invalidateListCacheForOwner).toHaveBeenCalledWith(
      "owner@example.com",
    );
  });
});

describe("syncInboxLabelDeltaForTargets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses a target's own threadId hint without a store lookup", async () => {
    await syncInboxLabelDeltaForTargets(
      "owner@example.com",
      [{ id: "m1", threadId: "t1", accountEmail: "acct@example.com" }],
      { add: ["STARRED"] },
    );
    expect(mocks.findThreadIdsByMessageIds).not.toHaveBeenCalled();
    expect(mocks.applyLocalLabelDelta).toHaveBeenCalledWith(
      "owner@example.com",
      "acct@example.com",
      ["t1"],
      { add: ["STARRED"] },
    );
  });

  it("resolves a missing threadId from the store, grouped per account", async () => {
    mocks.findThreadIdsByMessageIds.mockImplementation(
      async (_owner: string, account: string, ids: string[]) => {
        if (account === "a@example.com") return new Map([["m1", "t1"]]);
        if (account === "b@example.com") return new Map([["m2", "t2"]]);
        return new Map();
      },
    );

    await syncInboxLabelDeltaForTargets(
      "owner@example.com",
      [
        { id: "m1", accountEmail: "a@example.com" },
        { id: "m2", accountEmail: "b@example.com" },
      ],
      { remove: ["UNREAD"] },
    );

    expect(mocks.applyLocalLabelDelta).toHaveBeenCalledWith(
      "owner@example.com",
      "a@example.com",
      ["t1"],
      { remove: ["UNREAD"] },
    );
    expect(mocks.applyLocalLabelDelta).toHaveBeenCalledWith(
      "owner@example.com",
      "b@example.com",
      ["t2"],
      { remove: ["UNREAD"] },
    );
  });

  it("drops a target with no accountEmail rather than guessing the owner's account", async () => {
    await syncInboxLabelDeltaForTargets("owner@example.com", [{ id: "m1" }], {
      add: ["STARRED"],
    });

    expect(mocks.findThreadIdsByMessageIds).not.toHaveBeenCalled();
    expect(mocks.applyLocalLabelDelta).not.toHaveBeenCalled();
  });

  it("skips a target whose message id never resolves to a threadId", async () => {
    mocks.findThreadIdsByMessageIds.mockResolvedValue(new Map());

    await syncInboxLabelDeltaForTargets(
      "owner@example.com",
      [{ id: "unknown-message", accountEmail: "a@example.com" }],
      { add: ["STARRED"] },
    );

    expect(mocks.applyLocalLabelDelta).not.toHaveBeenCalled();
  });

  it("resolves the other targets in the same call even when one has no accountEmail", async () => {
    mocks.findThreadIdsByMessageIds.mockResolvedValue(new Map([["m1", "t1"]]));

    await syncInboxLabelDeltaForTargets(
      "owner@example.com",
      [
        { id: "m1", accountEmail: "a@example.com" },
        { id: "m2" }, // no accountEmail — dropped, not defaulted
      ],
      { remove: ["UNREAD"] },
    );

    expect(mocks.applyLocalLabelDelta).toHaveBeenCalledTimes(1);
    expect(mocks.applyLocalLabelDelta).toHaveBeenCalledWith(
      "owner@example.com",
      "a@example.com",
      ["t1"],
      { remove: ["UNREAD"] },
    );
  });

  it("passes scope 'message' with the account's own message ids to applyLocalLabelDelta", async () => {
    await syncInboxLabelDeltaForTargets(
      "owner@example.com",
      [{ id: "m1", threadId: "t1", accountEmail: "a@example.com" }],
      { remove: ["UNREAD"], scope: "message" },
    );

    expect(mocks.applyLocalLabelDelta).toHaveBeenCalledWith(
      "owner@example.com",
      "a@example.com",
      ["t1"],
      { remove: ["UNREAD"], scope: "message", messageIds: ["m1"] },
    );
  });
});
