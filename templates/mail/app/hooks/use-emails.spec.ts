import { readFileSync } from "node:fs";

import type { EmailMessage } from "@shared/types";
import { describe, expect, it, afterEach, vi } from "vitest";

import {
  apiFetch,
  type ApiError,
  consumeExternalEmailRefresh,
  beginThreadReadIntent,
  beginReadMutation,
  confirmReadMutation,
  clearOptimisticOverride,
  forgetSuppressionClaim,
  finishThreadReadIntent,
  filterSuppressedThreads,
  markExternalEmailRefresh,
  parseAccountErrorsHeader,
  rebasePinnedLabelsUpdate,
  releaseSuppression,
  releaseSuppressionClaims,
  rollbackReadMutation,
  settleSuppression,
  setOptimisticOverride,
  suppressThread,
  hasFreshOptimisticOverrideEvidence,
  keepLatestEmailPage,
  markThreadReadRetryAfterMs,
  shouldRetryMarkThreadRead,
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

function removalComponentSource(name: "EmailList" | "EmailThread"): string {
  return readFileSync(
    new URL(`../components/email/${name}.tsx`, import.meta.url),
    "utf8",
  );
}

describe("keepLatestEmailPage", () => {
  it("keeps a confirmed newer response when an older request resolves last", () => {
    const stale = {
      emails: [makeEmail("stale", "thread-stale")],
      providerSnapshotId: 1,
      suppressionFence: 0,
    };
    const confirmed = {
      emails: [{ ...makeEmail("fresh", "thread-fresh"), isRead: true }],
      providerSnapshotId: 2,
      suppressionFence: 1,
    };

    expect(keepLatestEmailPage(stale, confirmed)).toBe(confirmed);
    expect(keepLatestEmailPage(confirmed, stale)).toBe(confirmed);
  });
});

describe("removal undo claim ownership", () => {
  it("releases only the claim created by the matching mutation hook", () => {
    const hookSource = emailsHookSource();
    const listSource = removalComponentSource("EmailList");
    const threadSource = removalComponentSource("EmailThread");

    expect(hookSource).not.toContain("export function unsuppressThread");
    for (const name of [
      "useArchiveEmail",
      "useTrashEmail",
      "useBulkArchiveEmails",
      "useBulkTrashEmails",
      "useMoveEmail",
    ]) {
      const start = hookSource.indexOf(`export function ${name}()`);
      const end = hookSource.indexOf("export function", start + 1);
      const hook = hookSource.slice(start, end === -1 ? undefined : end);

      expect(hook).toContain("recordSuppressionClaim");
      expect(hook).toContain("recordInboxMutationClaim");
      expect(hook).toContain("suppressionToken");
      expect(hook).toContain(
        "return { ...mutation, createSuppressionToken, getSuppressionIds }",
      );
      expect(hook.indexOf("recordSuppressionClaim")).toBeLessThan(
        hook.indexOf("await Promise.all"),
      );
      expect(hook.indexOf("recordInboxMutationClaim")).toBeLessThan(
        hook.indexOf("await Promise.all"),
      );
    }
    for (const source of [listSource, threadSource]) {
      expect(source).not.toContain("unsuppressThread");
      expect(source).toContain("releaseSuppressionClaims");
      expect(source).toContain("releaseOwnedInboxRemoval");
      expect(source).toContain("inboxRemovalSnapshot");
      expect(source).toContain("createSuppressionToken");
      expect(source).toContain("getSuppressionIds");
    }
  });
});

describe("filterSuppressedThreads", () => {
  const archivedSuppressionIds: number[] = [];

  afterEach(() => {
    for (const id of archivedSuppressionIds)
      releaseSuppression("thread-archived", id);
    archivedSuppressionIds.length = 0;
    consumeExternalEmailRefresh();
    vi.useRealTimers();
  });

  it("keeps an archived thread hidden from stale inbox refetches", () => {
    archivedSuppressionIds.push(
      suppressThread("thread-archived", "archive", {
        views: ["inbox", "unread"],
      }),
    );

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
    archivedSuppressionIds.push(
      suppressThread("thread-archived", "archive", {
        views: ["inbox", "unread"],
      }),
    );
    const row = () => [makeEmail("msg-archived", "thread-archived")];

    expect(filterSuppressedThreads(row(), "archive")).toHaveLength(1);
    // Archiving removes only INBOX, so All Mail and every label it carries
    // still list the thread.
    expect(filterSuppressedThreads(row(), "all")).toHaveLength(1);
    expect(filterSuppressedThreads(row(), "all", "Projects")).toHaveLength(1);
  });

  it("does not expire a pending archive claim while stale data is possible", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-26T12:00:00.000Z"));
    archivedSuppressionIds.push(
      suppressThread("thread-archived", "archive", {
        views: ["inbox", "unread"],
      }),
    );

    vi.advanceTimersByTime(60_001);

    expect(
      filterSuppressedThreads(
        [makeEmail("msg-archived", "thread-archived")],
        "inbox",
      ),
    ).toEqual([]);
  });
});

