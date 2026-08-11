// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UpdateIndicator } from "./UpdateIndicator.js";

describe("UpdateIndicator", () => {
  let container: HTMLDivElement;
  let root: Root;
  let install: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    install = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        updater: {
          getStatus: vi.fn().mockResolvedValue({
            state: "restart-required",
            version: "1.1.0",
            currentVersion: "1.0.0",
          }),
          install,
          onStatusChange: vi.fn(() => vi.fn()),
        },
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    vi.unstubAllGlobals();
  });

  it("renders a restart action in the chat-first rail variant", async () => {
    await act(async () => {
      root.render(<UpdateIndicator variant="rail" />);
      await Promise.resolve();
    });

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button).not.toBeNull();
    expect(button?.className).toContain("code-agents-nav-link");
    expect(button?.textContent).toContain("Restart to update");
    expect(button?.getAttribute("aria-label")).toBe(
      "Restart to update Agent Native to version 1.1.0",
    );

    act(() => button?.click());
    expect(install).toHaveBeenCalledTimes(1);
  });
});
