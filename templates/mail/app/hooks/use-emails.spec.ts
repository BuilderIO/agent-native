import { readFileSync } from "node:fs";

import type { EmailMessage } from "@shared/types";
import { describe, expect, it, afterEach, vi } from "vitest";

import {
  apiFetch,
  type ApiError,
  consumeExternalEmailRefresh,
  beginReadMutation,
  confirmReadMutation,
  filterSuppressedThreads,
  markExternalEmailRefresh,
  parseAccountErrorsHeader,
  rebasePinnedLabelsUpdate,
  rollbackReadMutation,
  suppressThread,
  unsuppressThread,
} from "./use-emails";

function makeEmail(id: string, threadId: string): EmailMessage {
  return {
    id,
    threadId,
    from: { name: "Sender", email: "sender@example.com" },
    to: [{ name: "Recipient", email: "recipient@example.com" }],
    subject: "Subject",
    snippet: "Snippet",
    body: "Body",
    date: "2026-06-25T12:00:00.000Z",
    isRead: false,
    isStarred: false,
    isArchived: false,
    isTrashed: false,
    labelIds: ["inbox"],
  };
}

function emailsHookSource(): string {
  return readFileSync(new URL("./use-emails.ts", import.meta.url), "utf8");
}

function threadCacheSource(): string {
  return readFileSync(
    new URL("../lib/thread-cache.ts", import.meta.url),
    "utf8",
  );
}

describe("filterSuppressedThreads", () => {
  afterEach(() => {
    unsuppressThread("thread-archived");
    consumeExternalEmailRefresh();
    vi.useRealTimers();
  });

  it("keeps an archived thread hidden from stale inbox refetches", () => {
    suppressThread("thread-archived", "archive");

    const visible = filterSuppressedThreads(
      [
        makeEmail("msg-archived", "thread-archived"),
        makeEmail("msg-visible", "thread-visible"),
      ],
      "inbox",
    );

    expect(visible.map((email) => email.id)).toEqual(["msg-visible"]);
  });

  it("allows an archived thread in the archive destination view", () => {
    suppressThread("thread-archived", "archive");

    const visible = filterSuppressedThreads(
      [makeEmail("msg-archived", "thread-archived")],
      "archive",
    );

    expect(visible.map((email) => email.id)).toEqual(["msg-archived"]);
  });
});

describe("consumeExternalEmailRefresh", () => {
  afterEach(() => {
    consumeExternalEmailRefresh();
    vi.useRealTimers();
  });

  it("uses each forced Gmail list refresh once per list scope", () => {
    vi.useFakeTimers();
    const now = new Date("2026-06-26T12:00:00.000Z").getTime();
    vi.setSystemTime(now);

    markExternalEmailRefresh();

    expect(consumeExternalEmailRefresh("inbox")).toBe(now);
    expect(consumeExternalEmailRefresh("important")).toBe(now);
    expect(consumeExternalEmailRefresh("inbox")).toBeUndefined();
    expect(consumeExternalEmailRefresh("important")).toBeUndefined();
  });

  it("drops expired forced Gmail list refreshes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-26T12:00:00.000Z"));
    markExternalEmailRefresh();

    vi.advanceTimersByTime(5000);

    expect(consumeExternalEmailRefresh()).toBeUndefined();
  });
});

describe("useLabels", () => {
  it("keeps the last label data during a failed refresh", () => {
    const source = emailsHookSource();

    expect(source).toContain("placeholderData: (previousData) => previousData");
    expect(source).toContain("export const EMPTY_LABELS: Label[] = [];");
    expect(source).toContain(
      "export function useLabels(accountEmails?: readonly string[])",
    );
    expect(source).toContain(
      'useActionQuery<ListLabelsResult>(\n    "list-labels",',
    );
  });

  it("keeps `data` as Label[] and exposes per-account label-fetch errors", () => {
    const source = emailsHookSource();

    expect(source).toContain(
      "return { ...query, data: query.data?.labels, accountErrors };",
    );
  });
});

