import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/action", () => ({
  defineAction: (definition: unknown) => definition,
  fail: (message: string): never => {
    throw new Error(message);
  },
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  asc: vi.fn((column: { name: string }) => ({
    type: "asc",
    field: column.name,
  })),
  desc: vi.fn((column: { name: string }) => ({
    type: "desc",
    field: column.name,
  })),
  eq: vi.fn((column: { name: string }, value: unknown) => ({
    type: "eq",
    field: column.name,
    value,
  })),
  inArray: vi.fn((column: { name: string }, values: unknown[]) => ({
    type: "inArray",
    field: column.name,
    values,
  })),
  like: vi.fn((column: { name: string }, pattern: string) => ({
    type: "like",
    field: column.name,
    pattern,
  })),
}));
vi.mock("../server/db/index.js", () => ({ getDb: vi.fn() }));
vi.mock("../server/db/schema.js", () => ({
  factoryAuditEvents: {},
  triageDecisions: { id: { name: "id" } },
  triageItems: {
    id: { name: "id" },
    orgId: { name: "orgId" },
    factoryId: { name: "factoryId" },
  },
  triageRuns: {
    id: { name: "id" },
    itemId: { name: "itemId" },
    orgId: { name: "orgId" },
    factoryId: { name: "factoryId" },
    dedupeKey: { name: "dedupeKey" },
    provider: { name: "provider" },
    status: { name: "status" },
    error: { name: "error" },
    completedAt: { name: "completedAt" },
  },
}));
vi.mock("../server/lib/factory-automation-caller.js", () => ({
  readCallingFactoryAutomation: vi.fn(),
}));
vi.mock("../server/lib/factory-scope.js", async () => {
  const { z } = await import("zod");
  return {
    DEFAULT_FACTORY_ID: "product-feedback",
    factoryIdSchema: z.string(),
    factoryStillPresent: vi.fn(),
    orgFactoryItemFilter: vi.fn(),
    orgFactoryRunFilter: vi.fn(),
    readTriageConfigRow: vi.fn(),
    requireExistingFactory: vi.fn(),
  };
});
vi.mock("../server/lib/require-factory-automation.js", () => ({
  requireFactoryAutomation: vi.fn(),
}));
vi.mock("../server/lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: vi.fn(),
  workspaceMemberIdentityFromContext: vi.fn(),
}));
vi.mock("../server/triage/audit.js", () => ({ recordFactoryAudit: vi.fn() }));
vi.mock("../server/triage/slack-client.js", () => ({
  createSlackReader: vi.fn(),
}));

import { SlackWriteError } from "../server/connectors/slack.js";
import { getDb } from "../server/db/index.js";
import {
  factoryAuditEvents,
  triageDecisions,
  triageItems,
  triageRuns,
} from "../server/db/schema.js";
import { readCallingFactoryAutomation } from "../server/lib/factory-automation-caller.js";
import { requireExistingFactory } from "../server/lib/factory-scope.js";
import { requireFactoryAutomation } from "../server/lib/require-factory-automation.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";
import { createSlackReader } from "../server/triage/slack-client.js";
import {
  findSlackReportMessage,
  factoryFindingsReportKey,
  factoryFindingRollupText,
  isSlackReportRejectionRetryable,
  reportableFindingSource,
} from "./report-factory-findings.js";
import action from "./report-factory-findings.js";

