// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { i18nCatalog } from "@/i18n";

import { WorkspaceSearch } from "./WorkspaceSearch";

import searchStyles from "./search.css?inline";

type Happy = {
  happyDOM: { setViewport(viewport: { width: number; height?: number }): void };
};
const happy = () => (window as unknown as Happy).happyDOM;

function setTouch(enabled: boolean) {
  Object.defineProperty(navigator, "maxTouchPoints", {
    value: enabled ? 1 : 0,
    configurable: true,
  });
}

describe("WorkspaceSearch phone and touch layout", () => {
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
    happy().setViewport({ width: 1280, height: 800 });
    setTouch(false);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.head.replaceChildren();
    document.body.replaceChildren();
    happy().setViewport({ width: 1280, height: 800 });
    setTouch(false);
  });

  async function mountSearch() {
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
  }

  async function typeQuery(value: string) {
    const input = host.querySelector<HTMLInputElement>(".ws-search-input");
    if (!input) throw new Error("Missing .ws-search-input");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
  }

  it("wraps the filter row on 390px phone viewports", async () => {
    happy().setViewport({ width: 390, height: 844 });
    await mountSearch();
    const filters = host.querySelector<HTMLElement>(".ws-search-filters");
    expect(filters).not.toBeNull();
    expect(getComputedStyle(filters!).flexWrap).toBe("wrap");
    expect(getComputedStyle(filters!).whiteSpace).toBe("normal");
  });

  it("hides idle and queried keyboard hints and footer bar on touch devices", async () => {
    happy().setViewport({ width: 390, height: 844 });
    setTouch(true);
    await mountSearch();

    const footer = host.querySelector<HTMLElement>(".ws-search-footer");
    const idleNote = host.querySelector<HTMLElement>(".ws-search-footer-note");
    expect(footer).not.toBeNull();
    expect(idleNote).not.toBeNull();
    expect(getComputedStyle(footer!).display).toBe("none");
    expect(getComputedStyle(idleNote!).display).toBe("none");

    await typeQuery("rev");
    const hints = Array.from(
      host.querySelectorAll<HTMLElement>(".ws-search-footer-hint"),
    );
    expect(hints.length).toBeGreaterThan(0);
    expect(getComputedStyle(footer!).display).toBe("none");
    for (const hint of hints) {
      expect(getComputedStyle(hint).display).toBe("none");
    }
  });

  it("keeps idle and queried keyboard hints visible on desktop pointers", async () => {
    happy().setViewport({ width: 1280, height: 800 });
    setTouch(false);
    await mountSearch();

    const footer = host.querySelector<HTMLElement>(".ws-search-footer");
    const idleNote = host.querySelector<HTMLElement>(".ws-search-footer-note");
    expect(footer).not.toBeNull();
    expect(idleNote).not.toBeNull();
    expect(getComputedStyle(footer!).display).toBe("flex");
    expect(getComputedStyle(idleNote!).display).toBe("inline-flex");

    await typeQuery("rev");
    const hints = Array.from(
      host.querySelectorAll<HTMLElement>(".ws-search-footer-hint"),
    );
    expect(hints.length).toBeGreaterThan(0);
    expect(getComputedStyle(footer!).display).toBe("flex");
    for (const hint of hints) {
      expect(getComputedStyle(hint).display).toBe("inline-flex");
    }
  });
});
