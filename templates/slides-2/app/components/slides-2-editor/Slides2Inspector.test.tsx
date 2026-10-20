import type { useT } from "@agent-native/core/client/i18n";
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import type { SlideFrameTextRangeStyle } from "../slides-2-runtime/protocol";
import { Slides2Inspector } from "./Slides2Inspector";
import type { ElementSnapshot } from "./types";

afterEach(cleanup);

const t = ((key: string) => key.split(".").at(-1) ?? key) as ReturnType<
  typeof useT
>;

function renderInspector(
  styles: Record<string, string> = {},
  text = "Hello",
  selectionCount = 1,
  rangeStyleSnapshot?: SlideFrameTextRangeStyle | null,
  onInspectTextRange = vi.fn(),
) {
  const onEdit = vi.fn();
  const selected: ElementSnapshot = {
    nodeId: "node-1",
    line: 1,
    column: 1,
    tagName: "div",
    bounds: { x: 20, y: 30, width: 200, height: 80 },
    text,
    styles,
  };

  const renderSelected = (nextSelected: ElementSnapshot = selected) => (
    <TooltipProvider>
      <Slides2Inspector
        selected={nextSelected}
        selectionCount={selectionCount}
        disabled={false}
        t={t}
        rangeStyleSnapshot={rangeStyleSnapshot}
        onInspectTextRange={onInspectTextRange}
        onEdit={onEdit}
        onAlign={vi.fn()}
        alignToSlide={false}
        onAlignToSlideChange={vi.fn()}
        smartGuidesEnabled
        onSmartGuidesChange={vi.fn()}
        onDistribute={vi.fn()}
        onArrange={vi.fn()}
        onDuplicateObject={vi.fn()}
        onDeleteObject={vi.fn()}
        canSelectParent={false}
        onSelectParent={vi.fn()}
      />
    </TooltipProvider>
  );
  const view = render(renderSelected());

  return {
    onEdit,
    selected,
    rerenderSelected: (nextSelected: ElementSnapshot) =>
      view.rerender(renderSelected(nextSelected)),
  };
}

