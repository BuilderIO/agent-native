// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FirstOutputNextStepBar,
  type FirstOutputNextStepLabels,
} from "./FirstOutputNextStepBar.js";
import type { FirstOutputNextStepBarProps } from "./FirstOutputNextStepBar.js";

const labels: FirstOutputNextStepLabels = {
  ariaLabel: "Next steps",
  refineWithPrompt: "Refine with a prompt",
  export: "Export",
  shareLink: "Share link",
  dismiss: "Dismiss",
};

describe("FirstOutputNextStepBar", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onTrack = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.clear();
    onTrack.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = (
    ready: boolean,
    handlers: Partial<
      Pick<FirstOutputNextStepBarProps, "onRefine" | "onExport" | "onShareLink">
    > = {},
  ) =>
    act(() => {
      root.render(
        <FirstOutputNextStepBar
          appId="design"
          userScope="user-1"
          outputId="design-1"
          ready={ready}
          labels={labels}
          onRefine={vi.fn()}
          onExport={vi.fn()}
          onShareLink={vi.fn()}
          onTrack={onTrack}
          {...handlers}
        />,
      );
    });

  it("appears only when the output is ready and tracks its first impression", () => {
    render(false);
    expect(container.querySelector("[data-first-output-next-step]")).toBeNull();

    render(true);
    expect(
      container.querySelector("[data-first-output-next-step]"),
    ).not.toBeNull();
    expect(onTrack).toHaveBeenCalledWith("first_output_next_step_shown", {
      app_id: "design",
      output_id: "design-1",
    });
  });

  it("tracks actions and dismisses once for the app", () => {
    const onRefine = vi.fn();
    const onExport = vi.fn();
    const onShareLink = vi.fn();
    render(true, { onRefine, onExport, onShareLink });

    act(() => {
      container
        .querySelector<HTMLButtonElement>('button:not([aria-label="Dismiss"])')
        ?.click();
    });
    expect(onRefine).toHaveBeenCalledOnce();
    expect(onTrack).toHaveBeenCalledWith(
      "first_output_next_step_clicked",
      expect.objectContaining({ action: "refine" }),
    );

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Dismiss"]')
        ?.click();
    });
    expect(container.querySelector("[data-first-output-next-step]")).toBeNull();
    expect(onTrack).toHaveBeenCalledWith(
      "first_output_next_step_dismissed",
      expect.objectContaining({ app_id: "design", output_id: "design-1" }),
    );
    expect(
      localStorage.getItem(
        "agent-native:first-output-next-step:design:user-1:v1",
      ),
    ).toBe("1");
  });

  it("stays hidden after the first view across remounts", () => {
    render(true);
    act(() => root.unmount());
    root = createRoot(container);
    render(true);

    expect(container.querySelector("[data-first-output-next-step]")).toBeNull();
    expect(onTrack).toHaveBeenCalledTimes(1);
  });
});