function createActionDatabase(
  initialItems: Record<string, unknown> | Record<string, unknown>[],
) {
  const items = Array.isArray(initialItems) ? initialItems : [initialItems];
  const runs: Array<Record<string, unknown>> = [];
  const matches = (
    row: Record<string, unknown>,
    condition: unknown,
  ): boolean => {
    if (!condition || typeof condition !== "object") return true;
    const value = condition as {
      type?: string;
      field?: string;
      value?: unknown;
      values?: unknown[];
      pattern?: string;
      conditions?: unknown[];
    };
    if (value.type === "and") {
      return (value.conditions ?? []).every((part) => matches(row, part));
    }
    if (value.type === "eq") return row[value.field ?? ""] === value.value;
    if (value.type === "inArray") {
      return Boolean(value.values?.includes(row[value.field ?? ""]));
    }
    if (value.type === "like") {
      const pattern = value.pattern
        ?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/%/g, ".*");
      return (
        typeof row[value.field ?? ""] === "string" &&
        new RegExp(`^${pattern}$`).test(row[value.field ?? ""] as string)
      );
    }
    return true;
  };
  const tableValues = (table: unknown) =>
    table === triageItems ? items : table === triageRuns ? runs : [];
  const tableRows = (table: unknown, condition: unknown) =>
    tableValues(table)
      .filter((row) => matches(row, condition))
      .map((row) => ({ ...row }));
  const query = (table: unknown) => {
    let condition: unknown;
    const builder = {
      where: (next: unknown) => {
        condition = next;
        return builder;
      },
      orderBy: () => builder,
      for: () => builder,
      limit: () => builder,
      then: (
        resolve: (rows: Array<Record<string, unknown>>) => unknown,
        reject?: (error: unknown) => unknown,
      ) => Promise.resolve(tableRows(table, condition)).then(resolve, reject),
    };
    return builder;
  };
  let transactionTail = Promise.resolve();
  const db: any = {
    select: () => ({ from: (table: unknown) => query(table) }),
    transaction: async <T>(callback: (tx: typeof db) => Promise<T>) => {
      let release!: () => void;
      const turn = new Promise<void>((resolve) => {
        release = resolve;
      });
      const previous = transactionTail;
      transactionTail = previous.then(() => turn);
      await previous;
      try {
        return await callback(db);
      } finally {
        release();
      }
    },
    insert: (table: unknown) => ({
      values: (value: Record<string, unknown>) => {
        if (table === triageRuns) runs.push({ ...value });
        return {
          onConflictDoUpdate: async () => undefined,
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (condition: unknown) => {
          const rows = tableValues(table).filter((row) =>
            matches(row, condition),
          );
          for (const row of rows) Object.assign(row, values);
        },
      }),
    }),
  };
  return { db, items, runs };
}

const reportAction = action as {
  run: (input: unknown, context: Record<string, unknown>) => Promise<unknown>;
};

function reportInput() {
  return reportInputFor(["item-1"]);
}

function reportInputFor(itemIds: string[]) {
  return {
    factoryId: "qa",
    findings: itemIds.map((itemId) => ({
      itemId,
      clearBug: true,
      risk: "low",
      confidence: "high",
      productUxImplications: false,
      reason: "A concrete export failure is reproducible.",
    })),
  };
}

function automationContext(runId: string) {
  return {
    caller: "automation",
    runId,
    threadId: "thread-1",
  };
}

function configureActionMocks(db: unknown, slack: unknown) {
  vi.mocked(getDb).mockReturnValue(db as never);
  vi.mocked(requireWorkspaceMember).mockResolvedValue({
    userEmail: "steve@example.com",
    orgId: "org-1",
  } as never);
  vi.mocked(workspaceMemberIdentityFromContext).mockReturnValue({} as never);
  vi.mocked(requireFactoryAutomation).mockResolvedValue(undefined as never);
  vi.mocked(readCallingFactoryAutomation).mockResolvedValue({
    config: { source: "github", template: "github-issues" },
  } as never);
  vi.mocked(requireExistingFactory).mockResolvedValue(undefined);
  vi.mocked(createSlackReader).mockReturnValue(slack as never);
}

