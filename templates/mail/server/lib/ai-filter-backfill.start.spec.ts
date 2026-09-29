import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const rows: Array<Record<string, any>> = [];
  let id = 0;
  let stateJsonWrites = 0;
  const advisoryLocks = new Map<string, Promise<void>>();
  let beforeNextTransaction: (() => Promise<void>) | undefined;
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
    if (
      condition?.strings?.join("").includes("retryAfterAt") &&
      condition.values.some((value: unknown) => typeof value === "number")
    ) {
      const retryAfterAt = JSON.parse(row.stateJson).retryAfterAt;
      const now = condition.values.find(
        (value: unknown) => typeof value === "number",
      );
      return (
        typeof now === "number" &&
        (typeof retryAfterAt !== "number" || retryAfterAt <= now)
      );
    }
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
          if (Object.prototype.hasOwnProperty.call(values, "stateJson"))
            stateJsonWrites += 1;
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
    transaction: async (callback: (tx: any) => unknown) => {
      const before = beforeNextTransaction;
      beforeNextTransaction = undefined;
      await before?.();
      const releases: Array<() => void> = [];
      const tx = {
        ...db,
        execute: async (query: { values?: unknown[] }) => {
          const key = String(query.values?.[0] ?? "");
          const previous = advisoryLocks.get(key) ?? Promise.resolve();
          let release = () => {};
          const pending = new Promise<void>((resolve) => {
            release = resolve;
          });
          advisoryLocks.set(key, pending);
          await previous;
          releases.push(() => {
            release();
            if (advisoryLocks.get(key) === pending) advisoryLocks.delete(key);
          });
          return { rows: [] };
        },
      };
      try {
        return await callback(tx);
      } finally {
        releases.reverse().forEach((release) => release());
      }
    },
  };

  return {
    rows,
    db,
    schema: { aiFilterBackfills },
    nextId: () => `backfill-${++id}`,
    setBeforeNextTransaction: (callback: () => Promise<void>) => {
      beforeNextTransaction = callback;
    },
    getStateJsonWrites: () => stateJsonWrites,
    resetStateJsonWrites: () => {
      stateJsonWrites = 0;
    },
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
  buildLabelCache: vi.fn(),
  ensureGmailLabel: vi.fn(),
  gmailGetThread: vi.fn(),
  gmailModifyThread: vi.fn(),
  syncInboxLabelDelta: vi.fn(),
  evaluateAiFilterBackfillRules: vi.fn(),
}));

const dispatch = vi.hoisted(() => ({ fireInternalDispatch: vi.fn() }));

vi.mock("@agent-native/core/action", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/action")>()),
  fail: (message: string, details: Record<string, unknown>) => {
    throw Object.assign(new Error(message), details);
  },
}));
vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  fireInternalDispatch: dispatch.fireInternalDispatch,
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
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));
vi.mock("nanoid", () => ({ nanoid: () => database.nextId() }));
vi.mock("../db/index.js", () => ({ db: database.db, schema: database.schema }));
vi.mock("./ai-filter.js", () => ({
  getAiFilterState: mocks.getAiFilterState,
  recordAiFilterDecisions: vi.fn(),
}));
vi.mock("./automation-engine.js", () => ({
  evaluateAiFilterBackfillRules: mocks.evaluateAiFilterBackfillRules,
}));
vi.mock("./automations.js", () => ({
  listAutomationRules: mocks.listAutomationRules,
}));
vi.mock("./automation-actions.js", () => ({
  buildLabelCache: mocks.buildLabelCache,
  ensureGmailLabel: mocks.ensureGmailLabel,
}));
vi.mock("./google-api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./google-api.js")>()),
  gmailBatchGetThreads: vi.fn(),
  gmailGetThread: mocks.gmailGetThread,
  gmailListThreads: vi.fn(),
  gmailModifyMessage: vi.fn(),
  gmailModifyThread: mocks.gmailModifyThread,
}));
vi.mock("./google-auth.js", () => ({
  getClientsWithErrors: mocks.getClientsWithErrors,
}));
vi.mock("./inbox-store-sync.js", () => ({
  syncInboxLabelDelta: mocks.syncInboxLabelDelta,
}));
vi.mock("./local-email-store.js", () => ({
  readLocalEmails: mocks.readLocalEmails,
  withLocalEmailMutationLock: mocks.withLocalEmailMutationLock,
  writeLocalEmails: mocks.writeLocalEmails,
}));

