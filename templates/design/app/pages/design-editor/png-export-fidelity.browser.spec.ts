import { createServer, type Server, type ServerResponse } from "node:http";

import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { editorChromeBridgeScript } from "../../../.generated/bridge/editor-chrome.generated";
import renderExportPng from "../../../actions/render-export-png";

const browsers: Browser[] = [];
let server: Server;
let base: string;
const slowResponses: ServerResponse[] = [];
let slowReleased = false;

beforeAll(async () => {
  const launch = chromium.launch.bind(chromium);
  vi.spyOn(chromium, "launch").mockImplementation(async (options) => {
    const browser = await launch(options);
    browsers.push(browser);
    return browser;
  });
  const bundle = await build({
    stdin: {
      contents:
        'export { renderExportDocumentCanvas } from "./app/pages/design-editor/png-export-render";',
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    globalName: "exporter",
    write: false,
    logLevel: "silent",
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.env": "{}",
    },
    plugins: [
      {
        name: "local-export-transport",
        setup(build) {
          build.onResolve(
            { filter: /^@agent-native\/core\/client\/hooks$/ },
            () => ({ path: "transport", namespace: "fixture" }),
          );
          build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: `export async function callActionBlob(name,args) {
              const response = await fetch('/render', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)});
              if (!response.ok) throw new Error(await response.text());
              return response.blob();
            }`,
          }));
        },
      },
    ],
  });
  server = createServer(async (request, response) => {
    try {
      if (request.url === "/render") {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk);
        const result = await renderExportPng.run(
          JSON.parse(Buffer.concat(chunks).toString()),
          { caller: "frontend" },
        );
        response.writeHead(result.status, { "content-type": "image/png" });
        response.end(Buffer.from(await result.arrayBuffer()));
      } else if (request.url === "/exporter.js") {
        response.writeHead(200, { "content-type": "text/javascript" });
        response.end(bundle.outputFiles[0]!.text);
      } else if (request.url === "/slow-density.svg") {
        if (slowReleased) {
          response.writeHead(200, { "content-type": "image/svg+xml" });
          response.end(
            '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>',
          );
        } else {
          slowResponses.push(response);
        }
      } else if (request.url === "/density.svg") {
        response.writeHead(200, { "content-type": "image/svg+xml" });
        response.end(
          '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>',
        );
      } else {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("<!doctype html><html><body></body></html>");
      }
    } catch (error) {
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  for (const browser of browsers) await browser.close();
  for (const response of slowResponses) response.destroy();
  vi.restoreAllMocks();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function hydrateBridge(runtime: boolean): string {
  return editorChromeBridgeScript
    .replace("__READ_ONLY__", "false")
    .replace("__TEXT_EDITING_ENABLED__", "false")
    .replace("__EDITOR_CHROME_SCALE_X__", "1")
    .replace("__EDITOR_CHROME_SCALE_Y__", "1")
    .replace("__DESIGN_CANVAS_SCREEN_ID__", '"export-fidelity"')
    .replace("__DESIGN_CANVAS_BOARD_SURFACE__", "true")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_X__", "0")
    .replace("__DESIGN_CANVAS_CONTENT_OFFSET_Y__", "0")
    .replace("__RUNTIME_LAYER_SNAPSHOT_ENABLED__", String(runtime))
    .replace(/__INITIAL_SOURCE_HEAD__/g, '""');
}

it.each([
  {
    name: "responsive layout with horizontal overflow",
    width: 1000,
    height: 600,
    frameHeight: 600,
    content:
      '<style>html,body{margin:0}main{width:100vw;height:400px}#probe{width:10vw;height:100px;background:red}aside{position:absolute;left:1300px;top:450px;width:100px;height:50px}</style><main><div id="probe"></div></main><aside></aside>',
    redWidth: 100,
    redHeight: 100,
  },
  {
    name: "density-corrected responsive image",
    width: 400,
    height: 400,
    frameHeight: 400,
    content:
      '<style>html,body{margin:0}</style><img id="probe" srcset="/density.svg 2x">',
    redWidth: 100,
    redHeight: 50,
  },
  {
    name: "responsive inline SVG data URL with whitespace",
    width: 400,
    height: 400,
    frameHeight: 400,
    runtime: true,
    content:
      "<style>html,body{margin:0}</style><img id=\"probe\" width=\"100\" height=\"50\" src=\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='100'><rect width='200' height='100' fill='red'/></svg>\" srcset=\"\">",
    redWidth: 100,
    redHeight: 50,
  },
  {
    name: "the browser-selected picture source",
    width: 400,
    height: 400,
    frameHeight: 400,
    content:
      '<style>html,body{margin:0}</style><picture><source type="image/svg+xml" srcset="/density.svg 2x"><img id="probe" src="/missing-fallback.svg"></picture>',
    redWidth: 100,
    redHeight: 50,
  },
  {
    name: "an offscreen lazy image without modifying its source attributes",
    width: 400,
    height: 400,
    frameHeight: 400,
    lazy: true,
    content:
      '<style>html,body{margin:0}</style><img id="probe" loading="lazy" srcset="/density.svg 2x">',
    redWidth: 100,
    redHeight: 50,
  },
  {
    name: "unsupported picture source sharing the fallback URL",
    width: 400,
    height: 400,
    frameHeight: 400,
    content:
      '<style>html,body{margin:0}</style><picture><source type="image/unsupported" srcset="/density.svg 2x"><img id="probe" src="/density.svg"></picture>',
    redWidth: 200,
    redHeight: 100,
  },
  {
    name: "runtime responsive image in a narrower viewport",
    width: 400,
    exportWidth: 50,
    height: 400,
    frameHeight: 400,
    runtime: true,
    content:
      '<style>html,body{margin:0}img{max-width:100%;height:auto}</style><img id="probe" srcset="/density.svg 2x">',
    redWidth: 50,
    redHeight: 25,
  },
  {
    name: "an empty inline SVG image reference",
    width: 400,
    height: 200,
    frameHeight: 200,
    runtime: true,
    content:
      '<style>html,body{margin:0}</style><svg width="100" height="50"><image href="" width="100" height="50"/><rect width="100" height="50" fill="red"/></svg>',
    redWidth: 100,
    redHeight: 50,
  },
  {
    name: "frame taller than the loaded document",
    width: 1000,
    height: 200,
    frameHeight: 1000,
    content:
      '<style>html,body{margin:0;height:200px}#probe{width:100px;height:100px;background:red}</style><div id="probe"></div>',
    redWidth: 100,
    redHeight: 100,
  },
])("preserves $name in the exported pixels", async (fixture) => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.goto(base);
  await page.addScriptTag({ url: `${base}/exporter.js` });
  await page.evaluate(() => {
    window.addEventListener("message", (event) => {
      if (event.data?.type === "agent-native:runtime-layer-snapshot") {
        (window as any).__exportSnapshot = event.data.payload.html;
      }
      if (
        event.data?.type ===
        "agent-native:runtime-layer-snapshot-reservation-request"
      ) {
        (event.source as Window).postMessage(
          {
            type: "grant-runtime-layer-snapshot-reservation",
            requestId: event.data.requestId,
            documentId: event.data.documentId,
            reservationToken: "export-fidelity",
          },
          "*",
        );
      }
    });
  });
  await page.evaluate(async (fixture) => {
    const iframe = document.createElement("iframe");
    iframe.width = String(fixture.width);
    iframe.height = String(fixture.height);
    iframe.style.cssText =
      "border:0;transform:scale(.5935);transform-origin:0 0";
    if ("lazy" in fixture && fixture.lazy) iframe.style.top = "8000px";
    if ("lazy" in fixture && fixture.lazy) iframe.style.position = "absolute";
    const ready = new Promise<void>((resolve) => {
      iframe.onload = () => resolve();
    });
    iframe.srcdoc = `<!doctype html><html><head></head><body>${fixture.content}</body></html>`;
    document.body.appendChild(iframe);
    await ready;
    if (!("lazy" in fixture && fixture.lazy)) {
      await Promise.all(
        Array.from(iframe.contentDocument!.images, (image) => image.decode()),
      );
    }
  }, fixture);
  await page.frames()[1]!.addScriptTag({
    content: hydrateBridge("runtime" in fixture && fixture.runtime === true),
  });
  if ("runtime" in fixture && fixture.runtime) {
    await page.waitForFunction(
      () => typeof (window as any).__exportSnapshot === "string",
    );
    expect(
      await page.evaluate(() => (window as any).__exportSnapshot),
    ).not.toContain("data-agent-native-export-resource-failures");
    await page.evaluate(async (width) => {
      const original = document.querySelector("iframe")!;
      const replacement = document.createElement("iframe");
      replacement.width = String(width);
      replacement.height = "400";
      replacement.style.border = "0";
      const ready = new Promise<void>(
        (resolve) => (replacement.onload = () => resolve()),
      );
      replacement.srcdoc = (window as any).__exportSnapshot;
      original.replaceWith(replacement);
      await ready;
    }, fixture.exportWidth);
  }
  if (fixture.name === "responsive inline SVG data URL with whitespace") {
    expect(
      await page
        .frames()[1]!
        .locator("#probe")
        .evaluate(async (element) => {
          const image = new Image();
          image.srcset = (element as HTMLImageElement).srcset;
          await image.decode();
          return image.naturalWidth;
        }),
    ).toBe(200);
  }
  const result = await page.evaluate(async (fixture) => {
    const iframe = document.querySelector("iframe")!;
    const { canvas } = await (
      window as any
    ).exporter.renderExportDocumentCanvas({
      doc: iframe.contentDocument,
      iframe,
      exportScale: 1,
      cropRect: {
        x: 0,
        y: 0,
        width: "exportWidth" in fixture ? fixture.exportWidth : fixture.width,
        height: fixture.frameHeight,
      },
    });
    const pixels = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width,
      top = canvas.height,
      right = -1,
      bottom = -1;
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        const index = (y * canvas.width + x) * 4;
        if (
          pixels[index] > 200 &&
          pixels[index + 1] < 80 &&
          pixels[index + 2] < 80 &&
          pixels[index + 3] > 200
        ) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
    return {
      width: canvas.width,
      height: canvas.height,
      redWidth: right - left + 1,
      redHeight: bottom - top + 1,
    };
  }, fixture);
  expect(result).toEqual({
    width: "exportWidth" in fixture ? fixture.exportWidth : fixture.width,
    height: fixture.frameHeight,
    redWidth: fixture.redWidth,
    redHeight: fixture.redHeight,
  });
  if ("lazy" in fixture && fixture.lazy) {
    expect(await page.frames()[1]!.locator("img").getAttribute("loading")).toBe(
      "lazy",
    );
  }
  await browser.close();
});

it("preserves transparent padding for negative-origin element crops", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.goto(base);
  await page.addScriptTag({ url: `${base}/exporter.js` });
  await page.evaluate(async () => {
    const iframe = document.createElement("iframe");
    iframe.width = "400";
    iframe.height = "400";
    iframe.style.border = "0";
    const ready = new Promise<void>(
      (resolve) => (iframe.onload = () => resolve()),
    );
    iframe.srcdoc = `<!doctype html><html><head><style>
      html,body{margin:0}#probe{position:absolute;left:0;top:0;width:84px;height:52px;background:red}
    </style></head><body><div id="probe"></div></body></html>`;
    document.body.appendChild(iframe);
    await ready;
  });
  await page.frames()[1]!.addScriptTag({ content: hydrateBridge(false) });
  const result = await page.evaluate(async () => {
    const iframe = document.querySelector("iframe")!;
    const { canvas } = await (
      window as any
    ).exporter.renderExportDocumentCanvas({
      doc: iframe.contentDocument,
      iframe,
      exportScale: 1,
      cropRect: { x: -16, y: -8, width: 116, height: 68 },
    });
    const pixels = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width,
      top = canvas.height,
      right = -1,
      bottom = -1;
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        const index = (y * canvas.width + x) * 4;
        if (
          pixels[index] > 200 &&
          pixels[index + 1] < 80 &&
          pixels[index + 2] < 80 &&
          pixels[index + 3] > 200
        ) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
    return {
      width: canvas.width,
      height: canvas.height,
      redLeft: left,
      redTop: top,
      redWidth: right - left + 1,
      redHeight: bottom - top + 1,
    };
  });
  expect(result).toEqual({
    width: 116,
    height: 68,
    redLeft: 16,
    redTop: 8,
    redWidth: 84,
    redHeight: 52,
  });
  const offscreenError = await page.evaluate(async () => {
    const iframe = document.querySelector("iframe")!;
    try {
      await (window as any).exporter.renderExportDocumentCanvas({
        doc: iframe.contentDocument,
        iframe,
        exportScale: 1,
        cropRect: { x: 500, y: 500, width: 10, height: 10 },
      });
      return null;
    } catch (error) {
      return (error as { code?: string }).code ?? null;
    }
  });
  expect(offscreenError).toBe("selection-unresolved");
  await browser.close();
});

