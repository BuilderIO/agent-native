// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  result: undefined as unknown,
  isError: false,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: vi.fn(
    (_name: string, _params: unknown, options?: { enabled?: boolean }) => ({
      data: options?.enabled === false ? undefined : mocks.result,
      isError: options?.enabled === false ? false : mocks.isError,
    }),
  ),
}));

import { useActionQuery } from "@agent-native/core/client/hooks";

import { TooltipProvider } from "@/components/ui/tooltip";

import { i18nCatalog } from "../../../i18n";
import { CitedInMenu } from "./CitedInMenu";

const PAGE = {
  id: "doc_1",
  title: "Q4 review",
  url: "https://content.agent-native.com/page/doc_1",
  updatedAt: "2026-11-18T10:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root;

function render() {
  act(() => {
    root.render(
      <AgentNativeI18nProvider
        catalog={i18nCatalog}
        initialLocale="en-US"
        persistPreference={false}
      >
        <TooltipProvider>
          <CitedInMenu dashboardId="growth" />
        </TooltipProvider>
      </AgentNativeI18nProvider>,
    );
  });
}

function trigger() {
  const button = container.querySelector("button");
  if (!button) throw new Error("no Cited in button");
  return button;
}

function openMenu() {
  act(() => {
    trigger().dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerType: "mouse",
      }),
    );
  });
}

function menuText() {
  return document.querySelector('[role="menu"]')?.textContent ?? "";
}

describe("CitedInMenu", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(useActionQuery).mockClear();
    mocks.result = { status: "ok", pages: [PAGE], more: false };
    mocks.isError = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("asks for the pages only once it opens", () => {
    render();
    expect(trigger().getAttribute("aria-label")).toBe("Cited in");
    expect(vi.mocked(useActionQuery)).toHaveBeenLastCalledWith(
      "list-dashboard-citations",
      { dashboardId: "growth" },
      expect.objectContaining({ enabled: false }),
    );

    openMenu();
    expect(vi.mocked(useActionQuery)).toHaveBeenLastCalledWith(
      "list-dashboard-citations",
      { dashboardId: "growth" },
      expect.objectContaining({ enabled: true }),
    );
  });

  it("links each citing page to open in a new tab", () => {
    mocks.result = {
      status: "ok",
      pages: [PAGE, { ...PAGE, id: "doc_2", title: "  " }],
      more: true,
    };
    render();
    openMenu();

    const links = [
      ...document.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]'),
    ];
    expect(links.map((link) => link.textContent)).toEqual([
      "Q4 review",
      "Untitled",
    ]);
    expect(links[0]?.getAttribute("href")).toBe(PAGE.url);
    expect(links[0]?.getAttribute("target")).toBe("_blank");
    expect(links[0]?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(menuText()).toContain(
      "Content checked only the most recently edited pages",
    );
  });

  it("doesn't call it empty when Content stopped before checking every page", () => {
    mocks.result = { status: "ok", pages: [], more: true };
    render();
    openMenu();

    expect(menuText()).toContain(
      "Content checked only the most recently edited pages",
    );
    expect(menuText()).not.toContain("No Content pages");
  });

  it("shows loading rows, then says when no page cites the dashboard", () => {
    mocks.result = undefined;
    render();
    openMenu();
    expect(
      document.querySelectorAll('[data-testid="cited-in-loading-row"]'),
    ).toHaveLength(3);

    mocks.result = { status: "ok", pages: [], more: false };
    render();
    expect(menuText()).toContain(
      "No Content pages you can open hold charts from this dashboard yet",
    );
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(0);
  });

  it("says when Content can't be reached", () => {
    mocks.result = { status: "unavailable", reason: "content_unreachable" };
    render();
    openMenu();
    expect(menuText()).toContain("Couldn't reach Content");

    mocks.result = undefined;
    mocks.isError = true;
    render();
    expect(menuText()).toContain("Couldn't reach Content");
  });
});
