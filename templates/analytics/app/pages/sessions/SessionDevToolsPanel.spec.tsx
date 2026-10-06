// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useLocale: () => ({ locale: "en-US" }),
}));

import { SessionDevToolsPanel } from "./SessionDevToolsPanel";

const diagnostics = {
  console: [],
  network: [],
  consoleErrorCount: 0,
  networkFailedCount: 0,
};

describe("SessionDevToolsPanel friction tab", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(friction?: React.ReactNode) {
    act(() => {
      root.render(
        <SessionDevToolsPanel
          diagnostics={diagnostics}
          currentTime={0}
          height={240}
          onHeightChange={() => {}}
          onSeek={() => {}}
          friction={friction}
        />,
      );
    });
  }

  function frictionTab() {
    return Array.from(container.querySelectorAll('[role="tab"]')).find(
      (tab) => tab.textContent === "sessions.friction",
    );
  }

  it("shows the friction tab only when the page passes friction", () => {
    render();
    expect(frictionTab()).toBeUndefined();

    render(<span>friction breakdown</span>);
    expect(container.textContent).not.toContain("friction breakdown");
    act(() => {
      frictionTab()?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
    });
    expect(container.textContent).toContain("friction breakdown");
  });
});
