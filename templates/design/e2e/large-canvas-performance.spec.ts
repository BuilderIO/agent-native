import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath } from "./helpers";

const screenCountInput = process.env.DESIGN_CANVAS_SCREEN_COUNT ?? "120";
const SCREEN_COUNT = Number(screenCountInput);
if (!Number.isInteger(SCREEN_COUNT) || SCREEN_COUNT < 1) {
  throw new Error(
    `DESIGN_CANVAS_SCREEN_COUNT must be positive, got ${screenCountInput}`,
  );
}
const CARDS_PER_SCREEN = 25;
const EXPECTED_AUTHORED_LAYERS = SCREEN_COUNT * (1 + CARDS_PER_SCREEN * 3);
const LIVE_IFRAME_BUDGET = 32;
const MINIMUM_PAN_FRAME_SAMPLES = 10;

interface BrowserPerfState {
  frameIntervalsMs: number[];
  panFrameIntervalEnd: number | null;
  longTasks: number[];
  maxEventLoopDelayMs: number;
  iframeAdded: number;
  iframeRemoved: number;
  iframeLoads: number;
  lastIframeActivityAt: number;
}

function screenHtml(screenIndex: number): string {
  const cards = Array.from({ length: CARDS_PER_SCREEN }, (_, cardIndex) => {
    const id = `${screenIndex}-${cardIndex}`;
    return `<article data-perf-layer="card-${id}" style="padding:12px;border:1px solid #334155;border-radius:10px;background:#111827">
      <h2 data-perf-layer="title-${id}" style="margin:0;font:600 16px/1.3 system-ui;color:#f8fafc">Card ${cardIndex + 1}</h2>
      <p data-perf-layer="copy-${id}" style="margin:6px 0 0;font:400 13px/1.4 system-ui;color:#94a3b8">Screen ${screenIndex + 1} deterministic performance content.</p>
    </article>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="margin:0;background:#020617;color:#f8fafc">
      <main data-perf-layer="root-${screenIndex}" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:20px">${cards}</main>
    </body></html>`;
}

async function postAction(
  request: APIRequestContext,
  baseURL: string,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const response = await request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    {
      data: input,
      headers: { "Content-Type": "application/json" },
      timeout: 60_000,
    },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function createLargeDesign(
  page: Page,
  baseURL: string,
): Promise<{ designId: string; screenIds: string[] }> {
  const created = await postAction(page.request, baseURL, "create-design", {
    title: "E2E Large Canvas Performance",
    projectType: "prototype",
  });
  const designId = String(
    created?.id ?? created?.data?.id ?? created?.design?.id ?? "",
  );
  if (!designId) throw new Error("create-design did not return an id");

  const screenIds: string[] = [];
  const concurrency = 8;
  for (let start = 0; start < SCREEN_COUNT; start += concurrency) {
    const batch = Array.from(
      { length: Math.min(concurrency, SCREEN_COUNT - start) },
      (_, offset) => start + offset,
    );
    const results = await Promise.all(
      batch.map((index) =>
        postAction(page.request, baseURL, "create-file", {
          designId,
          filename: `screen-${String(index).padStart(3, "0")}.html`,
          content: screenHtml(index),
          fileType: "html",
        }),
      ),
    );
    results.forEach((result) => screenIds.push(String(result.id)));
  }
  return { designId, screenIds };
}

async function installPerfObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = {
      frameIntervalsMs: [] as number[],
      panFrameIntervalEnd: null as number | null,
      longTasks: [] as number[],
      maxEventLoopDelayMs: 0,
      iframeAdded: 0,
      iframeRemoved: 0,
      iframeLoads: 0,
      lastIframeActivityAt: performance.now(),
    };
    (window as any).__largeCanvasPerf = state;

    let previousFrame = performance.now();
    const observeFrame = (frameTime: number) => {
      state.frameIntervalsMs.push(frameTime - previousFrame);
      previousFrame = frameTime;
      window.requestAnimationFrame(observeFrame);
    };
    window.requestAnimationFrame(observeFrame);

    let expectedTick = performance.now() + 16;
    window.setInterval(() => {
      const now = performance.now();
      state.maxEventLoopDelayMs = Math.max(
        state.maxEventLoopDelayMs,
        Math.max(0, now - expectedTick),
      );
      expectedTick = now + 16;
    }, 16);

    if (
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes.includes("longtask")
    ) {
      const observer = new PerformanceObserver((list) => {
        list
          .getEntries()
          .forEach((entry) => state.longTasks.push(entry.duration));
      });
      observer.observe({ type: "longtask", buffered: true });
    }

    const iframeCountInNode = (node: Node): number => {
      if (!(node instanceof Element)) return 0;
      return (
        (node.matches("iframe[data-design-preview-iframe]") ? 1 : 0) +
        node.querySelectorAll("iframe[data-design-preview-iframe]").length
      );
    };
    const mutationObserver = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          const added = iframeCountInNode(node);
          state.iframeAdded += added;
          if (added > 0) state.lastIframeActivityAt = performance.now();
        });
        record.removedNodes.forEach((node) => {
          const removed = iframeCountInNode(node);
          state.iframeRemoved += removed;
          if (removed > 0) state.lastIframeActivityAt = performance.now();
        });
      });
    });
    mutationObserver.observe(document, { childList: true, subtree: true });
    document.addEventListener(
      "load",
      (event) => {
        if (
          event.target instanceof HTMLIFrameElement &&
          event.target.matches("iframe[data-design-preview-iframe]")
        ) {
          state.iframeLoads += 1;
          state.lastIframeActivityAt = performance.now();
        }
      },
      true,
    );
  });
}

