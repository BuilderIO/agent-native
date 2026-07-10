import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { appPath } from "./helpers";

const SCREEN_COUNT = 120;
const CARDS_PER_SCREEN = 24;
const EXPECTED_AUTHORED_LAYERS = SCREEN_COUNT * (1 + CARDS_PER_SCREEN * 3);
const LIVE_IFRAME_BUDGET = 32;

interface BrowserPerfState {
  longTasks: number[];
  maxEventLoopDelayMs: number;
  iframeAdded: number;
  iframeRemoved: number;
  iframeLoads: number;
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
      longTasks: [] as number[],
      maxEventLoopDelayMs: 0,
      iframeAdded: 0,
      iframeRemoved: 0,
      iframeLoads: 0,
    };
    (window as any).__largeCanvasPerf = state;

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
          state.iframeAdded += iframeCountInNode(node);
        });
        record.removedNodes.forEach((node) => {
          state.iframeRemoved += iframeCountInNode(node);
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
  return page.evaluate(async (id) => {
    const shell = document.querySelector<HTMLElement>(
      `[data-screen-shell][data-frame-id="${CSS.escape(id)}"]`,
    );
    const clickTarget = shell?.querySelector<HTMLElement>("[data-frame-label]");
    const rowButton = document.querySelector<HTMLElement>(
      `[data-layer-row-button][data-layer-node-id="${CSS.escape(id)}"]`,
    );
    const row = rowButton?.closest<HTMLElement>('[role="treeitem"]');
    if (!clickTarget || !row)
      throw new Error(`missing screen selection DOM for ${id}`);
    const startedAt = performance.now();
    clickTarget.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
    while (performance.now() - startedAt < 2_000) {
      if (row.getAttribute("aria-selected") === "true") {
        return performance.now() - startedAt;
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
    throw new Error(`screen selection did not settle for ${id}`);
  }, screenId);
}

test("120-screen canvas stays usable, bounded, and responsive", async ({
  page,
}, workerInfo) => {
  test.setTimeout(240_000);
  const baseURL =
    (workerInfo.project.use.baseURL as string | undefined) ??
    "http://127.0.0.1:9333";
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
    const gesturePerf = await perfState(page);
    const iframeCountAfterGesture = await page
      .locator("iframe[data-design-preview-iframe]")
      .count();

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
    // The 32 live screens alone expose 2,336 authored nodes, so this proves
    // the browser is exercising a real thousands-of-layers DOM workload even
    // while the remaining 88 screens stay correctly placeholder-culled.
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
