import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * These tests exercise the REAL shader-fill-preview bridge script that
 * `DesignCanvas.tsx` injects into the design iframe. Rather than duplicate
 * the validation logic here (which would drift from the bridge), we import
 * the compiled bridge string from the generated module, strip the IIFE
 * wrapper, and pull out the pieces under test so the live postMessage
 * handler is exercised for real.
 *
 * Covers the two code-review fixes on the PREVIEW path only:
 *   1. GLSL validation gap — `glsl-shader-preview` (and `glsl-shader-update`)
 *      now run the same structural checks the persist path's
 *      `validateShaderDef()` applies (shared/shader-fills.ts) before ever
 *      calling into the WebGL runtime, and reject with a posted error
 *      message instead of compiling. Also covers the local MAX_PREVIEW_MOUNTS
 *      (8) cap enforced independently of the runtime's own bookkeeping.
 *   2. Unvalidated CSS — `shader-fill-preview` now gates `css` through
 *      `isSafeBackgroundStyleValue()` (a minimal duplicate of
 *      `isSafeStyleValue()` in shared/code-layer.ts) before writing
 *      `el.style.background`, rejecting silently (no style write) plus
 *      posting a warning message.
 *
 * Source: app/components/design/bridge/shader-fill-preview.bridge.ts
 * Compiled: .generated/bridge/shader-fill-preview.generated.ts
 */

interface FakeElement {
  style: Record<string, string>;
}

interface FakeAnShadersApi {
  version: number;
  scan: () => void;
  applyPreview: (
    target: { nodeId?: string; selector?: string },
    def: {
      id?: string;
      name?: string;
      glsl: string;
      uniforms?: Record<string, unknown>;
      values?: Record<string, unknown>;
    },
    mode?: string,
  ) => boolean;
  clearPreview: () => void;
  setUniform: (
    filter: { shaderId?: string; nodeId?: string; preview?: boolean },
    name: string,
    value: unknown,
  ) => void;
  updateShader: (
    id: string,
    patch: { glsl?: string; uniforms?: Record<string, unknown> },
  ) => void;
}

function loadBridge(): {
  /** Dispatch a parent → iframe postMessage into the bridge's listener. */
  sendMessage: (data: unknown) => void;
  /** Register a fake element addressable by data-agent-native-node-id. */
  addElement: (nodeId: string) => FakeElement;
  /** Messages the bridge posted back to window.parent. */
  parentMessages: unknown[];
  /** Calls recorded against the fake window.__anShaders runtime. */
  runtimeCalls: {
    applyPreview: Array<{
      target: unknown;
      def: unknown;
      mode?: string;
    }>;
    updateShader: Array<{ id: string; patch: unknown }>;
  };
  /** Controls what the fake runtime's applyPreview() returns. */
  setApplyPreviewResult: (result: boolean) => void;
} {
  const generatedPath = fileURLToPath(
    new URL(
      "../../../.generated/bridge/shader-fill-preview.generated.ts",
      import.meta.url,
    ),
  );
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { shaderFillPreviewBridgeScript } = require(generatedPath) as {
    shaderFillPreviewBridgeScript: string;
  };

  // The generated string is the compiled IIFE JS (no <script> tags).
  // esbuild wraps the source IIFE in an outer arrow-IIFE:
  //   "use strict";\n(() => {\n  // source-file-comment\n  (function() {\n    ...\n  })();\n})();\n
  // Strip both wrappers so only the function body is left, then run it
  // against fake window/document objects so the real message listener
  // registers and runs for real.
  let body = shaderFillPreviewBridgeScript;
  body = body.replace(/^["']use strict["'];\s*\(\(\)\s*=>\s*\{/, "");
  body = body.replace(/\}\)\(\);\s*$/, "");
  body = body.replace(/^\s*\/\/[^\n]*\n/, "");
  body = body.replace(/^\s*\(function\s*\(\s*\)\s*\{/, "");
  body = body.replace(/\}\)\(\);\s*$/, "");

  const listeners: Array<(e: unknown) => void> = [];
  const elements = new Map<string, FakeElement>();
  const parentMessages: unknown[] = [];

  const runtimeCalls = {
    applyPreview: [] as Array<{ target: unknown; def: unknown; mode?: string }>,
    updateShader: [] as Array<{ id: string; patch: unknown }>,
  };
  let applyPreviewResult = true;

  const fakeAnShaders: FakeAnShadersApi = {
    version: 1,
    scan: () => {},
    applyPreview: (target, def, mode) => {
      runtimeCalls.applyPreview.push({ target, def, mode });
      return applyPreviewResult;
    },
    clearPreview: () => {},
    setUniform: () => {},
    updateShader: (id, patch) => {
      runtimeCalls.updateShader.push({ id, patch });
    },
  };

  const fakeWindow = {
    parent: {
      postMessage: (data: unknown) => {
        parentMessages.push(data);
      },
    },
    addEventListener(type: string, fn: (e: unknown) => void) {
      if (type === "message") listeners.push(fn);
    },
    __anShaders: fakeAnShaders,
  };
  const fakeDocument = {
    querySelector(selector: string): FakeElement | null {
      const m = /\[data-agent-native-node-id="([^"]+)"\]/.exec(selector);
      return m ? (elements.get(m[1]) ?? null) : null;
    },
    body: { style: {} } as FakeElement,
  };

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function("window", "document", body);
  factory(fakeWindow, fakeDocument);

  return {
    sendMessage: (data: unknown) => {
      for (const fn of listeners) fn({ source: fakeWindow.parent, data });
    },
    addElement: (nodeId: string) => {
      const el: FakeElement = { style: {} };
      elements.set(nodeId, el);
      return el;
    },
    parentMessages,
    runtimeCalls,
    setApplyPreviewResult: (result: boolean) => {
      applyPreviewResult = result;
    },
  };
}

