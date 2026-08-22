import { describe, expect, it } from "vitest";

import {
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
          action: "start-builder-for-item",
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
    });
    expect(report.items).toHaveLength(1);
    expect(report.items[0]?.title).toContain("Analytics");
    expect(report.items[0]?.title).not.toMatch(/Slack thread/i);
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
          action: "start-builder-for-item",
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
    expect(report.items).toHaveLength(0);
    expect(report.trace).toEqual([
      expect.objectContaining({
        purpose: "repeat_scan",
        count: 20,
        summary: "Loaded 20 recent slack items.",
      }),
    ]);
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
});