describe("optimistic property overrides", () => {
  it("requires a provider request that started after the local mutation", () => {
    expect(hasFreshOptimisticOverrideEvidence(true, true, 4, 4)).toBe(false);
    expect(hasFreshOptimisticOverrideEvidence(true, true, 5, 4)).toBe(true);
    expect(hasFreshOptimisticOverrideEvidence(false, true, 5, 4)).toBe(false);
  });

  it("retires read and star overrides only after provider evidence", () => {
    const source = emailsHookSource();

    expect(source).not.toContain("OVERRIDE_DURATION");
    expect(source).toContain("reconcileOptimisticOverrides");
    expect(source).toContain("hasFreshOptimisticOverrideEvidence(");
    expect(source).toContain("providerSnapshotFences");
    expect(source).toContain("observed.providerSnapshotId <=");

    const threadHook = source.slice(
      source.indexOf("export function useThreadMessages("),
      source.indexOf("export function useMarkRead()"),
    );
    expect(threadHook).toContain("subscribeToOptimisticOverrides");
    expect(threadHook).toContain("reconcileOptimisticOverrides");
    expect(threadHook).toContain("providerSnapshotId");
    expect(threadHook).toContain("applyOverrides(messages)");
    expect(threadCacheSource()).toContain(
      "prev?.providerSnapshotId !== result.providerSnapshotId",
    );
  });
});

describe("suppression evidence", () => {
  it("does not use placeholder or search data to retire canonical claims", () => {
    const source = emailsHookSource();

    expect(source).toContain("providerSnapshotId");
    expect(source).toContain("suppressionFence");
    expect(source).toContain("if (search) return;");
    expect(source).toContain("q.isPlaceholderData");
    expect(source).toContain("page.suppressionFence < id");
    expect(source).toContain("pages[pages.length - 1]?.nextPageToken");
    expect(source).toContain("if (removed.onlyIn) return false;");
  });

  it("keeps an Undo claim addressable after evidence retires it", () => {
    const threadId = "thread-evidence-settled";
    const id = suppressThread(threadId, "archive", {
      views: ["inbox", "unread"],
    });

    // Provider evidence can retire the active suppression before the toast's
    // Undo callback runs.
    expect(settleSuppression(threadId, id)).toBe(true);
    expect(releaseSuppressionClaims(threadId, [id])).toBe(true);
    expect(releaseSuppressionClaims(threadId, [])).toBe(false);
  });

  it("does not undo an older claim after newer evidence has settled", () => {
    const threadId = "thread-settled-overlap";
    const archived = suppressThread(threadId, "archive", {
      views: ["inbox", "unread"],
    });
    const muted = suppressThread(threadId, "mute", {
      views: ["inbox", "unread"],
    });

    expect(settleSuppression(threadId, muted)).toBe(true);
    expect(releaseSuppressionClaims(threadId, [archived])).toBe(false);

    // Releasing the newer committed claim removes its tombstone, so the
    // older Undo can be honored after the newer action is explicitly undone.
    expect(releaseSuppressionClaims(threadId, [muted])).toBe(true);
  });

  it("removes failed claims from a still-visible Undo token", () => {
    const threadId = "thread-failed-undo";
    const id = suppressThread(threadId, "archive", {
      views: ["inbox", "unread"],
    });
    const token = {
      ids: new Map([[threadId, [id]]]),
      inboxMutationIds: new Map<string, string[]>(),
    };

    forgetSuppressionClaim(token, threadId, id);
    releaseSuppression(threadId, id);

    expect(
      releaseSuppressionClaims(threadId, token.ids.get(threadId) ?? []),
    ).toBe(false);
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
      "!query.isPlaceholderData && query.data?.errors.length",
    );
    expect(source).toContain(
      "return { ...query, data: query.data?.labels, accountErrors };",
    );
  });
});