const VALID_GLSL = `precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }`;

describe("shader-fill-preview bridge — CSS preview gate", () => {
  it("happy path: applies a safe background value to the target element", () => {
    const bridge = loadBridge();
    const el = bridge.addElement("hero");

    bridge.sendMessage({
      type: "shader-fill-preview",
      selector: "",
      nodeId: "hero",
      css: "linear-gradient(90deg, #ff0000, #0000ff)",
    });

    expect(el.style.background).toBe(
      "linear-gradient(90deg, #ff0000, #0000ff)",
    );
    expect(bridge.parentMessages).toEqual([]);
  });

  it("rejects an unsafe css value (javascript: breakout) without writing the style, and posts a warning", () => {
    const bridge = loadBridge();
    const el = bridge.addElement("hero");

    bridge.sendMessage({
      type: "shader-fill-preview",
      selector: "",
      nodeId: "hero",
      css: "javascript:alert(1)",
    });

    expect(el.style.background).toBeUndefined();
    expect(bridge.parentMessages).toEqual([
      { type: "shader-fill-preview-rejected", reason: "unsafe-css-value" },
    ]);
  });

  it("rejects a css value carrying url(...) on the background shorthand", () => {
    const bridge = loadBridge();
    const el = bridge.addElement("hero");

    bridge.sendMessage({
      type: "shader-fill-preview",
      selector: "",
      nodeId: "hero",
      css: "url(javascript:alert(1))",
    });

    expect(el.style.background).toBeUndefined();
    expect(bridge.parentMessages).toEqual([
      { type: "shader-fill-preview-rejected", reason: "unsafe-css-value" },
    ]);
  });

  it("rejects a css value with a rule-breakout character (semicolon injection)", () => {
    const bridge = loadBridge();
    const el = bridge.addElement("hero");

    bridge.sendMessage({
      type: "shader-fill-preview",
      selector: "",
      nodeId: "hero",
      css: "red; } body { display: none",
    });

    expect(el.style.background).toBeUndefined();
    expect(bridge.parentMessages).toEqual([
      { type: "shader-fill-preview-rejected", reason: "unsafe-css-value" },
    ]);
  });
});

