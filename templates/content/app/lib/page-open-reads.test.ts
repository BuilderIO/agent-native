import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => {
  type Answer = "pending" | "first-read" | "replaced";
  const listeners = new Set<() => void>();
  let answer: Answer = "first-read";
  return {
    listeners,
    transport: {},
    get: () => answer,
    // Like the session store: listeners hear the change in the same task.
    set(next: Answer) {
      answer = next;
      for (const listener of [...listeners]) listener();
    },
    reset(next: Answer) {
      answer = next;
      listeners.clear();
    },
  };
});

vi.mock("@agent-native/core/client/use-session", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/use-session")
  >()),
  firstSessionReadAnswer: () => session.get(),
  // Like the session store: a read sent while the load's first session read
  // is out belongs to that read, and is current only if it answers. These
  // specs never switch the session after it, so a later read is current.
  sessionReadIdentity: (options: { sentWithFirstSessionRead?: boolean } = {}) =>
    options.sentWithFirstSessionRead || session.get() === "pending"
      ? { sentWith: "first-read", transport: session.transport }
      : { sentWith: "answered", scope: "a", transport: session.transport },
  sessionReadIdentityStatus: (identity: { sentWith: string }) =>
    identity.sentWith === "answered"
      ? "current"
      : session.get() === "pending"
        ? "pending"
        : session.get() === "first-read"
          ? "current"
          : "stale",
  subscribeSessionReadIdentity: (listener: () => void) => {
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  },
}));

import { sessionReadIdentity } from "@agent-native/core/client/use-session";

import { contentActionInvalidatePredicate } from "../hooks/content-action-refresh";
import {
  adoptPageOpenRead,
  claimPageOpenRead,
  isAwaitingSession,
  isPageOpenRead,
  PAGE_OPEN_READ_TTL_MS,
  releasePageOpenRead,
  retirePageOpenReads,
  spoilPageOpenReads,
  startPageOpenRead,
  whenReadIdentityCurrent,
} from "./page-open-reads";

