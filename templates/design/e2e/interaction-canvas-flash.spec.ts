import { type Frame, type Page } from "@playwright/test";

import { selectTool } from "./helpers";
import {
  expect,
  expectOnlyChanged,
  test,
  type App,
  type SavedNode,
} from "./rails";

const BOARD = "__board__.html";

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

function isLightRgb(rgb: string | null | undefined): boolean {
  if (typeof rgb !== "string" || rgb === "NO_CONTAINER") return false;
  const channels = rgb
    .replace(/^rgba?\(/, "")
    .replace(/\)$/, "")
    .split(/[,\s/]+/)
    .map(Number);
  const [r, g, b, alpha] = channels;
  if (alpha === 0) return false;
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
              if (!docEl) {
                screens.push({
                  screenId,
                  accessible: true,
                  readyState: doc.readyState,
                  documentRootPresent: false,
                  bodyBg: null,
                  htmlClass: null,
                  colorScheme: null,
                  bridgeInstalled: false,
                });
                return;
              }
              screens.push({
                screenId,
                accessible: true,
                readyState: doc.readyState,
                documentRootPresent: true,
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

/** Seeds a two-screen dark design, opens it at 25% so the board has room beside the screens, and snapshots it. */
async function openDarkDesign(app: App, screenOne: string, screenTwo: string) {
  const page = app.page;
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  const id = await app.seed(screenOne, {
    files: { "page-two.html": screenTwo },
  });
  await app.open(id);
  await expect(page.locator("html")).toHaveClass(/dark/);
  const screenOneId = (await app.savedRecord(id)).files.find(
    (file) => file.filename === "index.html",
  )!.id;
  await installRecorder(page);
  const canvasPoint = await canvasSamplePoint(page);
  await expect
    .poll(() => pixelAt(page, canvasPoint.x, canvasPoint.y))
    .toBe("26,26,26");
  const zoomControl = page.getByRole("button", { name: /^\d+%$/ }).first();
  await zoomControl.click();
  const zoomInput = page.getByRole("textbox", { name: "Zoom percentage" });
  await zoomInput.fill("25%");
  await zoomInput.press("Enter");
  await expect(zoomControl).toHaveText("25%");
  await page.keyboard.press("Escape");
  await app.settled();
  const shell = page.locator(
    `[data-screen-shell][data-frame-id="${screenOneId}"] [data-screen-card]`,
  );
  let previous = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await shell.boundingBox());
        const stable = now === previous;
        previous = now;
        return stable;
      },
      { intervals: [200], message: "the camera never settled at 25%" },
    )
    .toBe(true);
  const card = (await shell.boundingBox())!;
  return {
    id,
    screenOneId,
    seeded: await app.savedNodes(id),
    card,
    cardCentre: {
      x: Math.round(card.x + card.width / 2),
      y: Math.round(card.y + card.height / 2),
    },
  };
}

async function dragWidgetIntoFooter(page: Page, screenId: string) {
  const widget = await boxFor(page, screenId, "widget");
  const footer = await boxFor(page, screenId, "footer");
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
  await page.mouse.up();
}