describe("account-scoped triage mutations", () => {
  it("forwards the selected account through spam, block, and mute requests", () => {
    const source = emailsHookSource();
    const reportSpam = source.slice(
      source.indexOf("export function useReportSpam()"),
      source.indexOf("export function useBlockSender()"),
    );
    const blockSender = source.slice(
      source.indexOf("export function useBlockSender()"),
      source.indexOf("export function useMuteThread()"),
    );
    const muteThread = source.slice(
      source.indexOf("export function useMuteThread()"),
      source.indexOf(
        "// ─── Contacts",
        source.indexOf("export function useMuteThread()"),
      ),
    );

    expect(reportSpam).toContain("accountEmail?: string");
    expect(reportSpam).toContain(
      "body: JSON.stringify({ accountEmail, threadId })",
    );
    expect(blockSender).toContain("accountEmail?: string");
    expect(blockSender).toContain(
      "body: JSON.stringify({ senderEmail, accountEmail })",
    );
    expect(muteThread).toContain("accountEmail?: string");
    expect(muteThread).toContain("body: JSON.stringify({ accountEmail })");
  });
});

describe("useEmails query warming", () => {
  it("shares the infinite-query fetcher with tab prefetches", () => {
    const source = emailsHookSource();
    const useEmailsSource = source.slice(
      source.indexOf("export function useEmails("),
    );

    expect(useEmailsSource).toContain(
      "placeholderData: (previousData) => previousData",
    );
    expect(useEmailsSource).toContain(
      "const canPaginate = !q.isPlaceholderData;",
    );
    expect(useEmailsSource).toContain(
      "hasNextPage: canPaginate && q.hasNextPage",
    );
    expect(useEmailsSource).toContain(
      "isFetchingNextPage: canPaginate && q.isFetchingNextPage",
    );
    expect(useEmailsSource).toContain(
      "const hasCurrentQueryData = Boolean(q.data) && !q.isPlaceholderData;",
    );
    expect(useEmailsSource).toContain(
      "isError: q.isError && !hasCurrentQueryData",
    );
    expect(source).toContain("function emailQueryOptions(");
    expect(source).toContain("prefetchInfiniteQuery({");
    expect(source).toContain('const prefetchKey = ["email-prefetch"');
    expect(source).toContain("EMAIL_PREFETCH_TIMEOUT_MS");
    expect(source).toContain("queryClient.removeQueries");
    expect(source).toContain("queryKey: prefetchKey");
    expect(source).toContain("...emailQueryOptions(view, search, label)");
  });
});

