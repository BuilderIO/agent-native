import { chromium, type Browser, type Frame } from "@playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ensureShaderRuntime,
  SHADER_FILL_ATTR,
  SHADER_SCRIPT_TYPE,
} from "../../../../shared/shader-fills";

// A hand-driven animation-frame queue and a count of WebGL draws, installed
// before the runtime boots so each test decides which timestamps it sees.
const MANUAL_FRAMES = `<script>
window.__frames = [];
window.__draws = 0;
window.requestAnimationFrame = function (cb) {
  window.__frames.push(cb);
  return window.__frames.length;
};
window.cancelAnimationFrame = function () {};
var drawArrays = WebGLRenderingContext.prototype.drawArrays;
WebGLRenderingContext.prototype.drawArrays = function () {
  window.__draws++;
  return drawArrays.apply(this, arguments);
};
window.__runFrame = function (ts) {
  var due = window.__frames;
  window.__frames = [];
  for (var i = 0; i < due.length; i++) due[i](ts);
  return { draws: window.__draws, queued: window.__frames.length };
};
</script>`;

// A saved, animated fill in the persisted format the runtime reads.
const SAVED_FILL = `<script type="${SHADER_SCRIPT_TYPE}" data-shader-id="an-shader-budget01" data-shader-name="Budget" data-shader-mode="fill">
/*! an-shader v1
{ "uniforms": {} }
*/
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  gl_FragColor = vec4(uv, 0.5 + 0.5 * sin(u_time), 1.0);
}
</script>`;

function screenHtml(head = ""): string {
  return ensureShaderRuntime(`<!doctype html>
<html>
<head>${head}${SAVED_FILL}<style>html,body{margin:0}#host{width:320px;height:240px;background:#101010}</style></head>
<body>
  <div id="host" data-agent-native-node-id="host" ${SHADER_FILL_ATTR}="an-shader-budget01"><p>content</p></div>
</body>
</html>`);
}

function canvasWidth(frame: Frame): Promise<number | null> {
  return frame.evaluate(() => {
    const canvas = document.querySelector(
      "canvas[data-an-shader-canvas]",
    ) as HTMLCanvasElement | null;
    return canvas ? canvas.width : null;
  });
}

describe("GLSL shader runtime — frame budget", () => {
  let browser: Browser;
  let webgl = false;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    webgl = await page.evaluate(() =>
      Boolean(document.createElement("canvas").getContext("webgl")),
    );
    await page.close();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it(
    "draws once per display frame when a frame's callbacks repeat",
    {
      timeout: 30_000,
    },
    async ({ skip }) => {
      if (!webgl) skip();
      const page = await browser.newPage({
        viewport: { width: 500, height: 400 },
      });
      await page.setContent(screenHtml(MANUAL_FRAMES), { waitUntil: "load" });
      await page.waitForSelector("canvas[data-an-shader-canvas]", {
        state: "attached",
      });
      const run = (ts: number) =>
        page.evaluate(
          (t) =>
            (
              window as unknown as {
                __runFrame: (t: number) => { draws: number; queued: number };
              }
            ).__runFrame(t),
          ts,
        );

      expect(await run(1000)).toEqual({ draws: 1, queued: 1 });
      // The same display frame handed to this document again: no new draw, and
      // the loop stays scheduled for the next one.
      expect(await run(1000)).toEqual({ draws: 1, queued: 1 });
      expect(await run(1000)).toEqual({ draws: 1, queued: 1 });
      expect(await run(1016.7)).toEqual({ draws: 2, queued: 1 });
      expect(await run(1033.4)).toEqual({ draws: 3, queued: 1 });
      await page.close();
    },
  );

  async function openScreen(deviceScaleFactor: number) {
    const page = await browser.newPage({
      viewport: { width: 500, height: 400 },
      deviceScaleFactor,
    });
    await page.setContent(
      '<!doctype html><html><body style="margin:0"><iframe id="screen" style="width:400px;height:300px;border:0"></iframe></body></html>',
    );
    await page.$eval(
      "#screen",
      (el, html) => {
        (el as HTMLIFrameElement).srcdoc = html;
      },
      screenHtml(),
    );
    const frame = (await (await page.$("#screen"))!.contentFrame())!;
    await frame.waitForFunction(() => {
      const canvas = document.querySelector(
        "canvas[data-an-shader-canvas]",
      ) as HTMLCanvasElement | null;
      return canvas !== null && canvas.width > 1;
    });
    const postFromEditor = (scaleX: unknown, scaleY: unknown = scaleX) =>
      page.evaluate(
        ([x, y]) => {
          (
            document.querySelector("#screen") as HTMLIFrameElement
          ).contentWindow!.postMessage(
            { type: "set-editor-chrome-scale", scaleX: x, scaleY: y },
            "*",
          );
        },
        [scaleX, scaleY],
      );
    const settlesAt = (width: number) =>
      frame.waitForFunction(
        (w) =>
          (
            document.querySelector(
              "canvas[data-an-shader-canvas]",
            ) as HTMLCanvasElement
          ).width === w,
        width,
        { timeout: 5_000 },
      );
    return { page, frame, postFromEditor, settlesAt };
  }

  it(
    "sizes canvases to the zoom the editor posts",
    { timeout: 30_000 },
    async ({ skip }) => {
      if (!webgl) skip();
      const { page, frame, postFromEditor, settlesAt } = await openScreen(2);
      expect(await canvasWidth(frame)).toBe(640);

      // Only the parent editor sets the zoom.
      await frame.evaluate(() =>
        window.postMessage(
          { type: "set-editor-chrome-scale", scaleX: 0.5, scaleY: 0.5 },
          "*",
        ),
      );
      await page.waitForTimeout(150);
      expect(await canvasWidth(frame)).toBe(640);

      await postFromEditor(0.5);
      await settlesAt(320);
      // Rounded up to eighths: 0.6 renders at 0.625.
      await postFromEditor(0.6);
      await settlesAt(400);
      // The larger axis wins, so neither is undersampled.
      await postFromEditor(0.5, 0.75);
      await settlesAt(480);
      // Never below one canvas pixel per CSS pixel, never above the
      // document's own resolution.
      await postFromEditor(0.05);
      await settlesAt(320);
      await postFromEditor(3);
      await settlesAt(640);
      // A zoom it can't read is ignored, not taken as full size.
      await postFromEditor(0.5);
      await settlesAt(320);
      await postFromEditor("not a number");
      await page.waitForTimeout(150);
      expect(await canvasWidth(frame)).toBe(320);
      await page.close();
    },
  );

  it(
    "keeps one canvas pixel per CSS pixel on a standard display",
    { timeout: 30_000 },
    async ({ skip }) => {
      if (!webgl) skip();
      const { page, frame, postFromEditor } = await openScreen(1);
      expect(await canvasWidth(frame)).toBe(320);
      await postFromEditor(0.25);
      await page.waitForTimeout(150);
      expect(await canvasWidth(frame)).toBe(320);
      await page.close();
    },
  );
});
