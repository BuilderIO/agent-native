import { describe, expect, it } from "vitest";

import { shouldInvalidateMailQueryForActionEvent } from "./sync-invalidation";

describe("shouldInvalidateMailQueryForActionEvent", () => {
  const inboxThreadsQuery = {
    queryKey: ["action", "list-inbox-threads", { tab: "inbox" }],
  };
  const inboxOverviewQuery = {
    queryKey: ["mail-inbox-overview", undefined],
  };
  const queuedDraftsQuery = {
    queryKey: ["action", "list-queued-drafts", {}],
  };
  const labelsQuery = { queryKey: ["action", "list-labels"] };

  it("refreshes action-backed reads such as the queued draft list", () => {
    expect(shouldInvalidateMailQueryForActionEvent(queuedDraftsQuery)).toBe(
      true,
    );
  });

  it("does not broadly refresh Gmail or provider reads", () => {
    expect(
      shouldInvalidateMailQueryForActionEvent({
        queryKey: ["emails", "inbox"],
      }),
    ).toBe(false);
    expect(
      shouldInvalidateMailQueryForActionEvent({
        queryKey: ["integration-data", "apollo", "person@example.com"],
      }),
    ).toBe(false);
  });

  it("limits sync-inbox events to inbox, label, and overview queries", () => {
    const events = [{ source: "action", key: "sync-inbox" }];

    expect(
      shouldInvalidateMailQueryForActionEvent(inboxThreadsQuery, events),
    ).toBe(true);
    expect(
      shouldInvalidateMailQueryForActionEvent(inboxOverviewQuery, events),
    ).toBe(true);
    expect(shouldInvalidateMailQueryForActionEvent(labelsQuery, events)).toBe(
      true,
    );
    expect(
      shouldInvalidateMailQueryForActionEvent(queuedDraftsQuery, events),
    ).toBe(false);
    expect(
      shouldInvalidateMailQueryForActionEvent(
        { queryKey: ["mail-inbox-sync"] },
        events,
      ),
    ).toBe(false);
  });

  it("targets inbox reads for preference action events", () => {
    const events = [{ source: "action", key: "update-mail-preferences" }];

    expect(
      shouldInvalidateMailQueryForActionEvent(inboxThreadsQuery, events),
    ).toBe(true);
    expect(
      shouldInvalidateMailQueryForActionEvent(inboxOverviewQuery, events),
    ).toBe(true);
    expect(shouldInvalidateMailQueryForActionEvent(labelsQuery, events)).toBe(
      false,
    );
    expect(
      shouldInvalidateMailQueryForActionEvent(queuedDraftsQuery, events),
    ).toBe(false);
    expect(
      shouldInvalidateMailQueryForActionEvent(
        { queryKey: ["emails", "inbox"] },
        events,
      ),
    ).toBe(false);
  });

  it("does not invalidate action queries for settings events", () => {
    const events = [{ source: "settings" }];

    expect(
      shouldInvalidateMailQueryForActionEvent(inboxThreadsQuery, events),
    ).toBe(false);
    expect(
      shouldInvalidateMailQueryForActionEvent(queuedDraftsQuery, events),
    ).toBe(false);
    expect(
      shouldInvalidateMailQueryForActionEvent(
        { queryKey: ["settings"] },
        events,
      ),
    ).toBe(false);
  });

  it("handles mixed sync and preference events without broad invalidation", () => {
    const events = [
      { source: "action", key: "sync-inbox" },
      { source: "action", key: "update-mail-preferences" },
      { source: "settings" },
    ];

    expect(
      shouldInvalidateMailQueryForActionEvent(inboxThreadsQuery, events),
    ).toBe(true);
    expect(
      shouldInvalidateMailQueryForActionEvent(inboxOverviewQuery, events),
    ).toBe(true);
    expect(
      shouldInvalidateMailQueryForActionEvent(queuedDraftsQuery, events),
    ).toBe(false);
  });

  it("keeps broad invalidation for unrelated action events", () => {
    const events = [{ source: "action", key: "send-email" }];

    expect(
      shouldInvalidateMailQueryForActionEvent(queuedDraftsQuery, events),
    ).toBe(true);
    expect(
      shouldInvalidateMailQueryForActionEvent(
        { queryKey: ["emails", "inbox"] },
        events,
      ),
    ).toBe(false);
  });
});
