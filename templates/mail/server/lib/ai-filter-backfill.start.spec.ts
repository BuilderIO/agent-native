import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const rows: Array<Record<string, any>> = [];
  let id = 0;
  const aiFilterBackfills = Object.fromEntries(
    [
      "id",
      "ownerEmail",
      "ruleSetKey",
      "status",
      "stateJson",
      "undoToken",
      "undoExpiresAt",
      "expiresAt",
      "claimId",
      "claimedAt",
      "createdAt",
      "updatedAt",
    ].map((name) => [name, { name }]),
  );

  function matches(condition: any, row: Record<string, any>): boolean {
    if (condition?.op === "and")
      return condition.conditions.every((part: any) => matches(part, row));
    if (condition?.op === "or")
      return condition.conditions.some((part: any) => matches(part, row));
    if (condition?.op === "eq")
      return row[condition.column.name] === condition.value;
    if (condition?.op === "gt")
      return row[condition.column.name] > condition.value;
    if (condition?.op === "lt")
      return row[condition.column.name] < condition.value;
    if (condition?.op === "inArray")
      return condition.values.includes(row[condition.column.name]);
    if (condition?.op === "isNull") return row[condition.column.name] == null;
    return false;
  }

  const db = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => {
          const result = () => rows.filter((row) => matches(condition, row));
          return {
            orderBy: () => ({
              limit: async (count: number) => result().slice(0, count),
            }),
            limit: async (count: number) => result().slice(0, count),
            for: () => ({
              then: (resolve: (value: Record<string, any>[]) => unknown) =>
                Promise.resolve(result()).then(resolve),
            }),
            then: (resolve: (value: Record<string, any>[]) => unknown) =>
              Promise.resolve(result()).then(resolve),
          };
        },
      }),
    }),
    insert: () => ({
      values: (value: Record<string, any>) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (
              rows.some(
                (row) =>
                  row.ownerEmail === value.ownerEmail &&
                  row.ruleSetKey === value.ruleSetKey &&
                  ["queued", "running", "undoing"].includes(row.status),
              )
            ) {
              return [];
            }
            rows.push(structuredClone(value));
            return [{ id: value.id }];
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, any>) => ({
        where: (condition: unknown) => {
          const updated = rows.filter((row) => matches(condition, row));
          for (const row of updated)
            Object.assign(row, structuredClone(values));
          const result = () => updated.map((row) => ({ ...row }));
          return {
            returning: async (projection?: Record<string, any>) =>
              result().map((row) =>
                projection
                  ? Object.fromEntries(
                      Object.entries(projection).map(([key, column]) => [
                        key,
                        row[column.name],
                      ]),
                    )
                  : row,
              ),
            then: (
              resolve: (value: Record<string, any>[]) => unknown,
              reject: (error: unknown) => unknown,
            ) => Promise.resolve(result()).then(resolve, reject),
          };
        },
      }),
    }),
    transaction: async (callback: (tx: any) => unknown) => callback(db),
  };

  return {
    rows,
    db,
    schema: { aiFilterBackfills },
    nextId: () => `backfill-${++id}`,
    resetId: () => {
      id = 0;
    },
  };
});

