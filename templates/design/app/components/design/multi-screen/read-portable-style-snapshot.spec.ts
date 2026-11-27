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
    const target = {
      selector: '[data-agent-native-node-id="nav"]',
      instanceIndex: 1,
    };

    expect(
      readPortableStyleSnapshot("screen-a", target, undefined, undefined),
    ).toEqual({ status: "captured", snapshot: snapshotWithDisplay("flex") });
    expect(
      readPortableStyleSnapshot("screen-a", target, 390, undefined),
    ).toEqual({ status: "captured", snapshot: snapshotWithDisplay("none") });
  });

  it("reports a missing snapshot when the selection's frame is not rendered", () => {
    frameAnswering("screen-a", snapshotWithDisplay("flex"));

    expect(
      readPortableStyleSnapshot(
        "screen-a",
        { selector: "main", instanceIndex: 1 },
        390,
        undefined,
      ),
    ).toEqual({ status: "missing" });
  });

  it("copies the frame's snapshot instead of keeping the frame's own object", () => {
    const frameSnapshot = snapshotWithDisplay("grid");
    frameAnswering("screen-a", frameSnapshot);

    const read = readPortableStyleSnapshot(
      "screen-a",
      { selector: "main", instanceIndex: 1 },
      undefined,
      undefined,
    );

    if (read.status !== "captured") throw new Error("not captured");
    expect(read.snapshot).toEqual(frameSnapshot);
    expect(read.snapshot).not.toBe(frameSnapshot);
  });
});

describe("proxied canvas images", () => {
  it("restores the original URL in a snapshot read from the frame", () => {
    const original = "https://images.example.com/a/photo.jpg?w=5350&fit=crop";
    const proxied = `${window.location.origin}/api/canvas-image?src=${encodeURIComponent(original)}&w=2048&u=subj&exp=1893456000&t=tok`;
    const snapshot: PortableStyleSnapshot = {
      version: 1,
      nodes: [
        { path: [], styles: { "background-image": `url("${proxied}")` } },
      ],
    };
    frameAnswering("screen-a", snapshot);

    const read = readPortableStyleSnapshot(
      "screen-a",
      { selector: "main", instanceIndex: 1 },
      undefined,
      undefined,
    );

    expect(JSON.stringify(read)).not.toContain("/api/canvas-image");
    expect(read).toEqual({
      status: "captured",
      snapshot: {
        version: 1,
        nodes: [
          { path: [], styles: { "background-image": `url("${original}")` } },
        ],
      },
    });
  });
});
