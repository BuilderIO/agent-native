// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => undefined),
  mutateAsync: vi.fn(async () => ({ id: "thread-1", deleted: true })),
  notify: vi.fn(),
  threads: [] as Array<Record<string, unknown>>,
  loading: false,
  error: null as string | null,
  orgRefetch: vi.fn(async () => undefined),
  org: {
    data: { orgId: "org-1" } as { orgId: string } | undefined,
    isPending: false,
    isError: false,
  },
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  notifyChatThreadsUpdated: mocks.notify,
  useChatThreadList: () => ({
    threads: mocks.threads,
    loading: mocks.loading,
    loadingMore: false,
    error: mocks.error,
    hasMore: false,
    loadMore: vi.fn(),
    refresh: mocks.refresh,
  }),
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({
    data: mocks.org.data,
    isPending: mocks.org.isPending,
    isError: mocks.org.isError,
    refetch: mocks.orgRefetch,
  }),
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    status: "authenticated",
    session: { email: "viewer@example.test" },
  }),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  currentActionQueryCacheBinding: () => undefined,
  useActionQueryCanFetch: () => true,
  runActionQueryRead: (
    _client: unknown,
    _key: unknown,
    _signal: unknown,
    read: (onResponse: (response: Response) => void) => unknown,
  ) => read(() => {}),
  actionErrorMessage: () => undefined,
  useActionMutation: () => ({ mutateAsync: mocks.mutateAsync }),
  callAction: async () => ({ creators: [] }),
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, options?: Record<string, unknown>) => {
    const value = key
      .split(".")
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === "object"
            ? (node as Record<string, unknown>)[part]
            : undefined,
        messages,
      );
    return typeof value === "string"
      ? value.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
          String(options?.[name]),
        )
      : key;
  },
}));

import messages from "@/i18n/en-US";

import { ThreadsPage } from "./ThreadsPage";

function pointerDown(element: HTMLElement) {
  element.dispatchEvent(
    new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
  );
}

/**
 * Row 482: a thread row offered no delete at all, so a teammate could not remove
 * a conversation from the only list that shows them (and QA residue could not be
 * cleaned). The row menu now carries Delete thread for a thread the viewer owns.
 */
