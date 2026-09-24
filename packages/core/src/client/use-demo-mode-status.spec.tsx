// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  setBrowserDemoModeEnabled,
  DEMO_MODE_STORAGE_KEY,
} from "../demo/browser-state.js";
import { useDemoModeStatus } from "./use-demo-mode-status.js";

function DemoModeStatusProbe() {
  const { enabled, forced, isLoading } = useDemoModeStatus();
  return (
    <output>
      {isLoading
        ? "loading"
        : `${enabled ? "enabled" : "disabled"} ${
            forced ? "forced" : "optional"
          }`}
    </output>
  );
}

describe("useDemoModeStatus", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("reads browser-local state without a backend request", () => {
    localStorage.setItem(DEMO_MODE_STORAGE_KEY, "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    act(() => root.render(<DemoModeStatusProbe />));

    expect(container.textContent).toBe("enabled optional");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates mounted consumers when the local preference changes", () => {
    act(() => root.render(<DemoModeStatusProbe />));
    expect(container.textContent).toBe("disabled optional");

    act(() => setBrowserDemoModeEnabled(true));
    expect(container.textContent).toBe("enabled optional");

    act(() => setBrowserDemoModeEnabled(false));
    expect(container.textContent).toBe("disabled optional");
  });
});
