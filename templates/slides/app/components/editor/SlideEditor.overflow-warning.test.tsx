// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SlideOverflowWarning } from "./SlideOverflowWarning";

const source = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "SlideEditor.tsx"),
  "utf8",
);

describe("SlideEditor layout overflow warning", () => {
  afterEach(cleanup);

  it("renders as a soft card above the slide, not overlapping it", () => {
    render(
      <SlideOverflowWarning
        verticalOverflow={59}
        warningLabel="Layout overflows"
        overflowDetails="Vertical overflow: 59px"
        overflowDetailsLabel="Show overflow details"
        isAskingAgentToFix={false}
        dismissLabel="Dismiss layout warning"
        onFix={() => {}}
        onDismiss={() => {}}
      />,
    );

    const status = screen.getByRole("status");
    expect(status.className).toContain("text-foreground");
    expect(status.className).toContain("bg-card");
    expect(status.className).toContain("shadow-sm");
    expect(status.className).not.toContain("border");
    expect(status.className).toContain("-top-12");
    expect(screen.getByText("Layout overflows")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Show overflow details" }),
    ).toBeTruthy();
  });

  it("persists dismissal per slide revision until the content is updated", () => {
    expect(source).toContain("readClientAppState");
    expect(source).toContain("setClientAppState");
    expect(source).toContain("slides-layout-warning-dismissed:");
    expect(source).toContain("dismissedOverflowWarningHash");
    expect(source).toContain("hashSlideContent(slide.content)");
  });

  it("keeps its controls from triggering canvas interactions", () => {
    const onCanvasPointerDown = vi.fn();
    const onCanvasClick = vi.fn();
    const onDismiss = vi.fn();

    render(
      <div onPointerDown={onCanvasPointerDown} onClick={onCanvasClick}>
        <SlideOverflowWarning
          verticalOverflow={59}
          warningLabel="Layout overflows"
          overflowDetails="Vertical overflow: 59px"
          overflowDetailsLabel="Show overflow details"
          isAskingAgentToFix={false}
          dismissLabel="Dismiss layout warning"
          onFix={() => {}}
          onDismiss={onDismiss}
        />
      </div>,
    );

    const dismissButton = screen.getByRole("button", {
      name: "Dismiss layout warning",
    });
    fireEvent.pointerDown(dismissButton);
    fireEvent.click(dismissButton);

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onCanvasPointerDown).not.toHaveBeenCalled();
    expect(onCanvasClick).not.toHaveBeenCalled();
  });
});
