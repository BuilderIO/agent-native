// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Badge } from "./badge.js";

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
  vi.unstubAllGlobals();
});

describe("Badge sizes", () => {
  it("keeps the default size unchanged", () => {
    act(() => root.render(<Badge variant="outline">New</Badge>));
    const classes = container.firstElementChild!.className.split(" ");
    expect(classes).toEqual(
      expect.arrayContaining(["px-2.5", "py-0.5", "text-xs", "font-semibold"]),
    );
  });

  it("renders a compact sm badge that fits a 24px row", () => {
    act(() =>
      root.render(
        <Badge variant="outline" size="sm">
          Recommended
        </Badge>,
      ),
    );
    const classes = container.firstElementChild!.className.split(" ");
    expect(classes).toEqual(
      expect.arrayContaining([
        "h-[18px]",
        "px-1.5",
        "text-[11px]",
        "leading-4",
        "font-normal",
        "rounded-full",
        "border",
      ]),
    );
    expect(classes).not.toEqual(expect.arrayContaining(["px-2.5"]));
    expect(classes).not.toContain("text-xs");
    expect(classes).not.toContain("font-semibold");
  });
});