describe("report-factory-findings", () => {
  it("accepts only issue and Sentry triage jobs, not PR jobs", () => {
    expect(
      reportableFindingSource({ source: "github", template: "github-issues" }),
    ).toBe("github_issue");
    expect(
      reportableFindingSource({ source: "sentry", template: "sentry-errors" }),
    ).toBe("sentry");
    expect(
      reportableFindingSource({ source: "github", template: "pr-governance" }),
    ).toBeNull();
    expect(
      reportableFindingSource({ source: "github", template: "pr-babysit" }),
    ).toBeNull();
    expect(
      reportableFindingSource({ source: "github", template: "blank" }),
    ).toBe("github_issue");
    expect(
      reportableFindingSource({ source: "slack", template: "slack-feedback" }),
    ).toBeNull();
  });

  it("builds one grouped message with the source links and stored evidence", () => {
    const text = factoryFindingRollupText({
      factoryId: "qa",
      reportKey: "run-abc",
      source: "github_issue",
      findings: [
        {
          itemId: "triage-1",
          clearBug: true,
          risk: "low",
          confidence: "high",
          productUxImplications: false,
          reason: "The check fails on a concrete export path.",
          id: "triage-1",
          source: "github_issue",
          sourceUrl: "https://github.com/BuilderIO/agent-native/issues/123",
          title: "Export test fails",
          summary: "Summary",
          metadataJson: JSON.stringify({
            errorReport: "Error: export returned an empty file",
          }),
        },
        {
          itemId: "triage-2",
          clearBug: true,
          risk: "low",
          confidence: "high",
          productUxImplications: false,
          reason: "A second issue identifies the same failure boundary.",
          id: "triage-2",
          source: "github_issue",
          sourceUrl: "https://github.com/BuilderIO/agent-native/issues/124",
          title: "Empty export output",
          summary: "Summary",
          metadataJson: JSON.stringify({
            errorReport: "Error: second export case",
          }),
        },
      ],
    });

    expect(text).toContain("GitHub findings for qa (2)");
    expect(text).toContain("/issues/123");
    expect(text).toContain("/issues/124");
    expect(text).toContain("Error: export returned an empty file");
    expect(text).toContain("Error: second export case");
    expect(text).toContain("Why it qualifies:");
    expect(text).toContain("Report reference: run-abc");
  });

  it("keeps the report key stable across retries and finding order", () => {
    const first = factoryFindingsReportKey({
      orgId: "org-1",
      factoryId: "qa",
      source: "github_issue",
      itemIds: ["item-b", "item-a"],
    });
    const retry = factoryFindingsReportKey({
      orgId: "org-1",
      factoryId: "qa",
      source: "github_issue",
      itemIds: ["item-a", "item-b"],
    });

    expect(retry).toBe(first);
    expect(
      factoryFindingsReportKey({
        orgId: "org-1",
        factoryId: "qa",
        source: "github_issue",
        itemIds: ["item-a"],
      }),
    ).not.toBe(first);
  });

  it("waits for Slack's rate-limit delay before retrying a rejected report", () => {
    const run = {
      status: "failed",
      error: "slack-rejected: retry-after=7: Slack API error 429",
      completedAt: "2026-10-10T12:00:00.000Z",
    };
    const rejectedAt = Date.parse(run.completedAt);

    expect(isSlackReportRejectionRetryable(run, rejectedAt + 6_999)).toBe(
      false,
    );
    expect(isSlackReportRejectionRetryable(run, rejectedAt + 7_000)).toBe(true);
    expect(
      isSlackReportRejectionRetryable(
        { ...run, error: "slack-delivery-unknown: fetch failed" },
        rejectedAt + 60_000,
      ),
    ).toBe(false);
  });

  it("keeps an ambiguous report pending across automation run ids", async () => {
    const { db, runs } = createActionDatabase({
      id: "item-1",
      source: "github_issue",
      sourceUrl: "https://github.com/BuilderIO/agent-native/issues/1",
      title: "Export test fails",
      summary: "The export is empty.",
      metadataJson: "{}",
    });
    const slack = {
      getAgentNativeIdentity: vi
        .fn()
        .mockResolvedValue({ userId: "U_AGENT_NATIVE" }),
      getChannelHistory: vi.fn().mockResolvedValue({
        messages: [],
        has_more: false,
        next_cursor: null,
      }),
      postChannelMessage: vi
        .fn()
        .mockRejectedValue(new SlackWriteError("connection reset", "unknown")),
    };
    configureActionMocks(db, slack);

    await expect(
      reportAction.run(reportInput(), automationContext("automation-run-a")),
    ).rejects.toThrow(/delivery is unknown/);
    await expect(
      reportAction.run(reportInput(), automationContext("automation-run-b")),
    ).rejects.toThrow(/previous Slack delivery attempt is still unresolved/);

    expect(slack.postChannelMessage).toHaveBeenCalledTimes(1);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("submitted");
  });

  it("retries a rate-limited report only after Retry-After and across run ids", async () => {
    const { db, items, runs } = createActionDatabase({
      id: "item-1",
      source: "github_issue",
      sourceUrl: "https://github.com/BuilderIO/agent-native/issues/1",
      title: "Export test fails",
      summary: "The export is empty.",
      metadataJson: "{}",
    });
    const slack = {
      getAgentNativeIdentity: vi
        .fn()
        .mockResolvedValue({ userId: "U_AGENT_NATIVE" }),
      getChannelHistory: vi.fn().mockResolvedValue({
        messages: [],
        has_more: false,
        next_cursor: null,
      }),
      postChannelMessage: vi
        .fn()
        .mockRejectedValueOnce(
          new SlackWriteError("Slack API error 429", "rejected", 5),
        )
        .mockResolvedValueOnce({ channel: "CQA", ts: "123.456" }),
    };
    configureActionMocks(db, slack);

    await expect(
      reportAction.run(reportInput(), automationContext("automation-run-a")),
    ).rejects.toThrow(/was rejected/);
    await expect(
      reportAction.run(reportInput(), automationContext("automation-run-b")),
    ).rejects.toThrow(/Slack rate limited this findings destination/);
    expect(slack.postChannelMessage).toHaveBeenCalledTimes(1);

    runs[0]!.completedAt = new Date(Date.now() - 6_000).toISOString();
    await expect(
      reportAction.run(reportInput(), automationContext("automation-run-c")),
    ).resolves.toMatchObject({ posted: true, count: 1 });
    expect(slack.postChannelMessage).toHaveBeenCalledTimes(2);
    expect(runs[0]?.status).toBe("acknowledged");
    expect(items[0]?.status).toBe("needs_manual");
  });

  it("applies a Slack Retry-After cooldown to overlapping reports", async () => {
    const item = (id: string) => ({
      id,
      source: "github_issue",
      sourceUrl: `https://github.com/BuilderIO/agent-native/issues/${id}`,
      title: `Finding ${id}`,
      summary: "A concrete failure.",
      metadataJson: "{}",
    });
    const { db } = createActionDatabase([
      item("item-a"),
      item("item-b"),
      item("item-c"),
    ]);
    const slack = {
      getAgentNativeIdentity: vi
        .fn()
        .mockResolvedValue({ userId: "U_AGENT_NATIVE" }),
      getChannelHistory: vi.fn().mockResolvedValue({
        messages: [],
        has_more: false,
        next_cursor: null,
      }),
      postChannelMessage: vi
        .fn()
        .mockRejectedValueOnce(
          new SlackWriteError("Slack API error 429", "rejected", 30),
        )
        .mockResolvedValueOnce({ channel: "CQA", ts: "123.456" }),
    };
    configureActionMocks(db, slack);

    await expect(
      reportAction.run(
        reportInputFor(["item-a", "item-b"]),
        automationContext("automation-run-a"),
      ),
    ).rejects.toThrow(/was rejected/);
    await expect(
      reportAction.run(
        reportInputFor(["item-b", "item-c"]),
        automationContext("automation-run-b"),
      ),
    ).rejects.toThrow(/Slack rate limited this findings destination/);
    expect(slack.postChannelMessage).toHaveBeenCalledTimes(1);
  });

  it("serializes overlapping batches before posting", async () => {
    const item = (id: string) => ({
      id,
      source: "github_issue",
      sourceUrl: `https://github.com/BuilderIO/agent-native/issues/${id}`,
      title: `Finding ${id}`,
      summary: "A concrete failure.",
      metadataJson: "{}",
    });
    const { db } = createActionDatabase([
      item("item-a"),
      item("item-b"),
      item("item-c"),
    ]);
    let resolvePost!: (message: { channel: string; ts: string }) => void;
    const pendingPost = new Promise<{ channel: string; ts: string }>(
      (resolve) => {
        resolvePost = resolve;
      },
    );
    const slack = {
      getAgentNativeIdentity: vi
        .fn()
        .mockResolvedValue({ userId: "U_AGENT_NATIVE" }),
      getChannelHistory: vi.fn().mockResolvedValue({
        messages: [],
        has_more: false,
        next_cursor: null,
      }),
      postChannelMessage: vi.fn().mockReturnValue(pendingPost),
    };
    configureActionMocks(db, slack);

    const firstReport = reportAction.run(
      reportInputFor(["item-a", "item-b"]),
      automationContext("automation-run-a"),
    );
    const overlappingReport = reportAction.run(
      reportInputFor(["item-b", "item-c"]),
      automationContext("automation-run-b"),
    );
    await expect(overlappingReport).rejects.toThrow(
      /different Slack findings report is unresolved/,
    );
    expect(slack.postChannelMessage).toHaveBeenCalledTimes(1);

    resolvePost({ channel: "CQA", ts: "123.456" });
    await expect(firstReport).resolves.toMatchObject({
      posted: true,
      count: 2,
    });
  });

  it("escapes Slack mentions, links, and formatting from source evidence", () => {
    const text = factoryFindingRollupText({
      factoryId: "qa",
      reportKey: "run-escape",
      source: "github_issue",
      findings: [
        {
          itemId: "triage-1",
          clearBug: true,
          risk: "low",
          confidence: "high",
          productUxImplications: false,
          reason:
            "@channel <@U123> <https://evil.test|click> *bold* _italic_ ~strike~ `code`",
          id: "triage-1",
          source: "github_issue",
          sourceUrl:
            "https://github.com/BuilderIO/agent-native/issues/1?x=1&y=2",
          title: "@here <fake-link|open> *bold* _italic_ ~strike~ `code`",
          summary: "Summary",
          metadataJson: JSON.stringify({
            errorReport:
              "Error <@U123>: <!channel> & invalid *bold* _italic_ ~strike~ `code`",
          }),
        },
      ],
    });

    expect(text).toContain(
      "＠channel &lt;＠U123&gt; &lt;https://evil.test|click&gt;",
    );
    expect(text).toContain(
      "＠here &lt;fake-link|open&gt; ∗bold∗ ＿italic＿ ～strike～ ｀code｀",
    );
    expect(text).toContain(
      "Error &lt;＠U123&gt;: &lt;!channel&gt; &amp; invalid",
    );
    expect(text).not.toContain("<@U123>");
    expect(text).not.toContain("<!channel>");
    expect(text).not.toMatch(/[*_~`]/);
  });

  it("keeps a ten-finding rollup below Slack's message text limit", () => {
    const findings = Array.from({ length: 10 }, (_, index) => ({
      itemId: `item-${index}`,
      clearBug: true as const,
      risk: "low" as const,
      confidence: "high" as const,
      productUxImplications: false as const,
      reason: "&@<*~_`".repeat(150),
      id: `item-${index}`,
      source: "github_issue" as const,
      sourceUrl: `https://github.com/BuilderIO/agent-native/issues/${index}?${"a".repeat(1_500)}`,
      title: "&@<*~_`".repeat(300),
      summary: "Summary",
      metadataJson: JSON.stringify({ errorReport: "&@<*~_`".repeat(1_500) }),
    }));
    const text = factoryFindingRollupText({
      factoryId: "qa",
      reportKey: "a".repeat(64),
      source: "github_issue",
      findings,
    });

    expect(text.length).toBeLessThan(40_000);
    expect(text).toContain("10. ");
  });

  it("reconciles an ambiguous delivery by paging the channel before retrying", async () => {
    const startedAt = "2026-10-10T12:00:00.000Z";
    const marker = "Report reference: run-abc";
    const readHistory = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [
          {
            type: "message",
            user: "U_OTHER",
            text: "newer message",
            ts: "1791633602.0",
          },
        ],
        has_more: true,
        next_cursor: "1791633602.0",
      })
      .mockResolvedValueOnce({
        messages: [
          {
            type: "message",
            bot_id: "B_AGENT_NATIVE",
            text: marker,
            ts: "1791633601.0",
          },
        ],
        has_more: true,
        next_cursor: "1791633601.0",
      });

    await expect(
      findSlackReportMessage({
        readHistory,
        channelId: "C0C4U4XRT6X",
        marker,
        expectedUserId: "U_AGENT_NATIVE",
        expectedBotId: "B_AGENT_NATIVE",
        startedAt,
      }),
    ).resolves.toEqual({ channel: "C0C4U4XRT6X", ts: "1791633601.0" });
    expect(readHistory).toHaveBeenCalledTimes(2);
    expect(readHistory).toHaveBeenLastCalledWith("1791633602.0");
  });

  it("does not reconcile a marker posted by another sender or quoted in text", async () => {
    const marker = "Report reference: run-abc";
    const readHistory = vi.fn().mockResolvedValue({
      messages: [
        {
          type: "message",
          user: "U_OTHER",
          text: marker,
          ts: "1791633601.0",
        },
        {
          type: "message",
          user: "U_AGENT_NATIVE",
          text: `A previous message said ${marker}`,
          ts: "1791633600.0",
        },
      ],
      has_more: false,
      next_cursor: null,
    });

    await expect(
      findSlackReportMessage({
        readHistory,
        channelId: "C0C4U4XRT6X",
        marker,
        expectedUserId: "U_AGENT_NATIVE",
        startedAt: "2026-10-10T12:00:00.000Z",
      }),
    ).resolves.toBeNull();
  });

  it("rejects absent and malformed Slack timestamps during reconciliation", async () => {
    for (const timestamp of [null, "", " ", "0", "not-a-timestamp"]) {
      const readHistory = vi.fn().mockResolvedValue({
        messages: [
          {
            type: "message",
            text: timestamp === null ? "Report reference: run-abc" : "newer",
            ts: timestamp,
          },
        ],
        has_more: false,
        next_cursor: null,
      });

      await expect(
        findSlackReportMessage({
          readHistory,
          channelId: "C0C4U4XRT6X",
          marker: "Report reference: run-abc",
          expectedUserId: "U_AGENT_NATIVE",
          startedAt: "2026-10-10T12:00:00.000Z",
        }),
      ).rejects.toThrow(/invalid message timestamp/);
    }
  });

  it("limits the batch and requires findings to clear the report gate", () => {
    const schema = (
      action as {
        schema: {
          safeParse: (value: unknown) => { success: boolean };
        };
      }
    ).schema;
    const finding = {
      itemId: "item-1",
      clearBug: true,
      risk: "low",
      confidence: "high",
      productUxImplications: false,
      reason: "Specific failing path.",
    };
    expect(schema.safeParse({ findings: [finding] }).success).toBe(true);
    expect(
      schema.safeParse({ findings: [{ ...finding, confidence: "medium" }] })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        findings: Array.from({ length: 11 }, (_, index) => ({
          ...finding,
          itemId: `item-${index}`,
        })),
      }).success,
    ).toBe(false);
  });
});
