import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import {
  assertSignedInOnBeta,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import { originFor, selectedSites, siteById } from "../../lib/fleet";

skipUnlessAuthed();

const selected = new Set(selectedSites().map((site) => site.id));
test.skip(!selected.has("design"), "design not in this run's selection");

const SCREEN_COUNT = 48;
const LIVE_IFRAME_BUDGET = 32;

function screenHtml(index: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="margin:0;background:#020617;color:#f8fafc"><main data-cull-layer="screen-${index}" style="width:720px;height:420px;padding:24px;box-sizing:border-box;font:20px system-ui">Screen ${index + 1}</main></body></html>`;
}

async function postAction(
  request: APIRequestContext,
  origin: string,
  name: string,
  input: Record<string, unknown>,
): Promise<any> {
  const response = await request.post(
    `${origin}/_agent-native/actions/${name}`,
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

async function createCullingDesign(
  request: APIRequestContext,
  origin: string,
): Promise<string> {
  const created = await postAction(request, origin, "create-design", {
    title: `Beta E2E culling ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = String(
    created?.id ?? created?.data?.id ?? created?.design?.id ?? "",
  );
  if (!designId) throw new Error("create-design did not return an id");

  try {
    for (let start = 0; start < SCREEN_COUNT; start += 8) {
      await Promise.all(
        Array.from({ length: Math.min(8, SCREEN_COUNT - start) }, (_, offset) =>
          postAction(request, origin, "create-file", {
            designId,
            filename: `screen-${String(start + offset).padStart(3, "0")}.html`,
            content: screenHtml(start + offset),
            fileType: "html",
          }),
        ),
      );
    }
    return designId;
  } catch (error) {
    await postAction(request, origin, "delete-design", { id: designId });
    throw error;
  }
}

async function previewIframeIds(page: Page): Promise<string[]> {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .evaluateAll((iframes) =>
      iframes.map(
        (iframe, index) =>
          iframe.getAttribute("data-screen-iframe-id") ?? `board-${index}`,
      ),
    );
}

async function installChurnObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { iframeAdded: 0, iframeRemoved: 0, iframeLoads: 0 };
    (
      window as typeof window & { __betaCullingPerf?: typeof state }
    ).__betaCullingPerf = state;
    const count = (node: Node): number => {
      if (!(node instanceof Element)) return 0;
      return (
        (node.matches("iframe[data-design-preview-iframe]") ? 1 : 0) +
        node.querySelectorAll("iframe[data-design-preview-iframe]").length
      );
    };
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) state.iframeAdded += count(node);
        for (const node of record.removedNodes)
          state.iframeRemoved += count(node);
      }
    }).observe(document, { childList: true, subtree: true });
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

async function resetChurn(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (
      window as typeof window & {
        __betaCullingPerf?: {
          iframeAdded: number;
          iframeRemoved: number;
          iframeLoads: number;
        };
      }
    ).__betaCullingPerf;
    if (!state) throw new Error("culling observer was not installed");
    state.iframeAdded = 0;
    state.iframeRemoved = 0;
    state.iframeLoads = 0;
  });
}

