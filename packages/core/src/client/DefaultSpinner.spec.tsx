// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOADING_LABELS } from "../shared/loading-labels.js";
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
    delete window.__agentNativeLoadingLabelIndex;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("renders the concise cube loader", () => {
    vi.stubEnv("NODE_ENV", "production");
    window.__agentNativeLoadingLabelIndex = 0;

    act(() => {
      root.render(<DefaultSpinner />);
    });

    expect(container.querySelector("span")?.textContent).toBe("Churning");
    expect(container.querySelector(".agent-running-shimmer")).not.toBeNull();
    expect(
      container.querySelectorAll("[data-agent-native-cube-loader] rect"),
    ).toHaveLength(9);
    expect(container.textContent).not.toContain("2m");
  });

  it("rotates through playful loading labels", () => {
    vi.useFakeTimers();
    try {
      window.__agentNativeLoadingLabelIndex = 0;

      act(() => {
        root.render(<DefaultSpinner />);
      });

      expect(
        container.querySelector(".agent-running-shimmer")?.textContent,
      ).toBe("Churning");

      act(() => {
        vi.advanceTimersByTime(3_000);
      });

      expect(
        container.querySelector(".agent-running-shimmer")?.textContent,
      ).toBe("Accomplishing");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the randomized static-shell label on first render", () => {
    window.__agentNativeLoadingLabelIndex = 3;

    act(() => {
      root.render(<DefaultSpinner />);
    });

    expect(container.querySelector(".agent-running-shimmer")?.textContent).toBe(
      "Actualizing",
    );
  });

  it("randomizes when no static-shell seed is present", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    act(() => {
      root.render(<DefaultSpinner />);
    });

    expect(container.querySelector(".agent-running-shimmer")?.textContent).toBe(
      LOADING_LABELS[Math.floor(LOADING_LABELS.length / 2)],
    );
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
