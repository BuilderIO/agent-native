import { describe, expect, it } from "vitest";

import { shaderFillPreviewBridgeScript } from "../../../.generated/bridge/shader-fill-preview.generated";

function loadBridge(version = 1) {
  let scans = 0;
  const listeners: Array<(event: unknown) => void> = [];
  const parent = {};
  const window = {
    parent,
    __anShaders: {
      version,
      scan: () => {
        scans += 1;
      },
    },
    addEventListener(type: string, listener: (event: unknown) => void) {
      if (type === "message") listeners.push(listener);
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("window", shaderFillPreviewBridgeScript)(window);
  return {
    send(source: unknown, data: unknown) {
      for (const listener of listeners) listener({ source, data });
    },
    parent,
    get scans() {
      return scans;
    },
  };
}

describe("saved GLSL rescan bridge", () => {
  it("rescans persisted mounts only for a parent message and supported runtime", () => {
    const bridge = loadBridge();
    bridge.send({}, { type: "glsl-shader-rescan" });
    bridge.send(bridge.parent, { type: "glsl-shader-rescan" });
    expect(bridge.scans).toBe(1);
    const unsupported = loadBridge(0);
    unsupported.send(unsupported.parent, { type: "glsl-shader-rescan" });
    expect(unsupported.scans).toBe(0);
  });

  it("ignores retired GLSL preview and update messages", () => {
    const bridge = loadBridge();
    for (const type of [
      "glsl-shader-preview",
      "glsl-shader-set-uniform",
      "glsl-shader-update",
      "glsl-shader-preview-clear",
    ]) {
      bridge.send(bridge.parent, { type });
    }
    expect(bridge.scans).toBe(0);
  });
});
