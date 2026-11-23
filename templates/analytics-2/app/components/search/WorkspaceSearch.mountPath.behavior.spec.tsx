// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Census CEN-analytics-2-002: a search result opened in a new tab went to
 * `row.result.href`, which is app-relative ("/project/p1/latest"), so on a host
 * that serves this app under a path the new tab landed on the host root and
 * missed the app. Both `window.open` call sites now pass the href through
 * `appMountedHref(href, appBasePath())`.
 */

vi.mock("@agent-native/core/client/api-path", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, appBasePath: () => "/analytics-2" };
});

import type { SearchResult } from "./types";
import { WorkspaceSearch } from "./WorkspaceSearch";

const project = (extra: Partial<SearchResult> = {}): SearchResult =>
  ({
    id: "p1",
    title: "Signup funnel",
    href: "/project/p1/latest",
    updatedAt: "2026-11-12T10:00:00.000Z",
    kind: "project",
    ...extra,
  }) as SearchResult;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let host: HTMLDivElement;
let root: Root | null = null;
let open: ReturnType<typeof vi.fn>;
let navigate: ReturnType<typeof vi.fn<(href: string) => void>>;
let close: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.append(host);
  open = vi.fn();
  navigate = vi.fn<(href: string) => void>();
  close = vi.fn<() => void>();
  vi.stubGlobal("open", open);
  // jsdom has no layout; the list scrolls the highlighted row into view.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function mountWith(result: SearchResult): Promise<void> {
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <WorkspaceSearch
        open
        filterOptions={{}}
        onClose={close}
        onNavigate={navigate}
        onSearch={async () => [result]}
      />,
    );
    await wait(0);
  });
  const input = document.querySelector<HTMLInputElement>("input");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, "signup");
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await wait(400);
  });
}

/** Meta+Enter on the highlighted row. */
async function openHighlightedInNewTab(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>("input");
  for (const [key, metaKey] of [
    ["ArrowDown", false],
    ["Enter", true],
  ] as const) {
    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { key, metaKey, bubbles: true }),
      );
      await wait(50);
    });
  }
}

describe("search results keep the app mount path in a new tab", () => {
  it("opens a project result under /analytics-2, not the host root", async () => {
    await mountWith(project());
    await openHighlightedInNewTab();
    expect(open).toHaveBeenCalled();
    expect(open.mock.calls[0]?.[0]).toBe("/analytics-2/project/p1/latest");
  });

  it("navigates a published app in the same tab and preserves native modified clicks", async () => {
    await mountWith(project({ publishedAppHref: "/app/p1/latest" }));
    const viewApp = [...document.querySelectorAll("a")].find((link) =>
      /view app/i.test(link.textContent ?? ""),
    );
    expect(viewApp?.getAttribute("href")).toBe("/analytics-2/app/p1/latest");
    if (!viewApp) throw new Error("Published app link missing");

    const observed: boolean[] = [];
    const preventNavigation = (event: MouseEvent) => {
      observed.push(event.defaultPrevented);
      event.preventDefault();
    };
    host.addEventListener("click", preventNavigation);
    host.addEventListener("auxclick", preventNavigation);
    try {
      await act(async () => {
        viewApp.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      expect(navigate).toHaveBeenCalledExactlyOnceWith("/app/p1/latest");
      expect(close).toHaveBeenCalledOnce();
      expect(observed).toEqual([true]);
      navigate.mockClear();
      close.mockClear();
      for (const options of [
        { type: "click", metaKey: true },
        { type: "click", ctrlKey: true },
        { type: "auxclick", button: 1 },
      ]) {
        await act(async () => {
          viewApp.dispatchEvent(
            new MouseEvent(options.type, {
              ...options,
              bubbles: true,
              cancelable: true,
            }),
          );
        });
      }
      expect(observed).toEqual([true, false, false, false]);
      expect(navigate).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    } finally {
      host.removeEventListener("click", preventNavigation);
      host.removeEventListener("auxclick", preventNavigation);
    }
  });
  it("cycles focus between the search input and published app link", async () => {
    await mountWith(project({ publishedAppHref: "/app/p1/latest" }));
    const input = host.querySelector<HTMLInputElement>("input");
    const link = host.querySelector<HTMLAnchorElement>(
      'a[href="/analytics-2/app/p1/latest"]',
    );
    expect(input).not.toBeNull();
    expect(link).not.toBeNull();
    input?.focus();
    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(link);
    await act(async () => {
      link?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(input);
  });
});
