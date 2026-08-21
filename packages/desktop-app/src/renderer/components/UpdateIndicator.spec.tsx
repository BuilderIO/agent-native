// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UpdateIndicator } from "./UpdateIndicator.js";

describe("UpdateIndicator", () => {
  let container: HTMLDivElement;
  let root: Root;
  let install: ReturnType<typeof vi.fn>;
  let check: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    install = vi.fn();
    check = vi.fn().mockResolvedValue({
      state: "not-available",
      currentVersion: "1.1.0",
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        updater: {
          getStatus: vi.fn().mockResolvedValue({
            state: "downloaded",
            version: "1.1.0",
          }),
          check,
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

  it("renders a restart action in the chat-first rail", async () => {
    await act(async () => {
      root.render(<UpdateIndicator />);
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

  it("keeps a check action in the expanded and collapsed rail states", async () => {
    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        updater: {
          getStatus: vi.fn().mockResolvedValue({
            state: "not-available",
            currentVersion: "1.1.0",
          }),
          check,
          install,
          onStatusChange: vi.fn(() => vi.fn()),
        },
      },
    });

    await act(async () => {
      root.render(<UpdateIndicator />);
      await Promise.resolve();
    });

    const button = container.querySelector<HTMLButtonElement>(
      "[data-update-indicator]",
    );
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("Check for updates");
    expect(button?.querySelector("svg")).not.toBeNull();

    act(() => button?.click());
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("does not let the initial status read overwrite a newer live update", async () => {
    let resolveStatus!: (status: UpdateStatus) => void;
    let onStatusChange!: (status: UpdateStatus) => void;
    const getStatus = vi.fn(
      () =>
        new Promise<UpdateStatus>((resolve) => {
          resolveStatus = resolve;
        }),
    );

    Object.defineProperty(window, "electronAPI", {
      configurable: true,
      value: {
        updater: {
          getStatus,
          check,
          install,
          onStatusChange: vi.fn((listener: (status: UpdateStatus) => void) => {
            onStatusChange = listener;
            return vi.fn();
          }),
        },
      },
    });

    await act(async () => {
      root.render(<UpdateIndicator />);
      await Promise.resolve();
    });

    act(() => {
      onStatusChange({ state: "downloaded", version: "1.2.0" });
      resolveStatus({ state: "idle" });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Restart to update");
  });
});
