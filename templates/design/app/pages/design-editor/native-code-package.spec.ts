// @vitest-environment jsdom
import JSZip from "jszip";
import { act, createElement, type ComponentType } from "react";
import * as React from "react";
import { createRoot } from "react-dom/client";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import { GRAIN_GRADIENT_EFFECT } from "../../../shared/native-effect-presets";
import { writeEffectsToHtml } from "../../../shared/native-effects";
import {
  buildNativeCodePackage,
  buildNativeStandaloneHtml,
} from "./native-code-package";

const png = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 5, 160, 0,
  0, 4, 0,
]);

function source() {
  const authored =
    '<!doctype html><html><head><style>.card{padding:12px}</style><style data-agent-native-export-tailwind-static>.p-4{padding:1rem}</style></head><body><main class="card p-4" data-agent-native-node-id="card">Editable</main><script data-agent-native-native-shader-runtime nonce="testnonce">/* bundled runtime */</script></body></html>';
  return writeEffectsToHtml(authored, {
    schemaVersion: 2,
    definitions: [GRAIN_GRADIENT_EFFECT],
    instances: [
      {
        id: "instance-1",
        nodeId: "card",
        definitionId: GRAIN_GRADIENT_EFFECT.id,
        definitionVersion: GRAIN_GRADIENT_EFFECT.version,
        placement: "fill",
        params: {},
        enabled: true,
        opacity: 1,
        seed: 77,
        clip: "bounds",
        blend: "normal",
        timing: { speed: 1, paused: true, time: 0 },
      },
    ],
  });
}

