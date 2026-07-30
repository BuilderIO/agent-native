// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/toolkit/design-tweaks", () => ({
  VisualColorPicker: ({
    label,
    value,
    mixed,
    mixedLabel,
  }: {
    label: string;
    value: string;
    mixed?: boolean;
    mixedLabel?: string;
  }) => (
    <span
      data-testid={`color-${label}`}
      data-value={value}
      data-mixed={mixed || undefined}
      data-mixed-label={mixedLabel}
    />
  ),
  VisualControlRow: ({
    label,
    children,
  }: {
    label: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div>
      <span>{label}</span>
      {children}
    </div>
  ),
  VisualInspectorPanel: ({
    title,
    subtitle,
    children,
    headerAction,
    className,
  }: {
    title: React.ReactNode;
    subtitle: React.ReactNode;
    children: React.ReactNode;
    headerAction: React.ReactNode;
    className?: string;
  }) => (
    <aside className={className}>
      <h2>{title}</h2>
      <p>{subtitle}</p>
      {headerAction}
      {children}
    </aside>
  ),
  VisualInspectorSection: ({
    title,
    children,
  }: {
    title: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <section>
      <h3>{title}</h3>
      {children}
    </section>
  ),
  VisualScrubInput: ({
    label,
    value,
    mixed,
    mixedLabel,
    onChange,
  }: {
    label: string;
    value: number;
    mixed?: boolean;
    mixedLabel?: string;
    onChange: (value: number) => void;
  }) => (
    <input
      aria-label={label}
      type="number"
      value={value}
      data-mixed={mixed || undefined}
      data-mixed-label={mixedLabel}
      onChange={(event) => onChange(Number(event.currentTarget.value))}
    />
  ),
  VisualSegmentedControl: ({
    options,
    value,
    onChange,
  }: {
    options: { label: string; value: string }[];
    value: string | null;
    onChange: (value: string) => void;
  }) => (
    <div data-segmented-value={value ?? "mixed"}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
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

  it("scopes filled, borderless shared scrub inputs to the Slides inspector", () => {
    const css = readFileSync(resolve(process.cwd(), "app/global.css"), "utf8");

    expect(css).toContain(".slide-style-inspector input");
    expect(css).toContain("border: 0;");
    expect(css).toContain(
      "background: var(--slides-inspector-control-background)",
    );
  });

  it("renders the requested shared inspector sections", () => {
    renderInspector();

    [
      "styleInspector.position",
      "styleInspector.layoutDimensions",
      "styleInspector.appearance",
      "styleInspector.fill",
      "styleInspector.stroke",
      "styleInspector.typography",
      "styleInspector.spacing",
    ].forEach((section) => expect(screen.getByText(section)).toBeTruthy());
  });

  it("emits pixel alignment, dimensions, and rotation patches", () => {
    const onChange = renderInspector();

    fireEvent.click(
      screen.getAllByRole("button", { name: "styleInspector.center" })[0],
    );
    expect(onChange).toHaveBeenLastCalledWith({ left: "400px" });

    fireEvent.click(
      screen.getByRole("button", { name: "styleInspector.bottom" }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ top: "495px" });

    fireEvent.change(
      screen.getByRole("spinbutton", { name: "styleInspector.width" }),
      {
        target: { value: "420" },
      },
    );
    expect(onChange).toHaveBeenLastCalledWith({ width: "420px" });

    fireEvent.change(
      screen.getByRole("spinbutton", { name: "styleInspector.rotation" }),
      {
        target: { value: "30" },
      },
    );
    expect(onChange).toHaveBeenLastCalledWith({ transform: "rotate(30deg)" });
  });

  it("shows honest mixed state for a multi-style text selection", () => {
    render(
      <SlideStyleInspector
        snapshot={{
          ...snapshot,
          textStyleScope: "selection",
          mixedTextStyles: ["color", "fontSize", "fontWeight"],
        }}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const color = screen.getByTestId("color-styleInspector.textColor");
    expect(color.getAttribute("data-mixed")).toBe("true");
    expect(color.getAttribute("data-mixed-label")).toBe("styleInspector.mixed");

    const size = screen.getByRole("spinbutton", {
      name: "styleInspector.size",
    });
    expect(size.getAttribute("data-mixed")).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "styleInspector.regular" })
        .parentElement?.getAttribute("data-segmented-value"),
    ).toBe("mixed");
  });
});
