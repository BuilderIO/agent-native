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

  it("renders the concise cube loader", () => {
    vi.stubEnv("NODE_ENV", "production");

    act(() => {
      root.render(<DefaultSpinner />);
    });

    expect(container.querySelector("span")?.textContent).toBe("Churning");
    expect(
      container.querySelectorAll("[data-agent-native-spinner] rect"),
    ).toHaveLength(9);
    expect(container.textContent).not.toContain("2m");
  });

  it("uses a caller-provided accessible loading label", () => {
    act(() => {
      root.render(<DefaultSpinner ariaLabel="Mail is reloading" />);
    });

    expect(
      container.querySelector('[role="status"]')?.getAttribute("aria-label"),
    ).toBe("Mail is reloading");
  });
});