test("Design culling preserves a bounded preview pool during physical pan and zoom", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const site = siteById("design");
  const origin = originFor(site);
  const context = await signedInContext(browser, site, { seedModel: false });
  let designId: string | undefined;
  try {
    await assertSignedInOnBeta(context, site);
    const page = await context.newPage();
    await installChurnObserver(page);
    designId = await createCullingDesign(page.request, origin);
    await page.goto(`${origin}/design/${designId}`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await expect(page.locator("[data-multi-screen-canvas-world]")).toHaveCount(
      1,
    );
    await expect(page.locator("[data-screen-shell]")).toHaveCount(SCREEN_COUNT);
    await expect
      .poll(() => page.locator("iframe[data-design-preview-iframe]").count(), {
        timeout: 45_000,
      })
      .toBeGreaterThan(0);

    const initialIframes = await page
      .locator("iframe[data-design-preview-iframe]")
      .count();
    const initialIframeIds = await previewIframeIds(page);
    const placeholders = await page
      .locator('[data-screen-content][data-cull-tier="placeholder"]')
      .count();
    const zoomControl = page.getByRole("button", { name: /^\d+%$/ }).first();
    await expect(zoomControl).toBeVisible();
    const initialZoomLabel = await zoomControl.innerText();
    const surface = page
      .locator("[data-multi-screen-canvas-world]")
      .locator("..");
    const world = page.locator("[data-multi-screen-canvas-world]");
    const initialTransform = await world.evaluate(
      (element) => (element as HTMLElement).style.transform,
    );
    const readWorldScale = () =>
      world.evaluate((element) => {
        const match = /scale\((-?[\d.]+)\)/.exec(
          (element as HTMLElement).style.transform,
        );
        if (!match) throw new Error("missing world camera scale");
        return Number(match[1]);
      });
    const initialScale = await readWorldScale();
    const surfaceBox = await surface.boundingBox();
    if (!surfaceBox) throw new Error("missing overview canvas surface");
    await Promise.all(
      page
        .frames()
        .filter((frame) => frame !== page.mainFrame())
        .map((frame) => frame.waitForLoadState("load")),
    );
    await resetChurn(page);
    const wheelTarget = await page.evaluate(({ x, y, width, height }) => {
      for (let offsetY = height - 24; offsetY >= 24; offsetY -= 24) {
        for (let offsetX = width - 24; offsetX >= 24; offsetX -= 24) {
          const point = { x: x + offsetX, y: y + offsetY };
          const target = document.elementFromPoint(point.x, point.y);
          if (
            !target?.closest("[data-multi-screen-canvas-surface]") ||
            target.closest("iframe[data-design-preview-iframe], object, embed")
          ) {
            continue;
          }
          return {
            point,
            tagName: target.tagName,
            className: target instanceof HTMLElement ? target.className : null,
            inCanvasSurface: true,
            inPreviewIframe: false,
          };
        }
      }
      return null;
    }, surfaceBox);
    if (!wheelTarget) throw new Error("missing empty canvas wheel target");
    console.info(
      `[beta-design-culling] gesture-start ${JSON.stringify({ initialZoomLabel, initialTransform, wheelTarget })}`,
    );
    expect(wheelTarget.inCanvasSurface).toBe(true);
    expect(wheelTarget.inPreviewIframe).toBe(false);
    await page.mouse.move(wheelTarget.point.x, wheelTarget.point.y);
    for (let index = 0; index < 16; index += 1) await page.mouse.wheel(72, 48);
    await page.keyboard.down("Control");
    for (let index = 0; index < 4; index += 1) await page.mouse.wheel(0, -60);
    await page.keyboard.up("Control");
    await page.waitForTimeout(700);
    await expect
      .poll(
        () =>
          world.evaluate((element) => (element as HTMLElement).style.transform),
        { timeout: 10_000 },
      )
      .not.toBe(initialTransform);
    const cameraTransformAtLabel = await world.evaluate(
      (element) => (element as HTMLElement).style.transform,
    );
    const cameraScaleAtLabel = await readWorldScale();
    console.info(
      `[beta-design-culling] camera-before-label ${JSON.stringify({ cameraScaleAtLabel, cameraTransformAtLabel, initialScale })}`,
    );
    await expect
      .poll(() => zoomControl.innerText(), { timeout: 10_000 })
      .not.toBe(initialZoomLabel);
    const finalTransform = await world.evaluate(
      (element) => (element as HTMLElement).style.transform,
    );
    const finalZoomLabel = await zoomControl.innerText();
    console.info(
      `[beta-design-culling] gesture-end ${JSON.stringify({ finalZoomLabel, finalTransform })}`,
    );

    const afterIframes = await page
      .locator("iframe[data-design-preview-iframe]")
      .count();
    const afterIframeIds = await previewIframeIds(page);
    expect(afterIframeIds).not.toEqual(initialIframeIds);
    const perf = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __betaCullingPerf?: {
              iframeAdded: number;
              iframeRemoved: number;
              iframeLoads: number;
            };
          }
        ).__betaCullingPerf,
    );
    console.info(
      `[beta-design-culling] ${JSON.stringify({ initialIframes, afterIframes, placeholders, ...perf })}`,
    );
    expect(initialIframes).toBeLessThanOrEqual(LIVE_IFRAME_BUDGET);
    expect(afterIframes).toBeLessThanOrEqual(LIVE_IFRAME_BUDGET);
    expect(placeholders).toBeGreaterThanOrEqual(
      SCREEN_COUNT - LIVE_IFRAME_BUDGET,
    );
    expect(
      (perf?.iframeAdded ?? 0) + (perf?.iframeRemoved ?? 0),
    ).toBeLessThanOrEqual(12);
    expect(perf?.iframeLoads ?? 0).toBeLessThanOrEqual(6);
  } finally {
    if (designId) {
      await postAction(context.request, origin, "delete-design", {
        id: designId,
      });
    }
    await context.close();
  }
});
