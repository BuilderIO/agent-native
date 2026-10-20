import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCallerMock = vi.hoisted(() => vi.fn());
const getDbMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
}));
vi.mock("../server/db/index.js", () => ({ getDb: getDbMock }));
vi.mock("../server/lib/workflow-action-support.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/workflow-action-support.js")
  >()),
  requireWorkflowActionCaller: requireCallerMock,
}));

import { encodeInboxCursor } from "../server/lib/inbox-cursor.js";
import action from "./list-factory-items.js";

const caller = {
  userEmail: "owner@example.test",
  orgId: "org-1",
  factoryId: "f1",
};
const context = { caller: "automation" as const, userEmail: caller.userEmail };

function row(index: number, extra: Record<string, unknown> = {}) {
  return {
    id: `item-${String(index).padStart(3, "0")}`,
    source: "slack",
    externalId: `ext-${index}`,
    sourceUrl: `https://slack.test/${index}`,
    title: `Item ${index}`,
    summary: "A short summary",
    status: "automation_started",
    channelId: "C0123ABCD",
    threadTs: `1700000${String(index).padStart(3, "0")}.000100`,
    repository: null,
    pullRequestNumber: null,
    headSha: null,
    metadataJson: JSON.stringify({
      author: "ada",
      builderBranch: "factory-g1",
    }),
    payloadJson: "{}",
    createdAt: "2026-10-14T10:00:00.000Z",
    updatedAt: `2026-10-14T11:${String(59 - index).padStart(2, "0")}:00.000Z`,
    ...extra,
  };
}

function dbReturning(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  getDbMock.mockReturnValue({
    select: () => ({ from: () => ({ where }) }),
  });
  return { limit, where };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCallerMock.mockResolvedValue(caller);
});

describe("list-factory-items", () => {
  it("is read-only and takes any item status", () => {
    const schema = action.schema as {
      safeParse: (v: unknown) => { success: boolean };
    };

    expect(action.readOnly).toBe(true);
    expect(schema.safeParse({ status: "automation_started" }).success).toBe(
      true,
    );
    expect(
      schema.safeParse({ status: "automation_started", limit: 101 }).success,
    ).toBe(false);
    expect(schema.safeParse({ status: "mystery" }).success).toBe(false);
  });

  it("returns the items in the status, not clamped to a job's work limit", async () => {
    const { limit } = dbReturning(Array.from({ length: 20 }, (_, i) => row(i)));

    const result = (await action.run(
      { status: "automation_started", limit: 20 },
      context,
    )) as Record<string, any>;

    expect(limit).toHaveBeenCalledWith(21);
    expect(result).toMatchObject({
      ok: true,
      status: "automation_started",
      count: 20,
      hasMore: false,
      nextCursor: null,
      truncated: false,
    });
    expect(result.items[0]).toMatchObject({
      id: "item-000",
      source: "slack",
      author: "ada",
      channelId: "C0123ABCD",
      metadata: { builderBranch: "factory-g1" },
    });
  });

  it("pages: one more row than asked means hasMore, with a cursor after the last item", async () => {
    dbReturning(Array.from({ length: 6 }, (_, i) => row(i)));

    const result = (await action.run(
      { status: "automation_started", limit: 5 },
      context,
    )) as Record<string, any>;

    expect(result.count).toBe(5);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe(
      encodeInboxCursor({
        updatedAt: "2026-10-14T11:55:00.000Z",
        id: "item-004",
      }),
    );
  });

  it("cuts a page to the size cap, says so, and resumes after the last item returned", async () => {
    const big = "z".repeat(450);
    dbReturning(
      Array.from({ length: 100 }, (_, i) =>
        row(i, {
          summary: big,
          title: "t".repeat(290),
          metadataJson: JSON.stringify({
            author: "ada",
            a: "x".repeat(900),
            b: "y".repeat(900),
          }),
          payloadJson: JSON.stringify({
            c: "p".repeat(900),
            d: "q".repeat(900),
          }),
        }),
      ),
    );

    const result = (await action.run(
      { status: "automation_started", limit: 100 },
      context,
    )) as Record<string, any>;

    expect(result.truncated).toBe(true);
    expect(result.hasMore).toBe(true);
    expect(result.count).toBeLessThan(100);
    expect(result.nextCursor).toBe(
      encodeInboxCursor({
        updatedAt: result.items[result.count - 1].updatedAt,
        id: result.items[result.count - 1].id,
      }),
    );
    expect(JSON.stringify(result).length).toBeLessThan(40_000);
  });

  it("flags an item whose metadata did not fit whole", async () => {
    dbReturning([
      row(0, {
        metadataJson: JSON.stringify({ author: "ada", big: "x".repeat(5_000) }),
      }),
    ]);

    const result = (await action.run(
      { status: "automation_started", limit: 5 },
      context,
    )) as Record<string, any>;

    expect(result.items[0].truncated).toBe(true);
    expect(result.items[0].metadata).toEqual({ author: "ada" });
    expect(result.truncated).toBe(true);
  });

  it("fails when an item's stored data cannot be read, rather than listing it blank", async () => {
    dbReturning([row(0, { metadataJson: "{not json" })]);

    await expect(
      action.run({ status: "automation_started", limit: 5 }, context),
    ).rejects.toMatchObject({ errorCode: "factory_item_unreadable" });
  });

  it("refuses a cursor it did not issue", async () => {
    dbReturning([]);

    await expect(
      action.run(
        { status: "automation_started", limit: 5, cursor: "garbage" },
        context,
      ),
    ).rejects.toMatchObject({ errorCode: "cursor_invalid" });
  });

  it("does not read for a caller the gate refuses", async () => {
    requireCallerMock.mockRejectedValue(new Error("not allowed"));

    await expect(
      action.run({ status: "automation_started", limit: 5 }, context),
    ).rejects.toThrow("not allowed");
    expect(getDbMock).not.toHaveBeenCalled();
  });
});
