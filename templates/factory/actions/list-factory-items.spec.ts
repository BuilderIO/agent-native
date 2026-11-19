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
import { OPERATION_CATALOG } from "../server/workflow/catalog/index.js";
import type { WorkflowNode } from "../server/workflow/contract.js";
import { assertStepWithinCap } from "../server/workflow/engine/cap.js";
import type { FlowItem } from "../server/workflow/engine/types.js";
import story01 from "../server/workflow/stories/01-bug-report-to-builder/workflow.json";
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

  it("cuts a page to the budget it is given, and resumes after the last item returned", async () => {
    dbReturning(
      Array.from({ length: 30 }, (_, i) =>
        row(i, { summary: "s".repeat(450), title: "t".repeat(250) }),
      ),
    );

    const result = (await action.run(
      { status: "automation_started", limit: 30, budgetChars: 4_000 },
      context,
    )) as Record<string, any>;

    expect(result.truncated).toBe(true);
    expect(result.hasMore).toBe(true);
    expect(result.count).toBeGreaterThan(0);
    expect(result.count).toBeLessThan(30);
    expect(JSON.stringify(result.items).length).toBeLessThanOrEqual(4_000);
    expect(result.nextCursor).toBe(
      encodeInboxCursor({
        updatedAt: result.items[result.count - 1].updatedAt,
        id: result.items[result.count - 1].id,
      }),
    );
  });

  it("keeps the first item when the budget is smaller than it, so a cut page is never empty", async () => {
    dbReturning(
      Array.from({ length: 3 }, (_, i) =>
        row(i, {
          summary: "s".repeat(450),
          metadataJson: JSON.stringify({
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
      { status: "automation_started", limit: 3, budgetChars: 1_000 },
      context,
    )) as Record<string, any>;

    expect(result.count).toBe(1);
    expect(result.items[0].id).toBe("item-000");
    expect(result.truncated).toBe(true);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).not.toBeNull();
  });

  it("takes a budget between 1,000 and the output budget, and no more", () => {
    const schema = action.schema as {
      safeParse: (v: unknown) => { success: boolean };
    };
    const parse = (budgetChars: number) =>
      schema.safeParse({ status: "automation_started", budgetChars }).success;

    expect(parse(4_000)).toBe(true);
    expect(parse(999)).toBe(false);
    expect(parse(34_001)).toBe(false);
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

// ---------------------------------------------------------------------------
// Story 01's open reports: what the grouping step is given, and what a step
// carries once it is on the reports a run takes.
// ---------------------------------------------------------------------------

/** A report a workflow handed to Builder, as the Slack poller stored it and the handed-off End recorded its task. */
function openReport(index: number) {
  const n = String(index).padStart(2, "0");
  const threadTs = `17600${n}000.000100`;
  const id = `0b7c9e2a-4d1f-4c6a-9d3e-a1b2c3d4e5${n}`;
  const text =
    "Clicking Pay does nothing on the checkout page. I tried Chrome and Safari and a card that worked yesterday, and the button just spins. This started after this morning's release, and three people on my team see the same thing.";
  return row(index, {
    id,
    externalId: `C0123ABCD:${threadTs}`,
    sourceUrl: `https://acme.slack.com/archives/C0123ABCD/p17600${n}000000100`,
    title: `Pat Customer: Clicking Pay does nothing on the checkout page, report ${n}`,
    summary: `${text} Order ${n}.`,
    threadTs,
    metadataJson: JSON.stringify({
      messageTs: threadTs,
      authorId: "U0123ABCDE",
      author: "U0123ABCDE",
      authorName: "Pat Customer",
      personReactions: [],
      personReactors: {},
      itemKind: "message",
      occurredAt: "2026-10-14T09:00:00.000Z",
      extras: {
        builderTaskId: `proj_8f2c1d9a:factory-${id}`,
        projectId: "proj_8f2c1d9a",
        branchName: `factory-${id}`,
        repository: "acme/web",
      },
      workflowEnd: {
        workflowId: "6f1d8c3e-2b7a-4e5d-9c10-3a4b5c6d7e8f",
        runId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
        status: "automation_started",
        outcome: "done",
        at: "2026-10-14T10:00:00.000Z",
      },
    }),
    payloadJson: JSON.stringify({
      text: text.repeat(3),
      user: "U0123ABCDE",
      ts: threadTs,
      thread_ts: threadTs,
      reply_count: 2,
    }),
  });
}

const OPEN_TASKS = OPERATION_CATALOG.get("factory.listItems")!;
const THREAD = OPERATION_CATALOG.get("slack.readThread")!;

/** What the executor sends the action for this operation: the catalog's own paths and budget. */
const asCatalogSends = {
  status: "automation_started",
  limit: 50,
  budgetChars: OPEN_TASKS.answerBudgetChars,
  answerFields: OPEN_TASKS.answerFields,
};

const sizeOf = (value: unknown) => JSON.stringify(value).length;

async function listOpen(
  reports: number,
  input: Record<string, unknown> = asCatalogSends,
): Promise<Record<string, any>> {
  dbReturning(Array.from({ length: reports }, (_, i) => openReport(i)));
  return (await action.run(
    { status: "automation_started", limit: 50, ...input },
    context,
  )) as Record<string, any>;
}

describe("the open reports story 01's grouping step is given", () => {
  it("keeps what tells one report from another and ties it to Builder's task, and nothing else", async () => {
    const result = await listOpen(1);

    expect(result.items).toEqual([
      {
        id: "0b7c9e2a-4d1f-4c6a-9d3e-a1b2c3d4e500",
        status: "automation_started",
        title:
          "Pat Customer: Clicking Pay does nothing on the checkout page, report 00",
        summary: expect.stringContaining("Clicking Pay does nothing"),
        url: "https://acme.slack.com/archives/C0123ABCD/p1760000000000100",
        channelId: "C0123ABCD",
        threadTs: "1760000000.000100",
        author: "U0123ABCDE",
        truncated: false,
        metadata: {
          extras: {
            projectId: "proj_8f2c1d9a",
            branchName: "factory-0b7c9e2a-4d1f-4c6a-9d3e-a1b2c3d4e500",
            repository: "acme/web",
          },
        },
      },
    ]);
  });

  it("hands all twelve open reports to the grouping step, with nothing cut and no more to read", async () => {
    const result = await listOpen(12);

    expect(result).toMatchObject({
      ok: true,
      count: 12,
      hasMore: false,
      nextCursor: null,
      truncated: false,
    });
    expect(result.items.map((item: { id: string }) => item.id)).toEqual(
      Array.from(
        { length: 12 },
        (_, i) =>
          `0b7c9e2a-4d1f-4c6a-9d3e-a1b2c3d4e5${String(i).padStart(2, "0")}`,
      ),
    );
    expect(sizeOf(result.items)).toBeLessThanOrEqual(
      OPEN_TASKS.answerBudgetChars!,
    );
  });

  it("holds the newest dozen or so of many, and says there are more and where to go on", async () => {
    const result = await listOpen(40);

    expect(result.count).toBeGreaterThanOrEqual(12);
    expect(result.count).toBeLessThan(40);
    expect(result.hasMore).toBe(true);
    expect(result.truncated).toBe(true);
    const last = result.count - 1;
    expect(result.nextCursor).toBe(
      encodeInboxCursor({
        updatedAt: `2026-10-14T11:${String(59 - last).padStart(2, "0")}:00.000Z`,
        id: result.items[last].id,
      }),
    );
  });

  it("holds four reports, not twelve, in the same budget when the whole item is handed on", async () => {
    const whole = await listOpen(12, {
      ...asCatalogSends,
      answerFields: undefined,
    });

    expect(whole.count).toBe(4);
    expect(whole.hasMore).toBe(true);
  });

  it("held one report at the 4,000 characters it was first bounded to", async () => {
    const before = await listOpen(40, { budgetChars: 4_000 });

    expect(before.count).toBe(1);
  });
});

describe("a step that carries story 01's open reports on the reports a run takes", () => {
  const takeLimit = (
    story01.nodes.find((node) => node.id === "feedback")!.settings as {
      takeLimit: number;
    }
  ).takeLimit;
  const stepNode = {
    id: "openTasks",
    name: "openTasks",
    kind: "lookup",
  } as unknown as WorkflowNode;

  /** A report with every limit of the item spent: the largest the inbox hands on. */
  const slackItem = (index: number) => ({
    id: `slack-item-${index}-${"i".repeat(40)}`,
    externalId: `C0123ABCD:17600${index}000.000100`,
    kind: "message",
    provider: "slack",
    title: "t".repeat(120),
    text: "x".repeat(2_048),
    url: `https://acme.slack.com/archives/C0123ABCD/p17600${index}000000100`,
    author: "U0123ABCDE",
    occurredAt: "2026-10-14T09:00:00.000Z",
    thread: { channelId: "C0123ABCD", threadTs: `17600${index}000.000100` },
    extras: {},
    payload: { text: "p".repeat(2_000) },
  });

  /** The thread read at its budget: the action's messages fill what the budget leaves after its own 400. */
  const threadAtBudget = {
    ok: true,
    coverage: "complete",
    channel: "C0123ABCD",
    threadTs: "1760000000.000100",
    messages: [
      {
        ts: "1760000000.000100",
        user: "U0123ABCDE",
        username: null,
        botId: null,
        isBot: false,
        text: "m".repeat(THREAD.answerBudgetChars! - 400),
        reactions: [],
      },
    ],
    messageCount: 20,
    truncated: true,
    omittedMessages: 4,
    nextOldest: "1760000000.000100",
  };
  const assessed = {
    clearBug: true,
    enoughContext: true,
    risk: "low",
    confidence: "high",
    productUxImplications: false,
    alreadyClaimed: false,
    categories: [],
    reason: "r".repeat(500),
  };

  const carry = (reports: number, nodes: Record<string, unknown>): FlowItem[] =>
    Array.from({ length: reports }, (_, index) => ({
      id: `item-${index}`,
      data: slackItem(index),
      nodes,
      inbox: true,
    }));

  it("reads the most reports a run takes from the story itself", () => {
    expect(takeLimit).toBe(3);
  });

  it("respects the cap at every step for that many reports, each with its thread at its budget and the open reports at theirs", async () => {
    const open = await listOpen(12);
    const chain: [string, Record<string, unknown>][] = [
      ["thread", { thread: threadAtBudget }],
      ["assess", { thread: threadAtBudget, assess: assessed }],
      [
        "openTasks",
        { thread: threadAtBudget, assess: assessed, openTasks: open },
      ],
    ];

    for (const [step, nodes] of chain) {
      expect(
        () => assertStepWithinCap(stepNode, carry(takeLimit, nodes)),
        step,
      ).not.toThrow();
    }
    // And all twelve are on every report the grouping step reads, inside the AI runner's default input budget.
    const grouped = carry(takeLimit, chain[2][1]);
    for (const item of grouped) {
      expect((item.nodes.openTasks as { items: unknown[] }).items).toHaveLength(
        12,
      );
    }
    expect(
      sizeOf(grouped.map(({ data, nodes }) => ({ item: data, nodes }))),
    ).toBeLessThan(24_000 * 4);
  });

  it("would not fit the five reports a run took before, nor a list cut only at the action's own limit", async () => {
    const open = await listOpen(12);
    const nodes = { thread: threadAtBudget, assess: assessed, openTasks: open };
    const wholeAtActionLimit = await listOpen(40, {
      status: "automation_started",
      limit: 50,
    });

    expect(() => assertStepWithinCap(stepNode, carry(5, nodes))).toThrow(
      expect.objectContaining({ code: "output_over_cap" }),
    );
    expect(() =>
      assertStepWithinCap(
        stepNode,
        carry(takeLimit, { ...nodes, openTasks: wholeAtActionLimit }),
      ),
    ).toThrow(expect.objectContaining({ code: "output_over_cap" }));
  });
});
