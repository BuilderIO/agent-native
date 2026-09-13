import { expect, test, type Frame, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { enterDirectMode, enterInteractView, gotoEditor } from "./helpers";

/**
 * Steve (screen recording, DARK theme): "it's doing that flashing thing again
 * where it goes light mode background for a second" during editing, and
 * "if I hit undo again, it goes back on the canvas, but the white background
 * comes back... I have to refresh to undo that."
 *
 * A prior sweep sampled steady state (before/after a gesture) 8 times and
 * found nothing — the flash is transient (a few frames) or needs state that
 * sweep's fixture lacked. This spec instruments every rendered frame during
 * the gesture instead of sampling before/after, on a DARK, two-screen design
 * with real landmark containers (reused from parity-drag-reparent.spec.ts's
 * fixture) so "drag into a container" and "alt-drag out of a screen" are
 * real, not board-rectangle stand-ins.
 */

const SCREEN_ONE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Screen One</title></head>
  <body style="margin:0;position:relative;min-height:1000px;width:900px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <header data-agent-native-node-id="header" data-agent-native-layer-name="Header"
            style="position:absolute;left:0;top:0;width:900px;height:80px;background:#1f2937"></header>
    <span data-agent-native-node-id="root-gap-1" data-agent-native-layer-name="RootGap1"
          style="position:absolute;left:400px;top:150px;width:60px;height:20px"></span>
    <main data-agent-native-node-id="main" data-agent-native-layer-name="Main"
          style="position:absolute;left:0;top:260px;width:900px;height:360px;background:#111827">
      <div data-agent-native-node-id="widget" data-agent-native-layer-name="Widget"
           style="position:absolute;left:40px;top:40px;width:140px;height:90px;background:#3b82f6"></div>
    </main>
    <span data-agent-native-node-id="root-gap-2" data-agent-native-layer-name="RootGap2"
          style="position:absolute;left:400px;top:680px;width:60px;height:20px"></span>
    <footer data-agent-native-node-id="footer" data-agent-native-layer-name="Footer"
            style="position:absolute;left:0;top:780px;width:900px;height:180px;background:#1f2937">
      <div data-agent-native-node-id="footer-item" data-agent-native-layer-name="FooterItem"
           style="position:absolute;left:30px;top:30px;width:120px;height:70px;background:#f59e0b"></div>
    </footer>
  </body>
</html>`;

const SCREEN_TWO = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Screen Two</title></head>
  <body style="margin:0;position:relative;min-height:900px;width:900px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <section data-agent-native-node-id="page2-target" data-agent-native-layer-name="Page2Target"
             style="position:absolute;left:60px;top:60px;width:400px;height:300px;background:#312e81"></section>
  </body>
</html>`;

/**
 * Refined-hypothesis fixture (mechanism b/c): dark via a STYLESHEET RULE keyed
 * off `<html class="dark">`, not an inline `style="background:..."` on body.
 * The prior fixture's inline body background can never go light — it does
 * not depend on a class surviving a morph or on the iframe's own
 * `color-scheme` matching the parent before its stylesheet applies. This one
 * does, on purpose.
 */
const SCREEN_ONE_CLASS_DARK = `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8" />
    <title>Screen One</title>
    <style>.dark body { background: #0b0b0b; color: #eee; }</style>
  </head>
  <body style="margin:0;position:relative;min-height:1000px;width:900px;font-family:system-ui,sans-serif">
    <header data-agent-native-node-id="header" data-agent-native-layer-name="Header"
            style="position:absolute;left:0;top:0;width:900px;height:80px;background:#1f2937"></header>
    <span data-agent-native-node-id="root-gap-1" data-agent-native-layer-name="RootGap1"
          style="position:absolute;left:400px;top:150px;width:60px;height:20px"></span>
    <main data-agent-native-node-id="main" data-agent-native-layer-name="Main"
          style="position:absolute;left:0;top:260px;width:900px;height:360px;background:#111827">
      <div data-agent-native-node-id="widget" data-agent-native-layer-name="Widget"
           style="position:absolute;left:40px;top:40px;width:140px;height:90px;background:#3b82f6"></div>
    </main>
    <span data-agent-native-node-id="root-gap-2" data-agent-native-layer-name="RootGap2"
          style="position:absolute;left:400px;top:680px;width:60px;height:20px"></span>
    <footer data-agent-native-node-id="footer" data-agent-native-layer-name="Footer"
            style="position:absolute;left:0;top:780px;width:900px;height:180px;background:#1f2937">
      <div data-agent-native-node-id="footer-item" data-agent-native-layer-name="FooterItem"
           style="position:absolute;left:30px;top:30px;width:120px;height:70px;background:#f59e0b"></div>
    </footer>
  </body>
</html>`;

/**
 * Refined-hypothesis fixture, second mechanism: dark via
 * `@media (prefers-color-scheme: dark)` + `:root{color-scheme:dark}`, no
 * class involved at all. If Chromium paints an opaque white backdrop for an
 * iframe whose resolved `color-scheme` diverges from the parent document's
 * during a reload gap, this is the screen that would show it — the parent
 * page runs `page.emulateMedia({ colorScheme: "dark" })` (see the test body),
 * which applies to iframe documents too, so this screen's own media query
 * matches for the whole test unless something transient changes it.
 */
const SCREEN_TWO_MEDIA_DARK = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Screen Two</title>
    <style>
      :root { color-scheme: dark; }
      @media (prefers-color-scheme: dark) {
        body { background: #0b0b0b; color: #eee; }
      }
    </style>
  </head>
  <body style="margin:0;position:relative;min-height:900px;width:900px;font-family:system-ui,sans-serif">
    <section data-agent-native-node-id="page2-target" data-agent-native-layer-name="Page2Target"
             style="position:absolute;left:60px;top:60px;width:400px;height:300px;background:#312e81"></section>
  </body>
</html>`;

let baseURL = "";

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const res = await page.request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok()) {
    throw new Error(
      `${name}: ${res.status()} ${(await res.text()).slice(0, 300)}`,
    );
  }
  return res.json();
}

async function newTwoScreenDarkDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "parity canvas flash",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId: id,
    filename: "index.html",
    content: SCREEN_ONE,
    fileType: "html",
  });
  await postAction(page, "create-file", {
    designId: id,
    filename: "page-two.html",
    content: SCREEN_TWO,
    fileType: "html",
  });
  return id;
}

/** Same shape as newTwoScreenDarkDesign, but with the class-based and
 *  media-query-based dark fixtures above instead of an inline body colour. */
async function newClassAndMediaDarkDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "parity screen flash (class/media dark)",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId: id,
    filename: "index.html",
    content: SCREEN_ONE_CLASS_DARK,
    fileType: "html",
  });
  await postAction(page, "create-file", {
    designId: id,
    filename: "page-two.html",
    content: SCREEN_TWO_MEDIA_DARK,
    fileType: "html",
  });
  return id;
}

async function fileIdFor(
  page: Page,
  id: string,
  filename: string,
): Promise<string> {
  const record = await page.request
    .get(`${baseURL}/_agent-native/actions/get-design?id=${id}`)
    .then((r) => r.json());
  const file = (record.files ?? []).find((f: any) => f.filename === filename);
  if (!file) throw new Error(`no file ${filename} in design ${id}`);
  return file.id;
}

async function boxFor(page: Page, screenId: string, nodeId: string) {
  const iframe = page.locator(
    `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
  );
  const box = await iframe
    .contentFrame()
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .boundingBox();
  if (!box) throw new Error(`no boundingBox for ${nodeId} on ${screenId}`);
  return box;
}

