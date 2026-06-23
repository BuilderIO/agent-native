// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandMenu, type CommandMenuDoc } from "./CommandMenu.js";

const DOCS: CommandMenuDoc[] = [
  {
    title: "Use the Chrome extension for browser logs",
    description: "Record a tab with console logs and fetch/XHR diagnostics.",
    href: "https://www.agent-native.com/docs/template-clips#browser-logs-and-developer-diagnostics",
    keywords: ["logs", "developer logs", "network diagnostics"],
  },
];

describe("CommandMenu docs group", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
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

  function renderMenu() {
    act(() => {
      root.render(
        <CommandMenu
          open
          onOpenChange={() => undefined}
          showAgentFallback={false}
        >
          <CommandMenu.DocsGroup docs={DOCS} />
        </CommandMenu>,
      );
    });
  }

  function search(value: string) {
    const input = document.querySelector<HTMLInputElement>("input");
    expect(input).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      input!.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("filters app docs entries through the shared search field", () => {
    renderMenu();

    search("logs");
    expect(document.body.textContent).toContain(
      "Use the Chrome extension for browser logs",
    );

    search("calendar");
    expect(document.body.textContent).not.toContain(
      "Use the Chrome extension for browser logs",
    );
  });
});
