import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { LABELS_QUERY_KEY } from "@/hooks/use-emails";
import { INBOX_THREADS_QUERY_KEY } from "@/hooks/use-inbox-threads";

import { createMailSyncEventHandler } from "./root";

function fakeQueryClient() {
  return { invalidateQueries: vi.fn() } as unknown as QueryClient & {
    invalidateQueries: ReturnType<typeof vi.fn>;
  };
}

function keysInvalidated(qc: ReturnType<typeof fakeQueryClient>) {
  return qc.invalidateQueries.mock.calls.map(
    (call) => (call[0] as { queryKey?: unknown }).queryKey,
  );
}

describe("createMailSyncEventHandler", () => {
  it("coalesces a batch of refresh-signal events into one inbox/label invalidation", async () => {
    const qc = fakeQueryClient();
    const onEvent = createMailSyncEventHandler(qc);

    for (let i = 0; i < 5; i++) {
      onEvent({
        source: "app-state",
        type: "app-state",
        key: "refresh-signal",
        requestSource: "other-tab",
      });
    }
    await Promise.resolve();
    await Promise.resolve();

    const keys = keysInvalidated(qc);
    const labelCalls = keys.filter(
      (k) => JSON.stringify(k) === JSON.stringify(LABELS_QUERY_KEY),
    );
    const inboxCalls = keys.filter(
      (k) => JSON.stringify(k) === JSON.stringify(INBOX_THREADS_QUERY_KEY),
    );
    expect(labelCalls).toHaveLength(1);
    expect(inboxCalls).toHaveLength(1);
  });

  it("refreshes only preferences for an unkeyed settings event", async () => {
    const qc = fakeQueryClient();
    const onEvent = createMailSyncEventHandler(qc);

    onEvent({
      source: "settings",
      type: "settings",
      requestSource: "other-tab",
    });
    await Promise.resolve();

    const keys = keysInvalidated(qc);
    expect(keys).not.toContainEqual(LABELS_QUERY_KEY);
    expect(keys).not.toContainEqual(INBOX_THREADS_QUERY_KEY);
    expect(keys).toEqual([["settings"]]);
  });

  it("coalesces mail preference events into only affected inbox and settings reads", async () => {
    const qc = fakeQueryClient();
    const onEvent = createMailSyncEventHandler(qc);

    for (let i = 0; i < 35; i++) {
      onEvent({
        source: "settings",
        type: "settings",
        key: "u:other@example.com:mail-settings",
        requestSource: "other-tab",
      });
    }
    await Promise.resolve();

    const keys = keysInvalidated(qc);
    expect(
      keys.filter((key) => JSON.stringify(key) === '["settings"]'),
    ).toHaveLength(1);
    expect(
      keys.filter((key) => JSON.stringify(key) === '["mail-inbox-overview"]'),
    ).toHaveLength(1);
    expect(
      keys.filter(
        (key) => JSON.stringify(key) === '["action","list-inbox-threads"]',
      ),
    ).toHaveLength(1);
    expect(keys).toHaveLength(3);
  });

  it("refreshes only the agent engine picker for an engine setting event", async () => {
    const qc = fakeQueryClient();
    const onEvent = createMailSyncEventHandler(qc);

    onEvent({
      source: "settings",
      type: "settings",
      key: "o:org-1:agent-engine",
      requestSource: "other-tab",
    });
    await Promise.resolve();

    expect(keysInvalidated(qc)).toEqual([["agent-engines"]]);
  });

  it("does not re-invalidate list-inbox-threads/list-labels on a screen-refresh event", () => {
    const qc = fakeQueryClient();
    const onEvent = createMailSyncEventHandler(qc);

    onEvent({
      source: "screen-refresh",
      type: "screen-refresh",
      requestSource: "other-tab",
    });

    const keys = keysInvalidated(qc);
    expect(keys).not.toContainEqual(LABELS_QUERY_KEY);
    expect(keys).not.toContainEqual(INBOX_THREADS_QUERY_KEY);
  });
});
