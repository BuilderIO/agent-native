// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { i18nCatalog } from "@/i18n";

import { WorkspaceSearch } from "./WorkspaceSearch";

import searchStyles from "./search.css?inline";

describe("WorkspaceSearch parity & edge cases", () => {
  let host: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    document.head.replaceChildren();
    document.body.replaceChildren();
    const style = document.createElement("style");
    style.textContent = searchStyles;
    document.head.append(style);
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.head.replaceChildren();
    document.body.replaceChildren();
  });

  const clickButton = async (label: string) => {
    const button = [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === label,
    );
    expect(button, `Missing button: ${label}`).toBeDefined();
    await act(async () => {
      button?.click();
    });
  };

  it("sizes Reset all in the filter bar as auto instead of 100% width", async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <WorkspaceSearch
            filterOptions={{
              categories: [{ id: "cat-1", label: "Finance" }],
            }}
            onClose={() => undefined}
            onNavigate={() => undefined}
            onSearch={async () => []}
            open
          />
        </AgentNativeI18nProvider>,
      );
      await Promise.resolve();
    });

    await clickButton("Category");
    await clickButton("Finance");

    const resetAll = [
      ...host.querySelectorAll<HTMLButtonElement>(".ws-search-filters button"),
    ].find((b) => b.textContent?.trim() === "Reset all");
    expect(resetAll).toBeDefined();
    expect(getComputedStyle(resetAll!).width).not.toBe("100%");
  });

  it("keeps at most one Date FilterSelect submenu open and closes only the submenu on Escape or outside click", async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <WorkspaceSearch
            filterOptions={{}}
            onClose={() => undefined}
            onNavigate={() => undefined}
            onSearch={async () => []}
            open
          />
        </AgentNativeI18nProvider>,
      );
      await Promise.resolve();
    });

    await clickButton("Date");
    const fieldBtn = host.querySelector<HTMLButtonElement>(
      '[data-rid="search.date.field"]',
    );
    const modeBtn = host.querySelector<HTMLButtonElement>(
      '[data-rid="search.date.mode"]',
    );
    expect(fieldBtn).not.toBeNull();
    expect(modeBtn).not.toBeNull();

    await act(async () => fieldBtn!.click());
    expect(host.querySelectorAll(".ws-search-submenu")).toHaveLength(1);

    await act(async () => modeBtn!.click());
    expect(host.querySelectorAll(".ws-search-submenu")).toHaveLength(1);
    expect(modeBtn!.getAttribute("aria-expanded")).toBe("true");
    expect(fieldBtn!.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(host.querySelectorAll(".ws-search-submenu")).toHaveLength(0);
    expect(host.querySelector(".ws-search-date-menu")).not.toBeNull();

    await act(async () => modeBtn!.click());
    expect(host.querySelectorAll(".ws-search-submenu")).toHaveLength(1);
    await act(async () => {
      host
        .querySelector(".ws-search-date-head")!
        .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(host.querySelectorAll(".ws-search-submenu")).toHaveLength(0);
    expect(host.querySelector(".ws-search-date-menu")).not.toBeNull();
  });

  it("auto-focuses the Creator search input when the Creator filter opens", async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <WorkspaceSearch
            filterOptions={{
              creators: [{ id: "u1", label: "Alice" }],
              creatorSearch: {
                text: "",
                status: "ready",
                hasMore: false,
                onSearch: () => undefined,
                onMore: () => undefined,
              },
            }}
            onClose={() => undefined}
            onNavigate={() => undefined}
            onSearch={async () => []}
            open
          />
        </AgentNativeI18nProvider>,
      );
      await Promise.resolve();
    });

    await clickButton("Creator");
    const creatorInput = host.querySelector<HTMLInputElement>(
      'input[type="search"]',
    );
    expect(creatorInput).not.toBeNull();
    expect(document.activeElement).toBe(creatorInput);
  });

  it("shows a loading spinner while initial Recents are loading", async () => {
    let resolveSearch!: (rows: never[]) => void;
    const pending = new Promise<never[]>((resolve) => {
      resolveSearch = resolve;
    });

    await act(async () => {
      root = createRoot(host);
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <WorkspaceSearch
            filterOptions={{}}
            onClose={() => undefined}
            onNavigate={() => undefined}
            onSearch={() => pending}
            open
          />
        </AgentNativeI18nProvider>,
      );
      await Promise.resolve();
    });

    expect(host.querySelector(".ws-search-loading")).not.toBeNull();
    await act(async () => {
      resolveSearch([]);
      await Promise.resolve();
    });
    expect(host.querySelector(".ws-search-loading")).toBeNull();
  });

  it("skips disabled buttons in the dialog Tab focus trap", async () => {
    await act(async () => {
      root = createRoot(host);
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          persistPreference={false}
        >
          <WorkspaceSearch
            filterOptions={{}}
            onClose={() => undefined}
            onCreateThread={() => new Promise(() => undefined)}
            onNavigate={() => undefined}
            onSearch={async () => []}
            open
          />
        </AgentNativeI18nProvider>,
      );
      await Promise.resolve();
    });

    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    const input = host.querySelector<HTMLInputElement>(".ws-search-input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "hello");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    await clickButton("Start a new threadAsk “hello”");
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.at(-1)?.disabled).toBe(true);
    const lastEnabled = buttons.filter((b) => !b.disabled).at(-1)!;
    input.focus();

    await act(async () => {
      dialog.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(document.activeElement).toBe(lastEnabled);
    expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);
  });
});
