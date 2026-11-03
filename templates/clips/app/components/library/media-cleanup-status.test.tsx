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
  toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
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

// Every file-removal check finished; only the storage usage update is owed.
const usageOnly = (id = "rec-usage") => ({
  ...record("blocked", "accounting_unavailable", id),
  blocked: 0,
  deleted: 2,
});

const PENDING_TITLE = "Deletion checks in progress";
const UNCONFIRMED_TITLE = "Couldn't confirm video file deletion";
const USAGE_TITLE = "Storage usage update needs a retry";
const RECONNECT =
  "Reconnect storage to remove media files from deleted recordings";
const RETAINED_TITLE =
  "Shared media files from deleted recordings are kept while other recordings use them";
const RETRY_REMOVAL = "Retry removal";
const RETRY_USAGE = "Retry usage update";
const PENDING_HELP =
  "Clips continues checking in the background. You can leave this page and check Trash for updates.";
const UNCONFIRMED_HELP =
  "Stored video files may still exist. Retry removal starts another attempt. You can leave this page and check Trash for the result.";
const USAGE_HELP =
  "File-removal checks finished, but this video may still count toward your storage limit. Retry usage update to update your storage total.";

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

  const button = (label: string) =>
    Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
  const rows = () =>
    Array.from(container.querySelectorAll<HTMLElement>('[role="listitem"]'));
  const row = (position: number) =>
    container.querySelector<HTMLElement>(
      `[role="listitem"]:nth-child(${position})`,
    );
  // The spinner carries its own <style>, which is not text anyone sees.
  const shown = (element: Element | null) => {
    const copy = element?.cloneNode(true);
    if (!(copy instanceof Element)) return "";
    copy.querySelectorAll("style").forEach((style) => style.remove());
    return copy.textContent;
  };
  const click = (element: HTMLElement | null | undefined) =>
    act(async () => {
      if (!element) throw new Error("Expected an element to click");
      element.click();
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

  it("retries only the cleanups behind the clicked button", async () => {
    mocks.query.data = {
      cleanups: [
        record("blocked", "retry_exhausted", "cleanup-files"),
        usageOnly("cleanup-usage"),
      ],
    };
    mocks.retry.mockImplementation(async ({ id }: { id: string }) =>
      id === "cleanup-usage"
        ? usageOnly(id)
        : record("blocked", "retry_exhausted", id),
    );
    render();

    await click(row(2)?.querySelector<HTMLElement>("button:not([aria-label])"));
    expect(mocks.retry.mock.calls).toEqual([[{ id: "cleanup-usage" }]]);

    mocks.retry.mockClear();
    await click(row(1)?.querySelector<HTMLElement>("button:not([aria-label])"));
    expect(mocks.retry.mock.calls).toEqual([[{ id: "cleanup-files" }]]);

    expect(rows().map(shown)).toEqual([
      `${UNCONFIRMED_TITLE}${RETRY_REMOVAL}`,
      `${USAGE_TITLE}${RETRY_USAGE}`,
    ]);
  });

  it("disables both retries and names the running one while it is in flight", async () => {
    mocks.query.data = {
      cleanups: [
        record("blocked", "retry_exhausted", "cleanup-files"),
        usageOnly("cleanup-usage"),
      ],
    };
    const settle: Array<(value: unknown) => void> = [];
    mocks.retry.mockImplementation(
      () => new Promise((resolve) => settle.push(resolve)),
    );
    render();

    await click(button(RETRY_USAGE));

    expect(shown(row(2))).toBe(`Retrying storage usage update${RETRY_USAGE}`);
    expect(row(2)?.querySelector('[role="status"]')).not.toBeNull();
    expect(shown(row(1))).toBe(`${UNCONFIRMED_TITLE}${RETRY_REMOVAL}`);
    expect(button(RETRY_USAGE)?.disabled).toBe(true);
    expect(button(RETRY_REMOVAL)?.disabled).toBe(true);
    await click(button(RETRY_REMOVAL));
    expect(mocks.retry).toHaveBeenCalledTimes(1);

    const settleUsage = settle.shift();
    if (!settleUsage) throw new Error("Expected the usage retry to be pending");
    await act(async () => settleUsage(usageOnly("cleanup-usage")));

    expect(toast.info).toHaveBeenCalledWith(
      "Storage usage update still needs a retry",
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(button(RETRY_USAGE)?.disabled).toBe(false);
    expect(button(RETRY_REMOVAL)?.disabled).toBe(false);

    await click(button(RETRY_REMOVAL));
    expect(shown(row(1))).toBe(`Retrying video file deletion${RETRY_REMOVAL}`);
    expect(row(1)?.querySelector('[role="status"]')).not.toBeNull();
    expect(button(RETRY_USAGE)?.disabled).toBe(true);
  });

  it.each([
    ["pending", [record("pending")], PENDING_TITLE, PENDING_HELP],
    [
      "unconfirmed",
      [record("blocked", "retry_exhausted")],
      `${UNCONFIRMED_TITLE}${RETRY_REMOVAL}`,
      UNCONFIRMED_HELP,
    ],
    ["usage", [usageOnly()], `${USAGE_TITLE}${RETRY_USAGE}`, USAGE_HELP],
  ])(
    "keeps the %s explanation in a help popover, not under the title",
    async (_, cleanups, text, help) => {
      mocks.query.data = { cleanups };
      render();

      expect(shown(container)).toBe(text);
      expect(document.body.textContent).not.toContain(help);

      const helpButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="More info"]',
      );
      expect(helpButton?.querySelector(".tabler-icon-help-circle")).not.toBe(
        null,
      );
      await click(helpButton);

      expect(document.body.textContent).toContain(help);
    },
  );

  it("marks the usage update with a neutral usage icon, not a question or success", () => {
    mocks.query.data = {
      cleanups: [record("blocked", "retry_exhausted"), usageOnly()],
    };
    render();

    expect(row(1)?.querySelector(".tabler-icon-cloud-question")).not.toBe(null);
    expect(row(2)?.querySelector(".tabler-icon-gauge")).not.toBe(null);
    expect(row(2)?.querySelector(".tabler-icon-cloud-question")).toBe(null);
    expect(row(2)?.querySelector('[class*="tabler-icon-circle-check"]')).toBe(
      null,
    );
    expect(container.querySelector(".text-destructive")).toBeNull();
  });

  it("keeps a blocked cleanup after a retry the server still reports blocked", async () => {
    mocks.query.data = { cleanups: [record("blocked", "retry_exhausted")] };
    mocks.retry.mockResolvedValue(record("blocked", "retry_exhausted"));
    render();
    expect(container.textContent).toContain(UNCONFIRMED_TITLE);

    await click(button(RETRY_REMOVAL));

    expect(mocks.retry).toHaveBeenCalledWith({ id: "rec-blocked" });
    expect(toast.info).toHaveBeenCalledWith(
      "Still couldn't confirm video file deletion",
    );
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["action", "list-recording-media-cleanups"],
    });
    expect(container.textContent).toContain(UNCONFIRMED_TITLE);
  });

  it("reports a retry request that failed and lets it be tried again", async () => {
    mocks.query.data = { cleanups: [usageOnly()] };
    mocks.retry.mockRejectedValue(
      new Error("Media cleanup is already running"),
    );
    render();

    await click(button(RETRY_USAGE));

    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't start the retry. Try again.",
    );
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["action", "list-recording-media-cleanups"],
    });
    expect(button(RETRY_USAGE)?.disabled).toBe(false);
  });

  it("asks to reconnect when a retry is still missing storage credentials", async () => {
    mocks.query.data = {
      cleanups: [record("blocked", "credential_unavailable")],
    };
    mocks.retry.mockResolvedValue(record("blocked", "credential_unavailable"));
    render();

    await click(button(RETRY_REMOVAL));

    expect(toast.warning).toHaveBeenCalledWith(RECONNECT);
    expect(toast.info).not.toHaveBeenCalled();
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

    await click(button(RETRY_REMOVAL));

    expect(container.textContent).toContain("Retrying video file deletion");
    expect(container.textContent).not.toContain(UNCONFIRMED_TITLE);
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
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector(".text-destructive")).toBeNull();
  });

  it.each([
    ["credential_unavailable", RECONNECT, true],
    ["credential_space_mismatch", RECONNECT, true],
    ["retry_exhausted", UNCONFIRMED_TITLE, false],
    ["delete_unconfirmed", UNCONFIRMED_TITLE, false],
    ["accounting_unavailable", UNCONFIRMED_TITLE, false],
    [null, UNCONFIRMED_TITLE, false],
  ])(
    "flags only missing credentials as a failure (%s)",
    (reason, title, alarming) => {
      mocks.query.data = { cleanups: [record("blocked", reason)] };
      render();

      expect(container.textContent).toBe(`${title}${RETRY_REMOVAL}`);
      expect(container.querySelector(".text-destructive") !== null).toBe(
        alarming,
      );
    },
  );

  it("shows cleanup still being checked without a retry or a claim about the files", () => {
    mocks.query.data = { cleanups: [record("pending")] };
    render();

    expect(shown(container)).toBe(PENDING_TITLE);
    expect(button(RETRY_REMOVAL)).toBeUndefined();
    expect(button(RETRY_USAGE)).toBeUndefined();
    expect(container.querySelector(".text-destructive")).toBeNull();
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
    expect(interval([usageOnly()])).toBe(60_000);
    expect(interval([record("retained_shared")])).toBe(60_000);
    expect(interval([record("complete")])).toBe(false);
  });
});
