import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { contentActionInvalidatePredicate } from "../hooks/content-action-refresh";
import {
  adoptPageOpenRead,
  claimPageOpenRead,
  isPageOpenRead,
  PAGE_OPEN_READ_TTL_MS,
  releasePageOpenRead,
  retirePageOpenReads,
  spoilPageOpenReads,
  startPageOpenRead,
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
});
