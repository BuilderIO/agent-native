import { Buffer } from "node:buffer";
import { TextEncoder } from "node:util";
import { runInNewContext } from "node:vm";
import { MessageChannel } from "node:worker_threads";

import { describe, expect, it } from "vitest";

import { MAX_SLIDE_SOURCE_BYTES } from "./slide-source-limits.js";
import { SlideSourceError } from "./slide-source.js";
import {
  buildReactSlideRuntime,
  prepareReactSlideSource,
} from "./slide-worker-runtime.js";

function prepare(expression: string): string {
  return prepareBody(`return <div>{${expression}}</div>;`);
}

function prepareBody(body: string): string {
  return prepareReactSlideSource(
    `import React from "react"; export default function Slide() { ${body} }`,
  ).source;
}

type WorkerResponse = {
  type: "rendered" | "error";
  html?: string;
  message?: string;
};

async function renderInWorker(
  sourceTsx: string,
  page = { current: 1, total: 1 },
): Promise<WorkerResponse> {
  const runtime = await buildReactSlideRuntime(sourceTsx, {
    ...page,
    assetUrls: new Map(),
  });
  return renderWorker(runtime.workerSource, page);
}

function renderWorker(
  workerSource: string,
  page: { current: number; total: number },
): WorkerResponse {
  const responses: WorkerResponse[] = [];
  const workerScope: {
    onmessage?: (event: { data: Record<string, unknown> }) => void;
  } = {};
  runInNewContext(workerSource, {
    atob,
    MessageChannel,
    TextEncoder,
    self: workerScope,
    postMessage: (response: WorkerResponse) => responses.push(response),
  });
  workerScope.onmessage?.({
    data: {
      type: "render",
      requestId: "css-vars-test",
      page,
      assetUrls: {},
      revealedSteps: null,
      isActivePage: false,
    },
  });
  const response = responses[0];
  if (!response) throw new Error("The slide Worker did not reply.");
  return response;
}

