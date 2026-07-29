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

function sectionSummary(title: string) {
  const summary = Array.from(document.querySelectorAll("summary")).find(
    (element) => element.textContent?.includes(title),
  );
  if (!summary) throw new Error(`Missing ${title} section`);
  return summary;
}

describe("SlideStyleInspector", () => {
  afterEach(cleanup);

  it("uses filled, borderless local numeric fields", () => {
    renderInspector();

    for (const field of document.querySelectorAll<HTMLInputElement>(
      "[data-inspector-field]",
    )) {
      expect(field.getAttribute("class")).toContain("border-0");
      expect(field.getAttribute("class")).toContain("bg-transparent");
      expect(field.parentElement?.getAttribute("class")).toContain(
        "bg-muted/70",
      );
    }
  });

  it("keeps each requested inspector section available through disclosure", () => {
    renderInspector();

    [
      "Position",
      "Layout & dimensions",
      "Appearance",
      "Fill",
      "Stroke",
      "Typography",
      "Spacing",
    ].forEach((section) => expect(sectionSummary(section)).toBeTruthy());

    fireEvent.click(sectionSummary("Stroke"));
    expect(screen.getByRole("spinbutton", { name: "Weight" })).toBeTruthy();

    fireEvent.click(sectionSummary("Spacing"));
    expect(screen.getByRole("spinbutton", { name: "Horizontal" })).toBeTruthy();
  });

  it("emits pixel alignment and dimension patches", () => {
    const onChange = renderInspector();

    fireEvent.click(screen.getByRole("button", { name: "Align center" }));
    expect(onChange).toHaveBeenLastCalledWith({
      left: "400px",
    });

    fireEvent.click(screen.getByRole("button", { name: "Align bottom" }));
    expect(onChange).toHaveBeenLastCalledWith({
      top: "495px",
    });

    const width = screen.getByRole("spinbutton", { name: "W" });
    fireEvent.change(width, { target: { value: "420" } });
    fireEvent.blur(width);
    expect(onChange).toHaveBeenLastCalledWith({ width: "420px" });

    const rotation = screen.getByRole("spinbutton", { name: "Rotation" });
    fireEvent.change(rotation, { target: { value: "30" } });
    fireEvent.blur(rotation);
    expect(onChange).toHaveBeenLastCalledWith({ transform: "rotate(30deg)" });
  });
});