it("waits for a loading width-described image and refreshes its runtime snapshot", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.addScriptTag({ url: `${base}/exporter.js` });
  await page.evaluate(async () => {
    (window as any).__snapshots = [];
    window.addEventListener("message", (event) => {
      if (event.data?.type === "agent-native:runtime-layer-snapshot") {
        (window as any).__snapshots.push(event.data.payload.html);
      }
      if (
        event.data?.type ===
        "agent-native:runtime-layer-snapshot-reservation-request"
      ) {
        (window as any).__reservation = true;
        (event.source as Window).postMessage(
          {
            type: "grant-runtime-layer-snapshot-reservation",
            requestId: event.data.requestId,
            documentId: event.data.documentId,
            reservationToken: "loading-image",
          },
          "*",
        );
      }
    });
    const iframe = document.createElement("iframe");
    iframe.width = "400";
    iframe.height = "400";
    iframe.style.border = "0";
    const ready = new Promise<void>(
      (resolve) => (iframe.onload = () => resolve()),
    );
    iframe.srcdoc =
      '<!doctype html><html><body style="margin:0"></body></html>';
    document.body.appendChild(iframe);
    await ready;
  });
  await page.frames()[1]!.addScriptTag({ content: hydrateBridge(true) });
  const requested = page.waitForRequest((request) =>
    request.url().endsWith("/slow-density.svg"),
  );
  await page.frames()[1]!.evaluate(() => {
    const image = document.createElement("img");
    image.srcset = "/slow-density.svg 200w";
    image.sizes = "100px";
    document.body.appendChild(image);
  });
  await requested;
  await page.waitForFunction(() => (window as any).__reservation === true);
  const capture = page.evaluate(async () => {
    const iframe = document.querySelector("iframe")!;
    const { canvas } = await (
      window as any
    ).exporter.renderExportDocumentCanvas({
      doc: iframe.contentDocument,
      iframe,
      exportScale: 1,
      cropRect: { x: 0, y: 0, width: 400, height: 400 },
    });
    const row = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, 1).data;
    let red = 0;
    for (let x = 0; x < canvas.width; x++) {
      if (row[x * 4] > 200 && row[x * 4 + 1] < 80 && row[x * 4 + 2] < 80) red++;
    }
    return red;
  });
  await new Promise((resolve) => setTimeout(resolve, 10_500));
  slowReleased = true;
  for (const response of slowResponses) {
    response.writeHead(200, { "content-type": "image/svg+xml" });
    response.end(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>',
    );
  }
  expect(await capture).toBe(100);
  await page.waitForFunction(() =>
    ((window as any).__snapshots as string[]).some((html) => {
      const snapshot = new DOMParser().parseFromString(html, "text/html");
      return (
        snapshot.querySelector("img") &&
        !snapshot.documentElement.hasAttribute(
          "data-agent-native-export-resource-failures",
        )
      );
    }),
  );
  const width = await page.evaluate(async () => {
    const html = (window as any).__snapshots.at(-1);
    const snapshot = new DOMParser().parseFromString(html, "text/html");
    const source = snapshot.querySelector("img")!;
    const image = new Image();
    image.srcset = source.srcset;
    await image.decode();
    return image.naturalWidth;
  });
  expect(
    await page.evaluate(() => {
      const source = new DOMParser()
        .parseFromString((window as any).__snapshots.at(-1), "text/html")
        .querySelector("img");
      return {
        hasSrc: source?.hasAttribute("src"),
        hasSrcset: source?.hasAttribute("srcset"),
      };
    }),
  ).toEqual({ hasSrc: false, hasSrcset: true });
  expect(width).toBe(100);
  expect(errors).toEqual([]);
  await browser.close();
}, 20_000);
