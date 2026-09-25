// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import { runScaleSelection } from "./scale-selection";

function frame(id: string) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-screen-iframe-id", id);
  document.body.append(iframe);
  const postMessage = vi.fn();
  Object.defineProperty(iframe, "contentWindow", {
    configurable: true,
    value: { postMessage },
  });
  return postMessage;
}

const selectedElement = {
  selector: '[data-agent-native-node-id="card"]',
  sourceLayerIdentity: { screenId: "home", nodeId: "card" },
} as unknown as ElementInfo;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("runScaleSelection", () => {
  it("scales inside the active breakpoint frame", () => {
    const primary = frame("home");
    const breakpoint = frame("home::bp-768");

    runScaleSelection(
      {
        selectedElement,
        boardFileId: undefined,
        activeBreakpointWidthPx: 768,
        fallbackIframe: null,
      },
      2,
      { x: 0.5, y: 0.5 },
    );

    expect(breakpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent-native:scale-selection",
        factor: 2,
      }),
      "*",
    );
    expect(primary).not.toHaveBeenCalled();
  });

  it("uses the screen's own frame when no breakpoint is active", () => {
    const primary = frame("home");
    const breakpoint = frame("home::bp-768");

    runScaleSelection(
      {
        selectedElement,
        boardFileId: undefined,
        activeBreakpointWidthPx: undefined,
        fallbackIframe: null,
      },
      2,
      { x: 0.5, y: 0.5 },
    );

    expect(primary).toHaveBeenCalledTimes(1);
    expect(breakpoint).not.toHaveBeenCalled();
  });
});