const mocks = vi.hoisted(() => ({
  rules: [] as Array<Record<string, any>>,
  emails: [] as Array<Record<string, any>>,
  getAiFilterState: vi.fn(),
  listAutomationRules: vi.fn(),
  getClientsWithErrors: vi.fn(),
  readLocalEmails: vi.fn(),
  withLocalEmailMutationLock: vi.fn(),
  writeLocalEmails: vi.fn(),
  getUserSetting: vi.fn(),
  mutateUserSetting: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  fail: (message: string, details: Record<string, unknown>) => {
    throw Object.assign(new Error(message), details);
  },
}));
vi.mock("@agent-native/core/settings", () => ({
  getUserSetting: mocks.getUserSetting,
  mutateUserSetting: mocks.mutateUserSetting,
}));
vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ op: "and", conditions }),
  asc: (column: unknown) => column,
  desc: (column: unknown) => column,
  eq: (column: unknown, value: unknown) => ({ op: "eq", column, value }),
  gt: (column: unknown, value: unknown) => ({ op: "gt", column, value }),
  inArray: (column: unknown, values: unknown[]) => ({
    op: "inArray",
    column,
    values,
  }),
  isNull: (column: unknown) => ({ op: "isNull", column }),
  lt: (column: unknown, value: unknown) => ({ op: "lt", column, value }),
  or: (...conditions: unknown[]) => ({ op: "or", conditions }),
}));
vi.mock("nanoid", () => ({ nanoid: () => database.nextId() }));
vi.mock("../db/index.js", () => ({ db: database.db, schema: database.schema }));
vi.mock("./ai-filter.js", () => ({
  getAiFilterState: mocks.getAiFilterState,
  recordAiFilterDecisions: vi.fn(),
}));
vi.mock("./automation-engine.js", () => ({
  evaluateAiFilterBackfillRules: vi.fn(),
}));
vi.mock("./automations.js", () => ({
  assertMailJevEnabled: vi.fn(),
  listAutomationRules: mocks.listAutomationRules,
}));
vi.mock("./automation-actions.js", () => ({
  buildLabelCache: vi.fn(),
  ensureGmailLabel: vi.fn(),
}));
vi.mock("./google-api.js", () => ({
  gmailBatchGetThreads: vi.fn(),
  gmailGetThread: vi.fn(),
  gmailListThreads: vi.fn(),
  gmailModifyMessage: vi.fn(),
  gmailModifyThread: vi.fn(),
}));
vi.mock("./google-auth.js", () => ({
  getClientsWithErrors: mocks.getClientsWithErrors,
}));
vi.mock("./inbox-store-sync.js", () => ({ syncInboxLabelDelta: vi.fn() }));
vi.mock("./local-email-store.js", () => ({
  readLocalEmails: mocks.readLocalEmails,
  withLocalEmailMutationLock: mocks.withLocalEmailMutationLock,
  writeLocalEmails: mocks.writeLocalEmails,
}));

import { AI_FILTER_LABEL } from "../../shared/ai-filter.js";
import {
  checkpointAppliedBackfillMutation,
  processMailAiFilterBackfills,
  requestMailAiFilterBackfillUndo,
  startMailAiFilterBackfill,
} from "./ai-filter-backfill.js";

const ownerEmail = "mail-test@example.test";

function rule(id: string): Record<string, any> {
  return {
    id,
    ownerEmail,
    domain: "mail",
    kind: "ai-filter",
    enabled: true,
    name: `Rule ${id}`,
    condition: "Important messages",
    actions: [{ type: "label", labelName: `Label ${id}` }],
    updatedAt: "2026-09-26T00:00:00.000Z",
  };
}

function localEmail(id = "saved-incoming") {
  return {
    id,
    threadId: "thread-a",
    from: { name: "Sender", email: "sender@example.test" },
    to: [],
    subject: "Review needed",
    snippet: "Can you review this?",
    body: "",
    date: "2026-09-25T10:00:00.000Z",
    isRead: true,
    isStarred: false,
    isArchived: false,
    isTrashed: false,
    isDraft: false,
    isSent: false,
    labelIds: ["inbox"],
  };
}

