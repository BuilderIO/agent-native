import { expect, test, type Frame, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { enterDirectMode, enterInteractView, gotoEditor } from "./helpers";


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
  return r > 150 && g > 150 && b > 150;
}

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

function badFrames(frames: any[]): any[] {
  return frames.filter((f) => isLightRgb(f.bg));
}

function remountFrames(frames: any[]): any[] {
  return frames.filter((f) => f.remounts.length > 0);
}

function badScreenFrames(frames: any[]): any[] {
  return frames.filter((f) =>
    (f.screens ?? []).some((s: any) => isLightRgb(s.bodyBg)),
  );
}

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

function badPixels(pixels: any[]): any[] {
  return pixels.filter((p) => isLightRgb(p.rgb));
}

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

      await page.keyboard.press("Escape");
      await page.locator('button[aria-label="Move"]').first().click();
      await page.waitForTimeout(200);

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

      results["undo-1"] = await runInstrumentedGesture(
        page,
        "undo-1",
        screenCardPoint,
        frameIds,
        nextFrameId,
        () => page.keyboard.press("ControlOrMeta+z"),
      );

      results["undo-2"] = await runInstrumentedGesture(
        page,
        "undo-2",
        screenCardPoint,
        frameIds,
        nextFrameId,
        () => page.keyboard.press("ControlOrMeta+z"),
      );

      results["redo"] = await runInstrumentedGesture(
        page,
        "redo",
        screenCardPoint,
        frameIds,
        nextFrameId,
        () => page.keyboard.press("ControlOrMeta+Shift+z"),
      );

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

      results["undo-after-alt-drag-out"] = await runInstrumentedGesture(
        page,
        "undo-after-alt-drag-out",
        screenCardPoint,
        frameIds,
        nextFrameId,
        () => page.keyboard.press("ControlOrMeta+z"),
      );

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

      results["undo-1"] = await runInstrumentedGesture(
        page,
        "undo-1",
        screenCardPoint,
        frameIds,
        nextFrameId,
        () => page.keyboard.press("ControlOrMeta+z"),
      );

      results["undo-2"] = await runInstrumentedGesture(
        page,
        "undo-2",
        screenCardPoint,
        frameIds,
        nextFrameId,
        () => page.keyboard.press("ControlOrMeta+z"),
      );

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

      results["undo-after-alt-drag-out"] = await runInstrumentedGesture(
        page,
        "undo-after-alt-drag-out",
        screenCardPoint,
        frameIds,
        nextFrameId,
        () => page.keyboard.press("ControlOrMeta+z"),
      );

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
