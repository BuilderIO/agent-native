// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_THINKING_DISPLAY,
  parseThinkingDisplay,
} from "../shared/thinking-display.js";
import {
  getBrowserThinkingDisplay,
  setBrowserThinkingDisplay,
  subscribeToBrowserThinkingDisplay,
  ThinkingDisplayProvider,
  THINKING_DISPLAY_STORAGE_KEY,
  useThinkingDisplay,
  useThinkingDisplayControl,
} from "./thinking-display.js";

describe("parseThinkingDisplay", () => {
  it("accepts the three modes and rejects everything else", () => {
    expect(parseThinkingDisplay("expanded")).toBe("expanded");
    expect(parseThinkingDisplay("collapsed")).toBe("collapsed");
    expect(parseThinkingDisplay("hidden")).toBe("hidden");
    expect(parseThinkingDisplay("Hidden")).toBe(null);
    expect(parseThinkingDisplay("")).toBe(null);
    expect(parseThinkingDisplay(null)).toBe(null);
    expect(parseThinkingDisplay(undefined)).toBe(null);
    expect(parseThinkingDisplay(3)).toBe(null);
  });
});

describe("browser thinking-display preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("defaults to collapsed with nothing stored", () => {
    expect(DEFAULT_THINKING_DISPLAY).toBe("collapsed");
    expect(getBrowserThinkingDisplay()).toBe("collapsed");
  });

  it("round-trips a non-default mode and clears the key on the default", () => {
    setBrowserThinkingDisplay("hidden");
    expect(window.localStorage.getItem(THINKING_DISPLAY_STORAGE_KEY)).toBe(
      "hidden",
    );
    expect(getBrowserThinkingDisplay()).toBe("hidden");

    setBrowserThinkingDisplay("collapsed");
    expect(window.localStorage.getItem(THINKING_DISPLAY_STORAGE_KEY)).toBe(
      null,
    );
    expect(getBrowserThinkingDisplay()).toBe("collapsed");
  });

  it("falls back to the default for a value it cannot read as a mode", () => {
    window.localStorage.setItem(THINKING_DISPLAY_STORAGE_KEY, "sometimes");
    expect(getBrowserThinkingDisplay()).toBe("collapsed");
  });

  it("notifies subscribers on change", () => {
    const seen: string[] = [];
    const unsubscribe = subscribeToBrowserThinkingDisplay(() => {
      seen.push(getBrowserThinkingDisplay());
    });

    setBrowserThinkingDisplay("expanded");
    setBrowserThinkingDisplay("hidden");
    unsubscribe();
    setBrowserThinkingDisplay("collapsed");

    expect(seen).toEqual(["expanded", "hidden"]);
  });
});

describe("useThinkingDisplay", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function Probe() {
    const mode = useThinkingDisplay();
    const { pinned } = useThinkingDisplayControl();
    return <span data-testid="probe">{`${mode}:${pinned}`}</span>;
  }

  const probeText = () =>
    container.querySelector('[data-testid="probe"]')?.textContent;

  it("reads the stored preference when no host pinned a mode", () => {
    setBrowserThinkingDisplay("hidden");
    act(() => {
      root.render(<Probe />);
    });

    expect(probeText()).toBe("hidden:false");
  });

  it("lets a host prop win over the stored preference and hides the control", () => {
    setBrowserThinkingDisplay("hidden");
    act(() => {
      root.render(
        <ThinkingDisplayProvider value="expanded">
          <Probe />
        </ThinkingDisplayProvider>,
      );
    });

    expect(probeText()).toBe("expanded:true");
  });

  it("inherits a pinned mode through a nested provider with no value", () => {
    act(() => {
      root.render(
        <ThinkingDisplayProvider value="expanded">
          <ThinkingDisplayProvider>
            <Probe />
          </ThinkingDisplayProvider>
        </ThinkingDisplayProvider>,
      );
    });

    expect(probeText()).toBe("expanded:true");
  });

  it("tracks a preference change made elsewhere in the app", () => {
    act(() => {
      root.render(<Probe />);
    });
    expect(probeText()).toBe("collapsed:false");

    act(() => {
      setBrowserThinkingDisplay("expanded");
    });

    expect(probeText()).toBe("expanded:false");
  });
});