import { AI_FILTER_LABEL } from "../../shared/ai-filter.js";
import { aiPriorityEmailKey } from "../../shared/ai-priority.js";
import {
  aiFilterBackfillRetryDelay,
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
    mocks.evaluateAiFilterBackfillRules.mockReset();
    database.rows.splice(0, database.rows.length);
    database.resetId();
    database.resetStateJsonWrites();
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
    mocks.buildLabelCache.mockResolvedValue(new Map());
    mocks.ensureGmailLabel.mockResolvedValue("label-id");
    dispatch.fireInternalDispatch.mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("does not claim a backfill after the sweep deadline", async () => {
    database.rows.push({
      ...runningRow([rule("rule-a")]),
      status: "queued",
    });

    await expect(
      processMailAiFilterBackfills(undefined, undefined, Date.now() - 1),
    ).rejects.toThrow("Mail AI-filter backfill sweep deadline reached.");

    expect(database.rows[0].claimId).toBeNull();
    expect(database.rows[0].status).toBe("queued");
  });

  it("queues without synchronously resolving model availability", async () => {
    mocks.rules = [rule("rule-a")];

    const result = await startMailAiFilterBackfill(ownerEmail, ["rule-a"]);

    expect(result).toMatchObject({ status: "queued" });
    expect(database.rows).toHaveLength(1);
  });

  it("keeps a queued run recoverable after an ambiguous handoff failure", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("A2A_SECRET", "test-secret");
    mocks.rules = [rule("rule-a")];
    dispatch.fireInternalDispatch.mockRejectedValueOnce(
      new Error("background response timed out"),
    );

    const result = await startMailAiFilterBackfill(ownerEmail, ["rule-a"]);

    expect(result).toMatchObject({ status: "queued" });
    expect(database.rows).toHaveLength(1);
    expect(database.rows[0].status).toBe("queued");
    expect(JSON.parse(database.rows[0].stateJson).error).toBeUndefined();
  });

  it("requires the deployment signing secret before creating a Netlify run", async () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("A2A_SECRET", "");
    mocks.rules = [rule("rule-a")];

    await expect(
      startMailAiFilterBackfill(ownerEmail, ["rule-a"]),
    ).rejects.toMatchObject({
      errorCode: "ai_filter_backfill_signing_secret_missing",
      statusCode: 503,
    });

    expect(database.rows).toHaveLength(0);
    expect(dispatch.fireInternalDispatch).not.toHaveBeenCalled();
  });

  it("treats bounded model timeouts as retryable", () => {
    const timeout = Object.assign(new Error("model timed out"), {
      name: "TimeoutError",
    });
    expect(aiFilterBackfillRetryDelay(timeout)).toBe(30_000);
  });

  it("skips delayed retries before bounding worker queue candidates", async () => {
    const delayedRules = Array.from({ length: 8 }, (_, index) =>
      rule(`delayed-${index}`),
    );
    const readyRule = rule("ready-rule");
    mocks.rules = [...delayedRules, readyRule];
    const retryAfterAt = Date.now() + 60_000;
    for (const [index, delayedRule] of delayedRules.entries()) {
      const state = backfillState([delayedRule]) as Record<string, any>;
      state.retryAfterAt = retryAfterAt;
      state.candidates = [];
      database.rows.push({
        ...runningRow([delayedRule]),
        id: `delayed-${index}`,
        status: "queued",
        stateJson: JSON.stringify(state),
        createdAt: Date.now() + index,
      });
    }
    const readyState = backfillState([readyRule]);
    readyState.candidates = [];
    const readyRun = {
      ...runningRow([readyRule]),
      id: "ready-run",
      status: "queued",
      stateJson: JSON.stringify(readyState),
      createdAt: Date.now() + 100,
    };
    database.rows.push(readyRun);

    await processMailAiFilterBackfills(ownerEmail);

    expect(readyRun.status).toBe("completed");
    expect(
      database.rows
        .slice(0, delayedRules.length)
        .every((row) => row.status === "queued"),
    ).toBe(true);
  });

  it("does not let an older delayed overlap block a ready run", async () => {
    const olderRule = {
      ...rule("rule-a"),
      updatedAt: "2026-09-25T00:00:00.000Z",
    };
    const currentRule = rule("rule-a");
    mocks.rules = [currentRule];
    const delayedState = backfillState([olderRule]) as Record<string, any>;
    delayedState.retryAfterAt = Date.now() + 60_000;
    delayedState.candidates = [];
    const delayedRun = {
      ...runningRow([olderRule]),
      id: "delayed-run",
      status: "queued",
      stateJson: JSON.stringify(delayedState),
      createdAt: Date.now() - 1_000,
    };
    const readyState = backfillState([currentRule]);
    readyState.candidates = [];
    const readyRun = {
      ...runningRow([currentRule]),
      id: "ready-run",
      status: "queued",
      stateJson: JSON.stringify(readyState),
      createdAt: Date.now(),
    };
    database.rows.push(delayedRun, readyRun);

    await processMailAiFilterBackfills(ownerEmail);

    expect(readyRun.status).toBe("completed");
    expect(delayedRun.status).toBe("queued");
  });

  it("retries wrapped credential refresh failures in the worker", async () => {
    const activeRule = rule("rule-a");
    mocks.rules = [activeRule];
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [],
      errors: [
        {
          email: "account@example.test",
          error: "temporary refresh failure",
          retryable: true,
        },
      ],
    });
    const row = runningRow([activeRule]);
    database.rows.push(row);

    await processMailAiFilterBackfills(ownerEmail);

    expect(row.status).toBe("queued");
    const state = JSON.parse(row.stateJson);
    expect(state.retryCount).toBe(1);
    expect(state.retryAfterAt).toBeGreaterThan(Date.now());
  });

  it("retries wrapped credential refresh failures while undoing Gmail changes", async () => {
    const activeRule = rule("rule-a");
    const state = backfillState([activeRule]);
    Object.assign(state.snapshots, {
      "account@example.test:thread-a": {
        key: "account@example.test:thread-a",
        accountEmail: "account@example.test",
        threadId: "thread-a",
        local: false,
        messages: [
          {
            id: "gmail-message",
            labels: { INBOX: false },
            afterLabels: { INBOX: true },
          },
        ],
      },
    });
    const row = runningRow([activeRule]);
    row.status = "undoing";
    row.stateJson = JSON.stringify(state);
    database.rows.push(row);
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [],
      errors: [
        {
          email: "account@example.test",
          error: "temporary refresh failure",
          retryable: true,
        },
      ],
    });

    await processMailAiFilterBackfills(ownerEmail);

    expect(row.status).toBe("undoing");
    const saved = JSON.parse(row.stateJson);
    expect(saved.retryCount).toBe(1);
    expect(saved.retryAfterAt).toBeGreaterThan(Date.now());
    expect(mocks.gmailGetThread).not.toHaveBeenCalled();
  });

  it("preserves an explicit undo retry reset when an in-flight run fails", async () => {
    const archiveRule = rule("rule-archive");
    archiveRule.actions = [{ type: "archive" }];
    mocks.rules = [archiveRule];
    mocks.emails = [localEmail()];
    const row = runningRow([archiveRule]);
    const state = JSON.parse(row.stateJson);
    state.retryCount = 5;
    state.retryAfterAt = Date.now() - 1;
    row.stateJson = JSON.stringify(state);
    database.rows.push(row);
    mocks.writeLocalEmails.mockImplementation(
      async (_email: string, emails: Array<Record<string, any>>) => {
        mocks.emails = structuredClone(emails);
        await requestMailAiFilterBackfillUndo(
          ownerEmail,
          row.id,
          row.undoToken,
        );
        throw new TypeError("fetch failed");
      },
    );

    await processMailAiFilterBackfills(ownerEmail);

    const saved = JSON.parse(row.stateJson);
    expect(row.status).toBe("undoing");
    expect(row.claimId).toBeNull();
    expect(saved.retryCount).toBe(0);
    expect(saved).not.toHaveProperty("retryAfterAt");
    expect(saved).not.toHaveProperty("error");
  });

  it("resets exhausted retries when an explicit undo is requested", async () => {
    mocks.rules = [rule("rule-a")];
    const started = await startMailAiFilterBackfill(ownerEmail, ["rule-a"]);
    const row = database.rows[0];
    const state = JSON.parse(row.stateJson);
    state.retryCount = 6;
    state.retryAfterAt = Date.now() + 60_000;
    row.status = "failed";
    row.stateJson = JSON.stringify(state);

    await requestMailAiFilterBackfillUndo(
      ownerEmail,
      started.runId,
      row.undoToken,
    );

    const undoState = JSON.parse(row.stateJson);
    expect(row.status).toBe("undoing");
    expect(undoState.retryCount).toBe(0);
    expect(undoState).not.toHaveProperty("retryAfterAt");
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

  it("reuses a concurrent start for the same canonical rule set", async () => {
    mocks.rules = [rule("rule-a"), rule("rule-b")];

    const results = await Promise.allSettled([
      startMailAiFilterBackfill(ownerEmail, ["rule-b", "rule-a"]),
      startMailAiFilterBackfill(ownerEmail, ["rule-a", "rule-b"]),
    ]);

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(results.map((result: any) => result.value.runId)).toEqual([
      database.rows[0].id,
      database.rows[0].id,
    ]);
    expect(database.rows).toHaveLength(1);
    expect(database.rows[0].ruleSetKey).toBe(
      JSON.stringify([
        ["rule-a", mocks.rules[0].updatedAt],
        ["rule-b", mocks.rules[1].updatedAt],
      ]),
    );
  });

  it("rejects concurrent starts whose rule sets overlap", async () => {
    mocks.rules = [rule("rule-a"), rule("rule-b")];

    const results = await Promise.allSettled([
      startMailAiFilterBackfill(ownerEmail, ["rule-a"]),
      startMailAiFilterBackfill(ownerEmail, ["rule-a", "rule-b"]),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(database.rows).toHaveLength(1);
  });

  it("rejects a repeat start while that rule set is being undone", async () => {
    mocks.rules = [rule("rule-a")];
    database.rows.push({
      id: "undoing-run",
      ownerEmail,
      ruleSetKey: '["rule-a"]',
      status: "undoing",
      stateJson: JSON.stringify(backfillState(mocks.rules)),
      expiresAt: Date.now() + 60_000,
      updatedAt: Date.now(),
    });

    await expect(
      startMailAiFilterBackfill(ownerEmail, ["rule-a"]),
    ).rejects.toMatchObject({ errorCode: "ai_filter_backfill_active" });
    expect(database.rows).toHaveLength(1);
  });

  it("claims the current undoing status when Undo races the scheduler read", async () => {
    mocks.rules = [rule("rule-a")];
    const started = await startMailAiFilterBackfill(ownerEmail, ["rule-a"]);
    const row = database.rows[0];
    database.setBeforeNextTransaction(async () => {
      await requestMailAiFilterBackfillUndo(
        ownerEmail,
        started.runId,
        row.undoToken,
      );
    });

    await processMailAiFilterBackfills(ownerEmail);

    expect(row.status).toBe("undone");
    expect(mocks.evaluateAiFilterBackfillRules).not.toHaveBeenCalled();
    expect(mocks.writeLocalEmails).not.toHaveBeenCalled();
  });

  it("fails without checkpointing when evaluation omits a captured thread", async () => {
    const activeRule = rule("rule-a");
    mocks.rules = [activeRule];
    mocks.emails = [localEmail()];
    const state = { ...backfillState([activeRule]), evaluations: {} };
    database.rows.push({
      ...runningRow([activeRule]),
      stateJson: JSON.stringify(state),
    });
    mocks.evaluateAiFilterBackfillRules.mockResolvedValue(new Map());

    await processMailAiFilterBackfills(ownerEmail);

    expect(database.rows[0].status).toBe("failed");
    const saved = JSON.parse(database.rows[0].stateJson);
    expect(saved.evaluations).toEqual({});
    expect(saved.candidateIndex).toBe(0);
    expect(saved.error).toMatch("did not classify every thread");
    expect(mocks.writeLocalEmails).not.toHaveBeenCalled();
  });

  it("checkpoints an explicit no-match classification", async () => {
    const activeRule = rule("rule-a");
    mocks.rules = [activeRule];
    mocks.emails = [localEmail()];
    const state = { ...backfillState([activeRule]), evaluations: {} };
    database.rows.push({
      ...runningRow([activeRule]),
      stateJson: JSON.stringify(state),
    });
    mocks.evaluateAiFilterBackfillRules.mockResolvedValue(
      new Map([[aiPriorityEmailKey(undefined, "thread-a"), []]]),
    );

    await processMailAiFilterBackfills(ownerEmail);

    expect(database.rows[0].status).toBe("completed");
    const saved = JSON.parse(database.rows[0].stateJson);
    expect(saved.evaluations["local:thread-a"]).toEqual([]);
    expect(saved.processedThreads).toBe(1);
  });

  it("persists non-mutating progress once per backfill batch", async () => {
    const activeRule = rule("rule-a");
    mocks.rules = [activeRule];
    const state: any = { ...backfillState([activeRule]), evaluations: {} };
    state.candidates = ["thread-a", "thread-b", "thread-c"].map(
      (threadId, index) => ({
        ...state.candidates[0],
        key: `local:${threadId}`,
        threadId,
        email: {
          ...state.candidates[0].email,
          id: threadId,
          threadId,
        },
        messageIds: [`message-${index}`],
      }),
    );
    database.rows.push({
      ...runningRow([activeRule]),
      stateJson: JSON.stringify(state),
    });
    mocks.evaluateAiFilterBackfillRules.mockResolvedValue(
      new Map(
        state.candidates.map((candidate: any) => [
          aiPriorityEmailKey(undefined, candidate.email.id),
          [],
        ]),
      ),
    );
    database.resetStateJsonWrites();

    await processMailAiFilterBackfills(ownerEmail);

    expect(database.getStateJsonWrites()).toBe(2);
    const saved = JSON.parse(database.rows[0].stateJson);
    expect(database.rows[0].status).toBe("completed");
    expect(saved.candidateIndex).toBe(3);
    expect(saved.processedThreads).toBe(3);
  });

  it("maps shared Gmail thread IDs back to the matching account candidate", async () => {
    const activeRule = rule("rule-a");
    mocks.rules = [activeRule];
    const state: any = backfillState([activeRule]);
    state.evaluations = {};
    state.candidates = ["first@example.test", "second@example.test"].map(
      (accountEmail) => ({
        key: `${accountEmail}:thread-shared`,
        accountEmail,
        threadId: "thread-shared",
        email: {
          ...state.candidates[0].email,
          id: "thread-shared",
          threadId: "thread-shared",
          accountEmail,
        },
        messageIds: ["message-shared"],
      }),
    );
    database.rows.push({
      ...runningRow([activeRule]),
      stateJson: JSON.stringify(state),
    });
    mocks.evaluateAiFilterBackfillRules.mockResolvedValue(
      new Map([
        [aiPriorityEmailKey("first@example.test", "thread-shared"), []],
        [
          aiPriorityEmailKey("second@example.test", "thread-shared"),
          [{ ruleId: activeRule.id, confidence: 0.95 }],
        ],
      ]),
    );
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [
        { email: "first@example.test", accessToken: "first-token" },
        { email: "second@example.test", accessToken: "second-token" },
      ],
      errors: [],
    });
    mocks.gmailGetThread.mockResolvedValue({
      messages: [{ id: "message-shared", labelIds: ["INBOX"] }],
    });
    mocks.gmailModifyThread.mockResolvedValue({ historyId: "history-1" });
    mocks.syncInboxLabelDelta.mockResolvedValue(undefined);

    await processMailAiFilterBackfills(ownerEmail);

    const saved = JSON.parse(database.rows[0].stateJson);
    expect(saved.evaluations).toMatchObject({
      "first@example.test:thread-shared": [],
      "second@example.test:thread-shared": [
        { ruleId: activeRule.id, confidence: 0.95 },
      ],
    });
    expect(saved.matchedThreadKeys).toEqual([
      "second@example.test:thread-shared",
    ]);
    expect(mocks.gmailModifyThread).toHaveBeenCalledTimes(1);
    expect(mocks.gmailModifyThread).toHaveBeenCalledWith(
      "second-token",
      "thread-shared",
      ["label-id"],
      [],
    );
  });

  it("queues edited rules behind an active run and retires its undo before applying the replacement", async () => {
    const previousRule = rule("rule-a");
    const active: Record<string, any> = runningRow([previousRule]);
    active.claimId = "active-claim";
    active.claimedAt = Date.now();
    const activeState = backfillState([previousRule]);
    (activeState.snapshots as Record<string, any>)["local:thread-a"] = {
      key: "local:thread-a",
      threadId: "thread-a",
      local: true,
      messages: [{ id: "saved-incoming", labels: {}, archived: false }],
    };
    active.stateJson = JSON.stringify(activeState);
    database.rows.push(active);

    const editedRule = {
      ...previousRule,
      updatedAt: "2026-09-26T00:00:01.000Z",
    };
    mocks.rules = [editedRule];
    const replacement = await startMailAiFilterBackfill(ownerEmail, ["rule-a"]);
    const queued = database.rows.find((row) => row.id === replacement.runId)!;
    expect(queued.status).toBe("queued");

    await processMailAiFilterBackfills(ownerEmail);
    expect(queued.status).toBe("queued");
    expect(active.undoToken).toBe("undo-token");

    active.status = "failed";
    active.claimId = null;
    active.claimedAt = null;
    active.undoToken = "partial-run-undo";
    active.undoExpiresAt = Date.now() + 60_000;
    await processMailAiFilterBackfills(ownerEmail);

    expect(active.undoToken).toBeNull();
    expect(active.undoExpiresAt).toBeNull();
    expect(queued.status).toBe("completed");
  });

  it("waits for an in-flight mutation checkpoint before undoing and preserves newer replies", async () => {
    const archiveRule = rule("rule-archive");
    archiveRule.actions = [{ type: "archive" }];
    mocks.rules = [archiveRule];
    mocks.emails = [localEmail()];
    const run = runningRow(mocks.rules);
    const initialState = JSON.parse(run.stateJson);
    initialState.retryCount = 5;
    initialState.retryAfterAt = Date.now() - 1;
    initialState.error = "stale worker error";
    database.rows.push({ ...run, stateJson: JSON.stringify(initialState) });

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
    const checkpointed = JSON.parse(database.rows[0].stateJson);
    expect(checkpointed.retryCount).toBe(0);
    expect(checkpointed).not.toHaveProperty("retryAfterAt");
    expect(checkpointed).not.toHaveProperty("error");

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

  it("checkpoints the expected Gmail labels before inbox cache sync can fail", async () => {
    const tagRule = rule("rule-tag-archive");
    tagRule.actions = [
      { type: "label", labelName: "Tag A" },
      { type: "archive" },
    ];
    mocks.rules = [tagRule];
    const state = backfillState(mocks.rules);
    const candidate = state.candidates[0];
    candidate.key = "gmail:account@example.test:thread-a";
    Object.assign(candidate, { accountEmail: "account@example.test" });
    Object.assign(state.evaluations, {
      [candidate.key]: [{ ruleId: tagRule.id, confidence: 0.95 }],
    });
    database.rows.push({
      ...runningRow(mocks.rules),
      stateJson: JSON.stringify(state),
    });
    mocks.getClientsWithErrors.mockResolvedValue({
      clients: [{ email: "account@example.test", accessToken: "test-token" }],
      errors: [],
    });
    mocks.ensureGmailLabel.mockResolvedValue("tag-a-id");
    mocks.gmailGetThread
      .mockResolvedValueOnce({
        messages: [{ id: "gmail-message", labelIds: ["INBOX"] }],
      })
      .mockResolvedValueOnce({
        messages: [{ id: "gmail-message", labelIds: ["tag-a-id"] }],
      });
    mocks.gmailModifyThread.mockResolvedValue({ historyId: "history-1" });
    mocks.syncInboxLabelDelta.mockResolvedValue(undefined);

    await processMailAiFilterBackfills(ownerEmail);

    expect(mocks.gmailModifyThread).toHaveBeenCalledWith(
      "test-token",
      "thread-a",
      ["tag-a-id"],
      ["INBOX"],
    );
    expect(database.rows[0].status).toBe("completed");
    const saved = JSON.parse(database.rows[0].stateJson).snapshots[
      candidate.key
    ];
    expect(saved.messages[0].afterLabels).toEqual({
      "tag-a-id": true,
      INBOX: false,
    });
    expect(saved.messages[0].afterArchived).toBe(true);
    expect(
      mocks.listAutomationRules.mock.calls.some(
        ([, ruleId]) => ruleId === tagRule.id,
      ),
    ).toBe(true);
  });

  it("checkpoints an applied mutation while an undo request owns the run", async () => {
    const undoState = { ...backfillState([]), retryCount: 0 };
    database.rows.push({
      ...runningRow([]),
      status: "undoing",
      claimId: "claimed-worker",
      stateJson: JSON.stringify(undoState),
    });
    const workerState: any = backfillState([]);
    workerState.retryCount = 5;
    workerState.retryAfterAt = Date.now() + 60_000;
    workerState.error = "stale worker error";
    workerState.snapshots["local:thread-a"] = {
      key: "local:thread-a",
      threadId: "thread-a",
      local: true,
      messages: [],
    };

    await expect(
      checkpointAppliedBackfillMutation("run-a", "claimed-worker", workerState),
    ).resolves.toBe(false);

    expect(database.rows[0].status).toBe("undoing");
    const saved = JSON.parse(database.rows[0].stateJson);
    expect(saved.snapshots["local:thread-a"]).toEqual(
      workerState.snapshots["local:thread-a"],
    );
    expect(saved.retryCount).toBe(0);
    expect(saved).not.toHaveProperty("retryAfterAt");
    expect(saved).not.toHaveProperty("error");
  });
});
