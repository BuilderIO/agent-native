import type { Page } from "@playwright/test";

import { expect, test } from "./rails";

const SCREEN_COUNT = 120;
const CARDS_PER_SCREEN = 25;
const LIVE_IFRAME_BUDGET = 32;
const PREVIEW_IFRAME = "iframe[data-design-preview-iframe]";
const PAN_SHIELD = "[data-multi-screen-canvas-pan-shield]";

type IframeChurn = {
  added: number;
  removed: number;
  loads: number;
  lastActivityAt: number;
};

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

/** Counts preview iframes mounted, unmounted and (re)loaded, from before the editor boots. */
async function installIframeChurnObserver(page: Page) {
  await page.addInitScript((selector) => {
    const churn = {
      added: 0,
      removed: 0,
      loads: 0,
      lastActivityAt: performance.now(),
    };
    (window as unknown as { __iframeChurn: typeof churn }).__iframeChurn =
      churn;
    const count = (node: Node) =>
      node instanceof Element
        ? (node.matches(selector) ? 1 : 0) +
          node.querySelectorAll(selector).length
        : 0;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) churn.added += count(node);
        for (const node of record.removedNodes) churn.removed += count(node);
        if (record.addedNodes.length || record.removedNodes.length)
          churn.lastActivityAt = performance.now();
      }
    }).observe(document, { childList: true, subtree: true });
    document.addEventListener(
      "load",
      (event) => {
        if (
          event.target instanceof HTMLIFrameElement &&
          event.target.matches(selector)
        ) {
          churn.loads += 1;
          churn.lastActivityAt = performance.now();
        }
      },
      true,
    );
  }, PREVIEW_IFRAME);
}

async function iframeChurn(page: Page) {
  return page.evaluate(() => ({
    ...(window as unknown as { __iframeChurn: IframeChurn }).__iframeChurn,
  }));
}

async function resetIframeChurn(page: Page) {
  await page.evaluate(() => {
    const churn = (window as unknown as { __iframeChurn: IframeChurn })
      .__iframeChurn;
    churn.added = 0;
    churn.removed = 0;
    churn.loads = 0;
  });
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

async function middleDrag(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(from.x + dx, from.y + dy);
  await page.mouse.up({ button: "middle" });
}

test("a 120-screen canvas keeps at most 32 live iframes, barely remounts them through pan and zoom, and pans the camera by exactly the drag", async ({
  app,
}) => {
  test.setTimeout(240_000);
  const page = app.page;
  const files = Object.fromEntries(
    Array.from({ length: SCREEN_COUNT - 1 }, (_, offset) => [
      `screen-${String(offset + 1).padStart(3, "0")}.html`,
      screenHtml(offset + 1),
    ]),
  );
  const id = await app.seed(screenHtml(0), { files });
  await installIframeChurnObserver(page);
  await app.open(id);
  await expect(page.locator("[data-screen-shell]")).toHaveCount(SCREEN_COUNT);
  await page.waitForFunction(
    () => {
      const churn = (window as unknown as { __iframeChurn: IframeChurn })
        .__iframeChurn;
      return (
        churn.loads > 0 && performance.now() - churn.lastActivityAt >= 1_500
      );
    },
    undefined,
    { timeout: 30_000 },
  );
  expect(
    await page.locator(PREVIEW_IFRAME).count(),
    "live iframes once the canvas has loaded",
  ).toBeLessThanOrEqual(LIVE_IFRAME_BUDGET);

  const surfaceBox = (await page
    .locator("[data-multi-screen-canvas-surface]")
    .boundingBox())!;
  const centre = {
    x: surfaceBox.x + surfaceBox.width / 2,
    y: surfaceBox.y + surfaceBox.height / 2,
  };

  await test.step("a held middle-drag that pauses keeps the camera where the pointer left it", async () => {
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down({ button: "middle" });
    await expect(page.locator(PAN_SHIELD)).toHaveCount(1);
    await page.mouse.move(centre.x + 20, centre.y + 12);
    const paused = await readWorldCamera(page);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let frames = 0;
          const tick = () =>
            ++frames >= 10 ? resolve() : requestAnimationFrame(tick);
          requestAnimationFrame(tick);
        }),
    );
    expect(await readWorldCamera(page)).toEqual(paused);
    await page.mouse.up({ button: "middle" });
    await expect(page.locator(PAN_SHIELD)).toHaveCount(0);
  });

  await test.step("wheel pan and Ctrl-wheel zoom stay within the live-iframe and remount budgets", async () => {
    await resetIframeChurn(page);
    await page.mouse.move(centre.x, centre.y);
    for (let index = 0; index < 10; index += 1) await page.mouse.wheel(24, 18);
    await page.keyboard.down("Control");
    for (let index = 0; index < 6; index += 1)
      await page.mouse.wheel(0, index % 2 === 0 ? -28 : 28);
    await page.keyboard.up("Control");
    await page.waitForFunction(
      () =>
        performance.now() -
          (window as unknown as { __iframeChurn: IframeChurn }).__iframeChurn
            .lastActivityAt >=
        700,
    );
    const churn = await iframeChurn(page);
    expect(
      await page.locator(PREVIEW_IFRAME).count(),
      "live iframes after the gesture",
    ).toBeLessThanOrEqual(LIVE_IFRAME_BUDGET);
    expect(
      churn.added + churn.removed,
      "iframes mounted or unmounted by the gesture",
    ).toBeLessThanOrEqual(12);
    expect(
      churn.loads,
      "iframe loads caused by the gesture",
    ).toBeLessThanOrEqual(6);
  });

  await test.step("Escape during a middle-drag zoom restores the camera from before the drag", async () => {
    const before = await readWorldCamera(page);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(centre.x + 80, centre.y + 50);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -28);
    await page.keyboard.up("Control");
    await expect
      .poll(async () => (await readWorldCamera(page)).scale)
      .not.toBeCloseTo(before.scale, 3);
    await page.keyboard.press("Escape");
    await expect(page.locator(PAN_SHIELD)).toHaveCount(0);
    await page.mouse.up({ button: "middle" });
    await expect.poll(() => readWorldCamera(page)).toEqual(before);
  });

  await test.step("two middle-drags move the camera by exactly their summed delta", async () => {
    const before = await readWorldCamera(page);
    await middleDrag(page, centre, 45, 25);
    await middleDrag(page, centre, -20, 10);
    await expect
      .poll(async () => {
        const camera = await readWorldCamera(page);
        return {
          dx: Math.round((camera.x - before.x) * 10) / 10,
          dy: Math.round((camera.y - before.y) * 10) / 10,
          scale: camera.scale,
        };
      })
      .toEqual({ dx: 25, dy: 35, scale: before.scale });
  });
});