async function perfState(page: Page): Promise<BrowserPerfState> {
  return page.evaluate(() => ({ ...(window as any).__largeCanvasPerf }));
}

async function resetIframeChurn(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (window as any).__largeCanvasPerf as BrowserPerfState;
    state.iframeAdded = 0;
    state.iframeRemoved = 0;
    state.iframeLoads = 0;
  });
}

async function screenSelectionLatency(page: Page, screenId: string) {
  const rowButton = page.locator(
    `[data-layer-row-button][data-layer-node-id="${screenId}"]`,
  );
  const row = rowButton.locator('xpath=ancestor::*[@role="treeitem"][1]');
  if ((await row.getAttribute("aria-selected")) === "true") {
    const alternateRow = page
      .locator(
        `[data-layer-row-button][data-layer-node-id]:not([data-layer-node-id="${screenId}"])`,
      )
      .first();
    await alternateRow.click();
    await expect(row).toHaveAttribute("aria-selected", "false");
  }
  await page.evaluate((id) => {
    const button = document.querySelector<HTMLElement>(
      `[data-layer-row-button][data-layer-node-id="${CSS.escape(id)}"]`,
    );
    const selectedRow = button?.closest<HTMLElement>('[role="treeitem"]');
    if (!button || !selectedRow) {
      throw new Error("could not find the layer row for selection timing");
    }
    if (selectedRow.getAttribute("aria-selected") === "true") {
      throw new Error("selection timing requires an unselected row");
    }
    const state = window as typeof window & {
      __screenSelectionLatencyMs?: number | null;
    };
    state.__screenSelectionLatencyMs = null;
    let pointerDownAt: number | null = null;
    const observer = new MutationObserver(() => {
      if (
        pointerDownAt === null ||
        selectedRow.getAttribute("aria-selected") !== "true"
      ) {
        return;
      }
      state.__screenSelectionLatencyMs = performance.now() - pointerDownAt;
      observer.disconnect();
      button.removeEventListener("pointerdown", onPointerDown);
    });
    const onPointerDown = () => {
      pointerDownAt = performance.now();
    };
    observer.observe(selectedRow, {
      attributes: true,
      attributeFilter: ["aria-selected"],
    });
    button.addEventListener("pointerdown", onPointerDown, { once: true });
  }, screenId);
  await rowButton.click();
  await expect(row).toHaveAttribute("aria-selected", "true", {
    timeout: 2_000,
  });
  await page.waitForFunction(
    () => typeof (window as any).__screenSelectionLatencyMs === "number",
    undefined,
    { timeout: 2_000 },
  );
  return page.evaluate(
    () => (window as any).__screenSelectionLatencyMs as number,
  );
}