/** Same "clear of chrome" point picker as parity-canvas-background.spec.ts's
 *  sampleXY, restated per this task's spec: 60%/60% of the visible canvas
 *  rect, clear of the left rail and right inspector. */
async function canvasSamplePoint(
  page: Page,
): Promise<{ x: number; y: number }> {
  const canvasBox = await page
    .locator("[data-design-canvas-container]")
    .boundingBox();
  if (!canvasBox) throw new Error("no canvas container box");
  const leftShellBox = await page
    .locator('[data-design-chrome-region="left-shell"]')
    .boundingBox()
    .catch(() => null);
  const rightPanelBox = await page
    .locator('[data-design-chrome-region="right-panel"]')
    .boundingBox()
    .catch(() => null);
  const leftEdge = leftShellBox
    ? leftShellBox.x + leftShellBox.width
    : canvasBox.x;
  const rightEdge = rightPanelBox
    ? rightPanelBox.x
    : canvasBox.x + canvasBox.width;
  return {
    x: Math.round(leftEdge + (rightEdge - leftEdge) * 0.6),
    y: Math.round(canvasBox.y + canvasBox.height * 0.6),
  };
}

async function pixelAt(page: Page, x: number, y: number): Promise<string> {
  const client = await page.context().newCDPSession(page);
  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
  });
  await client.detach();
  return page.evaluate(
    async ({ b64, px, py }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context for the screenshot");
      ctx.drawImage(img, 0, 0);
      const ratio = img.width / window.innerWidth;
      const d = ctx.getImageData(
        Math.round(px * ratio),
        Math.round(py * ratio),
        1,
        1,
      ).data;
      return `${d[0]},${d[1]},${d[2]}`;
    },
    { b64: data, px: x, py: y },
  );
}

function isLightRgb(rgb: string): boolean {
  if (rgb === "NO_CONTAINER") return false;
  const [r, g, b] = rgb.split(",").map(Number);
  // Dark canvas is hsl(0 0% 10%) ~= 26,26,26. Light/white is >= 235.
  return r > 150 && g > 150 && b > 150;
}

/**
 * In-page recorder installed once per test. `start(label)` begins an rAF loop
 * (catches every rendered frame, not a Node-side poll) plus a
 * MutationObserver on the canvas container and <html>. `stop()` returns every
 * recorded frame so a one-frame flash can't hide between two `expect.poll`s.
 *
 * Refined-hypothesis extension: the prior sweep only ever sampled the
 * OVERVIEW CANVAS CONTAINER, never the screen documents living inside each
 * iframe. Edit-mode iframes carry `allow-same-origin` in their sandbox
 * (design-canvas/external-preview.ts's EDITABLE_INLINE_IFRAME_SANDBOX /
 * READ_ONLY_INLINE_IFRAME_SANDBOX, for inline/srcdoc screens), so
 * `contentDocument` is readable directly from this parent-page rAF loop —
 * no postMessage round trip, no risk of missing a same-tick flash. Every
 * screen iframe currently in the DOM is sampled on every rendered frame,
 * same cadence as the canvas-container check.
 */
async function installRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    w.__flash = {
      frames: [] as any[],
      raf: 0,
      seenIframes: new Map<string, Element>(),
      label: "",
      start(label: string) {
        this.frames = [];
        this.label = label;
        const tick = () => {
          const container = document.querySelector(
            "[data-design-canvas-container]",
          );
          const bg = container
            ? getComputedStyle(container).backgroundColor
            : "NO_CONTAINER";
          const varVal = container
            ? (container as HTMLElement).style.getPropertyValue(
                "--design-editor-canvas-bg",
              )
            : "";
          const htmlClass = document.documentElement.className;
          const skeletonPresent = !!document.querySelector(
            '[class*="skeleton"], [data-slot="skeleton"]',
          );
          const remounts: string[] = [];
          const screens: any[] = [];
          document
            .querySelectorAll("iframe[data-design-preview-iframe]")
            .forEach((el) => {
              const screenId =
                el.getAttribute("data-screen-iframe-id") ?? "(active)";
              const prev = this.seenIframes.get(screenId);
              if (prev && prev !== el) remounts.push(screenId);
              this.seenIframes.set(screenId, el);
              // Read the SCREEN's OWN document — the refined hypothesis's
              // actual target — not the canvas around it. contentDocument
              // throws (or is null) for a genuinely cross-origin/torn-down
              // frame; record that explicitly rather than aborting the tick.
              let doc: Document | null = null;
              try {
                doc = (el as HTMLIFrameElement).contentDocument;
              } catch {
                doc = null;
              }
              if (!doc || !doc.defaultView) {
                screens.push({ screenId, accessible: false });
                return;
              }
              const body = doc.body;
              const docEl = doc.documentElement;
              screens.push({
                screenId,
                accessible: true,
                readyState: doc.readyState,
                bodyBg: body
                  ? doc.defaultView.getComputedStyle(body).backgroundColor
                  : null,
                htmlClass: docEl.className,
                colorScheme:
                  doc.defaultView.getComputedStyle(docEl).colorScheme,
                bridgeInstalled: !!doc.querySelector(
                  '[data-agent-native-edit-overlay="shield"]',
                ),
              });
            });
          this.frames.push({
            t: performance.now(),
            bg,
            varVal,
            htmlClass,
            skeletonPresent,
            remounts,
            screens,
          });
          this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
      },
      stop() {
        cancelAnimationFrame(this.raf);
        return this.frames;
      },
    };
  });
}