describe("useMarkRead", () => {
  it("updates and rolls back the mounted thread cache", () => {
    const source = emailsHookSource();
    const hook = source.slice(
      source.indexOf("export function useMarkRead()"),
      source.indexOf("export function useMarkThreadRead()"),
    );

    expect(hook).toContain("getCachedThread(resolvedThreadId)");
    expect(hook).toContain("supersedeCachedThreadFetch(resolvedThreadId)");
    expect(hook).toContain(
      "message.id === id ? { ...message, isRead } : message",
    );
    expect(hook).toContain("applyReadMutationStates(");
  });

  it("rolls overlapping failures back to the confirmed server state", () => {
    const first = beginReadMutation("message-overlap", true, false);
    const second = beginReadMutation("message-overlap", false, true);

    expect(rollbackReadMutation("message-overlap", first)).toBeNull();
    expect(rollbackReadMutation("message-overlap", second)).toBe(true);
  });

  it("distinguishes an unavailable baseline from a stale mutation", () => {
    const version = beginReadMutation("message-unknown", undefined, true);

    expect(rollbackReadMutation("message-unknown", version)).toBeUndefined();
  });

  it("uses an earlier successful mutation as the later rollback baseline", () => {
    const first = beginReadMutation("message-confirmed", true, false);
    const second = beginReadMutation("message-confirmed", false, true);

    confirmReadMutation("message-confirmed", first, false);
    expect(rollbackReadMutation("message-confirmed", second)).toBe(false);
  });

  it("keeps a newer completion authoritative over an older completion", () => {
    const first = beginReadMutation("message-out-of-order", true, false);
    const second = beginReadMutation("message-out-of-order", false, true);

    expect(confirmReadMutation("message-out-of-order", second, true)).toBe(
      true,
    );
    expect(confirmReadMutation("message-out-of-order", first, false)).toBe(
      true,
    );
  });

  it("retains an earlier in-flight mutation when the latest fails", () => {
    const first = beginReadMutation("message-pending", false, true);
    const second = beginReadMutation("message-pending", true, false);

    expect(rollbackReadMutation("message-pending", second)).toBe(true);
    expect(confirmReadMutation("message-pending", first, true)).toBe(true);
    expect(rollbackReadMutation("message-pending", first)).toBeNull();
  });

  it("supersedes cold fetches before checking for cached messages", () => {
    const source = emailsHookSource();
    const hook = source.slice(
      source.indexOf("export function useMarkRead()"),
      source.indexOf("export function useMarkThreadRead()"),
    );

    expect(hook).toContain("const restartThread = resolvedThreadId");
    expect(hook).toContain("supersedeCachedThreadFetch(resolvedThreadId)");
    expect(hook).toContain("resolvedThreadId && restartThread");
    expect(source).toContain("clearOptimisticOverrideProperty(emailId, field)");
    expect(hook).toContain("refreshThreadAfterMutations(");
  });
});

describe("thread fetch ownership", () => {
  it("only lets the current request clear its in-flight entry", () => {
    expect(threadCacheSource()).toContain(
      "if (inflight.get(threadId) === request) inflight.delete(threadId)",
    );
    expect(threadCacheSource()).toContain("return superseded");
  });
});

describe("useMarkThreadRead", () => {
  it("supersedes a cold thread fetch before the optimistic update", () => {
    const source = emailsHookSource();
    const hook = source.slice(
      source.indexOf("export function useMarkThreadRead()"),
      source.indexOf("export function useToggleStar()"),
    );

    expect(hook).toContain("supersedeCachedThreadFetch(threadId)");
    expect(hook).toContain("beginReadMutation(id, false, true)");
    expect(hook).not.toContain("context.previousThread");
  });

  it("sends accountEmail with the mark-thread-read call so multi-account owners don't 401", () => {
    // Repro: the mutation used to take a bare threadId, so the server fell
    // back to the request owner's login email — wrong whenever that isn't
    // the Gmail account the thread belongs to (a second/personal account,
    // or local dev where the owner's login isn't a connected Gmail address).
    const source = emailsHookSource();
    const hook = source.slice(
      source.indexOf("export function useMarkThreadRead()"),
      source.indexOf("export function useToggleStar()"),
    );

    expect(hook).toContain(
      'mutationFn: ({\n      threadId,\n      accountEmail,\n    }: {\n      threadId: string;\n      accountEmail?: string;\n    }) =>\n      callAction("mark-thread-read", { threadId, accountEmail })',
    );
    expect(hook).toContain("onMutate: async ({ threadId, accountEmail }) => {");
  });
});

describe("serializePinnedLabelsUpdate", () => {
  it("runs pinned-label writes in order", async () => {
    const { serializePinnedLabelsUpdate } = await import("./use-emails");
    const events: string[] = [];
    let releaseFirst!: () => void;

    const first = serializePinnedLabelsUpdate(
      () =>
        new Promise<void>((resolve) => {
          events.push("first");
          releaseFirst = resolve;
        }),
    );
    const second = serializePinnedLabelsUpdate(async () => {
      events.push("second");
    });

    await Promise.resolve();
    expect(events).toEqual(["first"]);

    releaseFirst();
    await Promise.all([first, second]);

    expect(events).toEqual(["first", "second"]);
  });
});