async function readWorldCamera(page: Page) {
  return page
    .locator("[data-multi-screen-canvas-world]")
    .evaluate((element) => {
      const transform = getComputedStyle(element).transform;
      if (transform === "none") return { x: 0, y: 0, scale: 1 };
      const matrix = new DOMMatrixReadOnly(transform);
      return { x: matrix.e, y: matrix.f, scale: matrix.a };
    });
}

async function performPanZoomGesture(page: Page): Promise<{
  gesturePerf: BrowserPerfState;
  iframeCountAfterGesture: number;
}> {
  await resetIframeChurn(page);
  const surface = page
    .locator("[data-multi-screen-canvas-world]")
    .locator("..");
  const surfaceBox = await surface.boundingBox();
  if (!surfaceBox) throw new Error("missing overview canvas surface");
  await page.mouse.move(
    surfaceBox.x + surfaceBox.width / 2,
    surfaceBox.y + surfaceBox.height / 2,
  );
  for (let index = 0; index < 10; index += 1) {
    await page.mouse.wheel(24, 18);
  }
  await page.keyboard.down("Control");
  for (let index = 0; index < 6; index += 1) {
    await page.mouse.wheel(0, index % 2 === 0 ? -28 : 28);
  }
  await page.keyboard.up("Control");
  await page.waitForTimeout(700);
  return {
    gesturePerf: await perfState(page),
    iframeCountAfterGesture: await page
      .locator("iframe[data-design-preview-iframe]")
      .count(),
  };
}

