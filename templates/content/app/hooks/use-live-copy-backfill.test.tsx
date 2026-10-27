// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutation = vi.hoisted(() => ({
  mutate: vi.fn(),
  options: undefined as
    | {
        onSuccess?: (data: unknown, variables: { id: string }) => unknown;
        onError?: (error: unknown, variables: { id: string }) => unknown;
      }
    | undefined,
}));
const captureError = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: (_name: string, options: typeof mutation.options) => {
    mutation.options = options;
    return { mutate: mutation.mutate };
  },
}));
vi.mock("@agent-native/core/client/analytics", () => ({ captureError }));

import { useConvertPageToLiveCopyOnOpen } from "./use-live-copy-backfill";

let root: Root;
let container: HTMLElement;
let queryClient: QueryClient;

function Page({ id, enabled }: { id: string; enabled: boolean }) {
  useConvertPageToLiveCopyOnOpen(id, enabled);
  return <p>{`Page ${id}`}</p>;
}

function render(id: string, enabled: boolean) {
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Page id={id} enabled={enabled} />
      </QueryClientProvider>,
    );
  });
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mutation.mutate.mockReset();
  mutation.options = undefined;
  captureError.mockReset();
  queryClient = new QueryClient();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("useConvertPageToLiveCopyOnOpen", () => {
  it("asks once per page it opens, and not while it's off", () => {
    render("page-1", false);
    expect(mutation.mutate).not.toHaveBeenCalled();

    render("page-1", true);
    render("page-1", true);
    expect(mutation.mutate).toHaveBeenCalledTimes(1);
    expect(mutation.mutate).toHaveBeenLastCalledWith({ id: "page-1" });

    render("page-2", true);
    expect(mutation.mutate).toHaveBeenCalledTimes(2);
    expect(mutation.mutate).toHaveBeenLastCalledWith({ id: "page-2" });
  });

  it("keeps the page open, and logs and reports a failed switch", () => {
    render("page-1", true);
    const failure = Object.assign(new Error("The switch broke."), {
      errorCode: "LIVE_BODY_BACKFILL_FAILED",
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      act(() => {
        mutation.options?.onError?.(failure, { id: "page-1" });
      });

      expect(logged).toHaveBeenCalledWith(
        "[live-copy] Page page-1 couldn't switch to its live copy:",
        failure,
      );
    } finally {
      logged.mockRestore();
    }
    expect(captureError).toHaveBeenCalledWith(failure, {
      tags: { feature: "content-live-body-backfill", documentId: "page-1" },
    });
    expect(container.textContent).toBe("Page page-1");
  });

  it("refetches the page's reads, and the collection rows that list it, only when it switched", async () => {
    const page = ["action", "get-document", { id: "page-1" }];
    const otherPage = ["action", "get-document", { id: "page-2" }];
    const filesRows = [
      "action",
      "query-content-database-items",
      { databaseId: "files" },
    ];
    const otherRows = [
      "action",
      "query-content-database-items",
      { databaseId: "notes" },
    ];
    const excerpts = [
      "action",
      "get-content-database",
      { databaseId: "files" },
    ];
    queryClient.setQueryData(page, { id: "page-1" });
    queryClient.setQueryData(otherPage, { id: "page-2" });
    queryClient.setQueryData(filesRows, {
      items: [{ document: { id: "page-1" } }],
    });
    queryClient.setQueryData(otherRows, {
      items: [{ document: { id: "page-2" } }],
    });
    queryClient.setQueryData(excerpts, {
      items: [{ document: { id: "page-1" }, excerpt: "The old body." }],
    });
    render("page-1", true);
    const invalidated = (key: unknown[]) =>
      queryClient.getQueryState(key)?.isInvalidated;

    await mutation.options?.onSuccess?.(
      { id: "page-1", status: "skipped" },
      { id: "page-1" },
    );
    for (const key of [page, filesRows, excerpts]) {
      expect(invalidated(key)).toBe(false);
    }

    await mutation.options?.onSuccess?.(
      { id: "page-1", status: "converted" },
      { id: "page-1" },
    );
    for (const key of [page, filesRows, excerpts]) {
      expect(invalidated(key)).toBe(true);
    }
    expect(invalidated(otherPage)).toBe(false);
    expect(invalidated(otherRows)).toBe(false);
  });

  it("refetches the page's reads when it switched before its gate moved, and not when it was deferred unswitched", async () => {
    const page = ["action", "get-document", { id: "page-1" }];
    queryClient.setQueryData(page, { id: "page-1" });
    render("page-1", true);

    await mutation.options?.onSuccess?.(
      { id: "page-1", status: "deferred", reason: "live_edits" },
      { id: "page-1" },
    );
    expect(queryClient.getQueryState(page)?.isInvalidated).toBe(false);

    await mutation.options?.onSuccess?.(
      {
        id: "page-1",
        status: "deferred",
        reason: "gate_moved",
        gate: "flag_off",
      },
      { id: "page-1" },
    );
    expect(queryClient.getQueryState(page)?.isInvalidated).toBe(true);
  });
});
