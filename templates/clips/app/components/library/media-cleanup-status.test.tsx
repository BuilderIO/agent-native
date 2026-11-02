// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";

import { MediaCleanupStatus } from "./media-cleanup-status";

type QueryOptions = {
  refetchInterval?: (query: {
    state: { data?: { cleanups: unknown[] } };
  }) => number | false;
};

const mocks = vi.hoisted(() => ({
  query: {
    data: undefined as { cleanups: unknown[] } | undefined,
    isError: false,
  },
  queryOptions: undefined as QueryOptions | undefined,
  retry: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (_action: string, _input: unknown, options: QueryOptions) => {
    mocks.queryOptions = options;
    return { ...mocks.query, isFetching: false, refetch: vi.fn() };
  },
  useActionMutation: () => ({ mutateAsync: mocks.retry }),
}));

// Resolves keys against the real English catalog so copy changes show up here.
vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () =>
    (key: string, values?: Record<string, string | number | undefined>) => {
      const found = key
        .split(".")
        .reduce<unknown>(
          (node, part) =>
            node && typeof node === "object"
              ? (node as Record<string, unknown>)[part]
              : undefined,
          messages,
        );
      if (typeof found !== "string") throw new Error(`Missing copy: ${key}`);
      return found.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(values?.[name] ?? ""),
      );
    },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

const record = (
  status: string,
  reason: string | null = null,
  id = `rec-${status}`,
) => ({
  id,
  recordingId: id,
  status,
  pending: status === "pending" ? 1 : 0,
  blocked: status === "blocked" ? 1 : 0,
  deleted: status === "complete" ? 2 : 0,
  retained: status === "retained_shared" ? 1 : 0,
  reason,
  createdAt: "2026-10-28T10:00:00.000Z",
  updatedAt: "2026-10-28T10:05:00.000Z",
});

const BLOCKED_TITLE = "Media files from deleted recordings couldn't be removed";
const RECONNECT =
  "Reconnect storage to remove media files from deleted recordings";
const PENDING_TITLE = "Removing media files from deleted recordings";
const RETAINED_TITLE =
  "Shared media files from deleted recordings are kept while other recordings use them";

const retryButton = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Retry",
  );

describe("MediaCleanupStatus", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let invalidate: ReturnType<typeof vi.spyOn>;

  const render = () =>
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MediaCleanupStatus />
        </QueryClientProvider>,
      );
    });

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.clearAllMocks();
    mocks.query = { data: undefined, isError: false };
    mocks.queryOptions = undefined;
    queryClient = new QueryClient();
    invalidate = vi.spyOn(queryClient, "invalidateQueries");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps a blocked cleanup after a retry the server still reports blocked", async () => {
    mocks.query.data = { cleanups: [record("blocked")] };
    mocks.retry.mockResolvedValue({
      status: "blocked",
      pending: 0,
      blocked: 1,
      deleted: 0,
      retained: 0,
    });
    render();
    expect(container.textContent).toContain(BLOCKED_TITLE);

    await act(async () => retryButton(container)?.click());

    expect(mocks.retry).toHaveBeenCalledWith({ id: "rec-blocked" });
    expect(toast.warning).toHaveBeenCalledWith(
      "Media files still couldn't be removed",
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["action", "list-recording-media-cleanups"],
    });
    expect(container.textContent).toContain(BLOCKED_TITLE);
  });

  it("retries blocked cleanups one at a time and acknowledges the click at once", async () => {
    mocks.query.data = {
      cleanups: [
        record("blocked", null, "cleanup-1"),
        record("blocked", null, "cleanup-2"),
        record("retained_shared"),
      ],
    };
    const settle: Array<(value: unknown) => void> = [];
    mocks.retry.mockImplementation(
      () => new Promise((resolve) => settle.push(resolve)),
    );
    render();

    await act(async () => retryButton(container)?.click());

    expect(container.textContent).toContain(PENDING_TITLE);
    expect(container.textContent).not.toContain(BLOCKED_TITLE);
    expect(mocks.retry).toHaveBeenCalledTimes(1);
    expect(mocks.retry).toHaveBeenLastCalledWith({ id: "cleanup-1" });

    const settleFirst = settle.shift();
    if (!settleFirst) throw new Error("Expected first retry to be pending");
    await act(async () =>
      settleFirst({ ...record("complete"), id: "cleanup-1" }),
    );
    expect(mocks.retry).toHaveBeenCalledTimes(2);
    expect(mocks.retry).toHaveBeenLastCalledWith({ id: "cleanup-2" });

    const settleSecond = settle.shift();
    if (!settleSecond) throw new Error("Expected second retry to be pending");
    await act(async () =>
      settleSecond({ ...record("complete"), id: "cleanup-2" }),
    );
    expect(mocks.retry).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith("Media files removed");
  });

  it("shows kept shared media without claiming removal or offering a retry", () => {
    mocks.query.data = { cleanups: [record("retained_shared")] };
    render();

    expect(container.textContent).toBe(RETAINED_TITLE);
    expect(retryButton(container)).toBeUndefined();
    expect(container.querySelector(".text-destructive")).toBeNull();
  });

  it.each([
    ["credential_unavailable", RECONNECT],
    ["credential_space_mismatch", RECONNECT],
    ["provider_rejected", BLOCKED_TITLE],
  ])("asks to reconnect only for credential failures (%s)", (reason, title) => {
    mocks.query.data = { cleanups: [record("blocked", reason)] };
    render();

    expect(container.textContent).toBe(`${title}Retry`);
  });

  it.each([
    [
      "unreadable",
      { data: undefined, isError: true },
      "Couldn't load media removal statusRetry",
    ],
    [
      "finished",
      { data: { cleanups: [record("complete")] }, isError: false },
      "",
    ],
  ])("tells an %s status apart from nothing to show", (_, query, text) => {
    mocks.query = query;
    render();

    expect(container.textContent).toBe(text);
  });

  it("polls until cleanup is complete, slowly while blocked or kept", () => {
    render();
    const interval = (cleanups: unknown[]) =>
      mocks.queryOptions?.refetchInterval?.({ state: { data: { cleanups } } });

    expect(interval([record("pending"), record("blocked")])).toBe(10_000);
    expect(interval([record("blocked")])).toBe(60_000);
    expect(interval([record("retained_shared")])).toBe(60_000);
    expect(interval([record("complete")])).toBe(false);
  });
});
