// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsLoadingRow, SettingsSkeleton } from "./SettingsSkeleton.js";

describe("settings loading placeholders", () => {
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
  });

  it("renders field geometry without a visible loading label", async () => {
    await act(async () => {
      root.render(<SettingsSkeleton lines={3} />);
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.getAttribute("aria-busy")).toBe("true");
    expect(container.textContent).toBe("");
    expect(container.querySelectorAll("[data-shape]")).toHaveLength(9);
  });

  it("renders the configured number of row controls", async () => {
    await act(async () => {
      root.render(<SettingsLoadingRow controlCount={2} />);
    });

    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelectorAll("[data-shape]")).toHaveLength(4);
  });
});