describe("account errors and placeholder data", () => {
  it("does not carry account errors across an unsettled email query", () => {
    const source = emailsHookSource();

    expect(source).toContain(
      "if (!q.data || q.isPlaceholderData) return undefined;",
    );
    expect(source).toContain("}, [q.data, q.isPlaceholderData]);");
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

describe("triage suppression ordering", () => {
  it("records triage claims before waiting for query cancellation", () => {
    const source = emailsHookSource();
    for (const [name, end] of [
      ["useReportSpam", "export function useBlockSender()"],
      ["useBlockSender", "export function useMuteThread()"],
      ["useMuteThread", "// ─── Contacts"],
    ] as const) {
      const hook = source.slice(
        source.indexOf(`export function ${name}()`),
        source.indexOf(end),
      );
      expect(hook.indexOf("suppressThread(")).toBeLessThan(
        hook.indexOf("await Promise.all"),
      );
    }
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
    expect(source).toContain(
      "EMAIL_PREFETCH_TIMEOUT_MS,\n        prefetchKey,",
    );
    expect(source).toContain("...emailQueryOptions(qc, view, search, label)");
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

  it("uses a retained optimistic confirmation over stale cache data", () => {
    const first = beginReadMutation("message-stale-cache", false, true);
    expect(confirmReadMutation("message-stale-cache", first, true)).toBe(true);
    setOptimisticOverride("message-stale-cache", { isRead: true });

    const second = beginReadMutation("message-stale-cache", false, false);
    expect(rollbackReadMutation("message-stale-cache", second)).toBe(true);
    clearOptimisticOverride("message-stale-cache");
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
  it("waits only for a typed Gmail cooldown and caps its delay", () => {
    expect(
      markThreadReadRetryAfterMs(
        Object.assign(new Error("cooldown"), {
          status: 429,
          errorCode: "gmail_quota_cooldown",
          retryAfterMs: 45_000,
        }),
      ),
    ).toBe(45_000);
    expect(
      markThreadReadRetryAfterMs(
        Object.assign(new Error("other 429"), {
          status: 429,
          retryAfterMs: 45_000,
        }),
      ),
    ).toBeUndefined();
    expect(
      markThreadReadRetryAfterMs(
        Object.assign(new Error("invalid delay"), {
          status: 429,
          errorCode: "gmail_quota_cooldown",
          retryAfterMs: 900_000,
        }),
      ),
    ).toBe(300_000);

    const hook = emailsHookSource().slice(
      emailsHookSource().indexOf("export function useMarkThreadRead()"),
      emailsHookSource().indexOf("export function useToggleStar()"),
    );
    expect(hook).toContain("retry: (failureCount, error) =>");
    expect(hook).toContain("retryDelay: (_failureCount, error) =>");
    expect(hook).toContain('t("mail.error.rateLimitDescription")');
  });

  it("skips a cooldown retry after a newer read or unread intent", () => {
    const error = Object.assign(new Error("cooldown"), {
      status: 429,
      errorCode: "gmail_quota_cooldown",
      retryAfterMs: 45_000,
    });
    const first = beginThreadReadIntent("thread-retry-order");

    expect(shouldRetryMarkThreadRead(0, error, first)).toBe(true);
    const newer = beginThreadReadIntent("thread-retry-order");
    expect(shouldRetryMarkThreadRead(0, error, first)).toBe(false);
    expect(shouldRetryMarkThreadRead(0, error, newer)).toBe(true);

    finishThreadReadIntent(newer);
    expect(shouldRetryMarkThreadRead(0, error, first)).toBe(false);
    finishThreadReadIntent(first);

    const source = emailsHookSource();
    const threadReadHook = source.slice(
      source.indexOf("export function useMarkThreadRead()"),
      source.indexOf("export function markThreadReadRetryAfterMs"),
    );
    expect(threadReadHook).toContain(
      "if (intent && !isCurrentThreadReadIntent(intent)) return undefined;",
    );
    expect(threadReadHook).toContain(
      "threadReadIntentByVariables.set(variables, retryIntent)",
    );
    expect(source).toContain("beginThreadReadIntent(resolvedThreadId)");
    expect(source).toContain("].map(beginThreadReadIntent)");
  });

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

    expect(hook).toContain('await callAction("mark-thread-read", variables)');
    expect(hook).toContain("threadId: string;\n      accountEmail?: string;");
    expect(hook).toContain("const { threadId, accountEmail } = variables;");
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
    expect(source).toContain('if ("showAllTab" in variables)');
    expect(source).toContain("invalidations.push(invalidateInboxThreads(qc))");
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

  it("does not commit a response whose signal was aborted while its body was reading", async () => {
    let resolveBody!: (body: string) => void;
    const body = new Promise<string>((resolve) => {
      resolveBody = resolve;
    });
    const response = {
      headers: new Headers({ "Content-Type": "application/json" }),
      ok: true,
      status: 200,
      json: vi.fn(() => body.then((value) => JSON.parse(value))),
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const controller = new AbortController();
    const request = apiFetch("/api/emails", { signal: controller.signal });
    await vi.waitFor(() => expect(response.json).toHaveBeenCalled());
    controller.abort();
    resolveBody(JSON.stringify({ emails: [] }));

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
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
      expect(hook).toContain("releaseOwnedInboxRemoval(qc, threadId");
      expect(hook).toContain("restoreInboxThreadRemovals(qc");
    }
  });

  it("keeps a newer same-thread suppression claim after an older undo", () => {
    const threadId = "thread-overlap";
    const archived = suppressThread(threadId, "archive", {
      views: ["inbox", "unread"],
    });
    const muted = suppressThread(threadId, "mute", {
      views: ["inbox", "unread"],
    });
    const row = [makeEmail("message-overlap", threadId)];

    expect(releaseSuppression(threadId, archived)).toBe(false);
    expect(filterSuppressedThreads(row, "inbox")).toEqual([]);

    expect(releaseSuppression(threadId, muted)).toBe(true);
    expect(filterSuppressedThreads(row, "inbox")).toEqual(row);
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
      "reconcilePartialInboxMutation(qc, context, succeededThreadIds)",
    );
    expect(hook).toContain('suppressThread(threadId, "move", {');
    expect(hook).toContain(
      "releaseSuppression(threadId, context.suppressionIds[threadId])",
    );
    // Restoring the whole ["emails"] snapshot here would also revert a move
    // that completed while this one was still pending.
    expect(hook).not.toContain("previous.forEach");
  });

  it("keeps a later mutation hidden when an earlier move rolls back", () => {
    const moved = suppressThread("thread-moved", "move", {
      views: ["inbox", "unread"],
    });
    const archivedLater = suppressThread("thread-archived-later", "archive", {
      views: ["inbox", "unread"],
    });

    // The move failed for its own thread only; an archive that landed while it
    // was still pending must stay hidden.
    releaseSuppression("thread-moved", moved);

    const visible = filterSuppressedThreads(
      [
        makeEmail("msg-moved", "thread-moved"),
        makeEmail("msg-archived-later", "thread-archived-later"),
      ],
      "inbox",
    );

    expect(visible.map((email) => email.id)).toEqual(["msg-moved"]);
    releaseSuppression("thread-archived-later", archivedLater);
  });

  it("keeps the same thread hidden when an overlapping mutation rolls back", () => {
    // Move, then archive the same thread, then fail the move. The archive is
    // still pending, so releasing the move's claim must not reveal the row.
    const moved = suppressThread("thread-both", "move", {
      views: ["inbox", "unread"],
    });
    const archived = suppressThread("thread-both", "archive", {
      views: ["inbox", "unread"],
    });

    releaseSuppression("thread-both", moved);

    expect(
      filterSuppressedThreads([makeEmail("msg-both", "thread-both")], "inbox"),
    ).toEqual([]);

    releaseSuppression("thread-both", archived);
    expect(
      filterSuppressedThreads([makeEmail("msg-both", "thread-both")], "inbox"),
    ).toHaveLength(1);
  });

  it("keeps a newer mute claim when undo releases the earlier archive claim", () => {
    const archived = suppressThread("thread-archive-mute", "archive", {
      views: ["inbox", "unread"],
    });
    const muted = suppressThread("thread-archive-mute", "mute", {
      views: ["inbox", "unread"],
    });
    const row = [makeEmail("msg-archive-mute", "thread-archive-mute")];

    expect(releaseSuppressionClaims("thread-archive-mute", [archived])).toBe(
      false,
    );

    expect(filterSuppressedThreads(row, "inbox")).toEqual([]);

    expect(releaseSuppressionClaims("thread-archive-mute", [muted])).toBe(true);
    expect(filterSuppressedThreads(row, "inbox")).toHaveLength(1);
  });

  it("lets the newest claim decide where an overlapping thread stays visible", () => {
    // Archive then trash the same thread: Trash is its final location, so the
    // older archive claim must not keep hiding it there.
    const archived = suppressThread("thread-relocated", "archive", {
      views: ["inbox", "unread"],
    });
    const trashed = suppressThread("thread-relocated", "trash", {
      onlyIn: "trash",
    });
    const row = () => [makeEmail("msg-relocated", "thread-relocated")];

    expect(filterSuppressedThreads(row(), "trash")).toHaveLength(1);
    expect(filterSuppressedThreads(row(), "archive")).toEqual([]);
    // Trash leaves All Mail and every label behind as well.
    expect(filterSuppressedThreads(row(), "all")).toEqual([]);
    expect(filterSuppressedThreads(row(), "all", "Projects")).toEqual([]);

    releaseSuppression("thread-relocated", archived);
    releaseSuppression("thread-relocated", trashed);
  });

  it("keeps a moved thread in the labels it still carries", () => {
    // Moving out of the inbox with no source label leaves every label the
    // thread already had attached, so only the inbox loses the row.
    const moved = suppressThread("thread-filed", "move", {
      views: ["inbox", "unread"],
    });
    const row = () => [makeEmail("msg-filed", "thread-filed")];

    expect(filterSuppressedThreads(row(), "inbox")).toEqual([]);
    expect(filterSuppressedThreads(row(), "all")).toHaveLength(1);
    expect(filterSuppressedThreads(row(), "all", "Receipts")).toHaveLength(1);
    expect(filterSuppressedThreads(row(), "all", "Projects")).toHaveLength(1);

    releaseSuppression("thread-filed", moved);
  });

  it("hides a moved thread only in the source label it was moved out of", () => {
    // A mailbox-wide label tab fetches with view "all" plus the active label,
    // so only the label the move actually removed may stop listing it.
    const moved = suppressThread("thread-refiled", "move", {
      views: ["inbox", "unread"],
      label: "Marketing",
    });
    const row = () => [makeEmail("msg-refiled", "thread-refiled")];

    expect(filterSuppressedThreads(row(), "all", "Marketing")).toEqual([]);
    expect(filterSuppressedThreads(row(), "all", "Receipts")).toHaveLength(1);
    expect(filterSuppressedThreads(row(), "all", "Projects")).toHaveLength(1);
    expect(filterSuppressedThreads(row(), "all")).toHaveLength(1);

    releaseSuppression("thread-refiled", moved);
  });

  it("hides an archived thread only in the label the archive removed", () => {
    // Archiving from a label view passes removeLabel, so that label stops
    // listing the thread while every other label it carries keeps it.
    const archived = suppressThread("thread-filed-away", "archive", {
      views: ["inbox", "unread"],
      label: "Marketing",
    });
    const row = () => [makeEmail("msg-filed-away", "thread-filed-away")];

    expect(filterSuppressedThreads(row(), "all", "Marketing")).toEqual([]);
    expect(filterSuppressedThreads(row(), "all", "Projects")).toHaveLength(1);
    expect(filterSuppressedThreads(row(), "all")).toHaveLength(1);
    expect(filterSuppressedThreads(row(), "archive")).toHaveLength(1);
    expect(filterSuppressedThreads(row(), "inbox")).toEqual([]);

    releaseSuppression("thread-filed-away", archived);
  });

  it("rolls spam, block, and mute back per thread instead of by snapshot", () => {
    const source = emailsHookSource();
    const hooks = [
      ["useReportSpam", "export function useBlockSender()"],
      ["useBlockSender", "export function useMuteThread()"],
      ["useMuteThread", "export type Contact = "],
    ] as const;

    for (const [name, end] of hooks) {
      const hook = source.slice(
        source.indexOf(`export function ${name}()`),
        source.indexOf(end),
      );

      expect(hook).toContain("removeInboxThreadsOptimistic(");
      expect(hook).toContain("new Set([threadId])");
      expect(hook).toContain(
        "forgetInboxMutation(qc, context.inboxMutationId)",
      );
      expect(hook).toContain(
        "settleInboxMutationIfObserved(qc, context?.inboxMutationId)",
      );
      // A whole-snapshot restore here would revert mutations that landed after
      // this one started — the bug class this hook set was rewritten to avoid.
      expect(hook).not.toContain("previous.forEach");
    }
  });

  it("passes per-target account and thread hints to the Move action", () => {
    const source = emailsHookSource();
    const start = source.indexOf("export function useMoveEmail()");
    const end = source.indexOf("export function useSaveDraft()", start);
    const hook = source.slice(start, end);

    expect(source).toContain("accountEmails?: string");
    expect(source).toContain("threadIds?: string");
    expect(hook).toContain("accountEmails,");
    expect(hook).toContain("threadIds,");
    expect(hook).toContain('callAction("move-email", {');
  });
});
