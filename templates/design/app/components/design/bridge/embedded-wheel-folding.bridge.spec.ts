import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { embeddedWheelBridgeScript } from "../../../../.generated/bridge/embedded-wheel.generated";

type ForwardedWheel = {
  type: string;
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  steps: number;
};

const bridge = embeddedWheelBridgeScript
  .replace("__EMBEDDED_WHEEL_FORWARDING_ENABLED__", "true")
  .replace("__EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__", "false")
  .replace("__EDITING_SAFETY_ENABLED__", "true")
  .replace("__INTERACTION_MODE__", "false");

async function withPage(run: (page: Page) => Promise<void>) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body style="margin:0">');
    await page.evaluate(() => {
      const posted: unknown[] = [];
      (window as unknown as { __posted: unknown[] }).__posted = posted;
      // With no host above the page, `parent` is the page itself, so what the
      // bridge posts to the host arrives here.
      window.addEventListener("message", (event) => {
        if (event.data?.type === "embedded-canvas-wheel") {
          posted.push(event.data);
        }
      });
    });
    await page.addScriptTag({ content: bridge });
    await run(page);
  } finally {
    await browser.close();
  }
}

// Synchronous, so every wheel lands before the bridge could hear back.
function wheels(page: Page, ticks: { deltaY: number; ctrlKey?: boolean }[]) {
  return page.evaluate((ticks) => {
    for (const tick of ticks) {
      document.body.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          deltaY: tick.deltaY,
          ctrlKey: tick.ctrlKey ?? false,
          clientX: 20,
          clientY: 30,
        }),
      );
    }
  }, ticks);
}

const posted = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __posted: ForwardedWheel[] }).__posted.map(
        ({ type, deltaX, deltaY, ctrlKey, steps }) => ({
          type,
          deltaX,
          deltaY,
          ctrlKey,
          steps,
        }),
      ),
  );

const read = (page: Page) =>
  page.evaluate(() =>
    window.postMessage({ type: "embedded-canvas-wheel-read" }, "*"),
  );

describe("the embedded wheel bridge", () => {
  it(
    "folds wheels the host has not read yet into one step",
    { timeout: 30_000 },
    async () => {
      await withPage(async (page) => {
        await wheels(page, [
          { deltaY: -4, ctrlKey: true },
          { deltaY: -6, ctrlKey: true },
          { deltaY: -5, ctrlKey: true },
        ]);
        await page.waitForTimeout(20);
        expect(await posted(page)).toEqual([
          {
            type: "embedded-canvas-wheel",
            deltaX: 0,
            deltaY: -4,
            ctrlKey: true,
            steps: 1,
          },
        ]);

        await read(page);
        await page.waitForTimeout(20);
        expect((await posted(page)).slice(1)).toEqual([
          {
            type: "embedded-canvas-wheel",
            deltaX: 0,
            deltaY: -11,
            ctrlKey: true,
            steps: 2,
          },
        ]);
      });
    },
  );

  it(
    "keeps a pinch and a scroll in separate steps",
    { timeout: 30_000 },
    async () => {
      await withPage(async (page) => {
        await wheels(page, [
          { deltaY: -4, ctrlKey: true },
          { deltaY: -6, ctrlKey: true },
          { deltaY: 30 },
        ]);
        await read(page);
        await page.waitForTimeout(20);
        expect(
          (await posted(page)).map(({ deltaY, ctrlKey, steps }) => ({
            deltaY,
            ctrlKey,
            steps,
          })),
        ).toEqual([
          { deltaY: -4, ctrlKey: true, steps: 1 },
          { deltaY: -6, ctrlKey: true, steps: 1 },
          { deltaY: 30, ctrlKey: false, steps: 1 },
        ]);
      });
    },
  );

  it(
    "still sends folded wheels when the host never answers",
    { timeout: 30_000 },
    async () => {
      await withPage(async (page) => {
        await wheels(page, [{ deltaY: 20 }, { deltaY: 30 }, { deltaY: 10 }]);
        await page.waitForTimeout(250);
        expect(
          (await posted(page)).map(({ deltaY, steps }) => ({ deltaY, steps })),
        ).toEqual([
          { deltaY: 20, steps: 1 },
          { deltaY: 40, steps: 2 },
        ]);
      });
    },
  );
});
