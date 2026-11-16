// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startupSettled: false,
  statusRequests: 0,
  release: null as null | ((body: unknown) => void),
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
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { documentSyncStatusQueryKey } from "@/hooks/use-notion";

import { NotionConflictBanner } from "./NotionConflictBanner";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const conflict = {
  connected: true,
  pageId: "notion-page-1",
  state: "conflict",
  hasConflict: true,
};

describe("NotionConflictBanner's choices", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  async function renderBanner() {
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(NotionConflictBanner, { documentId: "notion-fixture" }),
        ),
      ),
    );
    await act(async () => Promise.resolve());
  }

  function choices() {
    return Array.from(container.querySelectorAll("button")).map((button) =>
      button.textContent.trim(),
    );
  }

  beforeEach(() => {
    mocks.startupSettled = false;
    mocks.statusRequests = 0;
    mocks.release = null;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("refresh-notion-sync-status")) {
          mocks.statusRequests += 1;
          return new Promise<Response>((resolve) => {
            mocks.release = (body) => resolve(json(body));
          });
        }
        return json({});
      }),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  it("offers no choice from a conflict an earlier visit cached, until a new read answers", async () => {
    // A minute-old answer says the page conflicts; it has been resolved since.
    queryClient.setQueryData(
      documentSyncStatusQueryKey("notion-fixture"),
      conflict,
      { updatedAt: Date.now() - 60_000 },
    );
    await renderBanner();

    // The status read waits for the page to settle; the banner waits too.
    expect(mocks.statusRequests).toBe(0);
    expect(choices()).toEqual([]);

    mocks.startupSettled = true;
    await renderBanner();
    await vi.waitFor(() => expect(mocks.release).not.toBeNull());
    expect(choices()).toEqual([]);

    await act(async () =>
      mocks.release?.({
        connected: true,
        pageId: "notion-page-1",
        state: "idle",
        hasConflict: false,
      }),
    );
    await act(async () => Promise.resolve());
    expect(choices()).toEqual([]);
  });

  it("offers both choices once a read since it mounted reports the conflict", async () => {
    queryClient.setQueryData(
      documentSyncStatusQueryKey("notion-fixture"),
      conflict,
      { updatedAt: Date.now() - 60_000 },
    );
    mocks.startupSettled = true;
    await renderBanner();
    await vi.waitFor(() => expect(mocks.release).not.toBeNull());

    await act(async () => mocks.release?.(conflict));
    await vi.waitFor(() =>
      expect(choices()).toEqual([
        "editor.notionConflictUseNotion",
        "editor.notionConflictUseLocal",
      ]),
    );
  });

  it("offers both choices at once from a fresh cached conflict", async () => {
    queryClient.setQueryData(
      documentSyncStatusQueryKey("notion-fixture"),
      conflict,
    );
    await renderBanner();

    expect(choices()).toEqual([
      "editor.notionConflictUseNotion",
      "editor.notionConflictUseLocal",
    ]);
  });
});
