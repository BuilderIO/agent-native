// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/toolkit/design-tweaks", () => ({
  VisualColorPicker: ({ label }: { label: string }) => (
    <button type="button" aria-label={label}>
      {label}
    </button>
  ),
}));

import {
  SlideStyleInspector,
  type SlideStyleSnapshot,
} from "./SlideStyleInspector";

const snapshot: SlideStyleSnapshot = {
  selector: "[data-builder-id='title']",
  label: "Title",
  tagName: "h1",
  textPreview: "A quiet inspector",
  isText: true,
  isImage: false,
  isAbsolute: true,
  x: 120,
  y: 80,
  width: 400,
  height: 180,
  rotation: 15,
  slideWidth: 1200,
  slideHeight: 675,
  color: "#111111",
  backgroundColor: "#ffffff",
  fontSize: 32,
  fontWeight: "600",
  lineHeight: 1.2,
  textAlign: "left",
  opacity: 100,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: "#111111",
  paddingX: 16,
  paddingY: 12,
};

function renderInspector(onChange = vi.fn()) {
  render(
    <SlideStyleInspector
      snapshot={snapshot}
      onChange={onChange}
      onClose={vi.fn()}
    />,
  );
  return onChange;
}

describe("SlideStyleInspector", () => {
  afterEach(cleanup);

  it("uses filled, borderless local numeric fields", () => {
    renderInspector();

    const width = screen.getByRole("spinbutton", { name: "W" });
    expect(width.getAttribute("class")).toContain("border-0");
    expect(width.getAttribute("class")).toContain("bg-transparent");
    expect(width.parentElement?.getAttribute("class")).toContain("bg-muted/70");
  });

  it("emits pixel alignment and dimension patches", () => {
    const onChange = renderInspector();

    fireEvent.click(screen.getByRole("button", { name: "Align center" }));
    expect(onChange).toHaveBeenLastCalledWith({
      left: "400px",
      transform: "rotate(15deg)",
    });

    fireEvent.click(screen.getByRole("button", { name: "Align bottom" }));
    expect(onChange).toHaveBeenLastCalledWith({
      top: "495px",
      transform: "rotate(15deg)",
    });

    const width = screen.getByRole("spinbutton", { name: "W" });
    fireEvent.change(width, { target: { value: "420" } });
    fireEvent.blur(width);
    expect(onChange).toHaveBeenLastCalledWith({ width: "420px" });
  });
});