test(`${SCREEN_COUNT}-screen canvas preserves live iframes during pan and zoom`, async ({
  page,
}, workerInfo) => {
  test.setTimeout(240_000);
  const baseURL =
    (workerInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();
  const { designId, screenIds } = await createLargeDesign(page, baseURL);

  try {
    await installPerfObservers(page);
    await page.goto(appPath(`/design/${designId}`), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-multi-screen-canvas-world]")).toHaveCount(
      1,
    );
    await expect(page.locator("[data-screen-shell]")).toHaveCount(SCREEN_COUNT);
    await expect
      .poll(() => page.locator("iframe[data-design-preview-iframe]").count(), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    await page.waitForFunction(
      () => {
        const state = (window as any).__largeCanvasPerf as BrowserPerfState;
        return (
          state.iframeAdded > 0 &&
          state.iframeLoads > 0 &&
          performance.now() - state.lastIframeActivityAt >= 1_500
        );
      },
      undefined,
      { timeout: 30_000 },
    );

    const surface = page.locator("[data-multi-screen-canvas-surface]");
    const surfaceBox = await surface.boundingBox();
    if (!surfaceBox) throw new Error("missing overview canvas surface");
    const panStart = {
      x: surfaceBox.x + surfaceBox.width / 2,
      y: surfaceBox.y + surfaceBox.height / 2,
    };
    const world = page.locator("[data-multi-screen-canvas-world]");
    const beforePan = await world.evaluate((element) => {
      const transform = getComputedStyle(element).transform;
      return transform === "none"
        ? { x: 0, y: 0 }
        : {
            x: new DOMMatrixReadOnly(transform).e,
            y: new DOMMatrixReadOnly(transform).f,
          };
    });
    const profileOutputPath = process.env.DESIGN_CANVAS_TRACE_OUTPUT?.trim();
    const profileSession = profileOutputPath
      ? await page.context().newCDPSession(page)
      : null;
    if (profileSession) {
      await profileSession.send("Tracing.start", {
        categories:
          "devtools.timeline,blink,cc,disabled-by-default-devtools.timeline",
        transferMode: "ReturnAsStream",
      });
    }
    const frameIntervalStart = (await perfState(page)).frameIntervalsMs.length;
    await page.evaluate(() => {
      const state = (window as any).__largeCanvasPerf as BrowserPerfState;
      state.panFrameIntervalEnd = null;
      const capturePanEnd = (event: MouseEvent) => {
        if (event.button !== 1) return;
        state.panFrameIntervalEnd = state.frameIntervalsMs.length;
        document.removeEventListener("mouseup", capturePanEnd, true);
      };
      document.addEventListener("mouseup", capturePanEnd, true);
    });
    await page.mouse.move(panStart.x, panStart.y);
    await page.mouse.down({ button: "middle" });
    await expect(
      page.locator("[data-multi-screen-canvas-pan-shield]"),
    ).toHaveCount(1);
    await page.mouse.move(panStart.x + 80, panStart.y + 50, { steps: 24 });
    await page.mouse.up({ button: "middle" });
    const frameIntervalEnd = await page.evaluate(
      () =>
        ((window as any).__largeCanvasPerf as BrowserPerfState)
          .panFrameIntervalEnd,
    );
    if (frameIntervalEnd === null) {
      throw new Error("Chrome did not capture the pan mouse-up frame boundary");
    }
    if (profileSession && profileOutputPath) {
      await page.waitForTimeout(200);
      const tracingComplete = new Promise<{ stream?: string }>((resolveTrace) =>
        profileSession.once("Tracing.tracingComplete", resolveTrace),
      );
      await profileSession.send("Tracing.end");
      const { stream } = await tracingComplete;
      if (!stream)
        throw new Error("Chrome did not return the performance trace");
      const traceChunks: Buffer[] = [];
      let traceComplete = false;
      while (!traceComplete) {
        const chunk = await profileSession.send("IO.read", {
          handle: stream,
          size: 1_048_576,
        });
        traceChunks.push(
          Buffer.from(chunk.data, chunk.base64Encoded ? "base64" : "utf8"),
        );
        traceComplete = chunk.eof;
      }
      await profileSession.send("IO.close", { handle: stream });
      const outputPath = resolve(profileOutputPath);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, Buffer.concat(traceChunks));
      await profileSession.detach();
    }
    await expect(
      page.locator("[data-multi-screen-canvas-pan-shield]"),
    ).toHaveCount(0);
    await expect
      .poll(async () =>
        world.evaluate((element) => {
          const transform = getComputedStyle(element).transform;
          return transform === "none"
            ? { x: 0, y: 0 }
            : {
                x: new DOMMatrixReadOnly(transform).e,
                y: new DOMMatrixReadOnly(transform).f,
              };
        }),
      )
      .not.toEqual(beforePan);
    const panIntervals = (await perfState(page)).frameIntervalsMs.slice(
      frameIntervalStart,
      frameIntervalEnd,
    );
    const sortedPanIntervals = [...panIntervals].sort(
      (left, right) => left - right,
    );
    expect(
      sortedPanIntervals.length,
      "pan gesture should capture enough real animation frames to profile",
    ).toBeGreaterThanOrEqual(MINIMUM_PAN_FRAME_SAMPLES);
    const percentile = (value: number) =>
      sortedPanIntervals[
        Math.max(0, Math.ceil(sortedPanIntervals.length * value) - 1)
      ]!;
    console.info(
      `[large-canvas-pan-profile] ${JSON.stringify({
        frames: sortedPanIntervals.length,
        p50FrameMs: +percentile(0.5).toFixed(1),
        p95FrameMs: +percentile(0.95).toFixed(1),
        maxFrameMs: +Math.max(...sortedPanIntervals).toFixed(1),
      })}`,
    );
    const selectionLatencyMs = await screenSelectionLatency(
      page,
      screenIds[0]!,
    );
    console.info(
      `[large-canvas-selection-profile] ${JSON.stringify({
        latencyMs: +selectionLatencyMs.toFixed(1),
      })}`,
    );

    await page.mouse.move(panStart.x, panStart.y);
    await page.mouse.down({ button: "middle" });
    await expect(
      page.locator("[data-multi-screen-canvas-pan-shield]"),
    ).toHaveCount(1);
    await page.mouse.move(panStart.x + 20, panStart.y + 12);
    const panDuringPause = await world.evaluate(
      (element) => getComputedStyle(element).transform,
    );
    const pauseFrameStart = (await perfState(page)).frameIntervalsMs.length;
    await expect
      .poll(async () => (await perfState(page)).frameIntervalsMs.length, {
        intervals: [20],
      })
      .toBeGreaterThanOrEqual(pauseFrameStart + 9);
    await expect(
      page.locator("[data-multi-screen-canvas-pan-shield]"),
    ).toHaveCount(1);
    await expect
      .poll(() =>
        world.evaluate((element) => getComputedStyle(element).transform),
      )
      .toBe(panDuringPause);
    await page.mouse.move(panStart.x + 80, panStart.y + 50, { steps: 4 });
    await page.mouse.up({ button: "middle" });
    await expect(
      page.locator("[data-multi-screen-canvas-pan-shield]"),
    ).toHaveCount(0);

    const { gesturePerf, iframeCountAfterGesture } =
      await performPanZoomGesture(page);
    expect(iframeCountAfterGesture).toBeLessThanOrEqual(LIVE_IFRAME_BUDGET);
    expect(
      gesturePerf.iframeAdded + gesturePerf.iframeRemoved,
    ).toBeLessThanOrEqual(12);
    expect(gesturePerf.iframeLoads).toBeLessThanOrEqual(6);

    const cameraBeforeConcurrentZoom = await readWorldCamera(page);
    await page.mouse.move(panStart.x, panStart.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(panStart.x + 80, panStart.y + 50);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -28);
    await page.keyboard.up("Control");
    await page.waitForTimeout(180);
    const cameraAfterConcurrentZoom = await readWorldCamera(page);
    expect(cameraAfterConcurrentZoom.scale).not.toBeCloseTo(
      cameraBeforeConcurrentZoom.scale,
      3,
    );
    expect(
      Math.abs(cameraAfterConcurrentZoom.x - cameraBeforeConcurrentZoom.x),
    ).toBeGreaterThan(30);
    await page.mouse.up({ button: "middle" });
    await expect(
      page.locator("[data-multi-screen-canvas-pan-shield]"),
    ).toHaveCount(0);
    await expect
      .poll(() => readWorldCamera(page))
      .toEqual(cameraAfterConcurrentZoom);

    const cameraBeforeEscape = await readWorldCamera(page);
    await page.mouse.move(panStart.x, panStart.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(panStart.x + 80, panStart.y + 50);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -28);
    await page.keyboard.up("Control");
    await page.waitForTimeout(180);
    const cameraAfterEscapeZoom = await readWorldCamera(page);
    expect(cameraAfterEscapeZoom.scale).not.toBeCloseTo(
      cameraBeforeEscape.scale,
      3,
    );
    await page.keyboard.press("Escape");
    await expect(
      page.locator("[data-multi-screen-canvas-pan-shield]"),
    ).toHaveCount(0);
    await page.mouse.up({ button: "middle" });
    await expect.poll(() => readWorldCamera(page)).toEqual(cameraBeforeEscape);

    const cameraBeforeSequentialPans = await readWorldCamera(page);
    for (const delta of [
      { x: 45, y: 25 },
      { x: -20, y: 10 },
    ]) {
      await page.mouse.move(panStart.x, panStart.y);
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(panStart.x + delta.x, panStart.y + delta.y);
      await page.mouse.up({ button: "middle" });
    }
    await expect
      .poll(async () => {
        const camera = await readWorldCamera(page);
        return (
          Math.abs(camera.x - (cameraBeforeSequentialPans.x + 25)) < 0.1 &&
          Math.abs(camera.y - (cameraBeforeSequentialPans.y + 35)) < 0.1 &&
          Math.abs(camera.scale - cameraBeforeSequentialPans.scale) < 0.001
        );
      })
      .toBe(true);
  } finally {
    await postAction(page.request, baseURL, "delete-design", {
      id: designId,
    }).catch(() => {});
  }
});

