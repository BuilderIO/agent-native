import type { useT } from "@agent-native/core/client/i18n";
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import type { SlideFrameTextRangeStyle } from "../slides-2-runtime/protocol";
import { Slides2Inspector } from "./Slides2Inspector";
import type { ElementSnapshot } from "./types";

afterEach(cleanup);

function disclosure(name: string): HTMLElement {
  const button = screen.queryByRole("button", { name });
  if (button) return button;

  const summary = Array.from(
    document.querySelectorAll<HTMLElement>("summary,button"),
  ).find((element) => element.textContent?.trim().startsWith(name));
  if (!summary) throw new Error(`Missing ${name} disclosure`);
  return summary;
}

const t = ((key: string) => key.split(".").at(-1) ?? key) as ReturnType<
  typeof useT
>;

function renderInspector(
  styles: Record<string, string> = {},
  text = "Hello",
  selectionCount = 1,
  rangeStyleSnapshot?: SlideFrameTextRangeStyle | null,
  onInspectTextRange = vi.fn(),
  onEditOnSlide = vi.fn(),
  onGroup = vi.fn(),
  onUngroup = vi.fn(),
  canUngroup = false,
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

  const renderSelected = (nextSelected: ElementSnapshot | null = selected) => (
    <TooltipProvider>
      <Slides2Inspector
        selected={nextSelected}
        selectionCount={selectionCount}
        disabled={false}
        t={t}
        rangeStyleSnapshot={rangeStyleSnapshot}
        onInspectTextRange={onInspectTextRange}
        onEditOnSlide={onEditOnSlide}
        onEdit={onEdit}
        onAlign={vi.fn()}
        alignToSlide={false}
        onAlignToSlideChange={vi.fn()}
        smartGuidesEnabled
        onSmartGuidesChange={vi.fn()}
        onDistribute={vi.fn()}
        onArrange={vi.fn()}
        onGroup={onGroup}
        onUngroup={onUngroup}
        canUngroup={canUngroup}
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
    onEditOnSlide,
    onGroup,
    onUngroup,
    selected,
    rerenderSelected: (nextSelected: ElementSnapshot | null) =>
      view.rerender(renderSelected(nextSelected)),
  };
}

function selectArrangeTab() {
  fireEvent.click(screen.getByLabelText("arrange"));
}

