// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  VisualColorPicker,
  VisualScrubInput,
  VisualSegmentedControl,
} from "./visual-style-controls.js";

describe("visual style controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows an honest mixed color instead of the fallback color", () => {
    act(() => {
      root.render(
        <VisualColorPicker
          label="Color"
          value="#000000"
          mixed
          mixedLabel="Mixed colors"
          onChange={() => {}}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Color"]',
    );
    expect(trigger?.textContent).toContain("Mixed colors");
    expect(trigger?.querySelector("span")?.style.background).toContain(
      "linear-gradient",
    );
  });

  it("renders the filled color trigger without an outer border", () => {
    act(() => {
      root.render(
        <VisualColorPicker
          label="Fill"
          value="#609ff8"
          variant="filled"
          onChange={() => {}}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Fill"]',
    );
    expect(trigger?.classList.contains("border-0")).toBe(true);
    expect(trigger?.classList.contains("border")).toBe(false);
    expect(trigger?.className).toContain("bg-muted/80");
  });

  it("uses the numeric value after a mixed scrub field receives focus", () => {
    act(() => {
      root.render(
        <VisualScrubInput
          label="Width"
          value={24}
          unit="px"
          mixed
          mixedLabel="Mixed values"
          onChange={() => {}}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input");
    expect(input?.value).toBe("Mixed values");

    act(() => input?.focus());
    expect(input?.value).toBe("24px");
  });

  it("supports a compact icon prefix without removing the accessible label", () => {
    const TestIcon = ({
      className,
      "aria-hidden": ariaHidden,
    }: {
      className?: string;
      "aria-hidden"?: boolean;
    }) => (
      <svg
        data-testid="scrub-icon"
        className={className}
        aria-hidden={ariaHidden}
      />
    );

    act(() => {
      root.render(
        <VisualScrubInput
          label="Corner radius"
          value={12}
          unit="px"
          icon={TestIcon}
          prefix="icon"
          onChange={() => {}}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>("input");
    const label = container.querySelector<HTMLLabelElement>("label");
    expect(label?.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(label?.className).toContain("w-8");
    expect(label?.querySelector("span")?.textContent).toBe("Corner radius");
    expect(label?.querySelector("span")?.className).toContain("sr-only");
    expect(label?.htmlFor).toBe(input?.id);
  });

  it("keeps labels single-line while the numeric input fills the remaining row", () => {
    act(() => {
      root.render(
        <VisualScrubInput
          label="A long numeric property label"
          value={12}
          onChange={() => {}}
        />,
      );
    });

    const row = container.querySelector("div");
    const label = container.querySelector("label");
    const input = container.querySelector("input");
    expect(row?.className).toContain("min-w-0");
    expect(label?.className).toContain("whitespace-nowrap");
    expect(label?.querySelector("span")?.className).toContain("truncate");
    expect(input?.className).toContain("w-0");
    expect(input?.className).toContain("flex-1");
  });

  it("leaves every segment unselected for a mixed value", () => {
    act(() => {
      root.render(
        <VisualSegmentedControl
          options={[
            { label: "Left", value: "left" },
            { label: "Center", value: "center" },
          ]}
          value={null}
          onChange={() => {}}
        />,
      );
    });

    expect(
      container.querySelectorAll(".bg-accent.text-foreground"),
    ).toHaveLength(0);
  });
});
