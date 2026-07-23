// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", () => ({
  useDemoModeStatus: () => ({
    enabled: false,
    forced: false,
    isLoading: false,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

import { ChartTooltip } from "./SqlChart";

describe("ChartTooltip", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    container = document.createElement("div");
    container.style.transform = "translate3d(0, 0, 0)";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("portals the visible tooltip to the document body so scrollable ancestors can't clip it", async () => {
    await act(async () => {
      root.render(
        <ChartTooltip
          active
          label="May 10"
          payload={[{ name: "signups", value: 12, color: "#10b981" }]}
        />,
      );
    });

    expect(container.querySelectorAll('[role="tooltip"]')).toHaveLength(0);
    expect(document.body.querySelectorAll('[role="tooltip"]')).toHaveLength(1);
  });

  it("removes the tooltip when the chart deactivates it", async () => {
    await act(async () => {
      root.render(
        <ChartTooltip
          active
          label="May 10"
          payload={[{ name: "signups", value: 12, color: "#10b981" }]}
        />,
      );
    });
    expect(document.body.querySelector('[role="tooltip"]')).not.toBeNull();

    await act(async () => {
      root.render(
        <ChartTooltip
          active={false}
          label="May 10"
          payload={[{ name: "signups", value: 12, color: "#10b981" }]}
        />,
      );
    });

    expect(document.body.querySelector('[role="tooltip"]')).toBeNull();
  });
});