describe("Slides2Inspector", () => {
  it("explains how to select an object when nothing is selected", () => {
    const { rerenderSelected } = renderInspector();
    rerenderSelected(null);

    expect(screen.getByRole("heading", { name: "selectElement" })).toBeTruthy();
    expect(screen.getByText("selectElementHint")).toBeTruthy();
  });

  it("opens inline editing from the content section", () => {
    const { onEditOnSlide } = renderInspector();

    expect(screen.getByRole("heading", { name: "content" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "editOnSlide" }));

    expect(onEditOnSlide).toHaveBeenCalledTimes(1);
  });

  it("keeps the selected element tab controls above inspector sections", () => {
    renderInspector();

    expect(
      screen.getByRole("radio", { name: "text" }).closest(".order-first"),
    ).not.toBeNull();
  });

  it("shows Group for a multi-selection and invokes the group action", () => {
    const onGroup = vi.fn();
    renderInspector({}, "Hello", 2, undefined, undefined, undefined, onGroup);

    fireEvent.click(screen.getByRole("button", { name: "group" }));

    expect(onGroup).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "ungroup" })).toBeNull();
  });

  it("shows Ungroup only for a selected group", () => {
    const onUngroup = vi.fn();
    renderInspector(
      {},
      "Group",
      1,
      undefined,
      undefined,
      undefined,
      undefined,
      onUngroup,
      true,
    );
    selectArrangeTab();

    fireEvent.click(screen.getByRole("button", { name: "ungroup" }));

    expect(onUngroup).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "group" })).toBeNull();
  });

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
    expect(bold.classList.contains("size-7")).toBe(true);
    expect(italic.classList.contains("size-7")).toBe(true);
    expect(center.classList.contains("size-7")).toBe(true);
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

  it("does not report text ranges while IME text is composing", () => {
    const onInspectTextRange = vi.fn();
    renderInspector({}, "Hello", 1, null, onInspectTextRange);
    const textArea = screen.getByDisplayValue("Hello") as HTMLTextAreaElement;

    textArea.setSelectionRange(0, 5);
    fireEvent.select(textArea);
    expect(onInspectTextRange).toHaveBeenLastCalledWith({
      start: 0,
      end: 5,
      expectedText: "Hello",
    });

    fireEvent.compositionStart(textArea);
    expect(onInspectTextRange).toHaveBeenLastCalledWith(null);

    fireEvent.change(textArea, { target: { value: "こんにちは" } });
    textArea.setSelectionRange(0, 5);
    fireEvent.select(textArea);
    expect(onInspectTextRange).toHaveBeenLastCalledWith(null);

    fireEvent.compositionEnd(textArea);
    expect(onInspectTextRange).toHaveBeenLastCalledWith({
      start: 0,
      end: 5,
      expectedText: "こんにちは",
    });
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

  it("keeps typography fields compact and accessibly labeled", () => {
    renderInspector();

    const weight = screen.getByRole("combobox", { name: "weight" });
    expect(weight.classList.contains("h-7")).toBe(true);
    expect(
      weight
        .closest("label")
        ?.parentElement?.classList.contains("grid-cols-[2fr_1fr]"),
    ).toBe(true);
    expect(
      weight.closest("label")?.firstElementChild?.classList.contains("sr-only"),
    ).toBe(true);

    for (const label of ["size", "lineHeight", "letterSpacing"]) {
      const field = screen.getByRole("spinbutton", { name: `${label} px` });
      expect(field.classList.contains("h-7")).toBe(true);
      expect(
        field
          .closest("label")
          ?.firstElementChild?.classList.contains("sr-only"),
      ).toBe(true);
      expect(
        field.parentElement?.querySelector('svg[aria-hidden="true"]'),
      ).not.toBeNull();
    }
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
    fireEvent.click(disclosure("fontFamily"));
    expect(screen.getByRole("textbox", { name: "fontFamily" })).toHaveProperty(
      "value",
      "Georgia",
    );
    expect(
      screen.getByLabelText("textColor", { selector: 'input[type="text"]' }),
    ).toHaveProperty("value", "#123456");
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

    fireEvent.click(disclosure("fontFamily"));
    const fontFamily = screen.getByRole("textbox", { name: "fontFamily" });
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

  it.each(["300", "800"])("supports CSS font weight %s", (weight) => {
    const { onEdit } = renderInspector();
    fireEvent.click(screen.getByRole("combobox", { name: "weight" }));
    fireEvent.click(screen.getByRole("option", { name: weight }));

    expect(onEdit).toHaveBeenCalledWith([
      {
        kind: "set-style",
        key: "fontWeight",
        value: weight,
        prevText: "Hello",
      },
    ]);
  });

  it("keeps font family available from the compact Typography header", () => {
    renderInspector();

    const trigger = disclosure("fontFamily");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    const typography = screen.getByRole("heading", { name: "typography" });
    expect(typography.parentElement?.contains(trigger)).toBe(true);
    expect(trigger.querySelector("svg")).not.toBeNull();
    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("textbox", { name: "fontFamily" })).toBeTruthy();
  });

  it("keeps Position controls available in a collapsed section", () => {
    renderInspector();
    expect(screen.queryByRole("spinbutton", { name: "x px" })).toBeNull();
    selectArrangeTab();

    const summary = disclosure("position");
    expect((summary.closest("details") as HTMLDetailsElement).open).toBe(false);
    fireEvent.click(summary);

    expect((summary.closest("details") as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByRole("spinbutton", { name: "x px" })).toBeTruthy();
    expect(screen.getByRole("spinbutton", { name: "width px" })).toBeTruthy();
  });

  it("uses unrotated dimensions for Position after the object is rotated", () => {
    const { onEdit, selected, rerenderSelected } = renderInspector();
    selectArrangeTab();
    rerenderSelected({
      ...selected,
      bounds: { ...selected.bounds, width: 80, height: 200 },
      transform: {
        basis: { a: 0, b: 1, c: -1, d: 0 },
        translate: { x: 0, y: 0 },
        width: 200,
        height: 80,
        rotation: 90,
      },
    });
    fireEvent.click(disclosure("position"));

    const width = screen.getByRole("spinbutton", { name: "width px" });
    const height = screen.getByRole("spinbutton", { name: "height px" });
    expect(width).toHaveProperty("value", "200");
    expect(height).toHaveProperty("value", "80");

    fireEvent.focus(width);
    fireEvent.change(width, { target: { value: "240" } });
    fireEvent.blur(width);

    expect(onEdit).toHaveBeenCalledWith([
      {
        kind: "set-style",
        key: "width",
        value: "240px",
        prevText: "Hello",
      },
    ]);
  });

  it("shows the selected element source location in a collapsed section", () => {
    renderInspector();

    const summary = disclosure("source");
    expect((summary.closest("details") as HTMLDetailsElement).open).toBe(false);
    fireEvent.click(summary);

    expect(screen.getByText("<div> · 1:1")).toBeTruthy();
  });

  it("displays and saves unitless line-height ratios when source metadata says they are unitless", () => {
    const { onEdit, selected, rerenderSelected } = renderInspector({
      fontSize: "58px",
      lineHeight: "59.16px",
    });
    rerenderSelected({
      ...selected,
      authoredStyles: { lineHeight: "1.02" },
    });

    const lineHeight = screen.getByRole("spinbutton", { name: "lineHeight" });
    expect(lineHeight).toHaveProperty("value", "1.02");
    fireEvent.focus(lineHeight);
    fireEvent.change(lineHeight, { target: { value: "1.25" } });
    fireEvent.blur(lineHeight);

    expect(onEdit).toHaveBeenCalledWith([
      {
        kind: "set-style",
        key: "lineHeight",
        value: "1.25",
        prevText: "Hello",
      },
    ]);
  });

  it("keeps computed and explicitly authored pixel line heights in px", () => {
    const { onEdit, selected, rerenderSelected } = renderInspector({
      fontSize: "58px",
      lineHeight: "59.16px",
    });
    const computedLineHeight = screen.getByRole("spinbutton", {
      name: "lineHeight px",
    });
    expect(computedLineHeight).toHaveProperty("value", "59.16");

    rerenderSelected({
      ...selected,
      authoredStyles: { lineHeight: "28px" },
    });
    const authoredLineHeight = screen.getByRole("spinbutton", {
      name: "lineHeight px",
    });
    expect(authoredLineHeight).toHaveProperty("value", "28");
    fireEvent.focus(authoredLineHeight);
    fireEvent.change(authoredLineHeight, { target: { value: "32" } });
    fireEvent.blur(authoredLineHeight);

    expect(onEdit).toHaveBeenCalledWith([
      {
        kind: "set-style",
        key: "lineHeight",
        value: "32px",
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

    expect(
      screen.getByLabelText("background", { selector: 'input[type="text"]' }),
    ).toHaveProperty("value", "#ffffff");
    expect(
      screen.getByLabelText("background", { selector: 'input[type="color"]' }),
    ).toHaveProperty("value", "#ffffff");
    expect(
      screen
        .getByRole("button", { name: "transparent" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("edits colors through the compact hex field while retaining the picker", () => {
    const { onEdit } = renderInspector({
      color: "#123456",
      backgroundColor: "#ffffff",
    });
    const textColor = screen.getByLabelText("textColor", {
      selector: 'input[type="text"]',
    });

    expect(
      screen.getByLabelText("textColor", { selector: 'input[type="color"]' }),
    ).toBeTruthy();
    expect(textColor.className).toContain("h-7");
    expect(textColor.parentElement?.parentElement?.className).toContain("flex");
    fireEvent.change(textColor, { target: { value: "#abcdef" } });
    fireEvent.blur(textColor);

    expect(onEdit).toHaveBeenCalledWith([
      {
        kind: "set-style",
        key: "color",
        value: "#abcdef",
        prevText: "Hello",
      },
    ]);
  });

  it("shows arrange controls without editing only the first item in a multi-selection", () => {
    renderInspector({}, "Hello", 2);

    expect(screen.queryByDisplayValue("Hello")).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByRole("button", { name: "align left" })).toBeTruthy();
  });

  it("does not commit an empty numeric field as zero", () => {
    const { onEdit } = renderInspector();
    selectArrangeTab();
    const x = screen.getByRole("spinbutton", { name: "x px" });

    fireEvent.change(x, { target: { value: "" } });
    fireEvent.blur(x);

    expect(onEdit).not.toHaveBeenCalled();
    expect(x).toHaveProperty("value", "20");
  });

  it("does not commit an unchanged numeric field on blur", () => {
    const { onEdit } = renderInspector();
    selectArrangeTab();
    const x = screen.getByRole("spinbutton", { name: "x px" });

    fireEvent.focus(x);
    fireEvent.blur(x);

    expect(onEdit).not.toHaveBeenCalled();
  });

  it("preserves a focused numeric draft when selected geometry refreshes", () => {
    const { onEdit, selected, rerenderSelected } = renderInspector();
    selectArrangeTab();
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
    selectArrangeTab();
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
