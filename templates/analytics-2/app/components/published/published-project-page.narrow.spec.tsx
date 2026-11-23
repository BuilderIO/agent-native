// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";
import { projectDocumentSchema } from "@/lib/model/contracts";
import { resolveRoute } from "@/routes/routing/registry";

const toastSpy = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toastSpy }));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...actual, useQueries: () => [] };
});

vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentChatHome: () => null,
  AgentChatSurface: () => null,
}));

vi.mock("@/components/sharing/PublishedAppSharePopover", () => ({
  PublishedAppSharePopover: () => <button type="button">Share</button>,
}));

vi.mock("./PublishedAppSchedulePanel", () => ({
  PublishedAppSchedulePanel: () => null,
}));

vi.mock("./usePublishedAppSession", () => ({
  usePublishedAppSession: () => ({
    session: {
      releaseId: "rel_1",
      sessionId: "sess_1",
      state: "ready",
      refreshedAt: "2026-11-15T00:00:00.000Z",
      staleAfter: { kind: "hours", value: 24 },
      refreshUnavailable: false,
      overrides: { region: "US" },
      outputs: {},
      queryStates: {},
      caps: { refreshDefault: true, saveView: true },
      projection: {
        project: {
          id: "prj_1",
          ownerEmail: "reader@example.invalid",
          title: "Revenue overview",
          description: "",
          language: "python",
          statusId: null,
          favorited: false,
          trashedAt: null,
          archivedAt: null,
          lastOpenedAt: null,
          createdAt: "2026-11-15T00:00:00.000Z",
          updatedAt: "2026-11-15T00:00:00.000Z",
          workingVersionId: "ver_working",
          publishedVersionId: "ver_published",
          collectionIds: [],
          cells: [],
        },
        outputs: {},
        queryStates: {},
      },
    },
    busy: false,
    error: null,
    refresh: vi.fn(),
    reset: vi.fn(),
    setInput: vi.fn(),
    saveBookmark: vi.fn(async () => ({})),
  }),
}));

import { PublishedProjectPage } from "./PublishedProjectPage";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const timestamp = "2026-11-15T00:00:00.000Z";
const project = {
  project: projectDocumentSchema.parse({
    id: "prj_1",
    ownerEmail: "reader@example.invalid",
    title: "Revenue overview",
    description: "",
    language: "python",
    statusId: null,
    favorited: false,
    trashedAt: null,
    archivedAt: null,
    lastOpenedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    workingVersionId: "ver_working",
    publishedVersionId: "ver_published",
    collectionIds: [],
    cells: [],
  }),
  outputs: {},
  queryStates: {},
};

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/hooks")>();
  return {
    ...actual,
    useActionQuery: (name: string) =>
      name === "get-published-project"
        ? {
            data: project,
            isPending: false,
            isError: false,
            error: null,
            refetch: vi.fn(),
          }
        : { data: undefined, isPending: false, isError: false },
    callAction: vi.fn(),
  };
});

function setProperty(target: object, key: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (original) Object.defineProperty(target, key, original);
    else delete (target as Record<string, unknown>)[key];
  };
}