async function startRecorder(page: Page, label: string): Promise<void> {
  await page.evaluate((l) => (window as any).__flash.start(l), label);
}

async function stopRecorder(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).__flash.stop());
}

/** The actual bug report is a colour flash — only a light/white frame fails
 *  the test. A screen iframe remount is logged (see `remountFrames`) but
 *  never asserted on its own: MultiScreenCanvas.tsx's PF16 comment documents
 *  a real, intended full remount of every overview screen when the whole
 *  overview shell unmounts (Direct <-> Interact), and this run's own samples
 *  show it repainting the correct dark colour immediately — so failing on
 *  that remount alone would flag working code, not this bug. */
function badFrames(frames: any[]): any[] {
  return frames.filter((f) => isLightRgb(f.bg));
}

function remountFrames(frames: any[]): any[] {
  return frames.filter((f) => f.remounts.length > 0);
}

/** Same light/white check, but against each SCREEN's own document instead of
 *  the canvas around it — the refined hypothesis's actual target. */
function badScreenFrames(frames: any[]): any[] {
  return frames.filter((f) =>
    (f.screens ?? []).some((s: any) => isLightRgb(s.bodyBg)),
  );
}

/** First screen-document sample (across any frame) that painted light,
 *  reported with the surrounding classification signals — the report this
 *  spec exists to produce: was the frame mid-reload (readyState !==
 *  "complete"), was the bridge/shield gone (an actual navigation just
 *  happened), did the html class or color-scheme diverge from the canvas's
 *  own dark state. */
function firstBadScreenSample(frames: any[]): Record<string, unknown> | null {
  for (const frame of frames) {
    const hit = (frame.screens ?? []).find((s: any) => isLightRgb(s.bodyBg));
    if (hit) return { t: frame.t, htmlClass: frame.htmlClass, ...hit };
  }
  return null;
}

function summarize(frames: any[]): string {
  const bad = badFrames(frames);
  return `${frames.length} frames recorded, ${bad.length} light. First light frame: ${JSON.stringify(bad[0] ?? null)}`;
}

/**
 * Node-side companion to installRecorder's in-page screen sampling: a CDP
 * screenshot pixel sampled INSIDE the first screen card (catches anything a
 * DOM read alone could miss — compositor paint vs. style recalculation lag)
 * plus a `page.frames()` identity/title poll. A remounted iframe is a NEW
 * Playwright `Frame` object, and `frame.title()` mid-navigation throws — both
 * are themselves evidence, so record them rather than treating either as a
 * bug in the recorder. Runs on its own ~40ms cadence, concurrently with a
 * gesture, until `stop.done` flips.
 */