describe("rebasePinnedLabelsUpdate", () => {
  it("drops a failed queued pin from the later payload", () => {
    expect(
      rebasePinnedLabelsUpdate([], ["important"], ["important", "travel"]),
    ).toEqual(["travel"]);
  });

  it("keeps a later reorder aligned with confirmed pins", () => {
    expect(
      rebasePinnedLabelsUpdate(
        ["inbox", "sent"],
        ["inbox", "sent"],
        ["sent", "inbox"],
      ),
    ).toEqual(["sent", "inbox"]);
  });

  it("preserves confirmed order when a queued intent keeps the same order", () => {
    expect(
      rebasePinnedLabelsUpdate(
        ["sent", "inbox"],
        ["inbox", "sent"],
        ["inbox", "sent"],
      ),
    ).toEqual(["sent", "inbox"]);
  });
});

describe("useUpdateSettings", () => {
  it("serializes pinned-label snapshots without touching other settings writes", () => {
    const source = emailsHookSource();

    expect(source).toContain('"pinnedLabels" in data');
    expect(source).toContain("serializePinnedLabelsUpdate(() =>");
    expect(source).toContain("rebasePinnedLabelsUpdate(");
    expect(source).toContain("resetPinnedLabelsState(owner)");
    expect(source).toContain("settingsLoading || !prev || !owner");
    expect(source).toContain("requestSource: TAB_ID");
  });
});

describe("parseAccountErrorsHeader", () => {
  it("returns undefined for a missing header", () => {
    expect(parseAccountErrorsHeader(null)).toBeUndefined();
    expect(parseAccountErrorsHeader(undefined)).toBeUndefined();
  });

  it("parses a JSON array of per-account errors", () => {
    expect(
      parseAccountErrorsHeader(
        JSON.stringify([{ email: "a@example.com", error: "quota exceeded" }]),
      ),
    ).toEqual([{ email: "a@example.com", error: "quota exceeded" }]);
  });

  it("ignores malformed JSON instead of throwing", () => {
    expect(parseAccountErrorsHeader("not json")).toBeUndefined();
  });

  it("drops entries missing email or error and empty arrays", () => {
    expect(
      parseAccountErrorsHeader(JSON.stringify([{ email: "a@example.com" }])),
    ).toBeUndefined();
    expect(parseAccountErrorsHeader(JSON.stringify([]))).toBeUndefined();
  });
});

describe("apiFetch quota signaling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches status and retryAfterMs from a 429 + Retry-After response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "Google is busy. We'll try again in a moment.",
          }),
          { status: 429, headers: { "Retry-After": "45" } },
        ),
      ),
    );

    await expect(apiFetch("/api/emails")).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 45_000,
    });
  });

  it("leaves retryAfterMs undefined without a Retry-After header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 502 })),
    );

    const error = (await apiFetch("/api/emails").catch(
      (e: ApiError) => e,
    )) as ApiError;
    expect(error).toMatchObject({ status: 502 });
    expect(error.retryAfterMs).toBeUndefined();
  });
});