describe("shader-fill-preview bridge — GLSL preview gate", () => {
  it("happy path: forwards a structurally valid shader to the runtime", () => {
    const bridge = loadBridge();

    bridge.sendMessage({
      type: "glsl-shader-preview",
      target: { nodeId: "hero" },
      shader: { id: "s1", name: "Test", glsl: VALID_GLSL, uniforms: {} },
      mode: "fill",
    });

    expect(bridge.runtimeCalls.applyPreview).toHaveLength(1);
    expect(bridge.runtimeCalls.applyPreview[0].def).toMatchObject({
      glsl: VALID_GLSL,
    });
    expect(bridge.parentMessages).toEqual([]);
  });

  it("rejects an empty GLSL source without calling the runtime, and posts the validation errors", () => {
    const bridge = loadBridge();

    bridge.sendMessage({
      type: "glsl-shader-preview",
      target: { nodeId: "hero" },
      shader: { id: "s1", name: "Test", glsl: "   ", uniforms: {} },
      mode: "fill",
    });

    expect(bridge.runtimeCalls.applyPreview).toHaveLength(0);
    expect(bridge.parentMessages).toHaveLength(1);
    const [message] = bridge.parentMessages as Array<{
      type: string;
      errors: string[];
    }>;
    expect(message.type).toBe("glsl-shader-preview-rejected");
    expect(message.errors.join(" ")).toMatch(/empty/);
  });

  it("rejects GLSL missing void main()/gl_FragColor without calling the runtime", () => {
    const bridge = loadBridge();

    bridge.sendMessage({
      type: "glsl-shader-preview",
      target: { nodeId: "hero" },
      shader: {
        id: "s1",
        name: "Test",
        glsl: "precision highp float;\nfloat noop() { return 1.0; }",
        uniforms: {},
      },
      mode: "fill",
    });

    expect(bridge.runtimeCalls.applyPreview).toHaveLength(0);
    const [message] = bridge.parentMessages as Array<{
      type: string;
      errors: string[];
    }>;
    expect(message.type).toBe("glsl-shader-preview-rejected");
    expect(message.errors.some((e) => /void main/.test(e))).toBe(true);
    expect(message.errors.some((e) => /gl_FragColor/.test(e))).toBe(true);
  });

  it("rejects GLSL containing an opening script tag without calling the runtime — GPU-hang/injection guard", () => {
    const bridge = loadBridge();

    bridge.sendMessage({
      type: "glsl-shader-preview",
      target: { nodeId: "hero" },
      shader: {
        id: "s1",
        name: "Test",
        glsl: VALID_GLSL + "\n</script><script>alert(1)</script>",
        uniforms: {},
      },
      mode: "fill",
    });

    expect(bridge.runtimeCalls.applyPreview).toHaveLength(0);
    const [message] = bridge.parentMessages as Array<{
      type: string;
      errors: string[];
    }>;
    expect(message.type).toBe("glsl-shader-preview-rejected");
    expect(message.errors.some((e) => /opening script tag/.test(e))).toBe(true);
  });

  it("allows a bare closing `</script` sequence (e.g. inside a comment) to pass preview validation — matches the relaxed persist-path contract", () => {
    const bridge = loadBridge();

    bridge.sendMessage({
      type: "glsl-shader-preview",
      target: { nodeId: "hero" },
      shader: {
        id: "s1",
        name: "Test",
        glsl: VALID_GLSL + "\n// avoid a </script> breakout in output",
        uniforms: {},
      },
      mode: "fill",
    });

    expect(bridge.runtimeCalls.applyPreview).toHaveLength(1);
    expect(bridge.parentMessages).toEqual([]);
  });

  it("rejects a malformed uniforms manifest (bad name, wrong value type) without calling the runtime", () => {
    const bridge = loadBridge();

    bridge.sendMessage({
      type: "glsl-shader-preview",
      target: { nodeId: "hero" },
      shader: {
        id: "s1",
        name: "Test",
        glsl: VALID_GLSL,
        uniforms: {
          bad_name: { type: "float", value: 1 },
          u_broken: { type: "float", value: "not-a-number" },
        },
      },
      mode: "fill",
    });

    expect(bridge.runtimeCalls.applyPreview).toHaveLength(0);
    const [message] = bridge.parentMessages as Array<{
      type: string;
      errors: string[];
    }>;
    expect(message.type).toBe("glsl-shader-preview-rejected");
    expect(message.errors.some((e) => /bad_name/.test(e))).toBe(true);
    expect(message.errors.some((e) => /u_broken/.test(e))).toBe(true);
  });

  it("rejects re-declaring a runtime built-in uniform (u_time / u_resolution) in the manifest", () => {
    const bridge = loadBridge();

    bridge.sendMessage({
      type: "glsl-shader-preview",
      target: { nodeId: "hero" },
      shader: {
        id: "s1",
        name: "Test",
        glsl: VALID_GLSL,
        uniforms: { u_time: { type: "float", value: 1 } },
      },
      mode: "fill",
    });

    expect(bridge.runtimeCalls.applyPreview).toHaveLength(0);
    const [message] = bridge.parentMessages as Array<{
      type: string;
      errors: string[];
    }>;
    expect(message.errors.some((e) => /u_time/.test(e))).toBe(true);
  });

  it("enforces the MAX_PREVIEW_MOUNTS (8) cap independent of the runtime, rejecting the 9th preview request since the last clear", () => {
    const bridge = loadBridge();
    // The bridge counts every ACCEPTED preview request since the last
    // glsl-shader-preview-clear (rather than trusting that a preview mount
    // always self-replaces), so 8 accepted requests saturate the cap and a
    // 9th is rejected without ever reaching the runtime.
    for (let i = 0; i < 8; i++) {
      bridge.sendMessage({
        type: "glsl-shader-preview",
        target: { nodeId: "hero" },
        shader: { id: "s" + i, name: "Test", glsl: VALID_GLSL, uniforms: {} },
        mode: "fill",
      });
    }
    expect(bridge.runtimeCalls.applyPreview).toHaveLength(8);
    expect(bridge.parentMessages).toEqual([]);

    bridge.sendMessage({
      type: "glsl-shader-preview",
      target: { nodeId: "hero" },
      shader: { id: "s8", name: "Test", glsl: VALID_GLSL, uniforms: {} },
      mode: "fill",
    });

    // Still 8 — the 9th request was rejected before calling the runtime.
    expect(bridge.runtimeCalls.applyPreview).toHaveLength(8);
    const [message] = bridge.parentMessages as Array<{
      type: string;
      errors: string[];
    }>;
    expect(message.type).toBe("glsl-shader-preview-rejected");
    expect(message.errors.some((e) => /too many/.test(e))).toBe(true);
  });

  it("resets the local preview-mount count on glsl-shader-preview-clear", () => {
    const bridge = loadBridge();
    bridge.sendMessage({
      type: "glsl-shader-preview",
      target: { nodeId: "hero" },
      shader: { id: "s1", name: "Test", glsl: VALID_GLSL, uniforms: {} },
      mode: "fill",
    });
    expect(bridge.runtimeCalls.applyPreview).toHaveLength(1);

    bridge.sendMessage({ type: "glsl-shader-preview-clear" });

    bridge.sendMessage({
      type: "glsl-shader-preview",
      target: { nodeId: "hero" },
      shader: { id: "s2", name: "Test", glsl: VALID_GLSL, uniforms: {} },
      mode: "fill",
    });
    expect(bridge.runtimeCalls.applyPreview).toHaveLength(2);
  });
});