function backfillState(rules: Array<Record<string, any>>) {
  return {
    version: 1,
    aiFilterSettings: {
      autoFilter: true,
      autoFilterThreshold: 0.9,
      suggestionThreshold: 0.7,
      feedback: [],
    },
    rules: rules.map(({ id, name, condition, actions }) => ({
      id,
      name,
      condition,
      actions,
    })),
    ruleUpdatedAt: Object.fromEntries(
      rules.map(({ id, updatedAt }) => [id, updatedAt]),
    ),
    candidates: [
      {
        key: "local:thread-a",
        threadId: "thread-a",
        email: {
          id: "thread-a",
          threadId: "thread-a",
          from: "Sender sender@example.test",
          to: "",
          subject: "Review needed",
          snippet: "Can you review this?",
          labelIds: ["inbox"],
          date: "2026-09-25T10:00:00.000Z",
          isArchived: false,
          isTrashed: false,
        },
        messageIds: ["saved-incoming"],
      },
    ],
    candidateIndex: 0,
    evaluations: {
      "local:thread-a": rules.map(({ id }) => ({
        ruleId: id,
        confidence: 0.95,
      })),
    },
    processedIds: [],
    seenMatchIds: [],
    pendingDecisions: [],
    failedKeys: [],
    undoProcessedIds: [],
    undoFailedKeys: [],
    snapshots: {},
    matchedThreadKeys: [],
    appliedThreadKeys: [],
    processedThreads: 0,
    restoredThreads: 0,
    perRule: rules.map(({ id, name }) => ({
      ruleId: id,
      name,
      matchedCount: 0,
      appliedCount: 0,
      suggestedCount: 0,
      previews: [],
    })),
  };
}