/** Alt-drags Widget out of its screen onto empty board to the screen's left. */
async function altDragWidgetOut(
  page: Page,
  screenId: string,
  card: { x: number; y: number },
) {
  const widget = await boxFor(page, screenId, "widget");
  await page.mouse.move(
    widget.x + widget.width / 2,
    widget.y + widget.height / 2,
  );
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(
    widget.x + widget.width / 2 + 20,
    widget.y + widget.height / 2,
    { steps: 5 },
  );
  await page.mouse.move(card.x - 120, card.y + 60, { steps: 30 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
}

/**
 * Selects Widget and deletes it. On the overview a plain click reaches the nested Widget; once its screen is
 * focused a plain click stops at Main, so that caller deep-selects with Cmd/Ctrl held.
 */
async function deleteWidget(app: App, screenId: string, held: string[]) {
  const widget = await boxFor(app.page, screenId, "widget");
  for (const key of held) await app.page.keyboard.down(key);
  await app.page.mouse.click(
    widget.x + widget.width / 2,
    widget.y + widget.height / 2,
  );
  for (const key of held) await app.page.keyboard.up(key);
  await expect
    .poll(() => app.selectedLayers(), {
      message: "the click selects Widget before Delete",
    })
    .toEqual(["Widget"]);
  await app.page.keyboard.press("Delete");
}

/** Clears the selection, focuses the screen, enters Interact from the top bar, then returns to editing. */
async function interactRoundTrip(page: Page, screenId: string) {
  const shell = page.locator(
    `[data-screen-shell][data-frame-id="${screenId}"]`,
  );
  await page.keyboard.press("Escape");
  await expect(
    page.locator('[role="treeitem"][aria-selected="true"]'),
  ).toHaveCount(0);
  await shell.locator("[data-frame-full-view]").click();
  await page
    .locator('[data-design-top-bar] [data-design-mode="interact"]')
    .click();
  await expect(shell).toHaveAttribute("data-screen-interact-mode", "true");
  await page.locator('[data-design-top-bar] [data-design-mode="edit"]').click();
  await expect(shell).toHaveAttribute("data-screen-interact-mode", "false");
}

function namedNodes(nodes: Map<string, SavedNode>, name: string) {
  return [...nodes.values()]
    .filter((node) => node.attrs["data-agent-native-layer-name"] === name)
    .map((node) => node.id);
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("flash color detection recognizes CSS and screenshot samples", () => {
  expect(isLightRgb("255,255,255")).toBe(true);
  expect(isLightRgb("rgb(255, 255, 255)")).toBe(true);
  expect(isLightRgb("rgba(255, 255, 255, 1)")).toBe(true);
  expect(isLightRgb("rgba(255, 255, 255, 0)")).toBe(false);
  expect(isLightRgb("rgb(26, 26, 26)")).toBe(false);
  expect(isLightRgb(null)).toBe(false);
});

test("frame recorder continues while a preview document has no root", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("about:blank");
  await page.evaluate(() => {
    const iframe = document.createElement("iframe");
    iframe.dataset.designPreviewIframe = "true";
    iframe.dataset.screenIframeId = "recorder-transition";
    iframe.srcdoc = "<html><body>Preview</body></html>";
    document.body.append(iframe);
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!document.querySelector<HTMLIFrameElement>("iframe")?.contentDocument
            ?.body,
      ),
    )
    .toBe(true);
  await installRecorder(page);
  await page.evaluate(() =>
    document
      .querySelector<HTMLIFrameElement>("iframe")!
      .contentDocument!.documentElement.remove(),
  );
  await startRecorder(page, "document-root-transition");
  await page.evaluate(async () => {
    for (let i = 0; i < 4; i += 1)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    const doc =
      document.querySelector<HTMLIFrameElement>("iframe")!.contentDocument!;
    doc.open();
    doc.write(
      '<html><body style="background: #fff">Restored preview</body></html>',
    );
    doc.close();
    for (let i = 0; i < 4; i += 1)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
  });
  const frames = await stopRecorder(page);
  expect(errors).toEqual([]);
  expect(frames.length).toBeGreaterThanOrEqual(4);
  const screens = frames.flatMap((frame) => frame.screens);
  expect(screens.some((screen) => screen.documentRootPresent === false)).toBe(
    true,
  );
  expect(screens.some((screen) => screen.documentRootPresent === true)).toBe(
    true,
  );
  expect(
    screens.some(
      (screen) =>
        screen.documentRootPresent === true && isLightRgb(screen.bodyBg),
    ),
  ).toBe(true);
});

test.describe("canvas flash — transient capture, dark theme, multi-screen", () => {
  // oracle: none — only the toolbar tool selection changed in this test; its own claim is unmeasured against Figma.
  // oracle: none — only the toolbar tool selection changed in this test; its own claim is unmeasured against Figma.
  test("overview canvas never paints a light/white frame across drag-into-container, undo x2, alt-drag-out, new shape, single-screen round trip, and resize", async ({
    app,
  }) => {
    test.setTimeout(180_000);
    const page = app.page;
    const { id, screenOneId, seeded, card } = await openDarkDesign(
      app,
      SCREEN_ONE,
      SCREEN_TWO,
    );
    const results: Record<
      string,
      { total: number; bad: any[]; remounts: any[] }
    > = {};
    const capture = async (
      label: string,
      gesture: () => Promise<void>,
      windowMs: number,
    ) => {
      await startRecorder(page, label);
      await gesture();
      await page.waitForTimeout(windowMs); // e2e-harness-ignore fixed frame-capture sampling window
      const frames = await stopRecorder(page);
      results[label] = {
        total: frames.length,
        bad: badFrames(frames),
        remounts: remountFrames(frames),
      };
      await app.settled();
    };

    await capture(
      "drag-into-container",
      () => dragWidgetIntoFooter(page, screenOneId),
      2000,
    );
    expect(
      (await app.savedNodes(id)).get("widget")?.parent,
      "the drag moved Widget into Footer",
    ).toBe("footer");
    await capture("undo-1", () => page.keyboard.press("ControlOrMeta+z"), 2000);
    expectOnlyChanged(seeded, await app.savedNodes(id), []);
    await capture("undo-2", () => page.keyboard.press("ControlOrMeta+z"), 2000);
    expectOnlyChanged(seeded, await app.savedNodes(id), []);
    await capture(
      "alt-drag-out",
      () => altDragWidgetOut(page, screenOneId, card),
      2000,
    );
    expect(
      namedNodes(await app.savedNodes(id, BOARD), "Widget"),
      "Alt-drag left one Widget copy on the board",
    ).toHaveLength(1);
    expectOnlyChanged(seeded, await app.savedNodes(id), []);
    await capture(
      "draw-first-shape",
      async () => {
        await selectTool(page, "Rectangle");
        await page.mouse.move(card.x - 220, card.y + 220);
        await page.mouse.down();
        await page.mouse.move(card.x - 120, card.y + 300, { steps: 12 });
        await page.mouse.up();
      },
      1500,
    );
    expect(
      namedNodes(await app.savedNodes(id, BOARD), "Rectangle"),
      "the Rectangle tool drew one board shape",
    ).toHaveLength(1);
    await page.keyboard.press("Escape");
    await page.locator('button[aria-label="Move"]').first().click();
    await capture(
      "single-screen-round-trip",
      () => interactRoundTrip(page, screenOneId),
      500,
    );
    await capture(
      "viewport-resize",
      async () => {
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.setViewportSize({ width: 1600, height: 1000 });
      },
      800,
    );

    for (const [gesture, result] of Object.entries(results)) {
      console.log(
        `[canvas-flash] ${gesture}: total=${result.total} light=${result.bad.length} remounts=${result.remounts.length}`,
      );
    }
    expect(
      Object.entries(results)
        .filter(([, result]) => result.bad.length > 0)
        .map(([gesture, result]) => `${gesture}: ${summarize(result.bad)}`),
      "gestures that painted a light overview-canvas frame",
    ).toEqual([]);
    // Focusing a screen may swap its preview for the live-editor iframe, so the no-remount rule covers edits only.
    expect(
      Object.entries(results)
        .filter(
          ([gesture, result]) =>
            gesture !== "single-screen-round-trip" &&
            result.remounts.length > 0,
        )
        .map(
          ([gesture, result]) =>
            `${gesture}: ${JSON.stringify(result.remounts[0].remounts)}`,
        ),
      "editing gestures that remounted a screen iframe",
    ).toEqual([]);
  });
});

test.describe("screen document flash — inside-iframe capture, dark theme", () => {
  // fixme: product bug: Drag, undo, then a second undo with nothing left to undo, then redo: Widget stays in Main. The extra undo discards the redo; with a
  test.fixme("no screen document ever paints a light/white background across drag-into-container, undo/redo depth, alt-drag-out, delete+undo, and Direct<->Interact", async ({
    app,
  }) => {
    test.setTimeout(180_000);
    const page = app.page;
    const { id, screenOneId, seeded, card, cardCentre } = await openDarkDesign(
      app,
      SCREEN_ONE_CLASS_DARK,
      SCREEN_TWO_MEDIA_DARK,
    );
    await expect
      .poll(async () =>
        isLightRgb(await pixelAt(page, cardCentre.x, cardCentre.y)),
      )
      .toBe(false);
    const frameIds = new Map<Frame, number>();
    const nextFrameId = { n: 0 };
    const results: Record<
      string,
      Awaited<ReturnType<typeof runInstrumentedGesture>>
    > = {};
    const capture = async (label: string, gesture: () => Promise<void>) => {
      results[label] = await runInstrumentedGesture(
        page,
        label,
        cardCentre,
        frameIds,
        nextFrameId,
        gesture,
      );
      await app.settled();
    };

    await capture("drag-into-container", () =>
      dragWidgetIntoFooter(page, screenOneId),
    );
    expect(
      (await app.savedNodes(id)).get("widget")?.parent,
      "the drag moved Widget into Footer",
    ).toBe("footer");
    await capture("undo-1", () => page.keyboard.press("ControlOrMeta+z"));
    expectOnlyChanged(seeded, await app.savedNodes(id), []);
    await capture("undo-2", () => page.keyboard.press("ControlOrMeta+z"));
    expectOnlyChanged(seeded, await app.savedNodes(id), []);
    await capture("redo", () => page.keyboard.press("ControlOrMeta+Shift+z"));
    expect
      .soft(
        (await app.savedNodes(id)).get("widget")?.parent,
        "redo after an extra undo re-applies the drag",
      )
      .toBe("footer");
    await capture("undo-redo", () => page.keyboard.press("ControlOrMeta+z"));
    expectOnlyChanged(seeded, await app.savedNodes(id), []);
    await capture("alt-drag-out", () =>
      altDragWidgetOut(page, screenOneId, card),
    );
    expect(
      namedNodes(await app.savedNodes(id, BOARD), "Widget"),
      "Alt-drag left one Widget copy on the board",
    ).toHaveLength(1);
    expectOnlyChanged(seeded, await app.savedNodes(id), []);
    await capture("undo-after-alt-drag-out", () =>
      page.keyboard.press("ControlOrMeta+z"),
    );
    expect(
      namedNodes(await app.savedNodes(id, BOARD), "Widget"),
      "undo removed the copy",
    ).toEqual([]);
    await capture("direct-interact-round-trip", () =>
      interactRoundTrip(page, screenOneId),
    );
    await capture("delete-widget", () =>
      deleteWidget(app, screenOneId, ["ControlOrMeta"]),
    );
    expect(
      (await app.savedNodes(id)).has("widget"),
      "Delete removed Widget",
    ).toBe(false);
    await capture("undo-after-delete", () =>
      page.keyboard.press("ControlOrMeta+z"),
    );
    expectOnlyChanged(seeded, await app.savedNodes(id), []);

    for (const [gesture, r] of Object.entries(results)) {
      console.log(
        `[screen-flash] ${gesture}: total=${r.total} badScreen=${r.badScreen.length} badPixels=${r.badPixels.length} remounts=${JSON.stringify(r.remounts.map((f: any) => f.remounts))}`,
      );
    }
    expect(
      Object.entries(results)
        .filter(
          ([gesture, r]) =>
            r.badScreen.length > 0 ||
            r.badPixels.length > 0 ||
            (gesture !== "direct-interact-round-trip" && r.remounts.length > 0),
        )
        .map(([gesture, r]) => ({
          gesture,
          badScreen: r.badScreen.length,
          badPixels: r.badPixels.length,
          remounts: r.remounts.length,
          firstBadScreenSample: r.firstBadScreenSample,
        })),
      "gestures that painted a light screen document or pixel, or remounted a screen",
    ).toEqual([]);
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

test.describe("script-bearing screen flash — Tailwind/Alpine CDN latency simulation", () => {
  test("no reload re-triggers the CDN latency paint across drag-into-container, undo x2, alt-drag-out, undo, delete, undo", async ({
    app,
  }) => {
    test.setTimeout(180_000);
    const page = app.page;
    await installCdnLatencyMock(page);
    const { id, screenOneId, seeded, card, cardCentre } = await openDarkDesign(
      app,
      SCRIPT_BEARING_SCREEN_ONE,
      SCRIPT_BEARING_SCREEN_TWO,
    );
    await expect
      .poll(async () =>
        isLightRgb(await pixelAt(page, cardCentre.x, cardCentre.y)),
      )
      .toBe(false);
    const frameIds = new Map<Frame, number>();
    const nextFrameId = { n: 0 };
    const results: Record<
      string,
      Awaited<ReturnType<typeof runInstrumentedGesture>>
    > = {};
    const capture = async (label: string, gesture: () => Promise<void>) => {
      results[label] = await runInstrumentedGesture(
        page,
        label,
        cardCentre,
        frameIds,
        nextFrameId,
        gesture,
      );
      await app.settled();
    };

    await capture("drag-into-container", () =>
      dragWidgetIntoFooter(page, screenOneId),
    );
    expect(
      (await app.savedNodes(id)).get("widget")?.parent,
      "the drag moved Widget into Footer",
    ).toBe("footer");
    await capture("undo-1", () => page.keyboard.press("ControlOrMeta+z"));
    expectOnlyChanged(seeded, await app.savedNodes(id), []);
    await capture("undo-2", () => page.keyboard.press("ControlOrMeta+z"));
    expectOnlyChanged(seeded, await app.savedNodes(id), []);
    await capture("alt-drag-out", () =>
      altDragWidgetOut(page, screenOneId, card),
    );
    expect(
      namedNodes(await app.savedNodes(id, BOARD), "Widget"),
      "Alt-drag left one Widget copy on the board",
    ).toHaveLength(1);
    expectOnlyChanged(seeded, await app.savedNodes(id), []);
    await capture("undo-after-alt-drag-out", () =>
      page.keyboard.press("ControlOrMeta+z"),
    );
    expect(
      namedNodes(await app.savedNodes(id, BOARD), "Widget"),
      "undo removed the copy",
    ).toEqual([]);
    await capture("delete-widget", () => deleteWidget(app, screenOneId, []));
    expect(
      (await app.savedNodes(id)).has("widget"),
      "Delete removed Widget",
    ).toBe(false);
    await capture("undo-after-delete", () =>
      page.keyboard.press("ControlOrMeta+z"),
    );
    expectOnlyChanged(seeded, await app.savedNodes(id), []);
    expect(
      await screenDocState(page, screenOneId),
      "the restored screen kept its dark document",
    ).toMatchObject({
      accessible: true,
      htmlClass: expect.stringContaining("dark"),
      bodyInlineBg: expect.stringMatching(/rgb\(11, 11, 11\)|#0b0b0b/),
    });

    for (const [gesture, r] of Object.entries(results)) {
      console.log(
        `[script-flash] ${gesture}: total=${r.total} badScreen=${r.badScreen.length} badPixels=${r.badPixels.length} remounts=${JSON.stringify(r.remounts.map((f: any) => f.remounts))} titleRemounts=${JSON.stringify(r.frameTitleRemounts)}`,
      );
    }
    expect(
      Object.entries(results)
        .filter(
          ([, r]) =>
            r.badScreen.length > 0 ||
            r.badPixels.length > 0 ||
            r.remounts.length > 0 ||
            Object.keys(r.frameTitleRemounts).length > 0,
        )
        .map(([gesture, r]) => ({
          gesture,
          badScreen: r.badScreen.length,
          badPixels: r.badPixels.length,
          remounts: r.remounts.length,
          titleRemounts: r.frameTitleRemounts,
          firstBadScreenSample: r.firstBadScreenSample,
        })),
      "gestures that reloaded the script-bearing screen (light frame, light pixel, or a frame-identity change)",
    ).toEqual([]);
  });
});
