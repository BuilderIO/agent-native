// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";

import type { PortableStyleSnapshot } from "../types";
import { readPortableStyleSnapshot } from "./read-portable-style-snapshot";

function snapshotWithDisplay(display: string): PortableStyleSnapshot {
  return { version: 1, nodes: [{ path: [], styles: { display } }] };
}

function frameAnswering(iframeId: string, snapshot: PortableStyleSnapshot) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-screen-iframe-id", iframeId);
  document.body.append(iframe);
  Object.assign(iframe.contentWindow!, {
    __anEditorChromeBridgeInstance: {
      collectPortableStyleSnapshot: (screenId: string) =>
        screenId === "screen-a" ? { status: "captured", snapshot } : null,
    },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("readPortableStyleSnapshot", () => {
  it("reads from the breakpoint frame the selection came from, not another frame of its screen", () => {
    frameAnswering("screen-a", snapshotWithDisplay("flex"));
    frameAnswering("screen-a::bp-390", snapshotWithDisplay("none"));
    const selector = '[data-agent-native-node-id="nav"]';

    expect(
      readPortableStyleSnapshot("screen-a", selector, undefined, undefined),
    ).toEqual({ status: "captured", snapshot: snapshotWithDisplay("flex") });
    expect(
      readPortableStyleSnapshot("screen-a", selector, 390, undefined),
    ).toEqual({ status: "captured", snapshot: snapshotWithDisplay("none") });
  });

  it("reports a missing snapshot when the selection's frame is not rendered", () => {
    frameAnswering("screen-a", snapshotWithDisplay("flex"));

    expect(
      readPortableStyleSnapshot("screen-a", "main", 390, undefined),
    ).toEqual({ status: "missing" });
  });
});
