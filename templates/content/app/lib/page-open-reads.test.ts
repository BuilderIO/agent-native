import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  adoptPageOpenRead,
  PAGE_OPEN_READ_TTL_MS,
  retirePageOpenReads,
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
