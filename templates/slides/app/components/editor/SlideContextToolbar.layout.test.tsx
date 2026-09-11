// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { SlideContextToolbar } from "./SlideContextToolbar";

function renderMultiToolbar(
  objectSelectionCount: number,
  onAlignObjects = vi.fn(),
  onDistributeObjects = vi.fn(),
) {
  render(
    <TooltipProvider>
      <SlideContextToolbar
        snapshot={null}
        background="#000000"
        objectSelectionCount={objectSelectionCount}
        onAlignObjects={onAlignObjects}
        onDistributeObjects={onDistributeObjects}
        onChange={vi.fn()}
        onBackgroundChange={vi.fn()}
      />
    </TooltipProvider>,
  );
  return { onAlignObjects, onDistributeObjects };
}

function openMenu(name: string | RegExp) {
  const trigger = screen.getByRole("button", { name });
  fireEvent.pointerDown(trigger, { button: 0 });
  fireEvent.pointerUp(trigger, { button: 0 });
}

describe("contextual toolbar object layout", () => {
  afterEach(cleanup);

  it("offers alignment actions for a multi-selection", () => {
    const { onAlignObjects } = renderMultiToolbar(2);

    openMenu("Align");
    fireEvent.click(screen.getByRole("menuitem", { name: "Right" }));

    expect(onAlignObjects).toHaveBeenCalledWith("right");
  });

  it("keeps distribution disabled until three objects are selected", () => {
    const { onDistributeObjects } = renderMultiToolbar(2);

    openMenu(/Distribute/);

    expect(
      screen
        .getByRole("menuitem", { name: "Horizontal" })
        .getAttribute("data-disabled"),
    ).toBe("");
    expect(
      screen
        .getByRole("menuitem", { name: "Vertical" })
        .getAttribute("data-disabled"),
    ).toBe("");
    expect(onDistributeObjects).not.toHaveBeenCalled();
  });

  it("dispatches distribution for three or more objects", () => {
    const { onDistributeObjects } = renderMultiToolbar(3);

    openMenu(/Distribute/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Vertical" }));

    expect(onDistributeObjects).toHaveBeenCalledWith("vertical");
  });

  it("keeps zoom controls inside the style toolbar", () => {
    const onZoomOut = vi.fn();
    const onZoomIn = vi.fn();

    render(
      <TooltipProvider>
        <SlideContextToolbar
          snapshot={null}
          background="#000000"
          onChange={vi.fn()}
          onBackgroundChange={vi.fn()}
          zoomControls={{
            value: 100,
            onZoomOut,
            onZoomIn,
            canZoomOut: true,
            canZoomIn: true,
          }}
        />
      </TooltipProvider>,
    );

    const toolbar = screen.getByRole("toolbar");
    expect(within(toolbar).getByText("100%")).toBeTruthy();
    fireEvent.click(within(toolbar).getByRole("button", { name: "Zoom out" }));
    fireEvent.click(within(toolbar).getByRole("button", { name: "Zoom in" }));

    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(
      within(toolbar).queryByRole("button", { name: "Fit slide to screen" }),
    ).toBeNull();
  });
});