async function recordExternalSignals(
  page: Page,
  point: { x: number; y: number },
  stop: { done: boolean },
  frameIds: Map<Frame, number>,
  nextFrameId: { n: number },
): Promise<{ pixels: any[]; frameSamples: any[] }> {
  const client = await page.context().newCDPSession(page);
  const pixels: any[] = [];
  const frameSamples: any[] = [];
  try {
    while (!stop.done) {
      const { data } = await client.send("Page.captureScreenshot", {
        format: "png",
      });
      const rgb = await page.evaluate(
        async ({ b64, px, py }) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return "NO_CTX";
          ctx.drawImage(img, 0, 0);
          const ratio = img.width / window.innerWidth;
          const d = ctx.getImageData(
            Math.round(px * ratio),
            Math.round(py * ratio),
            1,
            1,
          ).data;
          return `${d[0]},${d[1]},${d[2]}`;
        },
        { b64: data, px: point.x, py: point.y },
      );
      pixels.push({ t: Date.now(), rgb });
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        let id = frameIds.get(frame);
        if (id === undefined) {
          id = nextFrameId.n++;
          frameIds.set(frame, id);
        }
        try {
          const title = await frame.title();
          frameSamples.push({ t: Date.now(), id, title, url: frame.url() });
        } catch (error) {
          // Execution context destroyed mid-navigation IS the reload signal
          // this poll exists to catch — keep it, not just an empty catch.
          frameSamples.push({ t: Date.now(), id, error: String(error) });
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  } finally {
    await client.detach().catch(() => {});
  }
  return { pixels, frameSamples };
}

/** Any pixel sample the CDP screenshot loop caught painting light. */
function badPixels(pixels: any[]): any[] {
  return pixels.filter((p) => isLightRgb(p.rgb));
}

/** A title seen under more than one Playwright Frame id is a genuine
 *  navigation/remount the frame-identity poll actually witnessed, as
 *  distinct from the in-page DOM-element remount check. */
function frameTitleRemounts(frameSamples: any[]): Record<string, number[]> {
  const idsByTitle = new Map<string, Set<number>>();
  for (const sample of frameSamples) {
    if (!sample.title) continue;
    const set = idsByTitle.get(sample.title) ?? new Set<number>();
    set.add(sample.id);
    idsByTitle.set(sample.title, set);
  }
  const out: Record<string, number[]> = {};
  for (const [title, ids] of idsByTitle) {
    if (ids.size > 1) out[title] = Array.from(ids);
  }
  return out;
}

/** Runs one gesture with both the in-page (installRecorder) and Node-side
 *  (recordExternalSignals) instrumentation active for its whole duration. */
async function runInstrumentedGesture(
  page: Page,
  label: string,
  screenCardPoint: { x: number; y: number },
  frameIds: Map<Frame, number>,
  nextFrameId: { n: number },
  gesture: () => Promise<void>,
) {
  await startRecorder(page, label);
  const stop = { done: false };
  const externalPromise = recordExternalSignals(
    page,
    screenCardPoint,
    stop,
    frameIds,
    nextFrameId,
  );
  await gesture();
  // Fixed sampling window for frame-capture instrumentation, not a wait for
  // settled state — a transient flash can occur after the gesture's own
  // state settles, so polling a proxy condition would defeat the point of
  // this spec.
  await page.waitForTimeout(1500); // e2e-harness-ignore fixed frame-capture sampling window, see comment above
  stop.done = true;
  const { pixels, frameSamples } = await externalPromise;
  const canvasFrames = await stopRecorder(page);
  return {
    label,
    total: canvasFrames.length,
    badCanvas: badFrames(canvasFrames),
    badScreen: badScreenFrames(canvasFrames),
    remounts: remountFrames(canvasFrames),
    firstBadScreenSample: firstBadScreenSample(canvasFrames),
    badPixels: badPixels(pixels),
    frameTitleRemounts: frameTitleRemounts(frameSamples),
  };
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeAll(async ({}, testInfo) => {
  baseURL =
    (testInfo.project.use as { baseURL?: string }).baseURL ??
    process.env.E2E_BASE_URL ??
    e2eBaseURL();
});

test.describe("canvas flash — transient capture, dark theme, multi-screen", () => {
  test("overview canvas never paints a light/white frame across drag-into-container, undo x2, alt-drag-out, new shape, single-screen round trip, and resize", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    let designId: string | undefined;
    try {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.addInitScript(() => localStorage.setItem("theme", "dark"));

      designId = await newTwoScreenDarkDesign(page);
      await gotoEditor(page, designId);
      await expect(page.locator("html")).toHaveClass(/dark/);

      const screenOneId = await fileIdFor(page, designId, "index.html");
      await installRecorder(page);

      const point = await canvasSamplePoint(page);
      await expect.poll(() => pixelAt(page, point.x, point.y)).toBe("26,26,26");

      const allResults: Record<
        string,
        { total: number; bad: any[]; remounts: any[] }
      > = {};

      // (a) drag Widget into the Footer container.
      {
        const widget = await boxFor(page, screenOneId, "widget");
        const footer = await boxFor(page, screenOneId, "footer");
        await startRecorder(page, "drag-into-container");
        await page.mouse.move(
          widget.x + widget.width / 2,
          widget.y + widget.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          widget.x + widget.width / 2 + 20,
          widget.y + widget.height / 2,
          { steps: 5 },
        );
        await page.mouse.move(
          footer.x + footer.width / 2,
          footer.y + footer.height / 2,
          {
            steps: 24,
          },
        );
        await page.waitForTimeout(300);
        await page.mouse.up();
        await page.waitForTimeout(2000); // e2e-harness-ignore fixed frame-capture sampling window (see runInstrumentedGesture doc comment)
        {
          const frames = await stopRecorder(page);
          allResults["drag-into-container"] = {
            total: frames.length,
            bad: badFrames(frames),
            remounts: remountFrames(frames),
          };
        }
      }

      // (b) undo the nest.
      {
        await startRecorder(page, "undo-1");
        await page.keyboard.press("ControlOrMeta+z");
        await page.waitForTimeout(2000); // e2e-harness-ignore fixed frame-capture sampling window (see runInstrumentedGesture doc comment)
        {
          const frames = await stopRecorder(page);
          allResults["undo-1"] = {
            total: frames.length,
            bad: badFrames(frames),
            remounts: remountFrames(frames),
          };
        }
      }

      // (c) undo again ("if I hit undo again ... white background comes back").
      {
        await startRecorder(page, "undo-2");
        await page.keyboard.press("ControlOrMeta+z");
        await page.waitForTimeout(2000); // e2e-harness-ignore fixed frame-capture sampling window (see runInstrumentedGesture doc comment)
        {
          const frames = await stopRecorder(page);
          allResults["undo-2"] = {
            total: frames.length,
            bad: badFrames(frames),
            remounts: remountFrames(frames),
          };
        }
      }

      // (d) alt-drag Widget from inside the screen out onto the empty board.
      {
        const widget = await boxFor(page, screenOneId, "widget");
        const world = await page
          .locator("[data-multi-screen-canvas-world]")
          .boundingBox();
        const outside = world
          ? { x: world.x + world.width - 40, y: world.y + 40 }
          : { x: widget.x + 900, y: widget.y - 200 };
        await startRecorder(page, "alt-drag-out");
        await page.mouse.move(
          widget.x + widget.width / 2,
          widget.y + widget.height / 2,
        );
        await page.mouse.down();
        await page.keyboard.down("Alt");
        await page.mouse.move(
          widget.x + widget.width / 2 + 20,
          widget.y + widget.height / 2,
          { steps: 5 },
        );
        await page.mouse.move(outside.x, outside.y, { steps: 30 });
        await page.waitForTimeout(300);
        await page.mouse.up();
        await page.keyboard.up("Alt");
        await page.waitForTimeout(2000); // e2e-harness-ignore fixed frame-capture sampling window (see runInstrumentedGesture doc comment)
        {
          const frames = await stopRecorder(page);
          allResults["alt-drag-out"] = {
            total: frames.length,
            bad: badFrames(frames),
            remounts: remountFrames(frames),
          };
        }
      }

      // (e) draw the first free-floating shape.
      {
        await startRecorder(page, "draw-first-shape");
        await page.locator('button[aria-label="Rectangle"]').first().click();
        const world = await page
          .locator("[data-multi-screen-canvas-world]")
          .boundingBox();
        const drawAt = world
          ? { x: world.x + world.width - 200, y: world.y + world.height - 200 }
          : { x: 200, y: 200 };
        await page.mouse.move(drawAt.x, drawAt.y);
        await page.mouse.down();
        await page.mouse.move(drawAt.x + 100, drawAt.y + 80, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(1500); // e2e-harness-ignore fixed frame-capture sampling window (see runInstrumentedGesture doc comment)
        {
          const frames = await stopRecorder(page);
          allResults["draw-first-shape"] = {
            total: frames.length,
            bad: badFrames(frames),
            remounts: remountFrames(frames),
          };
        }
      }

      // Rectangle tool leaves a full-canvas creation shield armed; back to
      // Move (and close any open menu) before driving chrome buttons again.
      await page.keyboard.press("Escape");
      await page.locator('button[aria-label="Move"]').first().click();
      await page.waitForTimeout(200);

      // (f) enter single-screen mode and back.
      {
        await startRecorder(page, "single-screen-round-trip");
        await enterInteractView(page, { screenId: screenOneId });
        await page.waitForTimeout(500);
        await enterDirectMode(page, { screenId: screenOneId });
        await page.waitForTimeout(500);
        {
          const frames = await stopRecorder(page);
          allResults["single-screen-round-trip"] = {
            total: frames.length,
            bad: badFrames(frames),
            remounts: remountFrames(frames),
          };
        }
      }

      // (g) resize the browser viewport.
      {
        await startRecorder(page, "viewport-resize");
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.waitForTimeout(300);
        await page.setViewportSize({ width: 1600, height: 1000 });
        await page.waitForTimeout(500);
        {
          const frames = await stopRecorder(page);
          allResults["viewport-resize"] = {
            total: frames.length,
            bad: badFrames(frames),
            remounts: remountFrames(frames),
          };
        }
      }

      for (const [gesture, result] of Object.entries(allResults)) {
        console.log(
          `[canvas-flash] ${gesture}: total=${result.total} light=${result.bad.length} remounts=${result.remounts.length}`,
        );
        if (result.remounts.length > 0) {
          console.log(
            `[canvas-flash] ${gesture} remount detail: ${JSON.stringify(result.remounts).slice(0, 500)}`,
          );
        }
      }
      const failing = Object.entries(allResults).filter(
        ([, r]) => r.bad.length > 0,
      );
      if (failing.length > 0) {
        for (const [gesture, r] of failing) {
          console.log(`[canvas-flash] ${gesture}: ${summarize(r.bad)}`);
        }
      }
      expect(
        failing,
        `one or more gestures painted a light/white overview-canvas frame: ${JSON.stringify(
          failing.map(([g, r]) => [g, r.bad.length]),
        )}`,
      ).toEqual([]);
    } finally {
      if (designId) {
        await postAction(page, "delete-design", { id: designId }).catch(
          () => {},
        );
      }
    }
  });
});

/**
 * Refined hypothesis: the previous describe block proved the OVERVIEW CANVAS
 * CONTAINER never flashes light — but it never looked inside a screen's own
 * document. Steve's report is specifically about the SCREEN turning light,
 * both mid-gesture ("during editing") and stuck ("if I hit undo again ... I
 * have to refresh to undo that"). This block reuses the same dark, two-screen,
 * real-container fixture but instruments each screen's `contentDocument`
 * directly (installRecorder's `screens` field) plus a Node-side CDP pixel/
 * frame-identity poll (recordExternalSignals), across a wider gesture set
 * that includes a second undo depth, redo, and a select+delete+undo cycle —
 * the exact sequence from the report.
 */
test.describe("screen document flash — inside-iframe capture, dark theme", () => {
  test("no screen document ever paints a light/white background across drag-into-container, undo/redo depth, alt-drag-out, delete+undo, and Direct<->Interact", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    let designId: string | undefined;
    try {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.addInitScript(() => localStorage.setItem("theme", "dark"));

      designId = await newClassAndMediaDarkDesign(page);
      await gotoEditor(page, designId);
      await expect(page.locator("html")).toHaveClass(/dark/);

      const screenOneId = await fileIdFor(page, designId, "index.html");
      await installRecorder(page);

      const canvasPoint = await canvasSamplePoint(page);
      await expect
        .poll(() => pixelAt(page, canvasPoint.x, canvasPoint.y))
        .toBe("26,26,26");

      const screenCardBox = await page
        .locator("[data-screen-card]")
        .first()
        .boundingBox();
      if (!screenCardBox) throw new Error("no screen card box");
      const screenCardPoint = {
        x: Math.round(screenCardBox.x + screenCardBox.width / 2),
        y: Math.round(screenCardBox.y + screenCardBox.height / 2),
      };
      // The screen card center must itself read as dark before any gesture
      // runs (it may land on the header/main/footer's own dark tone, not
      // exactly the body's #0f1115, depending on where geometry puts the
      // sample point) — the same light/white check the gestures are judged
      // by, not a specific RGB triple.
      await expect
        .poll(async () =>
          isLightRgb(await pixelAt(page, screenCardPoint.x, screenCardPoint.y)),
        )
        .toBe(false);

      const frameIds = new Map<Frame, number>();
      const nextFrameId = { n: 0 };
      const results: Record<
        string,
        Awaited<ReturnType<typeof runInstrumentedGesture>>
      > = {};

      // (a) drag Widget into the Footer container — the real structural
      // reparent the report's "editing" covers, not a board-rectangle move.
      results["drag-into-container"] = await runInstrumentedGesture(
        page,
        "drag-into-container",
        screenCardPoint,
        frameIds,
        nextFrameId,
        async () => {
          const widget = await boxFor(page, screenOneId, "widget");
          const footer = await boxFor(page, screenOneId, "footer");
          await page.mouse.move(
            widget.x + widget.width / 2,
            widget.y + widget.height / 2,
          );
          await page.mouse.down();
          await page.mouse.move(
            widget.x + widget.width / 2 + 20,
            widget.y + widget.height / 2,
            { steps: 5 },
          );
          await page.mouse.move(
            footer.x + footer.width / 2,
            footer.y + footer.height / 2,
            { steps: 24 },
          );
          await page.waitForTimeout(300);
          await page.mouse.up();
        },
      );

      // (b) first undo.
      results["undo-1"] = await runInstrumentedGesture(
        page,
        "undo-1",
        screenCardPoint,
        frameIds,
        nextFrameId,
        () => page.keyboard.press("ControlOrMeta+z"),
      );

      // (c) second undo — Steve's own repro step ("if I hit undo again").
      results["undo-2"] = await runInstrumentedGesture(
        page,
        "undo-2",
        screenCardPoint,
        frameIds,
        nextFrameId,
        () => page.keyboard.press("ControlOrMeta+z"),
      );

      // (d) redo, back toward the nested state.
      results["redo"] = await runInstrumentedGesture(
        page,
        "redo",
        screenCardPoint,
        frameIds,
        nextFrameId,
        () => page.keyboard.press("ControlOrMeta+Shift+z"),
      );

      // (e) alt-drag Widget out of the screen onto the empty board.
      results["alt-drag-out"] = await runInstrumentedGesture(
        page,
        "alt-drag-out",
        screenCardPoint,
        frameIds,
        nextFrameId,
        async () => {
          const widget = await boxFor(page, screenOneId, "widget");
          const world = await page
            .locator("[data-multi-screen-canvas-world]")
            .boundingBox();
          const outside = world
            ? { x: world.x + world.width - 40, y: world.y + 40 }
            : { x: widget.x + 900, y: widget.y - 200 };
          await page.mouse.move(
            widget.x + widget.width / 2,
            widget.y + widget.height / 2,
          );
          await page.mouse.down();
          await page.keyboard.down("Alt");
          await page.mouse.move(
            widget.x + widget.width / 2 + 20,
            widget.y + widget.height / 2,
            { steps: 5 },
          );
          await page.mouse.move(outside.x, outside.y, { steps: 30 });
          await page.waitForTimeout(300);
          await page.mouse.up();
          await page.keyboard.up("Alt");
        },
      );

      // (f) undo the alt-drag-out.
      results["undo-after-alt-drag-out"] = await runInstrumentedGesture(
        page,
        "undo-after-alt-drag-out",
        screenCardPoint,
        frameIds,
        nextFrameId,
        () => page.keyboard.press("ControlOrMeta+z"),
      );

      // (g) Direct <-> Interact round trip (PF16's own named repro path).
      results["direct-interact-round-trip"] = await runInstrumentedGesture(
        page,
        "direct-interact-round-trip",
        screenCardPoint,
        frameIds,
        nextFrameId,
        async () => {
          await enterInteractView(page, { screenId: screenOneId });
          await page.waitForTimeout(500);
          await enterDirectMode(page, { screenId: screenOneId });
        },
      );

      // (h) select the Widget and delete it, then undo — the report's other
      // named repro shape ("if I hit undo again ... white background").
      results["delete-widget"] = await runInstrumentedGesture(
        page,
        "delete-widget",
        screenCardPoint,
        frameIds,
        nextFrameId,
        async () => {
          const widget = await boxFor(page, screenOneId, "widget");
          await page.mouse.click(
            widget.x + widget.width / 2,
            widget.y + widget.height / 2,
          );
          await page.waitForTimeout(200);
          await page.keyboard.press("Delete");
        },
      );
      results["undo-after-delete"] = await runInstrumentedGesture(
        page,
        "undo-after-delete",
        screenCardPoint,
        frameIds,
        nextFrameId,
        () => page.keyboard.press("ControlOrMeta+z"),
      );

      for (const [gesture, r] of Object.entries(results)) {
        console.log(
          `[screen-flash] ${gesture}: total=${r.total} badCanvas=${r.badCanvas.length} badScreen=${r.badScreen.length} badPixels=${r.badPixels.length} remounts=${JSON.stringify(r.remounts.map((f: any) => f.remounts))} titleRemounts=${JSON.stringify(r.frameTitleRemounts)}`,
        );
        if (r.firstBadScreenSample) {
          console.log(
            `[screen-flash] ${gesture} FIRST BAD SCREEN SAMPLE: ${JSON.stringify(r.firstBadScreenSample)}`,
          );
        }
        if (r.badPixels.length > 0) {
          console.log(
            `[screen-flash] ${gesture} bad pixel samples: ${JSON.stringify(r.badPixels.slice(0, 5))}`,
          );
        }
      }

      // A bare title-remount (frameTitleRemounts) is not itself a failure —
      // same rule the first describe block's `badFrames` comment documents:
      // MultiScreenCanvas.tsx's PF16 remount on Direct<->Interact is real and
      // intended, and is only a bug if it (or anything else) actually paints
      // light. It stays in the per-gesture log below for classification.
      const failing = Object.entries(results).filter(
        ([, r]) => r.badScreen.length > 0 || r.badPixels.length > 0,
      );
      expect(
        failing,
        `one or more gestures painted a light/white SCREEN document or a light screen-card pixel: ${JSON.stringify(
          failing.map(([g, r]) => ({
            gesture: g,
            badScreen: r.badScreen.length,
            badPixels: r.badPixels.length,
            titleRemounts: r.frameTitleRemounts,
            firstBadScreenSample: r.firstBadScreenSample,
          })),
        )}`,
      ).toEqual([]);
    } finally {
      if (designId) {
        await postAction(page, "delete-design", { id: designId }).catch(
          () => {},
        );
      }
    }
  });
});

/**
 * Script-bearing hypothesis: both describe blocks above used SCRIPT-FREE
 * fixtures (inline `style="background:..."` or a `<style>` tag) and found
 * nothing. Every REAL generated Design screen instead carries a Tailwind Play
 * CDN `<script src="https://cdn.tailwindcss.com">`, an inline
 * `tailwind.config = { darkMode: 'class' }`, an Alpine CDN `<script>`, and
 * often an inline theme script — see design-generation's "Alpine.js +
 * Tailwind CDN" contract. `runtimeDocumentNeedsReload`
 * (DesignCanvas.tsx ~1078) forces a FULL iframe reload whenever *script* text
 * differs between the current runtime document and the next content; a full
 * reload of a Tailwind-CDN screen repaints unstyled (light) until the CDN
 * script re-downloads and runs. Both CDN scripts are routed here to a tiny
 * local stand-in that paints `html.dark` + body `#0b0b0b` only after a 400ms
 * `setTimeout`, so a real reload (script re-executes from scratch) is
 * observable as a light body for up to ~400ms, while an in-place DOM morph
 * (script never re-runs) never repaints light again after the initial load.
 */
const CDN_LATENCY_SCRIPT = `
setTimeout(function () {
  document.documentElement.classList.add('dark');
  if (document.body) {
    document.body.style.background = '#0b0b0b';
    document.body.style.color = '#eee';
  }
}, 400);
`;

async function installCdnLatencyMock(page: Page): Promise<void> {
  const respond = (route: Parameters<Parameters<Page["route"]>[1]>[0]) =>
    route.fulfill({
      contentType: "application/javascript",
      body: CDN_LATENCY_SCRIPT,
    });
  await page.route("https://cdn.tailwindcss.com/**", respond);
  await page.route("https://cdn.jsdelivr.net/**", respond);
}

const SCRIPT_BEARING_SCREEN_ONE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Screen One</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>if (window.tailwind) { tailwind.config = { darkMode: 'class' }; }</script>
    <script src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js" defer></script>
    <script>
      if (localStorage.getItem('theme') === 'dark') {
        document.documentElement.classList.add('dark');
      }
    </script>
  </head>
  <body style="margin:0;position:relative;min-height:1000px;width:900px;font-family:system-ui,sans-serif;background:#ffffff">
    <header data-agent-native-node-id="header" data-agent-native-layer-name="Header"
            style="position:absolute;left:0;top:0;width:900px;height:80px;background:#1f2937"></header>
    <span data-agent-native-node-id="root-gap-1" data-agent-native-layer-name="RootGap1"
          style="position:absolute;left:400px;top:150px;width:60px;height:20px"></span>
    <main data-agent-native-node-id="main" data-agent-native-layer-name="Main"
          style="position:absolute;left:0;top:260px;width:900px;height:360px;background:#111827">
      <div data-agent-native-node-id="widget" data-agent-native-layer-name="Widget"
           style="position:absolute;left:40px;top:40px;width:140px;height:90px;background:#3b82f6"></div>
    </main>
    <span data-agent-native-node-id="root-gap-2" data-agent-native-layer-name="RootGap2"
          style="position:absolute;left:400px;top:680px;width:60px;height:20px"></span>
    <footer data-agent-native-node-id="footer" data-agent-native-layer-name="Footer"
            style="position:absolute;left:0;top:780px;width:900px;height:180px;background:#1f2937">
      <div data-agent-native-node-id="footer-item" data-agent-native-layer-name="FooterItem"
           style="position:absolute;left:30px;top:30px;width:120px;height:70px;background:#f59e0b"></div>
    </footer>
  </body>
</html>`;

const SCRIPT_BEARING_SCREEN_TWO = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Screen Two</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      if (localStorage.getItem('theme') === 'dark') {
        document.documentElement.classList.add('dark');
      }
    </script>
  </head>
  <body style="margin:0;position:relative;min-height:900px;width:900px;font-family:system-ui,sans-serif;background:#ffffff">
    <section data-agent-native-node-id="page2-target" data-agent-native-layer-name="Page2Target"
             style="position:absolute;left:60px;top:60px;width:400px;height:300px;background:#312e81"></section>
  </body>
</html>`;

/** One-shot diagnostic snapshot of a screen's own document, read directly
 *  (not via the rAF recorder) — used to tell a transient flash apart from a
 *  genuinely stuck-light document (Steve: "I have to refresh to undo that"). */
async function screenDocState(page: Page, screenId: string) {
  return page.evaluate((id) => {
    const iframe = document.querySelector(
      `iframe[data-design-preview-iframe][data-screen-iframe-id="${id}"]`,
    ) as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument;
    if (!doc) return { accessible: false };
    return {
      accessible: true,
      htmlClass: doc.documentElement.className,
      bodyBg: doc.body ? getComputedStyle(doc.body).backgroundColor : null,
      bodyInlineBg: doc.body?.style.background ?? null,
      scriptCount: doc.querySelectorAll("script").length,
    };
  }, screenId);
}

async function newScriptBearingDarkDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "parity canvas flash (script-bearing)",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId: id,
    filename: "index.html",
    content: SCRIPT_BEARING_SCREEN_ONE,
    fileType: "html",
  });
  await postAction(page, "create-file", {
    designId: id,
    filename: "page-two.html",
    content: SCRIPT_BEARING_SCREEN_TWO,
    fileType: "html",
  });
  return id;
}

