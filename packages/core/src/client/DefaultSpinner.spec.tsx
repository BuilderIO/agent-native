// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DefaultSpinner } from "./DefaultSpinner.js";

describe("DefaultSpinner", () => {
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
    vi.unstubAllEnvs();
  });

  it("does not render developer startup guidance in production", () => {
    vi.stubEnv("NODE_ENV", "production");

    act(() => {
      root.render(<DefaultSpinner />);
    });

    expect(container.textContent).not.toContain("dev server");
    expect(container.querySelector(".an-stall-hint")).toBeNull();
  });
});
