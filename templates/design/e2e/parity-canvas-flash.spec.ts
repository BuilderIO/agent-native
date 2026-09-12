import { expect, test, type Page } from "@playwright/test";

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

let baseURL = "";

async function postAction(page: Page, name: string, input: Record<string, unknown>) {
  const res = await page.request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok()) {
    throw new Error(`${name}: ${res.status()} ${(await res.text()).slice(0, 300)}`);
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

async function fileIdFor(page: Page, id: string, filename: string): Promise<string> {
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
async function canvasSamplePoint(page: Page): Promise<{ x: number; y: number }> {
  const canvasBox = await page.locator("[data-design-canvas-container]").boundingBox();
  if (!canvasBox) throw new Error("no canvas container box");
  const leftShellBox = await page
    .locator('[data-design-chrome-region="left-shell"]')
    .boundingBox()
    .catch(() => null);
  const rightPanelBox = await page
    .locator('[data-design-chrome-region="right-panel"]')
    .boundingBox()
    .catch(() => null);
  const leftEdge = leftShellBox ? leftShellBox.x + leftShellBox.width : canvasBox.x;
  const rightEdge = rightPanelBox ? rightPanelBox.x : canvasBox.x + canvasBox.width;
  return {
    x: Math.round(leftEdge + (rightEdge - leftEdge) * 0.6),
    y: Math.round(canvasBox.y + canvasBox.height * 0.6),
  };
}

async function pixelAt(page: Page, x: number, y: number): Promise<string> {
  const client = await page.context().newCDPSession(page);
  const { data } = await client.send("Page.captureScreenshot", { format: "png" });
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
      const d = ctx.getImageData(Math.round(px * ratio), Math.round(py * ratio), 1, 1).data;
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
          const container = document.querySelector("[data-design-canvas-container]");
          const bg = container ? getComputedStyle(container).backgroundColor : "NO_CONTAINER";
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
          document
            .querySelectorAll("iframe[data-design-preview-iframe]")
            .forEach((el) => {
              const screenId = el.getAttribute("data-screen-iframe-id") ?? "(active)";
              const prev = this.seenIframes.get(screenId);
              if (prev && prev !== el) remounts.push(screenId);
              this.seenIframes.set(screenId, el);
            });
          this.frames.push({
            t: performance.now(),
            bg,
            varVal,
            htmlClass,
            skeletonPresent,
            remounts,
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

function badFrames(frames: any[]): any[] {
  return frames.filter((f) => isLightRgb(f.bg) || f.remounts.length > 0);
}

function summarize(frames: any[]): string {
  const bad = badFrames(frames);
  return `${frames.length} frames recorded, ${bad.length} bad. First bad: ${JSON.stringify(bad[0] ?? null)}`;
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

      const allBad: Record<string, any[]> = {};

      // (a) drag Widget into the Footer container.
      {
        const widget = await boxFor(page, screenOneId, "widget");
        const footer = await boxFor(page, screenOneId, "footer");
        await startRecorder(page, "drag-into-container");
        await page.mouse.move(widget.x + widget.width / 2, widget.y + widget.height / 2);
        await page.mouse.down();
        await page.mouse.move(
          widget.x + widget.width / 2 + 20,
          widget.y + widget.height / 2,
          { steps: 5 },
        );
        await page.mouse.move(footer.x + footer.width / 2, footer.y + footer.height / 2, {
          steps: 24,
        });
        await page.waitForTimeout(300);
        await page.mouse.up();
        await page.waitForTimeout(2000);
        allBad["drag-into-container"] = badFrames(await stopRecorder(page));
      }

      // (b) undo the nest.
      {
        await startRecorder(page, "undo-1");
        await page.keyboard.press("ControlOrMeta+z");
        await page.waitForTimeout(2000);
        allBad["undo-1"] = badFrames(await stopRecorder(page));
      }

      // (c) undo again ("if I hit undo again ... white background comes back").
      {
        await startRecorder(page, "undo-2");
        await page.keyboard.press("ControlOrMeta+z");
        await page.waitForTimeout(2000);
        allBad["undo-2"] = badFrames(await stopRecorder(page));
      }

      // (d) alt-drag Widget from inside the screen out onto the empty board.
      {
        const widget = await boxFor(page, screenOneId, "widget");
        const world = await page.locator("[data-multi-screen-canvas-world]").boundingBox();
        const outside = world
          ? { x: world.x + world.width - 40, y: world.y + 40 }
          : { x: widget.x + 900, y: widget.y - 200 };
        await startRecorder(page, "alt-drag-out");
        await page.mouse.move(widget.x + widget.width / 2, widget.y + widget.height / 2);
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
        await page.waitForTimeout(2000);
        allBad["alt-drag-out"] = badFrames(await stopRecorder(page));
      }

      // (e) draw the first free-floating shape.
      {
        await startRecorder(page, "draw-first-shape");
        await page.locator('button[aria-label="Rectangle"]').first().click();
        const world = await page.locator("[data-multi-screen-canvas-world]").boundingBox();
        const drawAt = world
          ? { x: world.x + world.width - 200, y: world.y + world.height - 200 }
          : { x: 200, y: 200 };
        await page.mouse.move(drawAt.x, drawAt.y);
        await page.mouse.down();
        await page.mouse.move(drawAt.x + 100, drawAt.y + 80, { steps: 12 });
        await page.mouse.up();
        await page.waitForTimeout(1500);
        allBad["draw-first-shape"] = badFrames(await stopRecorder(page));
      }

      // (f) enter single-screen mode and back.
      {
        await startRecorder(page, "single-screen-round-trip");
        await enterInteractView(page, { screenId: screenOneId });
        await page.waitForTimeout(500);
        await enterDirectMode(page, { screenId: screenOneId });
        await page.waitForTimeout(500);
        allBad["single-screen-round-trip"] = badFrames(await stopRecorder(page));
      }

      // (g) resize the browser viewport.
      {
        await startRecorder(page, "viewport-resize");
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.waitForTimeout(300);
        await page.setViewportSize({ width: 1600, height: 1000 });
        await page.waitForTimeout(500);
        allBad["viewport-resize"] = badFrames(await stopRecorder(page));
      }

      const failing = Object.entries(allBad).filter(([, frames]) => frames.length > 0);
      if (failing.length > 0) {
        for (const [gesture, frames] of failing) {
          console.log(`[canvas-flash] ${gesture}: ${summarize(frames)}`);
        }
      }
      expect(
        failing,
        `one or more gestures painted a light/white overview-canvas frame or remounted a screen iframe: ${JSON.stringify(
          failing.map(([g, f]) => [g, f.length]),
        )}`,
      ).toEqual([]);
    } finally {
      if (designId) {
        await postAction(page, "delete-design", { id: designId }).catch(() => {});
      }
    }
  });
});