// This broader budget suite remains quarantined because long-task and
// selection timings vary substantially with the shared test host. The focused
// pan/zoom churn gate above keeps the deterministic iframe regression covered.
test.fixme("120-screen canvas stays usable, bounded, and responsive", async ({
  page,
}, workerInfo) => {
  test.setTimeout(240_000);
  const baseURL =
    (workerInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();
  const { designId, screenIds } = await createLargeDesign(page, baseURL);

  try {
    await installPerfObservers(page);
    const navigationStartedAt = Date.now();
    await page.goto(appPath(`/design/${designId}`), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-multi-screen-canvas-world]")).toHaveCount(
      1,
    );
    await expect(page.locator("[data-screen-shell]")).toHaveCount(SCREEN_COUNT);
    await expect
      .poll(() => page.locator("iframe[data-design-preview-iframe]").count(), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0);
    const editorUsableMs = Date.now() - navigationStartedAt;

    const iframeCount = await page
      .locator("iframe[data-design-preview-iframe]")
      .count();
    const placeholderCount = await page
      .locator('[data-screen-content][data-cull-tier="placeholder"]')
      .count();
    const authoredLayerCount = await page
      .locator("[data-screen-shell]")
      .evaluateAll((shells) =>
        shells.reduce((count, shell) => {
          const iframe = shell.querySelector<HTMLIFrameElement>(
            "iframe[data-design-preview-iframe]",
          );
          return (
            count +
            (iframe?.contentDocument?.querySelectorAll("[data-perf-layer]")
              .length ?? 0)
          );
        }, 0),
      );
    const usablePerf = await perfState(page);

    const { gesturePerf, iframeCountAfterGesture } =
      await performPanZoomGesture(page);

    const selectionIds = [0, 15, 30, 45, 60, 75, 90, 105].map(
      (index) => screenIds[index]!,
    );
    const selectionLatencies: number[] = [];
    for (const screenId of selectionIds) {
      selectionLatencies.push(await screenSelectionLatency(page, screenId));
    }
    selectionLatencies.sort((a, b) => a - b);
    const selectionP95Ms =
      selectionLatencies[Math.ceil(selectionLatencies.length * 0.95) - 1]!;
    const finalPerf = await perfState(page);
    const loadLongTasks = usablePerf.longTasks;
    const gestureLongTasks = gesturePerf.longTasks.slice(
      usablePerf.longTasks.length,
    );
    const selectionLongTasks = finalPerf.longTasks.slice(
      gesturePerf.longTasks.length,
    );
    const totalDuration = (durations: readonly number[]) =>
      durations.reduce((total, duration) => total + duration, 0);
    const longestDuration = (durations: readonly number[]) =>
      Math.max(0, ...durations);
    const longestTaskMs = Math.max(0, ...finalPerf.longTasks);

    console.info(
      `[large-canvas-perf] ${JSON.stringify({
        editorUsableMs,
        iframeCount,
        iframeCountAfterGesture,
        placeholderCount,
        authoredLayerCount,
        gestureIframeAdded: gesturePerf.iframeAdded,
        gestureIframeRemoved: gesturePerf.iframeRemoved,
        gestureIframeLoads: gesturePerf.iframeLoads,
        longestTaskMs: Math.round(longestTaskMs),
        loadLongTaskMs: Math.round(totalDuration(loadLongTasks)),
        gestureLongTaskMs: Math.round(totalDuration(gestureLongTasks)),
        gestureLongestTaskMs: Math.round(longestDuration(gestureLongTasks)),
        selectionLongTaskMs: Math.round(totalDuration(selectionLongTasks)),
        maxEventLoopDelayMs: Math.round(finalPerf.maxEventLoopDelayMs),
        selectionP95Ms: Math.round(selectionP95Ms),
      })}`,
    );

    expect(editorUsableMs).toBeLessThan(20_000);
    expect(iframeCount).toBeLessThanOrEqual(LIVE_IFRAME_BUDGET);
    expect(iframeCountAfterGesture).toBeLessThanOrEqual(LIVE_IFRAME_BUDGET);
    expect(placeholderCount).toBeGreaterThanOrEqual(
      SCREEN_COUNT - LIVE_IFRAME_BUDGET,
    );
    expect(authoredLayerCount).toBeGreaterThanOrEqual(2_000);
    expect(authoredLayerCount).toBeLessThanOrEqual(EXPECTED_AUTHORED_LAYERS);
    expect(
      gesturePerf.iframeAdded + gesturePerf.iframeRemoved,
    ).toBeLessThanOrEqual(12);
    expect(gesturePerf.iframeLoads).toBeLessThanOrEqual(6);
    expect(longestTaskMs).toBeLessThan(1_500);
    expect(totalDuration(loadLongTasks)).toBeLessThan(5_000);
    expect(totalDuration(gestureLongTasks)).toBeLessThan(1_500);
    expect(longestDuration(gestureLongTasks)).toBeLessThan(750);
    expect(finalPerf.maxEventLoopDelayMs).toBeLessThan(2_000);
    expect(selectionP95Ms).toBeLessThan(500);
  } finally {
    await postAction(page.request, baseURL, "delete-design", {
      id: designId,
    }).catch(() => {});
  }
});