describe("Slides2Inspector", () => {
  it("offers justified text alignment", () => {
    const { onEdit } = renderInspector();

    fireEvent.click(screen.getByRole("radio", { name: "justify" }));

    expect(onEdit).toHaveBeenCalledWith([
      {
        kind: "set-style",
        key: "textAlign",
        value: "justify",
        prevText: "Hello",
      },
    ]);
  });

  it("exposes current text styles as accessible toggle states", () => {
    renderInspector({
      textAlign: "center",
      fontWeight: "700",
      fontStyle: "italic",
    });

    const left = screen.getByRole("radio", { name: "textAlignLeft" });
    const center = screen.getByRole("radio", { name: "textAlignCenter" });
    const bold = screen.getByRole("button", { name: "bold" });
    const italic = screen.getByRole("button", { name: "italic" });

    expect(left.getAttribute("aria-checked")).toBe("false");
    expect(center.getAttribute("aria-checked")).toBe("true");
    expect(bold.getAttribute("aria-pressed")).toBe("true");
    expect(italic.getAttribute("aria-pressed")).toBe("true");
  });

  it("applies bold to the selected text range", () => {
    const { onEdit } = renderInspector();
    const textArea = screen.getByDisplayValue("Hello") as HTMLTextAreaElement;
    textArea.setSelectionRange(1, 4);
    fireEvent.select(textArea);

    fireEvent.click(screen.getByRole("button", { name: "bold" }));

    expect(onEdit).toHaveBeenCalledWith([
      {
        kind: "set-text-range-style",
        start: 1,
        end: 4,
        key: "fontWeight",
        value: "700",
        prevText: "Hello",
      },
    ]);
  });

  it("clears the inspected range when it collapses or the selected element changes", () => {
    const onInspectTextRange = vi.fn();
    const { selected, rerenderSelected } = renderInspector(
      {},
      "Hello",
      1,
      null,
      onInspectTextRange,
    );
    const textArea = screen.getByDisplayValue("Hello") as HTMLTextAreaElement;

    textArea.setSelectionRange(1, 4);
    fireEvent.select(textArea);
    expect(onInspectTextRange).toHaveBeenLastCalledWith({
      start: 1,
      end: 4,
      expectedText: "Hello",
    });

    textArea.setSelectionRange(2, 2);
    fireEvent.select(textArea);
    expect(onInspectTextRange).toHaveBeenLastCalledWith(null);

    textArea.setSelectionRange(1, 4);
    fireEvent.select(textArea);
    rerenderSelected({
      ...selected,
      nodeId: "node-2",
      line: 2,
      text: "Changed text",
    });

    expect(onInspectTextRange).toHaveBeenLastCalledWith(null);
    expect(textArea).toHaveProperty("value", "Changed text");
  });

  it("applies text content changes as the user types", () => {
    const { onEdit } = renderInspector();
    const textArea = screen.getByDisplayValue("Hello") as HTMLTextAreaElement;

    fireEvent.change(textArea, { target: { value: "Hello world" } });
    fireEvent.change(textArea, { target: { value: "Hello world!" } });
    fireEvent.blur(textArea);

    expect(onEdit).toHaveBeenNthCalledWith(1, [
      {
        kind: "set-text",
        value: "Hello world",
        prevText: "Hello",
      },
    ]);
    expect(onEdit).toHaveBeenNthCalledWith(2, [
      {
        kind: "set-text",
        value: "Hello world!",
        prevText: "Hello world",
      },
    ]);
    expect(onEdit).toHaveBeenCalledTimes(2);
  });

  it("commits composed text after IME composition ends", () => {
    const { onEdit } = renderInspector();
    const textArea = screen.getByDisplayValue("Hello") as HTMLTextAreaElement;

    fireEvent.compositionStart(textArea);
    fireEvent.change(textArea, { target: { value: "こんにちは" } });

    expect(onEdit).not.toHaveBeenCalled();

    fireEvent.compositionEnd(textArea);

    expect(onEdit).toHaveBeenCalledWith([
      {
        kind: "set-text",
        value: "こんにちは",
        prevText: "Hello",
      },
    ]);
  });

  it("toggles selected-range bold from the pending range value", () => {
    const { onEdit } = renderInspector();
    const textArea = screen.getByDisplayValue("Hello") as HTMLTextAreaElement;
    textArea.setSelectionRange(1, 4);
    fireEvent.select(textArea);

    const bold = screen.getByRole("button", { name: "bold" });
    fireEvent.click(bold);
    fireEvent.click(bold);

    expect(onEdit).toHaveBeenNthCalledWith(2, [
      {
        kind: "set-text-range-style",
        start: 1,
        end: 4,
        key: "fontWeight",
        value: "400",
        prevText: "Hello",
      },
    ]);
  });

  it("applies typography controls to the selected text range", () => {
    const { onEdit } = renderInspector();
    const textArea = screen.getByDisplayValue("Hello") as HTMLTextAreaElement;
    textArea.setSelectionRange(1, 4);
    fireEvent.select(textArea);

    const size = screen.getByRole("spinbutton", { name: "size px" });
    fireEvent.change(size, { target: { value: "32" } });
    fireEvent.blur(size);

    expect(size).toHaveProperty("value", "32");
    expect(onEdit).toHaveBeenCalledWith([
      {
        kind: "set-text-range-style",
        start: 1,
        end: 4,
        key: "fontSize",
        value: "32px",
        prevText: "Hello",
      },
    ]);
  });

  it("initializes range controls from the selected rendered text styles", () => {
    const onInspectTextRange = vi.fn();
    renderInspector(
      {
        fontSize: "18px",
        fontWeight: "400",
        fontFamily: "Arial",
        color: "rgb(0, 0, 0)",
      },
      "Hello",
      1,
      {
        line: 1,
        column: 1,
        nodeId: "node-1",
        start: 1,
        end: 4,
        expectedText: "Hello",
        styles: {
          fontFamily: "Georgia",
          fontSize: "36px",
          fontStyle: "italic",
          fontWeight: "700",
          color: "rgb(18, 52, 86)",
        },
      },
      onInspectTextRange,
    );
    const textArea = screen.getByDisplayValue("Hello") as HTMLTextAreaElement;
    textArea.setSelectionRange(1, 4);
    fireEvent.select(textArea);

    expect(screen.getByRole("spinbutton", { name: "size px" })).toHaveProperty(
      "value",
      "36",
    );
    expect(
      screen.getByRole("combobox", { name: "weight" }).textContent,
    ).toContain("fontWeightBold");
    expect(screen.getByLabelText("fontFamily")).toHaveProperty(
      "value",
      "Georgia",
    );
    expect(screen.getByLabelText("textColor")).toHaveProperty(
      "value",
      "#123456",
    );
    expect(onInspectTextRange).toHaveBeenCalledWith({
      start: 1,
      end: 4,
      expectedText: "Hello",
    });
  });

  it("keeps a cleared font family visible for the selected text range", () => {
    const { onEdit } = renderInspector({ fontFamily: "Arial" }, "Hello", 1, {
      line: 1,
      column: 1,
      nodeId: "node-1",
      start: 1,
      end: 4,
      expectedText: "Hello",
      styles: {
        color: "#000000",
        fontFamily: "Georgia",
        fontSize: "24px",
        fontStyle: "normal",
        fontWeight: "400",
      },
    });
    const textArea = screen.getByDisplayValue("Hello") as HTMLTextAreaElement;
    textArea.setSelectionRange(1, 4);
    fireEvent.select(textArea);

    const fontFamily = screen.getByLabelText("fontFamily");
    fireEvent.change(fontFamily, { target: { value: "" } });
    fireEvent.blur(fontFamily);

    expect(onEdit).toHaveBeenCalledWith([
      {
        kind: "set-text-range-style",
        start: 1,
        end: 4,
        key: "fontFamily",
        value: null,
        prevText: "Hello",
      },
    ]);
    expect(fontFamily).toHaveProperty("value", "");
  });

  it("shows named font weights and saves their numeric CSS values", () => {
    const { onEdit } = renderInspector({ fontWeight: "400" });
    const trigger = screen.getByRole("combobox", { name: "weight" });

    expect(trigger.textContent).toContain("fontWeightRegular");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "fontWeightSemibold" }));

    expect(onEdit).toHaveBeenCalledWith([
      {
        kind: "set-style",
        key: "fontWeight",
        value: "600",
        prevText: "Hello",
      },
    ]);
  });

  it("applies bold to the whole text element when no range is selected", () => {
    const { onEdit } = renderInspector();

    fireEvent.click(screen.getByRole("button", { name: "bold" }));

    expect(onEdit).toHaveBeenCalledWith([
      {
        kind: "set-style",
        key: "fontWeight",
        value: "700",
        prevText: "Hello",
      },
    ]);
  });

  it("clears a solid fill to transparent", () => {
    const { onEdit } = renderInspector({ backgroundColor: "#ff0000" });

    fireEvent.click(screen.getByRole("button", { name: "transparent" }));

    expect(onEdit).toHaveBeenCalledWith([
      {
        kind: "set-style",
        key: "backgroundColor",
        value: null,
        prevText: "Hello",
      },
    ]);
  });

  it("keeps image controls out of the style inspector", () => {
    const { selected, rerenderSelected } = renderInspector();
    rerenderSelected({ ...selected, tagName: "img" });

    expect(screen.queryByRole("button", { name: "replaceImage" })).toBeNull();
    expect(screen.queryByRole("button", { name: "cropImage" })).toBeNull();
  });

  it("shows transparent fills with a light color swatch and disables clearing", () => {
    renderInspector({ backgroundColor: "rgba(255, 0, 0, 0)" });

    expect(screen.getByLabelText("fill")).toHaveProperty("value", "#ffffff");
    expect(
      screen
        .getByRole("button", { name: "transparent" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("shows arrange controls without editing only the first item in a multi-selection", () => {
    renderInspector({}, "Hello", 2);

    expect(screen.queryByDisplayValue("Hello")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByRole("button", { name: "align left" })).toBeTruthy();
  });

  it("does not commit an empty numeric field as zero", () => {
    const { onEdit } = renderInspector();
    const x = screen.getByRole("spinbutton", { name: "x px" });

    fireEvent.change(x, { target: { value: "" } });
    fireEvent.blur(x);

    expect(onEdit).not.toHaveBeenCalled();
    expect(x).toHaveProperty("value", "20");
  });

  it("does not commit an unchanged numeric field on blur", () => {
    const { onEdit } = renderInspector();
    const x = screen.getByRole("spinbutton", { name: "x px" });

    fireEvent.focus(x);
    fireEvent.blur(x);

    expect(onEdit).not.toHaveBeenCalled();
  });

  it("preserves a focused numeric draft when selected geometry refreshes", () => {
    const { onEdit, selected, rerenderSelected } = renderInspector();
    const x = screen.getByRole("spinbutton", { name: "x px" });

    fireEvent.focus(x);
    fireEvent.change(x, { target: { value: "55" } });
    rerenderSelected({
      ...selected,
      bounds: { ...selected.bounds, x: 25 },
    });

    expect(x).toHaveProperty("value", "55");

    fireEvent.blur(x);

    expect(onEdit).toHaveBeenCalled();
  });

  it("cancels a numeric field edit on Escape", () => {
    const { onEdit } = renderInspector();
    const x = screen.getByRole("spinbutton", { name: "x px" });

    fireEvent.focus(x);
    fireEvent.change(x, { target: { value: "55" } });
    fireEvent.keyDown(x, { key: "Escape" });
    fireEvent.blur(x);

    expect(onEdit).not.toHaveBeenCalled();
    expect(x).toHaveProperty("value", "20");
  });

  it("disables distribution for a two-object selection", () => {
    renderInspector({}, "Hello", 2);

    expect(screen.getByRole("button", { name: "horizontal" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "vertical" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
