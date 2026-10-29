// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import type { SlideStyleSnapshot } from "./slide-style";
import { SlideContextToolbar } from "./SlideContextToolbar";

const originalPointerCaptureMethods = [
  [
    "setPointerCapture",
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, "setPointerCapture"),
  ],
  [
    "releasePointerCapture",
    Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "releasePointerCapture",
    ),
  ],
] as const;

function objectSnapshot(
  overrides: Partial<SlideStyleSnapshot> = {},
): SlideStyleSnapshot {
  return {
    selector: '[data-slide-object-id="object-a"]',
    label: "Object",
    tagName: "DIV",
    textPreview: "Object",
    isText: false,
    isImage: false,
    isAbsolute: true,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    slideWidth: 1280,
    slideHeight: 720,
    color: "#000000",
    fontFamily: "sans-serif",
    backgroundColor: "#ffffff",
    fontSize: 16,
    fontWeight: "400",
    fontStyle: "normal",
    textDecoration: "none",
    listKind: null,
    lineHeight: 1.2,
    textAlign: "left",
    opacity: 100,
    borderRadius: 0,
    borderWidth: 0,
    borderColor: "#000000",
    paddingX: 0,
    paddingY: 0,
    zIndex: 1,
    ...overrides,
  };
}

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
  afterEach(() => {
    cleanup();
    for (const [property, descriptor] of originalPointerCaptureMethods) {
      if (descriptor) {
        Object.defineProperty(HTMLElement.prototype, property, descriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, property);
      }
    }
  });

  it("starts a component comment from the selected-object toolbar", () => {
    const onComment = vi.fn();
    render(
      <TooltipProvider>
        <SlideContextToolbar
          snapshot={objectSnapshot()}
          background="#000000"
          canComment
          onComment={onComment}
          onChange={vi.fn()}
          onBackgroundChange={vi.fn()}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));

    expect(onComment).toHaveBeenCalledOnce();
  });

  it("opens Position for a selected flow object", () => {
    const onEnablePositioning = vi.fn();
    render(
      <TooltipProvider>
        <SlideContextToolbar
          snapshot={objectSnapshot({ isAbsolute: false })}
          background="#000000"
          objectSelectionCount={1}
          onEnablePositioning={onEnablePositioning}
          onChange={vi.fn()}
          onBackgroundChange={vi.fn()}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Position" }));

    expect(onEnablePositioning).toHaveBeenCalledOnce();
  });

  it("keeps Position available while a selected flow object has no style snapshot", () => {
    const onEnablePositioning = vi.fn();
    render(
      <TooltipProvider>
        <SlideContextToolbar
          snapshot={null}
          background="#000000"
          hasSelectedElement
          objectSelectionCount={0}
          onEnablePositioning={onEnablePositioning}
          onChange={vi.fn()}
          onBackgroundChange={vi.fn()}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Position" }));

    expect(onEnablePositioning).toHaveBeenCalledOnce();
  });

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

  it("dispatches group and one-step z-order actions for a multi-selection", () => {
    const onGroup = vi.fn();
    const onArrange = vi.fn();

    render(
      <TooltipProvider>
        <SlideContextToolbar
          snapshot={objectSnapshot()}
          background="#000000"
          objectSelectionCount={2}
          canGroup
          onGroup={onGroup}
          onArrange={onArrange}
          onChange={vi.fn()}
          onBackgroundChange={vi.fn()}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    openMenu("Order");
    fireEvent.click(screen.getByRole("menuitem", { name: "Bring forward" }));

    expect(onGroup).toHaveBeenCalledOnce();
    expect(onArrange).toHaveBeenCalledWith("forward");
  });

  it("dispatches ungroup for a selected group", () => {
    const onUngroup = vi.fn();

    render(
      <TooltipProvider>
        <SlideContextToolbar
          snapshot={objectSnapshot()}
          background="#000000"
          canUngroup
          onUngroup={onUngroup}
          onChange={vi.fn()}
          onBackgroundChange={vi.fn()}
        />
      </TooltipProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ungroup" }));

    expect(onUngroup).toHaveBeenCalledOnce();
  });

  it("keeps a refused rotation scrub mounted through previews", () => {
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: () => {},
    });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
      configurable: true,
      value: () => {},
    });
    const onChange = vi.fn(() => false);
    render(
      <TooltipProvider>
        <SlideContextToolbar
          snapshot={objectSnapshot()}
          background="#000000"
          onChange={onChange}
          onBackgroundChange={vi.fn()}
        />
      </TooltipProvider>,
    );

    const input = screen.getByRole("textbox", {
      name: "Rotation",
    }) as HTMLInputElement;
    const scrub = input.parentElement!;
    const label = document.querySelector<HTMLElement>(
      `label[for="${input.id}"]`,
    )!;
    fireEvent.pointerDown(label, {
      button: 0,
      pointerId: 7,
      clientX: 0,
    });
    fireEvent.pointerMove(scrub, { pointerId: 7, clientX: 10 });
    fireEvent.pointerMove(scrub, { pointerId: 7, clientX: 20 });

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("textbox", { name: "Rotation" })).toBe(input);

    fireEvent.pointerUp(scrub, { pointerId: 7, clientX: 20 });

    expect(onChange).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("textbox", { name: "Rotation" })).not.toBe(input);
  });

  it("picks a zoom level from the style toolbar", () => {
    const onSelect = vi.fn();

    render(
      <TooltipProvider>
        <SlideContextToolbar
          snapshot={null}
          background="#000000"
          onChange={vi.fn()}
          onBackgroundChange={vi.fn()}
          zoomControls={{ value: 100, presets: [50, 100, 200], onSelect }}
        />
      </TooltipProvider>,
    );

    const toolbar = screen.getByRole("toolbar");
    expect(within(toolbar).getByText("100%")).toBeTruthy();
    openMenu("Zoom");
    fireEvent.click(screen.getByRole("menuitem", { name: "200%" }));

    expect(onSelect).toHaveBeenCalledWith(200);
  });

  it("fits the slide to the screen from the top of the zoom menu", () => {
    const onFit = vi.fn();
    render(
      <TooltipProvider>
        <SlideContextToolbar
          snapshot={null}
          background="#000000"
          onChange={vi.fn()}
          onBackgroundChange={vi.fn()}
          zoomControls={{
            value: 80,
            presets: [50, 100, 200],
            onSelect: vi.fn(),
            fitted: true,
            onFit,
          }}
        />
      </TooltipProvider>,
    );

    openMenu("Zoom");
    const fit = screen.getAllByRole("menuitem").at(0);
    if (!fit) throw new Error("Expected zoom menu items");
    expect(fit.textContent).toBe("Fit to screen");
    fireEvent.click(fit);

    expect(onFit).toHaveBeenCalledOnce();
  });

  it("hands focus back when a toolbar menu closes", async () => {
    const onReturnFocus = vi.fn();
    render(
      <TooltipProvider>
        <SlideContextToolbar
          snapshot={null}
          background="#000000"
          onChange={vi.fn()}
          onBackgroundChange={vi.fn()}
          onReturnFocus={onReturnFocus}
          zoomControls={{ value: 100, presets: [50, 100], onSelect: vi.fn() }}
        />
      </TooltipProvider>,
    );

    openMenu("Zoom");
    fireEvent.click(screen.getByRole("menuitem", { name: "50%" }));

    await waitFor(() => expect(onReturnFocus).toHaveBeenCalledOnce());
    expect(document.activeElement).not.toBe(
      screen.getByRole("button", { name: "Zoom" }),
    );
  });

  it("keeps focus where it was when a toolbar button is pressed", () => {
    render(
      <TooltipProvider>
        <SlideContextToolbar
          snapshot={objectSnapshot()}
          background="#000000"
          onChange={vi.fn()}
          onBackgroundChange={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(
      fireEvent.mouseDown(screen.getByRole("button", { name: "Position" })),
    ).toBe(false);
    const width = screen.getAllByRole("textbox", { name: "Width" }).at(0);
    if (!width) throw new Error("Expected a Width field");
    expect(fireEvent.mouseDown(width)).toBe(true);
  });

  it("offers Crop for an image only when it can be cropped", () => {
    const onCropImage = vi.fn();
    const toolbar = (crop?: () => void) => (
      <TooltipProvider>
        <SlideContextToolbar
          snapshot={objectSnapshot({ isImage: true, tagName: "IMG" })}
          background="#000000"
          onChange={vi.fn()}
          onBackgroundChange={vi.fn()}
          {...(crop ? { onCropImage: crop } : {})}
        />
      </TooltipProvider>
    );
    const view = render(toolbar());
    expect(screen.queryByRole("button", { name: "Crop image" })).toBeNull();

    view.rerender(toolbar(onCropImage));
    fireEvent.click(screen.getByRole("button", { name: "Crop image" }));

    expect(onCropImage).toHaveBeenCalledOnce();
  });
});