describe("inbox-thread cache rollback on mutation error", () => {
  // Inbox optimistic state is a journal overlay. Errors retire only their own
  // entry, so overlapping mutations never restore an older cache snapshot.
  const boundaries: Array<[string, string]> = [
    ["export function useMarkRead()", "export function useMarkThreadRead()"],
    ["export function useMarkThreadRead()", "export function useToggleStar()"],
    ["export function useToggleStar()", "export function useArchiveEmail()"],
    [
      "export function useArchiveEmail()",
      "export function useUnarchiveEmail()",
    ],
    [
      "export function useTrashEmail()",
      "export function useBulkArchiveEmails()",
    ],
    [
      "export function useBulkArchiveEmails()",
      "export function useBulkTrashEmails()",
    ],
    [
      "export function useBulkTrashEmails()",
      "export function useBulkToggleStar()",
    ],
    [
      "export function useBulkToggleStar()",
      "export function useBulkMarkRead()",
    ],
    ["export function useBulkMarkRead()", "export function useMoveEmail()"],
  ];

  it.each(boundaries)(
    "%s journals and retires its inbox mutation",
    (start, end) => {
      const source = emailsHookSource();
      const hook = source.slice(source.indexOf(start), source.indexOf(end));

      expect(hook).toContain("cancelInboxThreadsQueries(qc)");
      expect(hook).toContain("forgetInboxMutation(qc");
      expect(hook).not.toContain("restoreInboxThreadsOptimistic(qc, context");
    },
  );

  it("clears the inbox removal journal when either undo mutation starts", () => {
    const source = emailsHookSource();

    for (const name of ["useUnarchiveEmail", "useUntrashEmail"]) {
      const start = source.indexOf(`export function ${name}()`);
      const end = source.indexOf("export function", start + 1);
      const hook = source.slice(start, end === -1 ? undefined : end);

      expect(hook).toContain("onMutate:");
      expect(hook).toContain("findInboxThreadIdByMessageId(qc, id)");
      expect(hook).toContain("clearInboxThreadRemoval(qc, threadId)");
      expect(hook).toContain("restoreInboxThreadRemovals(qc");
    }
  });

  it("keeps bulk Gmail rollbacks scoped to the items that failed", () => {
    const source = emailsHookSource();
    const bulkHooks = [
      [
        "export function useBulkArchiveEmails()",
        "export function useBulkTrashEmails()",
        [
          "enqueueBulkGmailMutation",
          "BulkGmailMutationFailure",
          "reconcilePartialInboxMutation",
        ],
      ],
      [
        "export function useBulkToggleStar()",
        "export function useBulkMarkRead()",
        [
          "enqueueBulkGmailMutation",
          "resolveBulkThreadIds(qc, targets)",
          "BulkGmailMutationFailure",
          "mutationVersions",
          "beginStarMutation",
          "reconcilePartialInboxMutation",
        ],
      ],
      [
        "export function useBulkMarkRead()",
        "export function useMoveEmail()",
        [
          "enqueueBulkGmailMutation",
          "resolveBulkThreadIds(qc, targets)",
          "BulkGmailMutationFailure",
          "mutationVersions",
          "beginReadMutation",
          "reconcilePartialInboxMutation",
        ],
      ],
    ] as const;

    for (const [start, end, markers] of bulkHooks) {
      const hook = source.slice(source.indexOf(start), source.indexOf(end));
      for (const marker of markers) expect(hook).toContain(marker);
    }
    expect(source).toContain('enqueueBulkGmailMutation("trash"');
    expect(source).toContain('cancelOrWait("trash", id)');
  });

  it("treats a partial move as an error and keeps only successful threads removed", () => {
    const source = emailsHookSource();
    const start = source.indexOf("export function useMoveEmail()");
    const end = source.indexOf("export function useSaveDraft()", start);
    const hook = source.slice(start, end);

    expect(hook).toContain('result.status === "partial"');
    expect(hook).toContain("throw new MoveEmailPartialFailure(result)");
    expect(hook).toContain("forgetInboxMutation(qc, context.inboxMutationId)");
    expect(hook).toContain(
      "removeInboxThreadsOptimistic(qc, succeededThreadIds)",
    );
    expect(hook).toContain(
      "context.previous.forEach(([key, data]) =>\n          qc.setQueryData(",
    );
  });

  it("passes per-target account and thread hints to the Move action", () => {
    const source = emailsHookSource();
    const start = source.indexOf("export function useMoveEmail()");
    const end = source.indexOf("export function useSaveDraft()", start);
    const hook = source.slice(start, end);

    expect(hook).toContain("accountEmails?: string");
    expect(hook).toContain("threadIds?: string");
    expect(hook).toContain("accountEmails,");
    expect(hook).toContain("threadIds,");
    expect(hook).toContain('callAction("move-email", {');
  });
});
