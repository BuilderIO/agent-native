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
