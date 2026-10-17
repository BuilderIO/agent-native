// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
  useLocale: () => ({ locale: "en-US" }),
}));

import type { ReplayDevToolsDiagnostics } from "./session-replay-devtools";
import { SessionDevToolsPanel } from "./SessionDevToolsPanel";

const diagnostics: ReplayDevToolsDiagnostics = {
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

  function render(
    friction?: React.ReactNode,
    jumpDisabled = false,
    values = diagnostics,
    onSeek = () => {},
  ) {
    act(() => {
      root.render(
        <MemoryRouter>
          <SessionDevToolsPanel
            diagnostics={values}
            currentTime={0}
            height={240}
            onHeightChange={() => {}}
            onSeek={onSeek}
            jumpDisabled={jumpDisabled}
            friction={friction}
          />
        </MemoryRouter>,
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

  it("disables DevTools jump-to controls during screenshot capture", () => {
    const onSeek = vi.fn();
    const values: ReplayDevToolsDiagnostics = {
      ...diagnostics,
      console: [
        {
          id: "console-error",
          offsetMs: 120,
          timestamp: 120,
          level: "error",
          source: "console",
          message: "replay error",
          args: [],
          repeat: 1,
        },
      ],
    };

    render(undefined, true, values, onSeek);

    const jumpButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("sessions.devtoolsJumpTo"),
    );
    expect(jumpButton?.disabled).toBe(true);
    jumpButton?.click();
    expect(onSeek).not.toHaveBeenCalled();
  });
});