function runningRow(rules: Array<Record<string, any>>) {
  const now = Date.now();
  return {
    id: "run-a",
    ownerEmail,
    ruleSetKey: JSON.stringify(rules.map(({ id }) => id).sort()),
    status: "running",
    stateJson: JSON.stringify(backfillState(rules)),
    undoToken: "undo-token",
    undoExpiresAt: now + 60_000,
    expiresAt: now + 60_000,
    claimId: null,
    claimedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("startMailAiFilterBackfill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.rows.splice(0, database.rows.length);
    database.resetId();
    mocks.rules = [];
    mocks.emails = [];
    mocks.getAiFilterState.mockResolvedValue({
      enabled: true,
      autoFilter: true,
      autoFilterThreshold: 0.9,
      suggestionThreshold: 0.7,
      feedback: [],
    });
    mocks.listAutomationRules.mockImplementation(async () => mocks.rules);
    mocks.getClientsWithErrors.mockResolvedValue({ clients: [], errors: [] });
    mocks.readLocalEmails.mockImplementation(async () =>
      structuredClone(mocks.emails),
    );
    mocks.withLocalEmailMutationLock.mockImplementation(
      async (_ownerEmail: string, callback: () => Promise<unknown>) =>
        callback(),
    );
    mocks.writeLocalEmails.mockImplementation(
      async (_ownerEmail: string, emails: Array<Record<string, any>>) => {
        mocks.emails = structuredClone(emails);
      },
    );
    mocks.getUserSetting.mockResolvedValue({ labels: [] });
    mocks.mutateUserSetting.mockResolvedValue(undefined);
  });

  it("rejects an omitted selection above the enabled-rule limit before inserting a run", async () => {
    mocks.rules = Array.from({ length: 33 }, (_, index) =>
      rule(`rule-${index}`),
    );

    await expect(startMailAiFilterBackfill(ownerEmail)).rejects.toMatchObject({
      errorCode: "too_many_ai_filter_rules",
      statusCode: 400,
    });
    expect(database.rows).toHaveLength(0);
  });

  it("rejects a concurrent start for the same canonical rule set", async () => {
    mocks.rules = [rule("rule-a"), rule("rule-b")];

    const results = await Promise.allSettled([
      startMailAiFilterBackfill(ownerEmail, ["rule-b", "rule-a"]),
      startMailAiFilterBackfill(ownerEmail, ["rule-a", "rule-b"]),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(database.rows).toHaveLength(1);
    expect(database.rows[0].ruleSetKey).toBe('["rule-a","rule-b"]');
  });

  it("rejects a repeat start while that rule set is being undone", async () => {
    mocks.rules = [rule("rule-a")];
    database.rows.push({
      id: "undoing-run",
      ownerEmail,
      ruleSetKey: '["rule-a"]',
      status: "undoing",
      stateJson: "{}",
      expiresAt: Date.now() + 60_000,
      updatedAt: Date.now(),
    });

    await expect(
      startMailAiFilterBackfill(ownerEmail, ["rule-a"]),
    ).rejects.toMatchObject({ errorCode: "ai_filter_backfill_active" });
    expect(database.rows).toHaveLength(1);
  });

  it("waits for an in-flight mutation checkpoint before undoing and preserves newer replies", async () => {
    const archiveRule = rule("rule-archive");
    archiveRule.actions = [{ type: "archive" }];
    mocks.rules = [archiveRule];
    mocks.emails = [localEmail()];
    database.rows.push(runningRow(mocks.rules));

    let requestedUndo = false;
    let writeCount = 0;
    mocks.writeLocalEmails.mockImplementation(
      async (_email: string, emails: Array<Record<string, any>>) => {
        mocks.emails = structuredClone(emails);
        writeCount += 1;
        if (requestedUndo) return;
        requestedUndo = true;
        await requestMailAiFilterBackfillUndo(
          ownerEmail,
          "run-a",
          "undo-token",
        );
        await processMailAiFilterBackfills(ownerEmail);
        expect(database.rows[0].status).toBe("undoing");
        expect(mocks.emails[0].isArchived).toBe(true);
      },
    );

    await processMailAiFilterBackfills(ownerEmail);

    expect(database.rows[0].status).toBe("undoing");
    expect(writeCount).toBe(1);
    expect(
      JSON.parse(database.rows[0].stateJson).snapshots["local:thread-a"]
        .messages[0].afterArchived,
    ).toBe(true);

    const reply = {
      ...localEmail("new-reply"),
      isArchived: true,
      labelIds: [],
    };
    mocks.emails.push(reply);
    await processMailAiFilterBackfills(ownerEmail);

    expect(database.rows[0].status).toBe("undone");
    expect(mocks.emails[0].isArchived).toBe(false);
    expect(mocks.emails[0].labelIds).toContain("inbox");
    expect(mocks.emails[1]).toEqual(reply);
  });

  it("rechecks settings and rule versions for every matched rule before applying", async () => {
    const first = rule("rule-first");
    first.actions = [{ type: "archive" }];
    const second = rule("rule-second");
    second.actions = [{ type: "archive" }];
    const third = rule("rule-third");
    mocks.rules = [first, second, third];
    mocks.emails = [localEmail()];
    database.rows.push(runningRow(mocks.rules));

    let writeCount = 0;
    mocks.writeLocalEmails.mockImplementation(
      async (_email: string, emails: Array<Record<string, any>>) => {
        mocks.emails = structuredClone(emails);
        writeCount += 1;
        if (writeCount === 1) {
          mocks.getAiFilterState.mockResolvedValue({
            enabled: true,
            autoFilter: false,
            autoFilterThreshold: 0.99,
            suggestionThreshold: 0.7,
            feedback: [],
          });
          mocks.rules = [first, second, { ...third, updatedAt: "changed" }];
        }
      },
    );

    await processMailAiFilterBackfills(ownerEmail);

    expect(database.rows[0].status).toBe("failed");
    expect(writeCount).toBe(2);
    expect(mocks.emails[0].isArchived).toBe(true);
    expect(mocks.emails[0].labelIds).toContain(AI_FILTER_LABEL.toLowerCase());
    expect(mocks.emails[0].labelIds).not.toContain("label rule-third");
  });

  it("checkpoints an applied mutation while an undo request owns the run", async () => {
    database.rows.push({
      ...runningRow([]),
      status: "undoing",
      claimId: "claimed-worker",
      stateJson: "{}",
    });

    await expect(
      checkpointAppliedBackfillMutation("run-a", "claimed-worker", {
        snapshot: "post-apply",
      }),
    ).resolves.toBe(false);

    expect(database.rows[0].status).toBe("undoing");
    expect(JSON.parse(database.rows[0].stateJson)).toEqual({
      snapshot: "post-apply",
    });
  });
});