const queryKey = ["action", "get-document", { id: "doc-1" }] as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("page open reads", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    session.reset("first-read");
  });

  afterEach(() => {
    vi.useRealTimers();
    queryClient.clear();
  });

  it("hands a landed read to the first mount only", async () => {
    const queryFn = vi.fn().mockResolvedValue({ id: "doc-1" });
    startPageOpenRead(queryClient, "doc-1", { queryKey, queryFn });
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toEqual({ id: "doc-1" }),
    );

    expect(adoptPageOpenRead(queryClient, queryKey)).toBe("fresh");
    expect(adoptPageOpenRead(queryClient, queryKey)).toBe("none");
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("starts one read per open even when several places ask for it", async () => {
    const queryFn = vi.fn().mockResolvedValue({ id: "doc-1" });
    startPageOpenRead(queryClient, "doc-1", { queryKey, queryFn });
    startPageOpenRead(queryClient, "doc-1", { queryKey, queryFn });
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toBeTruthy(),
    );
    startPageOpenRead(queryClient, "doc-1", { queryKey, queryFn });

    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("reports a read that is still in flight so the mount joins it", () => {
    const response = deferred<{ id: string }>();
    startPageOpenRead(queryClient, "doc-1", {
      queryKey,
      queryFn: () => response.promise,
    });

    expect(adoptPageOpenRead(queryClient, queryKey)).toBe("pending");
    response.resolve({ id: "doc-1" });
  });

  it("never adopts a read invalidated after it started", async () => {
    const response = deferred<{ id: string; title: string }>();
    startPageOpenRead(queryClient, "doc-1", {
      queryKey,
      queryFn: () => response.promise,
    });
    await queryClient.invalidateQueries({ queryKey });
    response.resolve({ id: "doc-1", title: "Before the change" });
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toBeTruthy(),
    );

    expect(adoptPageOpenRead(queryClient, queryKey)).toBe("none");
  });

  it("notices a change that lands on a query that was already invalidated", async () => {
    queryClient.setQueryData(queryKey, { id: "doc-1", title: "Old" });
    await queryClient.invalidateQueries({ queryKey });
    const response = deferred<{ id: string; title: string }>();
    startPageOpenRead(queryClient, "doc-1", {
      queryKey,
      queryFn: () => response.promise,
    });
    await queryClient.invalidateQueries({ queryKey });
    response.resolve({ id: "doc-1", title: "Before the change" });
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toMatchObject({
        title: "Before the change",
      }),
    );

    expect(adoptPageOpenRead(queryClient, queryKey)).toBe("none");
  });

  it("cancels an invalidated read that is still in flight so the mount reads again", async () => {
    const aborted = vi.fn();
    startPageOpenRead(queryClient, "doc-1", {
      queryKey,
      queryFn: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted();
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    });
    await queryClient.invalidateQueries({ queryKey });

    expect(adoptPageOpenRead(queryClient, queryKey)).toBe("none");
    await vi.waitFor(() => expect(aborted).toHaveBeenCalled());
  });

  it("does not count a cache write over a cancelled read as the read landing", async () => {
    queryClient.setQueryData(queryKey, { id: "doc-1", body: "Cached earlier" });
    const response = deferred<{ id: string; body: string }>();
    startPageOpenRead(queryClient, "doc-1", {
      queryKey,
      queryFn: () => response.promise,
    });
    // An optimistic update cancels the read and patches the older body.
    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData(queryKey, {
      id: "doc-1",
      body: "Cached earlier",
      title: "Renamed",
    });

    expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe("idle");
    expect(adoptPageOpenRead(queryClient, queryKey)).toBe("none");
  });

  it("does not count a cache write as a landed read for a page with no cached copy", async () => {
    const response = deferred<{ id: string }>();
    startPageOpenRead(queryClient, "doc-1", {
      queryKey,
      queryFn: () => response.promise,
    });
    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData(queryKey, { id: "doc-1", title: "Patched" });

    expect(adoptPageOpenRead(queryClient, queryKey)).toBe("none");
  });

  it("still adopts a landed read that a later optimistic patch touched", async () => {
    startPageOpenRead(queryClient, "doc-1", {
      queryKey,
      queryFn: () => Promise.resolve({ id: "doc-1", title: "Plan" }),
    });
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toBeTruthy(),
    );
    await queryClient.cancelQueries({ queryKey });
    queryClient.setQueryData(queryKey, { id: "doc-1", title: "Renamed" });

    expect(adoptPageOpenRead(queryClient, queryKey)).toBe("fresh");
  });

  it("does not let a restarted read join the spoiled fetch it replaces", async () => {
    const responses = [
      deferred<{ id: string; title: string }>(),
      deferred<{ id: string; title: string }>(),
    ];
    let calls = 0;
    const queryFn = () => responses[calls++].promise;
    startPageOpenRead(queryClient, "doc-1", { queryKey, queryFn });
    await queryClient.invalidateQueries({ queryKey });
    startPageOpenRead(queryClient, "doc-1", { queryKey, queryFn });

    responses[0].resolve({ id: "doc-1", title: "Before the change" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(queryClient.getQueryData(queryKey)).toBeUndefined();
    expect(adoptPageOpenRead(queryClient, queryKey)).toBe("pending");

    responses[1].resolve({ id: "doc-1", title: "After the change" });
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toEqual({
        id: "doc-1",
        title: "After the change",
      }),
    );
    expect(calls).toBe(2);
  });

  it("keeps a claimed read tracked until release, and refetches one spoiled in between", async () => {
    let title = "Before the change";
    const queryFn = vi.fn(async () => ({ id: "doc-1", title }));
    startPageOpenRead(queryClient, "doc-1", { queryKey, queryFn });
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toBeTruthy(),
    );

    const { adoption, read } = claimPageOpenRead(queryClient, queryKey);
    expect(adoption).toBe("fresh");
    expect(isPageOpenRead(queryClient, queryKey)).toBe(true);
    // A peer edit reaches sync after the claim but before the page subscribes.
    title = "After the change";
    const predicate = contentActionInvalidatePredicate("/home", (query) =>
      isPageOpenRead(queryClient, query.queryKey),
    );
    await queryClient.invalidateQueries({
      predicate: (query) =>
        predicate(query, [{ source: "action", key: "edit-document" }]),
    });
    releasePageOpenRead(queryClient, queryKey, read!);

    expect(isPageOpenRead(queryClient, queryKey)).toBe(false);
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toEqual({
        id: "doc-1",
        title: "After the change",
      }),
    );
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("releases an unspoiled claim without reading again", async () => {
    const queryFn = vi.fn(async () => ({ id: "doc-1" }));
    startPageOpenRead(queryClient, "doc-1", { queryKey, queryFn });
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toBeTruthy(),
    );
    const { read } = claimPageOpenRead(queryClient, queryKey);
    releasePageOpenRead(queryClient, queryKey, read!);

    expect(isPageOpenRead(queryClient, queryKey)).toBe(false);
    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it("spoils a page's reads when this tab changes the page", async () => {
    const draftKey = [
      "action",
      "get-preview-document-draft",
      { documentId: "doc-1" },
    ] as const;
    const otherKey = ["action", "get-document", { id: "doc-2" }] as const;
    for (const [id, key] of [
      ["doc-1", queryKey],
      ["doc-1", draftKey],
      ["doc-2", otherKey],
    ] as const) {
      startPageOpenRead(queryClient, id, {
        queryKey: key,
        queryFn: async () => ({ id }),
      });
    }
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(otherKey)).toBeTruthy(),
    );

    spoilPageOpenReads(queryClient, "doc-1");

    expect(adoptPageOpenRead(queryClient, queryKey)).toBe("none");
    expect(adoptPageOpenRead(queryClient, draftKey)).toBe("none");
    expect(adoptPageOpenRead(queryClient, otherKey)).toBe("fresh");
  });

  it("does not adopt a failed or expired read", async () => {
    startPageOpenRead(queryClient, "doc-1", {
      queryKey,
      queryFn: () => Promise.reject(new Error("unavailable")),
      retry: false,
    });
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(queryKey)?.status).toBe("error"),
    );
    expect(adoptPageOpenRead(queryClient, queryKey)).toBe("none");

    vi.useFakeTimers({ toFake: ["Date"] });
    startPageOpenRead(queryClient, "doc-1", {
      queryKey,
      queryFn: () => Promise.resolve({ id: "doc-1" }),
    });
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(queryKey)).toBeTruthy(),
    );
    vi.setSystemTime(Date.now() + PAGE_OPEN_READ_TTL_MS + 1);
    expect(adoptPageOpenRead(queryClient, queryKey)).toBe("none");
  });

  it("retires reads for pages the navigation did not open", async () => {
    const otherKey = ["action", "get-document", { id: "doc-2" }] as const;
    startPageOpenRead(queryClient, "doc-1", {
      queryKey,
      queryFn: () => Promise.resolve({ id: "doc-1" }),
    });
    startPageOpenRead(queryClient, "doc-2", {
      queryKey: otherKey,
      queryFn: () => Promise.resolve({ id: "doc-2" }),
    });
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(otherKey)).toBeTruthy(),
    );

    retirePageOpenReads(queryClient, "doc-2");

    expect(adoptPageOpenRead(queryClient, queryKey)).toBe("none");
    expect(adoptPageOpenRead(queryClient, otherKey)).toBe("fresh");
  });

  describe("a read sent before the session was known", () => {
    const draftKey = [
      "action",
      "get-preview-document-draft",
      { documentId: "doc-1" },
    ] as const;
    const laterKey = ["action", "get-document", { id: "doc-2" }] as const;

    beforeEach(() => session.reset("pending"));

    async function startLandedBeforeSession() {
      const pageRead = vi.fn().mockResolvedValue({ id: "doc-1", by: "a" });
      const draftRead = vi.fn().mockResolvedValue({ draft: "a's draft" });
      startPageOpenRead(queryClient, "doc-1", { queryKey, queryFn: pageRead });
      startPageOpenRead(queryClient, "doc-1", {
        queryKey: draftKey,
        queryFn: draftRead,
      });
      await vi.waitFor(() =>
        expect(queryClient.getQueryData(draftKey)).toBeTruthy(),
      );
      return { pageRead, draftRead };
    }

    function mount(
      key: typeof queryKey | typeof draftKey,
      queryFn: () => unknown,
    ) {
      return new QueryObserver(queryClient, {
        queryKey: key,
        queryFn,
        staleTime: Infinity,
      }).subscribe(() => {});
    }

    it("is adopted when the session is the answer to the load's own session read", async () => {
      await startLandedBeforeSession();
      session.set("first-read");

      expect(adoptPageOpenRead(queryClient, queryKey)).toBe("fresh");
      expect(adoptPageOpenRead(queryClient, draftKey)).toBe("fresh");
    });

    it("is adopted while the session read is still out, and held until it answers", async () => {
      const { pageRead } = await startLandedBeforeSession();

      const claim = claimPageOpenRead(queryClient, queryKey);

      expect(claim.adoption).toBe("fresh");
      expect(isAwaitingSession(claim.read)).toBe(true);
      const unsubscribe = mount(queryKey, pageRead);
      if (!claim.read)
        throw new Error("expected the load's read to be claimed");
      releasePageOpenRead(queryClient, queryKey, claim.read);

      session.set("first-read");

      expect(isAwaitingSession(claim.read)).toBe(false);
      expect(queryClient.getQueryData(queryKey)).toEqual({
        id: "doc-1",
        by: "a",
      });
      expect(pageRead).toHaveBeenCalledTimes(1);
      unsubscribe();
    });

    it("joins a read still in flight while the session read is out", () => {
      const page = deferred<unknown>();
      startPageOpenRead(queryClient, "doc-1", {
        queryKey,
        queryFn: () => page.promise,
      });

      const claim = claimPageOpenRead(queryClient, queryKey);

      expect(claim.adoption).toBe("pending");
      expect(isAwaitingSession(claim.read)).toBe(true);
    });

    it("is dropped and read again under the new session when another read answers after the claim", async () => {
      const { pageRead, draftRead } = await startLandedBeforeSession();
      const claim = claimPageOpenRead(queryClient, queryKey);
      const unsubscribePage = mount(queryKey, () =>
        Promise.resolve({ id: "doc-1", by: "b" }),
      );
      const unsubscribeDraft = mount(draftKey, () =>
        Promise.resolve({ draft: "b's draft" }),
      );
      if (!claim.read)
        throw new Error("expected the load's read to be claimed");
      releasePageOpenRead(queryClient, queryKey, claim.read);

      session.set("replaced");

      // Gone in the same task, before anything behind the session gate shows.
      expect(queryClient.getQueryData(queryKey)).toBeUndefined();
      expect(queryClient.getQueryData(draftKey)).toBeUndefined();
      expect(isAwaitingSession(claim.read)).toBe(false);
      // The component holding it counts the page as read only once it is
      // read again.
      expect(claim.read.readAgain).toBe("pending");
      await vi.waitFor(() =>
        expect(queryClient.getQueryData(queryKey)).toEqual({
          id: "doc-1",
          by: "b",
        }),
      );
      expect(claim.read.readAgain).toBe("landed");
      await vi.waitFor(() =>
        expect(queryClient.getQueryData(draftKey)).toEqual({
          draft: "b's draft",
        }),
      );
      expect(pageRead).toHaveBeenCalledTimes(1);
      expect(draftRead).toHaveBeenCalledTimes(1);
      unsubscribePage();
      unsubscribeDraft();
    });

    it("is dropped with every other one when a later session read answered before the claim", async () => {
      await startLandedBeforeSession();
      session.set("replaced");
      startPageOpenRead(queryClient, "doc-2", {
        queryKey: laterKey,
        queryFn: vi.fn().mockResolvedValue({ id: "doc-2" }),
      });
      await vi.waitFor(() =>
        expect(queryClient.getQueryData(laterKey)).toBeTruthy(),
      );

      expect(adoptPageOpenRead(queryClient, queryKey)).toBe("none");

      expect(queryClient.getQueryData(queryKey)).toBeUndefined();
      expect(queryClient.getQueryData(draftKey)).toBeUndefined();
      expect(isPageOpenRead(queryClient, draftKey)).toBe(false);
      expect(adoptPageOpenRead(queryClient, laterKey)).toBe("fresh");
    });

    it("cancels a read still in flight when another session read answers", async () => {
      const page = deferred<unknown>();
      startPageOpenRead(queryClient, "doc-1", {
        queryKey,
        queryFn: () => page.promise,
      });

      session.set("replaced");
      page.resolve({ id: "doc-1", by: "a" });
      await Promise.resolve();

      expect(queryClient.getQueryData(queryKey)).toBeUndefined();
      expect(isPageOpenRead(queryClient, queryKey)).toBe(false);
    });

    it("is not held when the session answered before it was sent", async () => {
      session.set("first-read");
      startPageOpenRead(queryClient, "doc-1", {
        queryKey,
        queryFn: vi.fn().mockResolvedValue({ id: "doc-1" }),
      });

      expect(
        isAwaitingSession(claimPageOpenRead(queryClient, queryKey).read),
      ).toBe(false);
    });

    it("runs work that waits on the session only when the load's own read keeps the reads", () => {
      const kept = vi.fn();
      whenReadIdentityCurrent(queryClient, sessionReadIdentity(), kept);
      expect(kept).not.toHaveBeenCalled();
      session.set("first-read");
      expect(kept).toHaveBeenCalledTimes(1);

      session.reset("pending");
      const other = new QueryClient();
      const dropped = vi.fn();
      whenReadIdentityCurrent(other, sessionReadIdentity(), dropped);
      session.set("replaced");
      expect(dropped).not.toHaveBeenCalled();
    });

    it("stops watching a page's read once another page opens and its session is this tab's", async () => {
      await startLandedBeforeSession();
      // Another page opens; doc-1's reads are never claimed.
      retirePageOpenReads(queryClient, "doc-2");
      // Still watched: the session that decides whose they are is out.
      expect(session.listeners.size).toBe(1);

      session.set("first-read");

      expect(session.listeners.size).toBe(0);
      expect(queryClient.getQueryData(queryKey)).toEqual({
        id: "doc-1",
        by: "a",
      });
    });

    it("stops watching at once a retired read whose session is already this tab's", async () => {
      await startLandedBeforeSession();
      session.set("first-read");
      expect(session.listeners.size).toBe(1);

      retirePageOpenReads(queryClient, "doc-2");

      expect(session.listeners.size).toBe(0);
    });

    it("still drops a retired read whose session turns out to be someone else's", async () => {
      await startLandedBeforeSession();
      retirePageOpenReads(queryClient, "doc-2");

      session.set("replaced");

      expect(queryClient.getQueryData(queryKey)).toBeUndefined();
      expect(queryClient.getQueryData(draftKey)).toBeUndefined();
      expect(session.listeners.size).toBe(0);
    });

    it("does not run work waiting on the session for a page whose open has ended", () => {
      session.reset("pending");
      const cancelled = vi.fn();
      const otherPage = vi.fn();
      const openedPage = vi.fn();
      const cancel = whenReadIdentityCurrent(
        queryClient,
        sessionReadIdentity(),
        cancelled,
        { documentId: "doc-1" },
      );
      whenReadIdentityCurrent(queryClient, sessionReadIdentity(), otherPage, {
        documentId: "doc-2",
      });
      whenReadIdentityCurrent(queryClient, sessionReadIdentity(), openedPage, {
        documentId: "doc-3",
      });

      cancel();
      // Another page is opened.
      retirePageOpenReads(queryClient, "doc-3");
      session.set("first-read");

      expect(cancelled).not.toHaveBeenCalled();
      expect(otherPage).not.toHaveBeenCalled();
      expect(openedPage).toHaveBeenCalledTimes(1);
    });
  });
});