test.describe("script-bearing screen flash — Tailwind/Alpine CDN latency simulation", () => {
  test("no reload re-triggers the CDN latency paint across drag-into-container, undo x2, alt-drag-out, undo, delete, undo", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    let designId: string | undefined;
    try {
      await installCdnLatencyMock(page);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.addInitScript(() => localStorage.setItem("theme", "dark"));

      designId = await newScriptBearingDarkDesign(page);
      await gotoEditor(page, designId);
      await expect(page.locator("html")).toHaveClass(/dark/);

      const screenOneId = await fileIdFor(page, designId, "index.html");
      await installRecorder(page);

      const screenCardBox = await page
        .locator("[data-screen-card]")
        .first()
        .boundingBox();
      if (!screenCardBox) throw new Error("no screen card box");
      const screenCardPoint = {
        x: Math.round(screenCardBox.x + screenCardBox.width / 2),
        y: Math.round(screenCardBox.y + screenCardBox.height / 2),
      };
      // The mock CDN script only paints dark ~400ms after the document first
      // parses. Wait that out before any gesture runs so every subsequent
      // light frame is attributable to a gesture-triggered reload, not the
      // one legitimate initial-load paint.
      await expect
        .poll(async () =>
          isLightRgb(await pixelAt(page, screenCardPoint.x, screenCardPoint.y)),
        )
        .toBe(false);

      const frameIds = new Map<Frame, number>();
      const nextFrameId = { n: 0 };
      const results: Record<
        string,
        Awaited<ReturnType<typeof runInstrumentedGesture>>
      > = {};

      // (a) drag Widget into the Footer container.
      results["drag-into-container"] = await runInstrumentedGesture(
        page,
        "drag-into-container",
        screenCardPoint,
        frameIds,
        nextFrameId,
        async () => {
          const widget = await boxFor(page, screenOneId, "widget");
          const footer = await boxFor(page, screenOneId, "footer");
          await page.mouse.move(
            widget.x + widget.width / 2,
            widget.y + widget.height / 2,
          );
          await page.mouse.down();
          await page.mouse.move(
            widget.x + widget.width / 2 + 20,
            widget.y + widget.height / 2,
            { steps: 5 },
          );
          await page.mouse.move(
            footer.x + footer.width / 2,
            footer.y + footer.height / 2,
            { steps: 24 },
          );
          await page.waitForTimeout(300);
          await page.mouse.up();
        },
      );

      // (b) Cmd+Z.
      results["undo-1"] = await runInstrumentedGesture(
        page,
        "undo-1",
        screenCardPoint,
        frameIds,
        nextFrameId,
        () => page.keyboard.press("ControlOrMeta+z"),
      );

      // (c) Cmd+Z again.
      results["undo-2"] = await runInstrumentedGesture(
        page,
        "undo-2",
        screenCardPoint,
        frameIds,
        nextFrameId,
        () => page.keyboard.press("ControlOrMeta+z"),
      );

      // (d) alt-drag Widget out of the screen onto the empty board.
      results["alt-drag-out"] = await runInstrumentedGesture(
        page,
        "alt-drag-out",
        screenCardPoint,
        frameIds,
        nextFrameId,
        async () => {
          const widget = await boxFor(page, screenOneId, "widget");
          const world = await page
            .locator("[data-multi-screen-canvas-world]")
            .boundingBox();
          const outside = world
            ? { x: world.x + world.width - 40, y: world.y + 40 }
            : { x: widget.x + 900, y: widget.y - 200 };
          await page.mouse.move(
            widget.x + widget.width / 2,
            widget.y + widget.height / 2,
          );
          await page.mouse.down();
          await page.keyboard.down("Alt");
          await page.mouse.move(
            widget.x + widget.width / 2 + 20,
            widget.y + widget.height / 2,
            { steps: 5 },
          );
          await page.mouse.move(outside.x, outside.y, { steps: 30 });
          await page.waitForTimeout(300);
          await page.mouse.up();
          await page.keyboard.up("Alt");
        },
      );

      // (e) Cmd+Z (undo the alt-drag-out).
      results["undo-after-alt-drag-out"] = await runInstrumentedGesture(
        page,
        "undo-after-alt-drag-out",
        screenCardPoint,
        frameIds,
        nextFrameId,
        () => page.keyboard.press("ControlOrMeta+z"),
      );

      // (f) select the Widget and Delete.
      results["delete-widget"] = await runInstrumentedGesture(
        page,
        "delete-widget",
        screenCardPoint,
        frameIds,
        nextFrameId,
        async () => {
          const widget = await boxFor(page, screenOneId, "widget");
          await page.mouse.click(
            widget.x + widget.width / 2,
            widget.y + widget.height / 2,
          );
          await page.waitForTimeout(200);
          await page.keyboard.press("Delete");
        },
      );
      console.log(
        `[script-flash] DIAG after delete-widget (settled): ${JSON.stringify(await screenDocState(page, screenOneId))}`,
      );

      // (g) Cmd+Z (undo the delete).
      results["undo-after-delete"] = await runInstrumentedGesture(
        page,
        "undo-after-delete",
        screenCardPoint,
        frameIds,
        nextFrameId,
        () => page.keyboard.press("ControlOrMeta+z"),
      );
      console.log(
        `[script-flash] DIAG after undo-after-delete (settled): ${JSON.stringify(await screenDocState(page, screenOneId))}`,
      );
      // Is it STUCK white (Steve's "have to refresh to undo that") or does it
      // recover on its own after more time?
      await page.waitForTimeout(3000); // e2e-harness-ignore fixed frame-capture sampling window (see runInstrumentedGesture doc comment)
      console.log(
        `[script-flash] DIAG 3s later (still stuck?): ${JSON.stringify(await screenDocState(page, screenOneId))}`,
      );

      for (const [gesture, r] of Object.entries(results)) {
        console.log(
          `[script-flash] ${gesture}: total=${r.total} badCanvas=${r.badCanvas.length} badScreen=${r.badScreen.length} badPixels=${r.badPixels.length} remounts=${JSON.stringify(r.remounts.map((f: any) => f.remounts))} titleRemounts=${JSON.stringify(r.frameTitleRemounts)}`,
        );
        if (r.firstBadScreenSample) {
          console.log(
            `[script-flash] ${gesture} FIRST BAD SCREEN SAMPLE (reload mechanism): ${JSON.stringify(r.firstBadScreenSample)}`,
          );
        }
        if (r.badPixels.length > 0) {
          console.log(
            `[script-flash] ${gesture} bad pixel samples: ${JSON.stringify(r.badPixels.slice(0, 5))}`,
          );
        }
      }

      // Stricter than the two describe blocks above: this gesture set has no
      // Direct<->Interact toggle, so there is no gesture here for which a
      // full iframe remount is intentional. Any Frame-identity change
      // (title-remount) or in-page iframe-element remount is itself evidence
      // of an unwarranted reload, in addition to any light frame/pixel.
      const failing = Object.entries(results).filter(
        ([, r]) =>
          r.badScreen.length > 0 ||
          r.badPixels.length > 0 ||
          r.remounts.length > 0 ||
          Object.keys(r.frameTitleRemounts).length > 0,
      );
      expect(
        failing,
        `one or more non-reload-worthy gestures reloaded the script-bearing screen (light frame, light pixel, or a Frame-identity change): ${JSON.stringify(
          failing.map(([g, r]) => ({
            gesture: g,
            badScreen: r.badScreen.length,
            badPixels: r.badPixels.length,
            remounts: r.remounts.length,
            titleRemounts: r.frameTitleRemounts,
            firstBadScreenSample: r.firstBadScreenSample,
          })),
        )}`,
      ).toEqual([]);
    } finally {
      if (designId) {
        await postAction(page, "delete-design", { id: designId }).catch(
          () => {},
        );
      }
    }
  });
});
