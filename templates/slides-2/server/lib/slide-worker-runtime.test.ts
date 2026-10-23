import { Buffer } from "node:buffer";
import { TextEncoder } from "node:util";
import { runInNewContext } from "node:vm";
import { MessageChannel } from "node:worker_threads";

import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

import { legacySlideHtmlToSource } from "./legacy-slide-source.js";
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

function staticSvgNoiseBackground(width = 420) {
  const matrix = "0 0 0 0 0.85 0 0 0 0 0.93 0 0 0 0 1 1 0 0 0 0";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${width}'><filter id='n' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='0.012' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='matrix' values='${matrix}'/></filter><rect width='${width}' height='${width}' filter='url(#n)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

describe("React slide source validation", () => {
  it("bundles supported core imports and bounded helpers from the worker shim", async () => {
    const response = await renderInWorker(`
import { CANVAS_WIDTH } from "@open-slide/core";
export default function Slide() {
  const labels = ["Cover", "Body"];
  return <main>{CANVAS_WIDTH}:{labels.join(", ")}</main>;
}
`);

    expect(response.type).toBe("rendered");
    expect(response.html).toContain("1920:Cover, Body");
  });

  it("renders concise arrow components with parenthesized return bodies", async () => {
    const response = await renderInWorker(`
const summary = () => ({ label: "Instrumented preview" });
const Preview = () => (
  <main><span>{summary().label}</span></main>
);
export default function Slide() { return <Preview />; }
`);

    expect(response.type).toBe("rendered");
    expect(response.html).toContain("Instrumented preview");
  });

  it("renders HTML-imported React source through the slide Worker", async () => {
    const sourceTsx = legacySlideHtmlToSource(
      '<section class="fmd-slide" style="color:#172033"><h1>Imported title</h1><p>Imported body</p><img src="asset://imported-image" alt="Imported image"></section>',
    );
    const runtime = await buildReactSlideRuntime(sourceTsx, {
      current: 1,
      total: 1,
      assetUrls: new Map([
        ["imported-image", "https://assets.example.test/imported.png"],
      ]),
    });

    const response = renderWorker(runtime.workerSource, runtime.page);

    expect(response.type).toBe("rendered");
    expect(response.html).toContain("Imported title");
    expect(response.html).toContain("Imported body");
    expect(response.html).toContain('src="asset://imported-image"');
  });

  it("preserves SVG pattern scale and rotation attributes", async () => {
    const response = await renderInWorker(`
export default function Slide() {
  return (
    <svg viewBox="0 0 100 100">
      <defs>
        <pattern id="stripes" patternUnits="userSpaceOnUse" patternTransform="rotate(45)" width="8" height="8">
          <path d="M 0 0 L 0 8" stroke="#fff" />
        </pattern>
      </defs>
      <rect width="100" height="100" fill="url(#stripes)" />
    </svg>
  );
}
`);

    expect(response.type).toBe("rendered");
    expect(response.html?.toLowerCase()).toContain(
      'patternunits="userSpaceOnUse"'.toLowerCase(),
    );
    expect(response.html?.toLowerCase()).toContain(
      'patterntransform="rotate(45)"',
    );
  });

  it("preserves SVG path length for normalized stroke dashes", async () => {
    const response = await renderInWorker(`
export default function Slide() {
  return <svg viewBox="0 0 100 100"><path d="M 0 50 L 100 50" pathLength={1} strokeDasharray="0.2 0.8" /></svg>;
}
`);

    expect(response.type).toBe("rendered");
    expect(response.html?.toLowerCase()).toContain('pathlength="1"');
  });

  it("renders bounded NoiseBackground primitives as inline SVG and limits them per slide", async () => {
    const source = `import { NoiseBackground } from "@agent-native/slides-core"; export default function Slide() { return <main><NoiseBackground /><NoiseBackground baseFrequency={0.03} numOctaves={2} seed={8} opacity={0.4} fill="#abc" /></main>; }`;
    const runtime = await buildReactSlideRuntime(source, {
      current: 1,
      total: 1,
      assetUrls: new Map(),
    });
    const response = renderWorker(runtime.workerSource, runtime.page);

    expect(response.type, response.message).toBe("rendered");
    expect(response.html).toContain("<feTurbulence");
    expect(response.html).toContain("<feColorMatrix");
    expect(response.html).toContain('id="slides2-noise-1"');
    expect(response.html).toContain('id="slides2-noise-2"');
    expect(response.html).toContain('baseFrequency="0.03"');
    expect(response.html).not.toContain("data:image");
    expect(response.html).not.toContain("data-slides2-noise");
    expect(source).not.toContain("data:image");

    const repeated = Array.from(
      { length: 9 },
      (_, index) => `<NoiseBackground key="${index}" />`,
    ).join("");
    const limited = await renderInWorker(
      `import { NoiseBackground } from "@agent-native/slides-core"; export default function Slide() { return <main>${repeated}</main>; }`,
    );

    expect(limited.type).toBe("error");
    expect(limited.message).toContain("too many filtered backgrounds");

    const invalid = await renderInWorker(
      'import { NoiseBackground } from "@agent-native/slides-core"; export default function Slide() { return <NoiseBackground numOctaves={5} />; }',
    );
    expect(invalid.type).toBe("error");
    expect(invalid.message).toContain("NoiseBackground props");
  });

  it("rejects authored SVG filter primitives outside NoiseBackground", async () => {
    await expect(
      renderInWorker(`
export default function Slide() {
  return <svg><defs><filter id="noise"><feTurbulence numOctaves="99" /></filter></defs></svg>;
}
`),
    ).rejects.toThrow("JSX element <filter> is not allowed");
  });

  it("counts built-in noise backgrounds once in the worker render budget", async () => {
    const noise = staticSvgNoiseBackground();
    const builtIns = [
      {
        component: "ImagePlaceholder",
        markup: (index: number) =>
          `<ImagePlaceholder key="${index}" hint="paper" style={{ backgroundImage: ${JSON.stringify(noise)} }} />`,
      },
      {
        component: "MorphElement",
        markup: (index: number) =>
          `<MorphElement key="${index}" id="shape-${index}" style={{ backgroundImage: ${JSON.stringify(noise)} }}><div /></MorphElement>`,
      },
    ];

    for (const builtIn of builtIns) {
      const renderedMarkup = (count: number) =>
        Array.from({ length: count }, (_, index) => builtIn.markup(index)).join(
          "",
        );
      const source = `
import { ${builtIn.component} } from "@agent-native/slides-core";
export default function Slide() { return <main>${renderedMarkup(8)}</main>; }
`;
      const response = await renderInWorker(source);

      expect(response.type).toBe("rendered");
      expect(
        response.html?.match(/data-slide-placeholder|data-slides2-morph/g),
      ).toHaveLength(8);

      const overLimit = await renderInWorker(
        source.replace(renderedMarkup(8), renderedMarkup(9)),
      );
      expect(overLimit.type).toBe("error");
      expect(overLimit.message).toContain("too many filtered backgrounds");
    }
  });

  it("uses a static default-page transition override before the module default", async () => {
    const runtime = await buildReactSlideRuntime(
      `
export const transition = { duration: 300 };
export default function Slide() { return <main />; }
Slide.transition = { duration: 220 };
`,
      { current: 1, total: 1, assetUrls: new Map() },
    );

    expect(runtime.transition).toEqual({ duration: 220 });
  });

  it("resolves a default-page transition from a static local value", () => {
    const prepared = prepareReactSlideSource(`
const Slide = () => <main />;
const pageTransition = { duration: 180 };
Slide.transition = pageTransition;
export default Slide;
`);

    expect(prepared.transition).toEqual({ duration: 180 });
  });

  it("rejects dynamic and repeated default-page transition assignments", () => {
    expect(() =>
      prepareReactSlideSource(`
export default function Slide() { return <main />; }
Slide.transition = getTransition();
`),
    ).toThrow("Slide module metadata must be a static object.");

    expect(() =>
      prepareReactSlideSource(`
export default function Slide() { return <main />; }
Slide.transition = { duration: 180 };
Slide.transition = { duration: 220 };
`),
    ).toThrow("A page may only declare one transition override.");
  });

  it("rejects transition assignments on a component other than the default page", () => {
    expect(() =>
      prepareReactSlideSource(`
function Cover() { return <main />; }
function Body() { return <section />; }
Body.transition = { duration: 220 };
export default Cover;
`),
    ).toThrow("Top-level ExpressionStatement code is not supported");
  });

  it("merges a morph marker and presentation props onto a single DOM child", async () => {
    const response = await renderInWorker(`
import { MorphElement } from "@agent-native/slides-core";
export default function Slide() {
  return (
    <MorphElement id="heading" className="morph-frame" style={{ color: "red" }}>
      <h1 className="title" style={{ color: "blue", fontSize: 48 }}>Hello</h1>
    </MorphElement>
  );
}
`);

    expect(response.type).toBe("rendered");
    expect(response.html).toContain('<h1 class="title morph-frame"');
    expect(response.html).toContain('data-slides2-morph="heading"');
    expect(response.html).toContain("font-size:48px");
    expect(response.html).toContain("color:red");
    expect(response.html).not.toContain("color:blue");
    expect(response.html).not.toContain('<div class="morph-frame"');
  });

  it("collapses stepped reveal fades under the reduced-motion media query", async () => {
    const runtime = await buildReactSlideRuntime(
      `
import { Step, Steps } from "@agent-native/slides-core";
export default function Slide() {
  return <Steps><Step duration={240}>Reveal</Step></Steps>;
}
`,
      { current: 1, total: 1, assetUrls: new Map() },
    );
    const css = runtime.styles.join("\n");

    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("#slide-root :is([data-slides2-step])");
    expect(css).toContain("transition-duration: 0ms !important");
  });

  it("keeps safe CSS timing functions in the static slide output", async () => {
    const runtime = await buildReactSlideRuntime(
      `export default function Slide() {
  return <div style={{ transition: "opacity 180ms cubic-bezier(0, 0, 0.2, 1)", animationTimingFunction: "steps(4, end)", clipPath: "inset(0 round 20px)", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gridTemplateRows: "fit-content(240px) 1fr" }} />;
}`,
      { current: 1, total: 1, assetUrls: new Map() },
    );
    const response = renderWorker(runtime.workerSource, runtime.page);

    expect(response.type).toBe("rendered");
    expect(response.html).toContain("cubic-bezier(0, 0, 0.2, 1)");
    expect(response.html).toContain("steps(4, end)");
    expect(response.html).toContain("inset(0 round 20px)");
    expect(response.html).toContain("repeat(3, minmax(0, 1fr))");
    expect(response.html).toContain("fit-content(240px) 1fr");
  });

  it("rejects a default export that aliases a Page array", () => {
    expect(() =>
      prepareReactSlideSource(`
function Cover() { return <main />; }
const pages: Page[] = [Cover];
export default pages;
`),
    ).toThrow("The default export must be a React page component.");
  });

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
        'import { useSlidePageNumber } from "@agent-native/slides-core";',
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
  ])(
    "accepts supported effect hooks accessed through %s",
    (_label, sourceTsx) => {
      expect(() => prepareReactSlideSource(sourceTsx)).not.toThrow();
    },
  );

  it("keeps static rendering deterministic while compiling a separate live React mount", async () => {
    const sourceTsx = `
import React, { useState } from "react";
export default function Slide() {
  const [count, setCount] = useState(0);
  React.useEffect(() => {
    window.requestAnimationFrame(() => setCount(1));
  }, []);
  return <div data-testid="count" onClick={(event) => { event.preventDefault(); setCount(event.target.tagName === "div" ? count + 1 : 9); }}>{count}</div>;
}
`;
    const runtime = await buildReactSlideRuntime(sourceTsx, {
      current: 1,
      total: 1,
      assetUrls: new Map(),
    });
    const liveSource = runtime.liveSource;
    if (typeof liveSource !== "string") {
      throw new Error("The live React bundle was not generated.");
    }
    const staticResponse = renderWorker(runtime.workerSource, runtime.page);
    expect(staticResponse.type).toBe("rendered");
    expect(staticResponse.html).toContain(">0</div>");
    expect(liveSource).toContain("__slideRuntimeLive");
    expect(liveSource).toContain("requestAnimationFrame");

    const browser = new Window({
      settings: { enableJavaScriptEvaluation: true },
    });
    browser.document.body.innerHTML = '<main id="root"></main>';
    const liveWindow = browser as unknown as Record<string, unknown>;
    try {
      browser.eval(liveSource);
      const api = liveWindow.__slideRuntimeLive as
        | {
            mount?: unknown;
          }
        | undefined;
      expect(typeof api?.mount).toBe("function");
    } finally {
      await browser.happyDOM.abort();
    }
  });

  it.each([
    "export default function Slide() { while (true) {} return <main />; }",
    "function first() { second(); } function second() { first(); } export default function Slide() { first(); return <main />; }",
  ])("rejects unbounded live source execution", (sourceTsx) => {
    expect(() => prepareReactSlideSource(sourceTsx)).toThrow(
      /Loops are not supported|Recursive slide source functions/,
    );
  });

  it.each([
    "window.parent",
    "window.document",
    "window.location",
    "window.matchMedia('all')",
  ])("rejects unsupported browser access %s", (expression) => {
    expect(() => prepare(`String(${expression})`)).toThrow(SlideSourceError);
  });

  it("allows timers only through the bounded window API", () => {
    expect(() =>
      prepareBody(
        "window.setTimeout(() => {}, 10); window.clearTimeout(1); window.setInterval(() => {}, 50); window.clearInterval(2); return <main />;",
      ),
    ).not.toThrow();
    expect(() =>
      prepareBody("setTimeout(() => {}, 10); return <main />;"),
    ).toThrow("Slide source cannot access setTimeout.");
    expect(() => prepareBody("clearTimeout(1); return <main />;")).toThrow(
      "Slide source cannot access clearTimeout.",
    );
  });

  it("allows static style keys named after blocked globals but rejects reads", async () => {
    const response = await renderInWorker(
      'export default function Slide() { return <div style={{ position: "absolute", top: 0 }} />; }',
    );

    expect(response.type).toBe("rendered");
    expect(response.html).toMatch(/top:\s*0/);
    expect(() => prepareBody("return <main>{top}</main>;")).toThrow(
      "Slide source cannot access top.",
    );
    expect(() => prepareBody("return <main style={{ top }} />;")).toThrow(
      "Slide source cannot access top.",
    );
  });

  it.each([
    ["parent frame", `const send = parent["postMessage"]; return <main />;`],
    ["top frame", `const send = top["postMessage"]; return <main />;`],
    [
      "frame collection",
      `const send = frames[0]["postMessage"]; return <main />;`,
    ],
    ["opened frame", `const send = opener["postMessage"]; return <main />;`],
    [
      "event frame path",
      `return <div onClick={(event) => event.view["parent"]} />;`,
    ],
  ])("rejects %s access to frame messaging", (_label, body) => {
    expect(() => prepareBody(body)).toThrow(SlideSourceError);
  });

  it("allows bounded event handlers and rejects non-allowlisted handlers", () => {
    expect(() =>
      prepareReactSlideSource(
        "export default function Slide() { return <div onClick={() => {}}>Open</div>; }",
      ),
    ).not.toThrow();
    expect(() =>
      prepareReactSlideSource(
        "export default function Slide() { return <div onError={() => {}}>Open</div>; }",
      ),
    ).toThrow(/Event handlers are not allowed/);
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
      'import { ImagePlaceholder } from "@agent-native/slides-core";',
      "export default function Slide() {",
      '  return <ImagePlaceholder hint="photo" />;',
      "}",
    ].join("\n");
    const source = prepareReactSlideSource(sourceTsx).source;

    expect(source).toMatch(
      /<ImagePlaceholder hint="photo"\s+data-slide-loc="3:9"\s*\/>/,
    );
  });

  it("renders Slides2 image placeholder hints and dimensions", async () => {
    const response = await renderInWorker(
      [
        'import { ImagePlaceholder } from "@agent-native/slides-core";',
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
    expect(response.html).toContain('role="img"');
    expect(response.html).toContain("border-radius:12px");
    expect(response.html).toContain('aria-label="image placeholder"');
    expect(response.html).toContain(">Image</span>");
    expect(response.html).toContain(">Product hero screenshot</span>");
    expect(response.html).toContain(">640 × 360</span>");
  });

  it("uses the placeholder fallback and does not infer dimensions or aspect ratio", async () => {
    const response = await renderInWorker(
      [
        'import { ImagePlaceholder } from "@agent-native/slides-core";',
        "export default function Slide() {",
        "  return <ImagePlaceholder width={640} />;",
        "}",
      ].join("\n"),
    );

    expect(response.type).toBe("rendered");
    expect(response.html).toContain(
      'data-slide-placeholder="Image placeholder"',
    );
    expect(response.html).toContain('aria-label="Image placeholder"');
    expect(response.html).toContain(">Image placeholder</span>");
    expect(response.html).toContain(
      'style="position:relative;width:640px;height:100%',
    );
    expect(response.html).not.toContain("640 ×");
    expect(response.html).not.toContain("aspect-ratio");
  });

  it("keeps uploaded image handles in image markup for host resolution", async () => {
    const image = await renderInWorker(
      [
        "export default function Slide() {",
        '  return <img src="asset://uploaded-image" alt="Product screenshot" />;',
        "}",
      ].join("\n"),
    );

    expect(image.type).toBe("rendered");
    expect(image.html).toContain('<img src="asset://uploaded-image"');
    expect(image.html).not.toContain('<link rel="preload"');
  });

  it.each([
    ["external image URL", "https://attacker.example/image.png"],
    ["malformed image handle", "asset://../image"],
  ])(
    "rejects %s instead of treating it as an image preload",
    async (_label, src) => {
      const image = await renderInWorker(
        `export default function Slide() { return <img src="${src}" alt="Product screenshot" />; }`,
      );

      expect(image.type).toBe("error");
    },
  );

  it("rejects uploaded image handles on image placeholders", async () => {
    const placeholder = await renderInWorker(
      [
        'import { ImagePlaceholder } from "@agent-native/slides-core";',
        "export default function Slide() {",
        '  return <ImagePlaceholder hint="Product screenshot" src="asset://uploaded-image" />;',
        "}",
      ].join("\n"),
    );

    expect(placeholder.type).toBe("error");
    expect(placeholder.message).toContain(
      "Media references must use uploaded asset handles.",
    );
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

  it("bundles the Worker-safe Slides2 canvas and design values", async () => {
    const sourceTsx = [
      'import { CANVAS_HEIGHT, CANVAS_WIDTH, defaultDesign, designToCssVars } from "@agent-native/slides-core";',
      "export default function Slide() {",
      "  return <main style={{ ...designToCssVars(defaultDesign), width: CANVAS_WIDTH, height: CANVAS_HEIGHT }} />;",
      "}",
    ].join("\n");

    const runtime = await buildReactSlideRuntime(sourceTsx, {
      current: 1,
      total: 1,
      assetUrls: new Map(),
    });

    expect(runtime.kind).toBe("agent-native-slides-react-worker-v1");
    expect(runtime.workerSource.length).toBeGreaterThan(0);
  });

  it("resolves React and JSX runtime imports in virtual slide modules", async () => {
    const runtime = await buildReactSlideRuntime(
      [
        'import React from "react";',
        'import { useSlidePageNumber } from "@agent-native/slides-core";',
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

  it("renders approved React identifiers with reveal components", async () => {
    const response = await renderInWorker(
      [
        'import { useId } from "react";',
        'import { Step, Steps } from "@agent-native/slides-core";',
        "export default function Slide() {",
        "  const id = useId();",
        '  return <main id={id}><a href={"#" + id}>Jump</a><Steps><Step>Reveal</Step></Steps></main>;',
        "}",
      ].join("\n"),
    );

    expect(response.type).toBe("rendered");
    expect(response.html).toMatch(/<main id="_[^"]+"[^>]*>/);
    expect(response.html).toMatch(/href="#_[^"]+"/);
    expect(response.html).toContain('data-slides2-step="revealed"');
    expect(response.html).toContain(">Reveal</div>");
  });

  it.each([
    "node:fs",
    "react-dom/server",
    "@agent-native/slides-2-core/internal",
  ])("rejects imports from unsupported module %s", (moduleName) => {
    expect(() =>
      prepareReactSlideSource(
        `import React from "${moduleName}"; export default function Slide() { return <main />; }`,
      ),
    ).toThrow(`Import from ${moduleName} is not supported`);
  });

  it("rejects module-level execution outside static declarations", () => {
    expect(() =>
      prepareReactSlideSource(
        'console.log("not allowed"); export default function Slide() { return <main />; }',
      ),
    ).toThrow("Top-level ExpressionStatement code is not supported");
  });

  it("bundles the bounded Slides2 CSS variable serializer", async () => {
    const sourceTsx = [
      'import { cssVarsToString } from "@agent-native/slides-core";',
      "export default function Slide() {",
      '  const cssText = cssVarsToString({ "--slides2-accent": "#6d4cff" });',
      "  return <pre>{cssText}</pre>;",
      "}",
    ].join("\n");

    const runtime = await buildReactSlideRuntime(sourceTsx, {
      current: 1,
      total: 1,
      assetUrls: new Map(),
    });

    expect(runtime.workerSource).toContain("--slides2-accent");
    expect(runtime.workerSource).toContain(
      "CSS variable names must be bounded custom properties.",
    );
  });

  it("does not enable dynamic stylesheet injection through the serializer", () => {
    const sourceTsx = [
      'import { cssVarsToString } from "@agent-native/slides-core";',
      "export default function Slide() {",
      '  const cssText = cssVarsToString({ "--slides2-accent": "#6d4cff" });',
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
        'import { cssVarsToString } from "@agent-native/slides-core";',
        "export default function Slide() {",
        '  const cssText = cssVarsToString({ "--slides2-accent": "#6d4cff" });',
        "  return <code>{cssText}</code>;",
        "}",
      ].join("\n"),
    );

    expect(response.type).toBe("rendered");
    expect(response.html).toContain("--slides2-accent: #6d4cff;");
  });

  it("rejects CSS variable values that could add declarations or resources", async () => {
    const response = await renderInWorker(
      [
        'import { cssVarsToString } from "@agent-native/slides-core";',
        "export default function Slide() {",
        '  const cssText = cssVarsToString({ "--slides2-accent": "red; background-image: url(https://example.test/a.png)" });',
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
