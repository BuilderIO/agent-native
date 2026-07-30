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
    icon: Icon,
    labelClassName,
    prefix,
  }: {
    label: string;
    value: number;
    mixed?: boolean;
    mixedLabel?: string;
    onChange: (value: number) => void;
    icon?: React.ElementType;
    labelClassName?: string;
    prefix?: "label" | "icon";
  }) => (
    <div>
      <label
        data-testid={`scrub-label-${label}`}
        data-prefix={prefix}
        className={labelClassName}
      >
        {Icon ? <Icon /> : null}
        <span className={prefix === "icon" ? "sr-only" : undefined}>
          {label}
        </span>
      </label>
      <input
        aria-label={label}
        type="number"
        value={value}
        data-mixed={mixed || undefined}
        data-mixed-label={mixedLabel}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </div>
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
  type SlideBackgroundStyleSnapshot,
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
  zIndex: 0,
};

const backgroundSnapshot: SlideBackgroundStyleSnapshot = {
  mode: "background",
  backgroundColor: "#f5f5f5",
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

  it("renders only fill controls for a slide background snapshot", () => {
    render(
      <SlideStyleInspector
        snapshot={backgroundSnapshot}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("styleInspector.background")).toBeTruthy();
    expect(screen.getByText("styleInspector.fill")).toBeTruthy();
    expect(
      screen
        .getByTestId("color-styleInspector.fill")
        .getAttribute("data-value"),
    ).toBe("#f5f5f5");
    expect(screen.queryByText("styleInspector.position")).toBeNull();
    expect(screen.queryByText("styleInspector.layoutDimensions")).toBeNull();
    expect(screen.queryByText("styleInspector.appearance")).toBeNull();
    expect(screen.queryByText("styleInspector.stroke")).toBeNull();
    expect(screen.queryByText("styleInspector.typography")).toBeNull();
    expect(screen.queryByText("styleInspector.spacing")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "styleInspector.bringToFront" }),
    ).toBeNull();
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
  });

  it("uses compact icon prefixes for long numeric labels", () => {
    renderInspector();

    [
      "styleInspector.rotation",
      "styleInspector.width",
      "styleInspector.height",
      "styleInspector.opacity",
      "styleInspector.cornerRadius",
      "styleInspector.strokeWeight",
      "styleInspector.size",
      "styleInspector.line",
      "styleInspector.horizontal",
      "styleInspector.vertical",
    ].forEach((label) => {
      const prefix = screen.getByTestId(`scrub-label-${label}`);
      expect(prefix.querySelector("svg")).toBeTruthy();
      expect(prefix.getAttribute("data-prefix")).toBe("icon");
      expect(prefix.querySelector("span")?.className).toContain("sr-only");
      expect(screen.getByRole("spinbutton", { name: label })).toBeTruthy();
    });

    ["styleInspector.x", "styleInspector.y"].forEach((label) => {
      const prefix = screen.getByTestId(`scrub-label-${label}`);
      expect(prefix.querySelector("svg")).toBeNull();
      expect(prefix.className).toContain("w-8");
      expect(prefix.className).toContain("justify-center");
    });
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

  it("shows bring-to-front / send-to-back only for a selected freeform object", () => {
    const onArrange = vi.fn();
    render(
      <SlideStyleInspector
        snapshot={snapshot}
        onChange={vi.fn()}
        onArrange={onArrange}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "styleInspector.bringToFront" }),
    );
    expect(onArrange).toHaveBeenLastCalledWith("front");

    fireEvent.click(
      screen.getByRole("button", { name: "styleInspector.sendToBack" }),
    );
    expect(onArrange).toHaveBeenLastCalledWith("back");
  });

  it("hides the Arrange row when there is no onArrange handler or the object isn't freeform", () => {
    renderInspector();
    expect(
      screen.queryByRole("button", { name: "styleInspector.bringToFront" }),
    ).toBeNull();

    render(
      <SlideStyleInspector
        snapshot={{ ...snapshot, isAbsolute: false }}
        onChange={vi.fn()}
        onArrange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "styleInspector.sendToBack" }),
    ).toBeNull();
  });
});