describe("shader-fill-preview bridge — glsl-shader-update validation", () => {
  it("forwards a structurally valid GLSL hot-swap to the runtime", () => {
    const bridge = loadBridge();

    bridge.sendMessage({
      type: "glsl-shader-update",
      id: "s1",
      glsl: VALID_GLSL,
    });

    expect(bridge.runtimeCalls.updateShader).toHaveLength(1);
    expect(bridge.runtimeCalls.updateShader[0]).toMatchObject({
      id: "s1",
      patch: { glsl: VALID_GLSL },
    });
  });

  it("rejects an invalid GLSL hot-swap without calling the runtime", () => {
    const bridge = loadBridge();

    bridge.sendMessage({
      type: "glsl-shader-update",
      id: "s1",
      glsl: "not glsl at all",
    });

    expect(bridge.runtimeCalls.updateShader).toHaveLength(0);
    const [message] = bridge.parentMessages as Array<{
      type: string;
      errors: string[];
    }>;
    expect(message.type).toBe("glsl-shader-preview-rejected");
  });

  it("allows a uniforms-only patch (no glsl field) without requiring GLSL to be re-sent", () => {
    const bridge = loadBridge();

    bridge.sendMessage({
      type: "glsl-shader-update",
      id: "s1",
      uniforms: { u_speed: { type: "float", value: 2, min: 0, max: 4 } },
    });

    expect(bridge.runtimeCalls.updateShader).toHaveLength(1);
    expect(bridge.runtimeCalls.updateShader[0]).toMatchObject({ id: "s1" });
  });
});
