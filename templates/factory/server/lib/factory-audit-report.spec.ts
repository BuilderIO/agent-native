import { describe, expect, it } from "vitest";

import {
  auditItemMessage,
  auditItemSubject,
  projectFactoryAuditReport,
  type FactoryAuditEventRecord,
} from "./factory-audit-report.js";

function event(
  partial: Partial<FactoryAuditEventRecord> &
    Pick<FactoryAuditEventRecord, "id" | "action" | "kind" | "summary">,
): FactoryAuditEventRecord {
  return {
    itemId: null,
    source: "slack",
    sourceUrl: null,
    status: "success",
    details: {},
    createdAt: "2026-08-21T23:00:00.000Z",
    ...partial,
  };
}

describe("projectFactoryAuditReport", () => {
  it("collapses per-item list reads and titles investigated items from summaries", () => {
    const itemId = "item-analytics";
    const report = projectFactoryAuditReport(
      [
        event({
          id: "poll-1",
          itemId,
          action: "poll-slack-channel",
          kind: "observed",
          summary: "`Analytics` stuck in an infinite re-confirmation loop",
          createdAt: "2026-08-21T23:01:21.000Z",
          details: { added: true },
        }),
        event({
          id: "list-1",
          itemId,
          action: "list-triage-items",
          kind: "read",
          summary: "Slack user Enzo",
          createdAt: "2026-08-21T23:01:24.000Z",
        }),
        event({
          id: "list-2",
          itemId,
          action: "list-triage-items",
          kind: "read",
          summary: "Slack user Enzo",
          createdAt: "2026-08-21T23:01:24.100Z",
        }),
        event({
          id: "list-other",
          itemId: "item-other",
          action: "list-triage-items",
          kind: "read",
          summary: "Slack user Enzo",
          createdAt: "2026-08-21T23:01:24.200Z",
        }),
        event({
          id: "ctx-1",
          itemId,
          action: "get-slack-feedback-context",
          kind: "read",
          summary: "Read the Slack thread (1 message).",
          createdAt: "2026-08-21T23:01:28.000Z",
        }),
        event({
          id: "dec-1",
          itemId,
          action: "dispatch-factory-item",
          kind: "decision",
          status: "skipped",
          summary: "Owner-managed UX request; keep manual.",
          createdAt: "2026-08-21T23:01:32.000Z",
          details: { clearBug: false, productUxImplications: true },
        }),
      ],
      [
        {
          id: itemId,
          title: "Slack user Enzo",
          summary: "`Analytics` stuck in an infinite re-confirmation loop",
          source: "slack",
          sourceUrl: "https://slack.example/analytics",
        },
      ],
    );

    expect(report.counts).toEqual({
      newlyObserved: 1,
      scanned: 2,
      investigated: 1,
      held: 1,
      dispatched: 0,
      failed: 0,
      added: 1,
      listed: 2,
      left: 1,
      inboxLimit: null,
      workLimit: null,
      authorFiltered: null,
      updated: null,
    });
    expect(report.work).toHaveLength(2);
    expect(report.items).toHaveLength(2);
    expect(report.work.filter((item) => item.outcome === "held")).toHaveLength(
      1,
    );
    expect(report.items[0]?.title).toContain("Analytics");
    expect(report.items[0]?.title).not.toMatch(/Slack thread/i);
    expect(report.items[0]?.summary).toBe(
      "`Analytics` stuck in an infinite re-confirmation loop",
    );
    expect(report.items[0]?.outcome).toBe("held");
    expect(
      report.trace.some((step) => step.action === "list-triage-items"),
    ).toBe(true);
    expect(
      report.items[0]?.events.some(
        (entry) => entry.action === "list-triage-items",
      ),
    ).toBe(false);
  });

  it("surfaces a failed factory run even when no dispatch audit event exists", () => {
    const itemId = "item-analytics";
    const report = projectFactoryAuditReport(
      [
        event({
          id: "poll-empty",
          action: "poll-slack-channel",
          kind: "observed",
          summary: "No new Slack feedback was observed.",
          createdAt: "2026-08-21T23:32:47.000Z",
        }),
        event({
          id: "scan",
          action: "list-triage-items",
          kind: "read",
          summary: "Loaded 5 review candidates.",
          createdAt: "2026-08-21T23:32:50.000Z",
          details: {
            purpose: "review_candidates",
            count: 5,
            itemIds: [itemId],
          },
        }),
        event({
          id: "ctx",
          itemId,
          action: "get-slack-feedback-context",
          kind: "read",
          summary: "Read the Slack thread (1 message).",
          createdAt: "2026-08-21T23:32:55.000Z",
        }),
        event({
          id: "dec",
          itemId,
          action: "dispatch-factory-item",
          kind: "decision",
          status: "success",
          summary: "Reproducible stuck multi-turn flow.",
          createdAt: "2026-08-21T23:33:02.000Z",
          details: { clearBug: true, productUxImplications: false },
        }),
      ],
      [
        {
          id: itemId,
          title: "Slack user Enzo",
          summary: "`Analytics` stuck in an infinite re-confirmation loop",
          source: "slack",
          sourceUrl: null,
        },
      ],
      [
        {
          itemId,
          status: "failed",
          error: "Slack API error: missing_scope",
          provider: "bot-tag",
          startedAt: "2026-08-21T23:33:02.410Z",
        },
      ],
      {
        startedAt: Date.parse("2026-08-21T23:32:47.000Z"),
        finishedAt: Date.parse("2026-08-21T23:33:10.000Z"),
      },
    );

    expect(report.counts.newlyObserved).toBe(0);
    expect(report.counts.failed).toBe(1);
    expect(report.items[0]?.outcome).toBe("failed");
    expect(report.items[0]?.dispatchError).toBe(
      "Slack API error: missing_scope",
    );
    expect(report.trace[0]?.summary).toMatch(/No new Slack feedback/);
  });

  it("shows babysit decisions as held items", () => {
    const itemId = "item-pr-3917";
    const report = projectFactoryAuditReport(
      [
        event({
          id: "poll-pr",
          itemId,
          action: "poll-github-sources",
          kind: "observed",
          source: "github",
          sourceUrl: "https://github.com/example/repo/pull/3917",
          summary: "Fix inbox filters",
          createdAt: "2026-08-28T23:00:00.000Z",
          details: { added: true },
        }),
        event({
          id: "scan-pr",
          action: "list-triage-items",
          kind: "read",
          source: "github",
          summary: "Loaded 3 review candidates.",
          createdAt: "2026-08-28T23:00:05.000Z",
          details: {
            purpose: "review_candidates",
            count: 3,
            itemIds: [itemId],
          },
        }),
        event({
          id: "babysit-pr",
          itemId,
          action: "babysit-factory-pull-request",
          kind: "decision",
          status: "skipped",
          source: "github",
          sourceUrl: "https://github.com/example/repo/pull/3917",
          summary: "#3917 skipped; author steve8708 is out of scope.",
          createdAt: "2026-08-28T23:00:08.000Z",
          details: { inScope: false, author: "steve8708" },
        }),
      ],
      [
        {
          id: itemId,
          title: "Fix inbox filters",
          summary: null,
          source: "github",
          sourceUrl: "https://github.com/example/repo/pull/3917",
        },
      ],
    );

    expect(report.counts).toEqual({
      newlyObserved: 1,
      scanned: 1,
      investigated: 1,
      held: 1,
      dispatched: 0,
      failed: 0,
      added: 1,
      listed: 1,
      left: 0,
      inboxLimit: null,
      workLimit: null,
      authorFiltered: null,
      updated: null,
    });
    expect(report.items[0]?.outcome).toBe("held");
    expect(report.items[0]?.rationale).toBe(
      "#3917 skipped; author steve8708 is out of scope.",
    );
  });

  it("counts only item-scoped poll observations as new", () => {
    const report = projectFactoryAuditReport([
      event({
        id: "rollup",
        action: "poll-github-sources",
        kind: "observed",
        source: "github",
        summary: "Polled 46 open pull requests.",
        createdAt: "2026-08-28T23:00:00.000Z",
      }),
      event({
        id: "changed-pr",
        itemId: "item-pr-1",
        action: "poll-github-sources",
        kind: "observed",
        source: "github",
        summary: "Fix inbox filters",
        createdAt: "2026-08-28T23:00:01.000Z",
        details: { added: true },
      }),
    ]);
    expect(report.counts.newlyObserved).toBe(1);
    expect(report.trace[0]?.summary).toBe("Polled 46 open pull requests.");
  });

  it("records a batched list scan as one trace step", () => {
    const report = projectFactoryAuditReport([
      event({
        id: "scan",
        action: "list-triage-items",
        kind: "read",
        summary: "Loaded 20 recent slack items.",
        details: {
          purpose: "repeat_scan",
          count: 20,
          itemIds: ["a", "b"],
        },
      }),
    ]);
    expect(report.counts.scanned).toBe(2);
    expect(report.counts.listed).toBe(2);
    expect(report.work).toHaveLength(2);
    expect(report.work.every((item) => item.outcome === "left")).toBe(true);
    expect(report.trace).toEqual([
      expect.objectContaining({
        purpose: "repeat_scan",
        count: 20,
        summary: "Loaded 20 recent slack items.",
      }),
    ]);
  });

  it("reads inbox caps from the poll rollup and lists every review candidate", () => {
    const report = projectFactoryAuditReport(
      [
        event({
          id: "poll-rollup",
          action: "poll-slack-channel",
          kind: "observed",
          summary: "No new Slack feedback was observed.",
          details: {
            inboxLimit: 25,
            added: 0,
            updated: 2,
            authorFiltered: 1,
            newerThanCursor: 3,
            truncated: false,
            itemIds: [],
          },
        }),
        event({
          id: "list",
          action: "list-triage-items",
          kind: "read",
          summary: "Loaded 2 review candidates.",
          details: {
            purpose: "review_candidates",
            needsReview: true,
            limit: 5,
            count: 2,
            itemIds: ["kept", "left"],
            listedItems: [
              { itemId: "kept", status: "received", outcome: null },
              {
                itemId: "left",
                status: "automation_started",
                outcome: "propose_fix",
              },
            ],
          },
        }),
        event({
          id: "ctx",
          itemId: "kept",
          action: "get-slack-feedback-context",
          kind: "read",
          summary: "Read the Slack thread (1 message).",
        }),
        event({
          id: "dec",
          itemId: "kept",
          action: "dispatch-factory-item",
          kind: "decision",
          status: "skipped",
          summary: "Not a clear bug.",
        }),
      ],
      [
        {
          id: "kept",
          title: "Inbox overflow",
          summary: "The inbox filter drops /dispatch",
          source: "slack",
          sourceUrl: null,
          createdAt: "2026-08-01T00:00:00.000Z",
        },
        {
          id: "left",
          title: "Already moving",
          summary: null,
          source: "slack",
          sourceUrl: null,
          status: "automation_started",
          slackBuilderReplyAt: "2026-08-20T00:00:00.000Z",
        },
      ],
    );

    expect(report.counts).toMatchObject({
      added: 0,
      listed: 2,
      held: 1,
      left: 1,
      inboxLimit: 25,
      workLimit: 5,
      authorFiltered: 1,
      updated: 2,
    });
    expect(report.inbox).toHaveLength(0);
    expect(report.work.map((item) => item.outcome)).toEqual(["held", "left"]);
    expect(report.work[1]?.builderAlreadyStarted).toBe(true);
    expect(report.work[1]?.listedStatus).toBe("automation_started");
    expect(report.actions).toHaveLength(0);
  });

  it("does not treat source-changed GitHub observations as inbox additions", () => {
    const report = projectFactoryAuditReport([
      event({
        id: "rollup",
        action: "poll-github-sources",
        kind: "observed",
        source: "github",
        summary: "Polled 2 open pull requests.",
        details: {
          added: 0,
          newlyObserved: 0,
          updated: 1,
          itemIds: [],
        },
      }),
      event({
        id: "changed-pr",
        itemId: "item-pr-1",
        action: "poll-github-sources",
        kind: "observed",
        source: "github",
        summary: "Fix inbox filters",
        details: { added: false, number: 1 },
      }),
      event({
        id: "ingest",
        itemId: "item-pr-1",
        action: "ingest-github-observation",
        kind: "observed",
        source: "github",
        summary: "Fix inbox filters",
        details: { reviewCount: 2, checkCount: 4 },
      }),
    ]);

    expect(report.counts.added).toBe(0);
    expect(report.inbox).toHaveLength(0);
  });
});

describe("auditItemSubject", () => {
  it("prefers the stored feedback summary over a generic Slack title", () => {
    expect(
      auditItemSubject(
        {
          id: "item",
          title: "Slack user Enzo",
          summary: "Settings url drops /dispatch from the slug",
          source: "slack",
          sourceUrl: null,
        },
        [
          event({
            id: "ctx",
            action: "get-slack-feedback-context",
            kind: "read",
            summary: "Read the Slack thread (1 message).",
          }),
        ],
      ),
    ).toBe("Settings url drops /dispatch from the slug");
  });

  it("keeps the full stored message separate from the truncated title", () => {
    const long =
      "This settings URL drops /dispatch from the slug and then the rest of the Slack report continues well past the title cap so the expanded audit row can still show the entire message.";
    expect(
      auditItemMessage(
        {
          id: "item",
          title: "Slack user Enzo",
          summary: long,
          source: "slack",
          sourceUrl: null,
        },
        [],
      ),
    ).toBe(long);
    expect(
      auditItemSubject(
        {
          id: "item",
          title: "Slack user Enzo",
          summary: long,
          source: "slack",
          sourceUrl: null,
        },
        [],
      ).endsWith("…"),
    ).toBe(true);
  });
});