describe("React slide source validation", () => {
  it("prepares a source module at the 256 KiB UTF-8 boundary", () => {
    const suffix = "*/\nexport default function Slide() { return <main />; }";
    const paddingLength =
      MAX_SLIDE_SOURCE_BYTES - Buffer.byteLength(`/*${suffix}`);
    const source = `/*${"x".repeat(paddingLength)}${suffix}`;

    expect(Buffer.byteLength(source, "utf8")).toBe(MAX_SLIDE_SOURCE_BYTES);
    expect(prepareReactSlideSource(source).source).toContain(
      "function Slide()",
    );
  });

  it("rejects UTF-8 byte overflow even when source character count is below the cap", () => {
    const suffix = "*/\nexport default function Slide() { return <main />; }";
    const paddingBytes =
      MAX_SLIDE_SOURCE_BYTES + 1 - Buffer.byteLength(`/*${suffix}`);
    const source = `/*${"é".repeat(Math.ceil(paddingBytes / 2))}${suffix}`;

    expect(source.length).toBeLessThan(MAX_SLIDE_SOURCE_BYTES);
    expect(Buffer.byteLength(source, "utf8")).toBeGreaterThan(
      MAX_SLIDE_SOURCE_BYTES,
    );
    expect(() => prepareReactSlideSource(source)).toThrow(
      "Slide source must be at most 256 KiB.",
    );
  });

  it("preserves slide numbers after the fortieth page", async () => {
    const runtime = await buildReactSlideRuntime(
      [
        'import { useSlidePageNumber } from "@open-slide/core";',
        "export default function Slide() {",
        "  const { current, total } = useSlidePageNumber();",
        "  return <main>{current}/{total}</main>;",
        "}",
      ].join("\n"),
      { current: 41, total: 41, assetUrls: new Map() },
    );
    const response = renderWorker(runtime.workerSource, runtime.page);

    expect(runtime.page).toEqual({ current: 41, total: 41 });
    expect(response.type).toBe("rendered");
    expect(response.html).toContain("41/41");
  });

  it("rejects unsafe page numbers", async () => {
    const response = await renderInWorker(
      "export default function Slide() { return <main />; }",
      { current: 1, total: Number.MAX_SAFE_INTEGER + 1 },
    );

    expect(response.type).toBe("error");
    expect(response.message).toContain("Slide render request is invalid.");
  });

  it.each([
    [
      "a named import alias",
      'import { useEffect as afterRender } from "react"; export default function Slide() { afterRender(() => {}, []); return <main />; }',
    ],
    [
      "a default import alias",
      'import ReactRuntime from "react"; export default function Slide() { ReactRuntime.useLayoutEffect(() => {}, []); return <main />; }',
    ],
    [
      "a destructured hook",
      'import ReactRuntime from "react"; export default function Slide() { const { useEffect: afterRender } = ReactRuntime; afterRender(() => {}, []); return <main />; }',
    ],
  ])("rejects effect hooks accessed through %s", (_label, sourceTsx) => {
    expect(() => prepareReactSlideSource(sourceTsx)).toThrow(
      "React effect hooks do not run during static slide rendering",
    );
  });

  it("rejects computed constructor access on React members", () => {
    expect(() =>
      prepare("React.useState['con' + 'structor']('return 1')()"),
    ).toThrow(SlideSourceError);
  });

  it("rejects Reflect-based dynamic-code access", () => {
    expect(() => prepare("Reflect.get(Object, 'constructor')")).toThrow(
      SlideSourceError,
    );
  });

  it("rejects Object prototype and descriptor reflection", () => {
    expect(() =>
      prepare(
        "Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Object), 'constructor').value('return 1')()",
      ),
    ).toThrow(SlideSourceError);
  });

  it("allows only the safe Object collection methods, including static keys", () => {
    const source = prepare(
      "Object.keys({ title: 'Deck' }).length + Object['values']({ count: 1 }).length",
    );
    expect(source).toContain("Object.keys");
    expect(source).toContain("Object['values']");
  });

  it.each([
    ['"x".repeat(1_000_000_000)', /Member call repeat is not supported/],
    ['"x"["repeat"](1_000_000_000)', /Member call repeat is not supported/],
    [
      '"x"["re" + "peat"](1_000_000_000)',
      /Member calls must use an approved static method/,
    ],
  ])(
    "rejects unbounded or unwrapped method access: %s",
    (expression, error) => {
      expect(() => prepare(expression)).toThrow(error);
    },
  );

  it("rejects aliases to dangerous or unbounded array methods", () => {
    expect(() =>
      prepareBody(
        'const repeat = "x".repeat; return <div>{repeat(1000000000)}</div>;',
      ),
    ).toThrow(/Prototype access is not allowed/);
    expect(() =>
      prepareBody("const map = rows.map; return <div>{map(() => 'x')}</div>;"),
    ).toThrow(/must be called directly so its bounds can be enforced/);
  });

  it("rewrites bounded array callbacks with the runtime budget wrapper", () => {
    const source = prepare("rows.map((row) => rows.map(() => row))");
    expect(source.match(/__slideRuntimeMap\(/g)).toHaveLength(2);
  });

  it("rewrites computed indexes through a bounded array/string accessor", () => {
    const source = prepare("rows[index]");
    expect(source).toContain("__slideRuntimeGet(rows, index)");
    expect(source).toContain("__slideRuntimeGet,");
  });

  it("adds a source locator to the ImagePlaceholder component", () => {
    const sourceTsx = [
      'import { ImagePlaceholder } from "@open-slide/core";',
      "export default function Slide() {",
      '  return <ImagePlaceholder hint="photo" />;',
      "}",
    ].join("\n");
    const source = prepareReactSlideSource(sourceTsx).source;

    expect(source).toMatch(
      /<ImagePlaceholder hint="photo"\s+data-slide-loc="3:9"\s*\/>/,
    );
  });

  it("renders OpenSlide image placeholder hints and dimensions", async () => {
    const response = await renderInWorker(
      [
        'import { ImagePlaceholder } from "@open-slide/core";',
        "export default function Slide() {",
        '  return <ImagePlaceholder hint="Product hero screenshot" width={640} height={360} />;',
        "}",
      ].join("\n"),
    );

    expect(response.type).toBe("rendered");
    expect(response.html).toContain(
      'data-slide-placeholder="Product hero screenshot"',
    );
    expect(response.html).toContain('aria-label="Product hero screenshot"');
    expect(response.html).toContain('data-placeholder-w="640"');
    expect(response.html).toContain('data-placeholder-h="360"');
    expect(response.html).toContain("width:640px");
    expect(response.html).toContain("height:360px");
  });

  it("renders video, source, and poster only with uploaded asset handles", async () => {
    const response = await renderInWorker(
      [
        "export default function Slide() {",
        '  return <video controls muted preload="metadata" poster="asset://poster-1"><source src="asset://clip-1" type="video/mp4" /></video>;',
        "}",
      ].join("\n"),
    );

    expect(response.type).toBe("rendered");
    expect(response.html).toContain(
      '<video controls="" muted="" preload="metadata" poster="asset://poster-1"',
    );
    expect(response.html).toContain(
      '<source src="asset://clip-1" type="video/mp4"',
    );
  });

  it("renders direct video sources and posters as uploaded asset handles", async () => {
    const response = await renderInWorker(
      'export default function Slide() { return <video controls src="asset://clip-1" poster="asset://poster-1" />; }',
    );

    expect(response.type).toBe("rendered");
    expect(response.html).toContain(
      '<video controls="" src="asset://clip-1" poster="asset://poster-1"',
    );
  });

  it.each([
    ["video src", 'return <video src="https://attacker.example/clip.mp4" />;'],
    [
      "source src",
      'return <video><source src="https://attacker.example/clip.mp4" /></video>;',
    ],
    [
      "poster",
      'return <video src="asset://clip-1" poster="https://attacker.example/poster.jpg" />;',
    ],
    ["malformed handle", 'return <video src="asset://../clip" />;'],
  ])("rejects unuploaded or malformed video %s URLs", async (_label, body) => {
    const response = await renderInWorker(
      `export default function Slide() { ${body} }`,
    );

    expect(response.type).toBe("error");
    expect(response.message).toMatch(/uploaded asset handles/);
  });

  it("rejects React event handlers on video elements", async () => {
    await expect(
      buildReactSlideRuntime(
        'export default function Slide() { return <video src="asset://clip-1" onError={() => {}} />; }',
        { current: 1, total: 1, assetUrls: new Map() },
      ),
    ).rejects.toThrow(/Event handlers are not allowed/);
  });

  it("rejects video sources outside a video element and videos without an asset source", async () => {
    for (const sourceTsx of [
      'export default function Slide() { return <div><source src="asset://clip-1" /></div>; }',
      'export default function Slide() { return <video src="asset://clip-1"><source /></video>; }',
      'export default function Slide() { return <video poster="asset://poster-1" />; }',
    ]) {
      const response = await renderInWorker(sourceTsx);
      expect(response.type).toBe("error");
    }
  });

  it("bundles the Worker-safe OpenSlide canvas and design values", async () => {
    const sourceTsx = [
      'import { CANVAS_HEIGHT, CANVAS_WIDTH, defaultDesign, designToCssVars } from "@open-slide/core";',
      "export default function Slide() {",
      "  return <main style={{ ...designToCssVars(defaultDesign), width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} />;",
      "}",
    ].join("\n");

    const runtime = await buildReactSlideRuntime(sourceTsx, {
      current: 1,
      total: 1,
      assetUrls: new Map(),
    });

    expect(runtime.kind).toBe("open-slide-react-worker-v1");
    expect(runtime.workerSource.length).toBeGreaterThan(0);
  });

  it("resolves React and JSX runtime imports in virtual slide modules", async () => {
    const runtime = await buildReactSlideRuntime(
      [
        'import React from "react";',
        'import { useSlidePageNumber } from "@open-slide/core";',
        "export default function Slide() {",
        "  const { current, total } = useSlidePageNumber();",
        '  return <main data-result="virtual React slide imports resolved">{current}/{total}</main>;',
        "}",
      ].join("\n"),
      { current: 1, total: 1, assetUrls: new Map() },
    );

    expect(runtime.workerSource).toContain(
      "virtual React slide imports resolved",
    );
  });

  it("bundles the bounded OpenSlide CSS variable serializer", async () => {
    const sourceTsx = [
      'import { cssVarsToString } from "@open-slide/core";',
      "export default function Slide() {",
      '  const cssText = cssVarsToString({ "--osd-accent": "#6d4cff" });',
      "  return <pre>{cssText}</pre>;",
      "}",
    ].join("\n");

    const runtime = await buildReactSlideRuntime(sourceTsx, {
      current: 1,
      total: 1,
      assetUrls: new Map(),
    });

    expect(runtime.workerSource).toContain("--osd-accent");
    expect(runtime.workerSource).toContain(
      "CSS variable names must be bounded custom properties.",
    );
  });

  it("does not enable dynamic stylesheet injection through the serializer", () => {
    const sourceTsx = [
      'import { cssVarsToString } from "@open-slide/core";',
      "export default function Slide() {",
      '  const cssText = cssVarsToString({ "--osd-accent": "#6d4cff" });',
      "  return <style>{cssText}</style>;",
      "}",
    ].join("\n");

    expect(() => prepareReactSlideSource(sourceTsx)).toThrow(
      /JSX element <style> is not allowed/,
    );
  });

  it("serializes valid CSS variables as escaped text in the Worker render", async () => {
    const response = await renderInWorker(
      [
        'import { cssVarsToString } from "@open-slide/core";',
        "export default function Slide() {",
        '  const cssText = cssVarsToString({ "--osd-accent": "#6d4cff" });',
        "  return <code>{cssText}</code>;",
        "}",
      ].join("\n"),
    );

    expect(response.type).toBe("rendered");
    expect(response.html).toContain("--osd-accent: #6d4cff;");
  });

  it("rejects CSS variable values that could add declarations or resources", async () => {
    const response = await renderInWorker(
      [
        'import { cssVarsToString } from "@open-slide/core";',
        "export default function Slide() {",
        '  const cssText = cssVarsToString({ "--osd-accent": "red; background-image: url(https://example.test/a.png)" });',
        "  return <pre>{cssText}</pre>;",
        "}",
      ].join("\n"),
    );

    expect(response).toMatchObject({
      type: "error",
      message: "CSS variable values must be safe scalar text.",
    });
  });

  it("keeps polygon clip paths while rejecting external CSS resources", async () => {
    const response = await renderInWorker(
      [
        "export default function Slide() {",
        '  return <main style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%)", backgroundImage: "url(https://example.test/a.png)" }} />;',
        "}",
      ].join("\n"),
    );

    expect(response.type).toBe("rendered");
    expect(response.html).toMatch(/clip-path:\s*polygon\(/);
    expect(response.html).not.toContain("background-image");
    expect(response.html).not.toContain("example.test");
  });

  it("rejects optional access and calls", () => {
    expect(() => prepare("model?.value")).toThrow(/Optional access and calls/);
    expect(() => prepare("render?.()")).toThrow(/Optional access and calls/);
  });
});
