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

  it("renders as plain amber text above the slide, not overlapping it", () => {
    render(
      <SlideOverflowWarning
        verticalOverflow={59}
        isAskingAgentToFix={false}
        dismissLabel="Dismiss layout warning"
        onFix={() => {}}
        onDismiss={() => {}}
      />,
    );

    const status = screen.getByRole("status");
    expect(status.className).toContain("text-amber-400");
    expect(status.className).not.toContain("border");
    expect(status.className).not.toContain("bg-amber-950/95");
    expect(status.className).toContain("-top-12");
    expect(screen.getByText("Layout overflows by 59px")).toBeTruthy();
  });

  it("can be dismissed until the slide content changes", () => {
    expect(source).toContain("!isOverflowWarningDismissed");
    expect(source).toContain("setIsOverflowWarningDismissed(false)");
    expect(source).toContain("setIsOverflowWarningDismissed(true)");
  });

  it("keeps its controls from triggering canvas interactions", () => {
    const onCanvasPointerDown = vi.fn();
    const onCanvasClick = vi.fn();
    const onDismiss = vi.fn();

    render(
      <div onPointerDown={onCanvasPointerDown} onClick={onCanvasClick}>
        <SlideOverflowWarning
          verticalOverflow={59}
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
