// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: { body: null as unknown, code: 200 },
  hold: false,
  release: null as null | ((body: unknown) => void),
}));

vi.mock(
  "@agent-native/core/client/use-after-paint",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/client/use-after-paint")
    >()),
    useAfterStartup: () => true,
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

import { NotionSyncBar } from "./NotionSyncBar";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("NotionSyncBar's link form", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  async function renderBar() {
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(NotionSyncBar, { documentId: "notion-fixture" }),
        ),
      ),
    );
    await vi.waitFor(() =>
      expect(statusQueryStates()).toEqual([
        expect.stringMatching(/success|error/),
      ]),
    );
    await act(async () => Promise.resolve());
  }

  function statusQueryStates() {
    return queryClient
      .getQueryCache()
      .findAll({ queryKey: ["action", "refresh-notion-sync-status"] })
      .map((query) => query.state.status);
  }

  function refetchStatus() {
    return queryClient.refetchQueries({
      queryKey: ["action", "refresh-notion-sync-status"],
    });
  }

  function buttonLabels() {
    return Array.from(container.querySelectorAll("button")).map((button) =>
      button.textContent.trim(),
    );
  }

  beforeEach(() => {
    mocks.status = { body: null, code: 200 };
    mocks.hold = false;
    mocks.release = null;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const href = String(input);
        if (href.includes("/_agent-native/actions/get-actions-batch")) {
          const { requests } = JSON.parse(String(init?.body)) as {
            requests: Array<{ action: string }>;
          };
          return json({
            results: requests.map(({ action }) => ({
              status: 200,
              body:
                action === "connect-notion-status" ? { connected: true } : {},
            })),
          });
        }
        if (href.includes("connect-notion-status")) {
          return json({ connected: true });
        }
        if (href.includes("refresh-notion-sync-status")) {
          if (mocks.hold) {
            return new Promise<Response>((resolve) => {
              mocks.release = (body) => resolve(json(body));
            });
          }
          return json(mocks.status.body, mocks.status.code);
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

  it("offers no link form when the status read fails", async () => {
    mocks.status = { body: { error: "Notion is unavailable" }, code: 500 };
    await renderBar();

    expect(statusQueryStates()).toEqual(["error"]);
    // The connection loads on its own; the bar's controls follow it.
    await vi.waitFor(() =>
      expect(buttonLabels()).toContain("editor.toolbar.disconnect"),
    );
    expect(buttonLabels()).not.toContain("editor.toolbar.linkPage");
    expect(container.querySelector("input")).toBeNull();
  });

  it("offers the link form once the status says the page isn't linked", async () => {
    mocks.status = {
      body: { connected: true, pageId: null, hasConflict: false },
      code: 200,
    };
    await renderBar();

    await vi.waitFor(() =>
      expect(buttonLabels()).toContain("editor.toolbar.linkPage"),
    );
    expect(container.querySelector("input")).not.toBeNull();
  });

  it("hides the link form when a later status read fails, until a retry succeeds", async () => {
    const unlinked = { connected: true, pageId: null, hasConflict: false };
    mocks.status = { body: unlinked, code: 200 };
    await renderBar();
    await vi.waitFor(() =>
      expect(buttonLabels()).toContain("editor.toolbar.linkPage"),
    );

    // A refetch fails: the cached "unlinked" answer may be stale.
    mocks.status = { body: { error: "Notion is unavailable" }, code: 500 };
    await act(async () => refetchStatus());
    expect(statusQueryStates()).toEqual(["error"]);
    await vi.waitFor(() =>
      expect(buttonLabels()).not.toContain("editor.toolbar.linkPage"),
    );
    expect(container.querySelector("input")).toBeNull();

    mocks.status = { body: unlinked, code: 200 };
    await act(async () => refetchStatus());
    expect(statusQueryStates()).toEqual(["success"]);
    await vi.waitFor(() =>
      expect(buttonLabels()).toContain("editor.toolbar.linkPage"),
    );
    expect(container.querySelector("input")).not.toBeNull();
  });
  it("offers no link form from an answer cached before it showed the page, until a new read answers", async () => {
    // An earlier visit left "unlinked" cached a minute ago; the page has been
    // linked since.
    queryClient.setQueryData(
      documentSyncStatusQueryKey("notion-fixture"),
      { connected: true, pageId: null, hasConflict: false },
      { updatedAt: Date.now() - 60_000 },
    );
    mocks.hold = true;
    await renderBar();
    await vi.waitFor(() => expect(mocks.release).not.toBeNull());
    await vi.waitFor(() =>
      expect(buttonLabels()).toContain("editor.toolbar.disconnect"),
    );

    expect(buttonLabels()).not.toContain("editor.toolbar.linkPage");
    expect(container.querySelector("input")).toBeNull();

    await act(async () =>
      mocks.release?.({
        connected: true,
        pageId: "notion-page-1",
        state: "idle",
        hasConflict: false,
      }),
    );
    await vi.waitFor(() =>
      expect(container.textContent).toContain("editor.toolbar.linkedToPage"),
    );
    expect(buttonLabels()).not.toContain("editor.toolbar.linkPage");
    expect(container.querySelector("input")).toBeNull();
  });
});