describe("PublishedProjectPage narrow header and presentation mode", () => {
  const cleanups: Array<() => void> = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeEach(() => {
    unhandled.length = 0;
    process.on("unhandledRejection", onUnhandled);
  });

  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    while (cleanups.length > 0) cleanups.pop()?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  function render() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    const route = resolveRoute("/app/prj_1/latest");
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <AgentNativeI18nProvider
            catalog={{ messages }}
            persistPreference={false}
          >
            <MemoryRouter initialEntries={["/app/prj_1/latest"]}>
              <PublishedProjectPage route={route} />
            </MemoryRouter>
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      );
    });
    cleanups.push(() => act(() => root.unmount()));
    return host;
  }

  function headerPresentationButton(host: HTMLElement) {
    const button = host.querySelector<HTMLButtonElement>(
      'header button[aria-label="Presentation mode"]',
    );
    expect(button).not.toBeNull();
    return button!;
  }

  function openMenuItem(host: HTMLElement) {
    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="More"]',
    );
    act(() => {
      trigger!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });
    const item = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((el) => el.textContent?.includes("Presentation mode"));
    expect(item).toBeDefined();
    return item!;
  }

  function clickMenuItem(host: HTMLElement) {
    const item = openMenuItem(host);
    act(() => item.click());
  }

  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("keeps the header row at the compact 40px height of the original app navbar", () => {
    const host = render();
    const row = host.querySelector<HTMLElement>(
      "header.app-session-header > div",
    );
    expect(row).not.toBeNull();
    // The original navbar is a fixed 40px bar; the wrapping row keeps that as
    // its minimum so narrow layouts can still grow.
    expect(row!.className).toContain("min-h-10");
    expect(row!.className).not.toMatch(/min-h-(11|12|14|16)\b/);
  });

  it("keeps the title readable at 390px: controls wrap, title truncates, secondary trigger is hidden below sm", () => {
    const host = render();
    const header = host.querySelector<HTMLElement>("header.app-session-header");
    const title = header?.querySelector<HTMLElement>("h1");
    expect(title?.textContent).toBe("Revenue overview");
    expect(title?.className).toContain("truncate");
    expect(title?.className).toContain("min-w-0");

    const row = title!.parentElement!.parentElement!;
    expect(row.className).toContain("flex-wrap");
    const controls = row.lastElementChild as HTMLElement;
    expect(controls.className).toContain("flex-wrap");
    expect(controls.className).not.toContain("shrink-0");
    expect(controls.className).toContain("min-w-0");

    const trigger = headerPresentationButton(host);
    expect(trigger.className).toContain("hidden");
    expect(trigger.className).toContain("sm:inline-flex");
    expect(openMenuItem(host).textContent).toContain("Presentation mode");
  });

  it("enters fullscreen from both triggers when the API is available", () => {
    const request = vi.fn(async () => {});
    cleanups.push(
      setProperty(HTMLElement.prototype, "requestFullscreen", request),
    );
    cleanups.push(setProperty(document, "fullscreenElement", null));
    const host = render();

    act(() => headerPresentationButton(host).click());
    expect(request).toHaveBeenCalledTimes(1);

    clickMenuItem(host);
    expect(request).toHaveBeenCalledTimes(2);
    expect(toastSpy.error).not.toHaveBeenCalled();
  });

  it("exits fullscreen when already fullscreen", () => {
    const exit = vi.fn(async () => {});
    const request = vi.fn(async () => {});
    cleanups.push(
      setProperty(HTMLElement.prototype, "requestFullscreen", request),
    );
    cleanups.push(setProperty(document, "exitFullscreen", exit));
    cleanups.push(setProperty(document, "fullscreenElement", document.body));
    const host = render();

    act(() => headerPresentationButton(host).click());
    expect(exit).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
  });

  it("reports unsupported fullscreen from both triggers instead of throwing", () => {
    cleanups.push(
      setProperty(HTMLElement.prototype, "requestFullscreen", undefined),
    );
    cleanups.push(setProperty(document, "fullscreenElement", null));
    const host = render();

    expect(() =>
      act(() => headerPresentationButton(host).click()),
    ).not.toThrow();
    expect(toastSpy.error).toHaveBeenCalledTimes(1);

    expect(() => clickMenuItem(host)).not.toThrow();
    expect(toastSpy.error).toHaveBeenCalledTimes(2);
    expect(toastSpy.error).toHaveBeenLastCalledWith("Presentation mode", {
      description: messages.error.genericDetails,
    });
  });

  it("reports unsupported exitFullscreen when stuck in fullscreen", () => {
    cleanups.push(setProperty(document, "exitFullscreen", undefined));
    cleanups.push(setProperty(document, "fullscreenElement", document.body));
    const host = render();

    expect(() =>
      act(() => headerPresentationButton(host).click()),
    ).not.toThrow();
    expect(toastSpy.error).toHaveBeenCalledTimes(1);
  });

  it("catches a rejected requestFullscreen promise and shows an error", async () => {
    const request = vi.fn(() => Promise.reject(new TypeError("denied")));
    cleanups.push(
      setProperty(HTMLElement.prototype, "requestFullscreen", request),
    );
    cleanups.push(setProperty(document, "fullscreenElement", null));
    const host = render();

    act(() => headerPresentationButton(host).click());
    await flush();
    clickMenuItem(host);
    await flush();

    expect(request).toHaveBeenCalledTimes(2);
    expect(toastSpy.error).toHaveBeenCalledTimes(2);
    expect(unhandled).toEqual([]);
  });

  it("catches a synchronous throw and a rejected exitFullscreen", async () => {
    const request = vi.fn(() => {
      throw new TypeError("blocked");
    });
    cleanups.push(
      setProperty(HTMLElement.prototype, "requestFullscreen", request),
    );
    cleanups.push(setProperty(document, "fullscreenElement", null));
    const host = render();
    expect(() =>
      act(() => headerPresentationButton(host).click()),
    ).not.toThrow();
    expect(toastSpy.error).toHaveBeenCalledTimes(1);

    cleanups.push(
      setProperty(document, "exitFullscreen", () =>
        Promise.reject(new Error("no")),
      ),
    );
    cleanups.push(setProperty(document, "fullscreenElement", document.body));
    act(() => headerPresentationButton(host).click());
    await flush();
    expect(toastSpy.error).toHaveBeenCalledTimes(2);
    expect(unhandled).toEqual([]);
  });
});
