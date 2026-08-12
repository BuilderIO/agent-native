// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppIcon } from "./app-icon";

describe("AppIcon", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("gives Plan a colored generated accent instead of a neutral gray", () => {
    act(() => {
      root.render(<AppIcon id="plan" name="Plan" />);
    });

    const icon = container.firstElementChild as HTMLElement;
    expect(icon.style.getPropertyValue("--dispatch-app-icon-color-rgb")).toBe(
      "47 111 237",
    );
    expect(icon.style.color).toBe("rgb(var(--dispatch-app-icon-color-rgb))");
  });
});