describe("threads page", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.mutateAsync.mockResolvedValue({ id: "thread-1", deleted: true });
    mocks.loading = false;
    mocks.error = null;
    mocks.org = {
      data: { orgId: "org-1" },
      isPending: false,
      isError: false,
    };
    mocks.orgRefetch.mockClear();
    mocks.threads = [
      {
        id: "thread-1",
        title: "Revenue by channel",
        ownerEmail: "owner@example.test",
        updatedAt: Date.parse("2026-11-08T10:00:00.000Z"),
        accessBasis: "owner",
      },
      {
        id: "thread-2",
        title: "Someone else's chat",
        ownerEmail: "other@example.test",
        updatedAt: Date.parse("2026-11-08T09:00:00.000Z"),
        accessBasis: "shared",
      },
    ];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    mocks.mutateAsync.mockClear();
    mocks.refresh.mockClear();
    mocks.notify.mockClear();
  });

  const render = () =>
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <ThreadsPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

  it("lists a row per conversation with its title", () => {
    render();
    expect(host.textContent).toContain("Revenue by channel");
    expect(host.textContent).toContain("Someone else's chat");
  });

  it("shows the empty state, not a row and not a Title sort, with no conversations", () => {
    // Row 120: a brand-new account must land on the empty state (icon, "No threads
    // yet", a line saying what the list is for) and the list must carry no sort
    // arrow on Title, because there is no table here to sort.
    mocks.threads = [];
    render();
    expect(host.textContent).toContain("No threads yet");
    expect(host.textContent).toContain(
      "Ask a question about your data and the conversation is kept here",
    );
    expect(host.querySelector("svg")).not.toBeNull();
    expect(host.querySelector("th")).toBeNull();
    expect(host.textContent).not.toContain("Revenue by channel");
  });

  it("offers delete only on the thread the viewer owns", () => {
    render();
    const labels = [...host.querySelectorAll("button")].map(
      (button) => button.getAttribute("aria-label") ?? "",
    );
    expect(labels).toContain("Actions for Revenue by channel");
    expect(labels).not.toContain("Actions for Someone else's chat");
  });

  it("report A2-THREAD-RENAME: renames an owned thread through its menu", async () => {
    render();
    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Actions for Revenue by channel"]',
    );
    if (!trigger) throw new Error("Missing actions");
    await act(async () => pointerDown(trigger));
    const rename = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ].find((item) => item.textContent?.trim() === "Rename");
    expect(rename).toBeDefined();
    await act(async () => rename?.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const input = dialog?.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("Missing title input");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(input, "Renamed revenue");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    mocks.mutateAsync.mockRejectedValueOnce(new Error("write failed"));
    const form = dialog?.querySelector("form");
    if (!form) throw new Error("Missing rename form");
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(
      document.querySelector('[role="dialog"] [role="alert"]')?.textContent,
    ).toContain("could not be renamed");
    expect(input.value).toBe("Renamed revenue");
    expect(mocks.refresh).not.toHaveBeenCalled();
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(mocks.mutateAsync).toHaveBeenLastCalledWith({
      threadId: "thread-1",
      title: "Renamed revenue",
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("report A2-THREAD-DELETE-CONFIRM: confirms deletion and refreshes after success", async () => {
    render();
    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Actions for Revenue by channel"]',
    );
    if (!trigger) throw new Error("Owner actions trigger was not rendered.");
    await act(async () => {
      pointerDown(trigger);
    });
    await act(async () => {
      [...document.querySelectorAll<HTMLElement>("[role=menuitem]")]
        .find((item) => item.textContent?.trim() === "Delete")
        ?.click();
    });
    expect(
      document.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain("Confirm delete");
    expect(
      document.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain("Are you sure you want to delete this thread?");
    await act(async () => {
      [...document.body.querySelectorAll("button")]
        .filter((button) => button.textContent?.trim() === "Delete")
        .at(-1)
        ?.click();
      await Promise.resolve();
    });
    expect(mocks.mutateAsync).toHaveBeenCalledWith({ threadId: "thread-1" });
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("report A2-FIND-1120F-S5-8: renders title icon, row icons, and no extra subtitle", () => {
    render();
    expect(host.textContent).not.toContain(
      "Every conversation with Analytics, newest first.",
    );
    const header = host.querySelector("header");
    expect(header?.querySelector("svg")).not.toBeNull();
    const tableRows = [
      ...host.querySelectorAll('[role="table"] [role="row"]'),
    ].slice(1);
    expect(tableRows.length).toBe(2);
    for (const row of tableRows) {
      expect(row.querySelector("svg")).not.toBeNull();
    }
  });

  it("report A2-FIND-1120F-S5-8: renders header and row checkboxes with selection controls", async () => {
    render();
    const selectAll = host.querySelector<HTMLButtonElement>(
      '[role="columnheader"] button[role="checkbox"]',
    );
    expect(selectAll).not.toBeNull();
    const rowCheckboxes = [
      ...host.querySelectorAll<HTMLButtonElement>(
        '[role="table"] [role="row"] [role="cell"] button[role="checkbox"]',
      ),
    ];
    expect(rowCheckboxes).toHaveLength(2);
    expect(
      [...host.querySelectorAll('[role="columnheader"]')].map((header) =>
        header.textContent?.trim(),
      ),
    ).toEqual(["Title", "Last Updated", "Creator"]);

    await act(async () => {
      rowCheckboxes[0]?.click();
    });
    expect(rowCheckboxes[0]?.getAttribute("aria-checked")).toBe("true");
    expect(rowCheckboxes[1]?.getAttribute("aria-checked")).toBe("false");
    expect(selectAll?.getAttribute("aria-checked")).toBe("mixed");
    expect(host.textContent).toContain("1 loaded rows selected");

    await act(async () => {
      selectAll?.click();
    });
    expect(rowCheckboxes[0]?.getAttribute("aria-checked")).toBe("true");
    expect(rowCheckboxes[1]?.getAttribute("aria-checked")).toBe("true");
    expect(selectAll?.getAttribute("aria-checked")).toBe("true");
    expect(host.textContent).toContain("2 loaded rows selected");

    const deselect = [
      ...host.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.trim() === "Deselect all");
    expect(deselect).toBeDefined();
    await act(async () => {
      deselect?.click();
    });
    expect(rowCheckboxes[0]?.getAttribute("aria-checked")).toBe("false");
    expect(rowCheckboxes[1]?.getAttribute("aria-checked")).toBe("false");
    expect(selectAll?.getAttribute("aria-checked")).toBe("false");
  });

  it("offers retry when loading threads fails", async () => {
    mocks.error = "Network failed";
    render();
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("There was an error loading threads.");
    const retry = [...(alert?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === "Retry",
    );
    expect(retry).toBeDefined();
    await act(async () => {
      retry?.click();
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("shows error with retry instead of empty state when organization fails to load", async () => {
    mocks.threads = [];
    mocks.org = { data: undefined, isPending: false, isError: true };
    render();
    expect(host.textContent).not.toContain("No threads yet");
    const alert = host.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    const retry = [...(alert?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === "Retry",
    );
    expect(retry).toBeDefined();
    await act(async () => {
      retry?.click();
    });
    expect(mocks.orgRefetch).toHaveBeenCalledOnce();
  });

  it("shows loading instead of empty state while organization is pending", () => {
    mocks.threads = [];
    mocks.org = { data: undefined, isPending: true, isError: false };
    render();
    expect(host.textContent).toContain("Loading threads…");
    expect(host.textContent).not.toContain("No threads yet");
  });

  it("uses responsive columns on narrow viewports so thread titles do not collapse", () => {
    render();
    const headerRow = host.querySelector('[role="table"] [role="row"]');
    expect(headerRow?.className).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(headerRow?.className).toContain(
      "sm:grid-cols-[minmax(0,22.5rem)_10rem_minmax(10rem,1fr)]",
    );
    const creatorHeader = host.querySelectorAll('[role="columnheader"]')[2];
    expect(creatorHeader?.className).toContain("hidden");
    expect(creatorHeader?.className).toContain("sm:block");
  });
});

// oracle-change: test-audit campaign removed whole low-value tests, see PR 498
