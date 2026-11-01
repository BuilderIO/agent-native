// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const mocks = vi.hoisted(() => ({
  startupSettled: false,
  fetchUrls: [] as string[],
  answerStatus: null as null | ((body: unknown, status?: number) => void),
}));

vi.mock("@agent-native/toolkit/clipboard", () => ({
  writeClipboardText: vi.fn(async () => true),
}));
vi.mock("@agent-native/core/client/analytics", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/analytics")
  >()),
  trackEvent: vi.fn(),
}));
vi.mock(
  "@agent-native/core/client/use-after-paint",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/client/use-after-paint")
    >()),
    useAfterStartup: () => mocks.startupSettled,
  }),
);
vi.mock("@agent-native/core/client/mcp-app-host", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/client/mcp-app-host")
  >()),
  useIsMcpAppWidgetEmbed: () => false,
  useIsMcpDirectoryWidgetReadOnlyEmbed: () => false,
  useIsMcpDirectoryWidgetWriteEmbed: () => false,
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
  useLocale: () => ({ locale: "en-US" }),
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@agent-native/toolkit/app/sharing", () => ({
  ShareButton: () => null,
}));

import { DocumentToolbar } from "./DocumentToolbar";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("DocumentToolbar's Notion item before the sync status loads", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  async function renderToolbar() {
    await act(async () =>
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(
            TooltipProvider,
            null,
            createElement(
              QueryClientProvider,
              { client: queryClient },
              createElement(DocumentToolbar, {
                documentId: "notion-fixture",
                documentTitle: "Roadmap",
                utilityPanel: null,
                onUtilityPanelChange: vi.fn(),
                readOnly: false,
                canEdit: true,
              }),
            ),
          ),
        ),
      ),
    );
    await act(async () => Promise.resolve());
  }

  async function openPageActions() {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="editor.toolbar.morePageActions"]',
    );
    if (!trigger) throw new Error("no page actions trigger");
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
    });
    await act(async () => Promise.resolve());
  }

  function notionItem() {
    return Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) =>
      [
        "editor.toolbar.notionSync",
        "editor.toolbar.linkToNotion",
        "editor.toolbar.connectNotion",
      ].includes(button.textContent.trim()),
    );
  }

  function answerStatus(body: unknown, status?: number) {
    const answer = mocks.answerStatus;
    if (!answer) throw new Error("the sync status wasn't requested");
    mocks.answerStatus = null;
    answer(body, status);
  }

  function statusRequests() {
    return mocks.fetchUrls.filter((url) =>
      url.includes("refresh-notion-sync-status"),
    );
  }

  beforeEach(() => {
    mocks.startupSettled = false;
    mocks.fetchUrls.length = 0;
    mocks.answerStatus = null;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const href = String(input);
        if (href.includes("/_agent-native/actions/get-actions-batch")) {
          const { requests } = JSON.parse(String(init?.body)) as {
            requests: Array<{ action: string; query: string }>;
          };
          for (const { action } of requests) {
            mocks.fetchUrls.push(`/_agent-native/actions/${action}`);
          }
          return json({
            results: requests.map(({ action }) => ({
              status: 200,
              body:
                action === "connect-notion-status"
                  ? { connected: true }
                  : action === "search-notion-pages"
                    ? { results: [] }
                    : {},
            })),
          });
        }
        mocks.fetchUrls.push(href);
        if (href.includes("connect-notion-status")) {
          return json({ connected: true });
        }
        if (href.includes("search-notion-pages")) {
          return json({ results: [] });
        }
        if (href.includes("refresh-notion-sync-status")) {
          return new Promise<Response>((resolve) => {
            mocks.answerStatus = (body, status) => resolve(json(body, status));
          });
        }
        return json({});
      }),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("asks for the status when the page actions open, and offers no link form until it answers", async () => {
    await renderToolbar();
    expect(statusRequests()).toEqual([]);

    await openPageActions();

    expect(statusRequests()).toHaveLength(1);
    const waiting = notionItem();
    expect(waiting?.textContent.trim()).toBe("editor.toolbar.notionSync");
    expect(waiting?.disabled).toBe(true);
    // A spinner shows the item is checking Notion, not out of reach.
    expect(waiting?.getAttribute("aria-busy")).toBe("true");
    expect(waiting?.querySelector(".animate-spin")).not.toBeNull();
    expect(document.body.textContent).not.toContain(
      "editor.toolbar.linkToNotion",
    );

    await act(async () =>
      answerStatus({
        connected: true,
        pageId: "notion-page-1",
        pageUrl: "https://www.notion.so/notionpage1",
        state: "idle",
        hasConflict: false,
      }),
    );
    await vi.waitFor(() => expect(notionItem()?.disabled).toBe(false));

    expect(notionItem()?.textContent.trim()).toBe("editor.toolbar.notionSync");
    expect(notionItem()?.hasAttribute("aria-busy")).toBe(false);
    expect(notionItem()?.querySelector(".animate-spin")).toBeNull();
  });

  it("offers the link once the status says the page isn't linked", async () => {
    await renderToolbar();
    await openPageActions();
    expect(notionItem()?.disabled).toBe(true);

    await act(async () =>
      answerStatus({
        connected: true,
        pageId: null,
        hasConflict: false,
      }),
    );
    await vi.waitFor(() => expect(notionItem()?.disabled).toBe(false));

    expect(notionItem()?.textContent.trim()).toBe(
      "editor.toolbar.linkToNotion",
    );
  });

  it("stops offering the link when a later status read fails, until a retry succeeds", async () => {
    const unlinked = { connected: true, pageId: null, hasConflict: false };
    await renderToolbar();
    await openPageActions();
    await act(async () => answerStatus(unlinked));
    await vi.waitFor(() =>
      expect(notionItem()?.textContent.trim()).toBe(
        "editor.toolbar.linkToNotion",
      ),
    );

    // The link form is open when a background refetch fails: the cached
    // "unlinked" answer may be stale, so the form closes.
    await act(async () => notionItem()?.click());
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain(
        "editor.toolbar.linkToNotionPage",
      ),
    );
    await act(async () => {
      void queryClient.refetchQueries({
        queryKey: ["action", "refresh-notion-sync-status"],
      });
    });
    await vi.waitFor(() => expect(statusRequests()).toHaveLength(2));
    await act(async () =>
      answerStatus({ error: "Notion is unavailable" }, 500),
    );
    await vi.waitFor(() => expect(notionItem()?.disabled).toBe(true));
    expect(notionItem()?.textContent.trim()).toBe("editor.toolbar.notionSync");
    await vi.waitFor(() =>
      expect(document.body.textContent).not.toContain(
        "editor.toolbar.linkToNotion",
      ),
    );

    // Reopening the page actions retries, and a success offers it again.
    await openPageActions();
    await openPageActions();
    await vi.waitFor(() => expect(statusRequests()).toHaveLength(3));
    expect(notionItem()?.disabled).toBe(true);
    await act(async () => answerStatus(unlinked));
    await vi.waitFor(() => expect(notionItem()?.disabled).toBe(false));
    expect(notionItem()?.textContent.trim()).toBe(
      "editor.toolbar.linkToNotion",
    );
    // The link form closed with the failure and stays closed.
    await act(async () => Promise.resolve());
    expect(document.body.textContent).not.toContain(
      "editor.toolbar.linkToNotionPage",
    );
  });

  it("offers no link form when the status read fails, and asks again when the page actions reopen", async () => {
    await renderToolbar();
    await openPageActions();
    expect(statusRequests()).toHaveLength(1);

    await act(async () =>
      answerStatus({ error: "Notion is unavailable" }, 500),
    );
    await act(async () => Promise.resolve());

    const failed = notionItem();
    expect(failed?.textContent.trim()).toBe("editor.toolbar.notionSync");
    expect(failed?.disabled).toBe(true);
    expect(document.body.textContent).not.toContain(
      "editor.toolbar.linkToNotion",
    );

    await openPageActions();
    await openPageActions();
    await vi.waitFor(() => expect(statusRequests()).toHaveLength(2));
    expect(notionItem()?.disabled).toBe(true);

    await act(async () =>
      answerStatus({
        connected: true,
        pageId: "notion-page-1",
        state: "idle",
        hasConflict: false,
      }),
    );
    await vi.waitFor(() => expect(notionItem()?.disabled).toBe(false));
    expect(notionItem()?.textContent.trim()).toBe("editor.toolbar.notionSync");
  });
});
