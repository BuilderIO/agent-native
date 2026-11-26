// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { MermaidRender } from "./MermaidBlock.js";

// The client build's stand-in for an optional peer that isn't installed: every
// export, and every property of `mermaid`'s default export, throws this.
const missingPeer = vi.hoisted(() => () => {
  throw Object.assign(new Error("This feature requires an optional peer."), {
    code: "ERR_AGENT_NATIVE_OPTIONAL_PEER",
  });
});

vi.mock("@excalidraw/mermaid-to-excalidraw", () => ({
  parseMermaidToExcalidraw: missingPeer,
}));

vi.mock("@excalidraw/excalidraw", () => ({
  convertToExcalidrawElements: missingPeer,
  exportToSvg: missingPeer,
}));

vi.mock("mermaid", () => ({
  default: new Proxy({}, { get: () => missingPeer }),
}));

const { useMermaidRender } = await import("./MermaidBlock.js");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("reports the renderers unavailable when neither package is installed", async () => {
  const seen: { current?: MermaidRender } = {};
  function Probe() {
    seen.current = useMermaidRender("flowchart LR\n  A --> B", "probe");
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(<Probe />);
  });
  for (let tries = 0; tries < 50 && !seen.current?.error; tries++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  expect(seen.current).toMatchObject({ mounted: true, unavailable: true });
  act(() => {
    root.unmount();
  });
});