describe("native React/CSS/Tailwind code package", () => {
  it("bundles the same canonical model/runtime with a captured poster and editable source", async () => {
    const html = source();
    const blob = await buildNativeCodePackage({
      html,
      poster: new Blob([png], { type: "image/png" }),
      viewport: { width: 1440, height: 1024 },
      pixelRatio: 1,
    });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const standalone = await zip.file("design.html")?.async("string");
    expect(standalone).toContain(
      'data-agent-native-static-fallback src="data:image/png;base64,',
    );
    expect(standalone).toContain("width:1440px;height:1024px");
    expect(standalone).toContain('<script nonce="testnonce">');
    expect(standalone).toContain("data-an-native-status");
    expect(standalone).toContain('data-agent-native-node-id="card">Editable');
    const exportedDocument = new DOMParser().parseFromString(
      standalone!,
      "text/html",
    );
    const fallbackImage = exportedDocument.querySelector<HTMLImageElement>(
      "[data-agent-native-static-fallback]",
    );
    const scripts = [...exportedDocument.querySelectorAll("script")];
    const fallbackScript = scripts[scripts.length - 1]?.textContent;
    expect(fallbackImage?.hidden).toBe(false);
    expect(fallbackScript).toBeTruthy();
    new Function("document", "MutationObserver", fallbackScript!)(
      exportedDocument,
      MutationObserver,
    );
    expect(fallbackImage?.parentElement).toBe(exportedDocument.documentElement);
    const target = exportedDocument.querySelector(
      "[data-agent-native-node-id='card']",
    )!;
    target.setAttribute("data-an-native-status", "ready");
    target.setAttribute("data-an-native-backend", "webgpu");
    const canvas = exportedDocument.createElement("canvas");
    canvas.setAttribute("data-an-native-canvas", "instance-1");
    target.append(canvas);
    await Promise.resolve();
    expect(fallbackImage?.hidden).toBe(true);
    target.setAttribute("data-an-native-status", "error");
    await Promise.resolve();
    expect(fallbackImage?.hidden).toBe(false);
    window.dispatchEvent(
      new CustomEvent("native-shader-status", {
        detail: {
          type: "native-shader-status",
          schemaVersion: 1,
          runtimeEpoch: "epoch-1",
          instanceId: "instance-1",
          nodeId: "card",
          status: "ready",
          backend: "webgpu",
        },
      }),
    );
    expect(fallbackImage?.hidden).toBe(true);
    window.dispatchEvent(
      new CustomEvent("native-shader-status", {
        detail: {
          type: "native-shader-status",
          schemaVersion: 1,
          runtimeEpoch: "epoch-1",
          instanceId: "instance-1",
          nodeId: "card",
          status: "error",
          backend: "unavailable",
        },
      }),
    );
    expect(fallbackImage?.hidden).toBe(false);
    const react = await zip.file("Design.tsx")?.async("string");
    expect(react).toContain('import designHtml from "./design.html?raw"');
    expect(react).toContain('import posterUrl from "./design-preview.png"');
    expect(react).toContain('data.status === "error"');
    expect(react).toContain('"instanceId":"instance-1"');
    expect(react).toContain('data.status === "unavailable"');
    expect(react).toContain('data.status === "last-good"');
    expect(react).toContain("data.runtimeEpoch !== runtimeEpoch");
    expect(react).toContain(
      'data.requestId !== requestPrefix + "-" + targetIndex',
    );
    expect(react).toContain('requestId: requestPrefix + "-" + index');
    expect(react).toContain("onLoad={() => onFrameLoad.current()}");
    expect(react).not.toContain('visibility: mode === "live"');
    const transformed = ts.transpileModule(react!, {
      fileName: "Design.tsx",
      reportDiagnostics: true,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
      },
    });
    expect(transformed.diagnostics).toEqual([]);
    expect(transformed.outputText).toContain("NativeDesignScene");
    expect(await zip.file("design.css")?.async("string")).toContain(".card");
    expect(await zip.file("tailwind.css")?.async("string")).toContain(".p-4");
    expect(await zip.file("design-preview.png")?.async("uint8array")).toEqual(
      png,
    );
    expect(await zip.file("README.md")?.async("string")).toContain(
      "not converted into individual JSX components",
    );
  });

  it("rejects a package missing the native model or runtime", async () => {
    await expect(
      buildNativeCodePackage({
        html: "<main>Unprocessed</main>",
        poster: new Blob([png], { type: "image/png" }),
        viewport: { width: 1440, height: 1024 },
        pixelRatio: 1,
      }),
    ).rejects.toThrow(/model or runtime is missing/);
  });

  it("keeps the prepared native input registry in standalone HTML and the React package scene", async () => {
    const registry = `<script type="application/x-agent-native-effect-assets" data-agent-native-export-assets>${JSON.stringify(
      {
        schemaVersion: 1,
        assets: [
          {
            path: "/shaders/input-alpha-mask.png",
            mimeType: "image/png",
            byteLength: 3,
            sha256: "0".repeat(64),
            base64: "AQID",
          },
        ],
      },
    )}</script>`;
    const html = source().replace("</body>", `${registry}</body>`);
    const args = {
      html,
      poster: new Blob([png], { type: "image/png" }),
      viewport: { width: 1440, height: 1024 },
      pixelRatio: 1,
    };
    const standalone = await buildNativeStandaloneHtml(args).then((blob) =>
      blob.text(),
    );
    expect(standalone.match(/data-agent-native-export-assets/g)).toHaveLength(
      1,
    );
    const zip = await JSZip.loadAsync(
      await buildNativeCodePackage(args).then((blob) => blob.arrayBuffer()),
    );
    expect(
      (await zip.file("design.html")?.async("string"))?.match(
        /data-agent-native-export-assets/g,
      ),
    ).toHaveLength(1);
  });

  it("rejects a valid PNG header captured for a different viewport", async () => {
    const wrongViewport = new Uint8Array(png);
    wrongViewport[19] = 128;
    const poster = new Blob([wrongViewport], { type: "image/png" });
    await expect(
      buildNativeStandaloneHtml({
        html: source(),
        poster,
        viewport: { width: 1440, height: 1024 },
        pixelRatio: 1,
      }),
    ).rejects.toThrow(/dimensions do not match/);
    await expect(
      buildNativeCodePackage({
        html: source(),
        poster,
        viewport: { width: 1440, height: 1024 },
        pixelRatio: 1,
      }),
    ).rejects.toThrow(/dimensions do not match/);
    await expect(
      buildNativeStandaloneHtml({
        html: source(),
        poster: new Blob([png], { type: "image/png" }),
        viewport: { width: 1440, height: 1024 },
        pixelRatio: 2,
      }),
    ).rejects.toThrow(/dimensions do not match/);
  });

  it("reveals React output only after a matching current-load status reply", async () => {
    const zip = await JSZip.loadAsync(
      await buildNativeCodePackage({
        html: source(),
        poster: new Blob([png], { type: "image/png" }),
        viewport: { width: 1440, height: 1024 },
        pixelRatio: 1,
      }).then((blob) => blob.arrayBuffer()),
    );
    const react = (await zip.file("Design.tsx")?.async("string"))!;
    const commonJs = ts.transpileModule(react, {
      fileName: "Design.tsx",
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }).outputText;
    const generated = { exports: {} as { default?: ComponentType } };
    const requireModule = (name: string) => {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "./design.html?raw") return source();
      if (name === "./design-preview.png") return "poster.png";
      throw new Error(`Unexpected generated import: ${name}`);
    };
    new Function("require", "module", "exports", commonJs)(
      requireModule,
      generated,
      generated.exports,
    );
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: {},
    });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () =>
        root.render(createElement(generated.exports.default!)),
      );
      const iframe = container.querySelector("iframe")!;
      const post = vi
        .spyOn(iframe.contentWindow!, "postMessage")
        .mockImplementation(() => {});
      const load = async () => {
        await act(async () => iframe.dispatchEvent(new Event("load")));
        return post.mock.lastCall?.[0] as {
          requestId: string;
          instanceId: string;
          nodeId: string;
        };
      };
      const reply = async (
        requestId: string,
        runtimeEpoch: string,
        status: "ready" | "error",
      ) =>
        act(async () =>
          window.dispatchEvent(
            new MessageEvent("message", {
              source: iframe.contentWindow,
              origin: window.location.origin,
              data: {
                type: "native-shader-status",
                schemaVersion: 1,
                requestId,
                runtimeEpoch,
                instanceId: "instance-1",
                nodeId: "card",
                status,
                backend: status === "ready" ? "webgpu" : "unavailable",
              },
            }),
          ),
        );
      const first = await load();
      expect(first.requestId).toMatch(/^[A-Za-z0-9_-]{1,80}$/);
      await reply(first.requestId, "first-runtime", "ready");
      expect(container.querySelector("img")).toBeNull();
      const second = await load();
      expect(container.querySelector("img")).not.toBeNull();
      await reply(first.requestId, "first-runtime", "ready");
      expect(container.querySelector("img")).not.toBeNull();
      await reply(second.requestId, "second-runtime", "ready");
      expect(container.querySelector("img")).toBeNull();
      await reply(second.requestId, "second-runtime", "error");
      expect(container.querySelector("img")).not.toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });
});
