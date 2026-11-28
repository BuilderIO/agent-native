import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { embeddedWheelBridgeScript } from "../../../../.generated/bridge/embedded-wheel.generated";

type ForwardedWheel = {
  type: string;
  deltaX: number;
  deltaY: number;
  ctrlKey: boolean;
  steps: number;
  seq: number;
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
    // The bridge's timers run only when a test moves this clock.
    await page.clock.install({ time: 0 });
    await page.clock.pauseAt(1000);
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
  page.evaluate(() =>
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

// Answers a posted step the way MultiScreenCanvas does, echoing its seq;
// by default the latest one.
const read = (page: Page, index = -1) =>
  page.evaluate((index) => {
    const posted = (window as unknown as { __posted: ForwardedWheel[] })
      .__posted;
    const step = posted[index < 0 ? posted.length + index : index];
    if (!step) throw new Error("No posted step to answer");
    window.postMessage(
      { type: "embedded-canvas-wheel-read", seq: step.seq },
      "*",
    );
  }, index);

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
    "starts another step after 32 folded wheels, so the host keeps their full travel",
    { timeout: 30_000 },
    async () => {
      await withPage(async (page) => {
        await wheels(
          page,
          Array.from({ length: 41 }, () => ({ deltaY: 30 })),
        );
        await page.waitForTimeout(20);
        await read(page);
        await page.waitForTimeout(20);
        await read(page);
        await page.waitForTimeout(20);
        expect(
          (await posted(page)).map(({ deltaY, steps }) => ({ deltaY, steps })),
        ).toEqual([
          { deltaY: 30, steps: 1 },
          { deltaY: 960, steps: 32 },
          { deltaY: 240, steps: 8 },
        ]);
      });
    },
  );

  it(
    "stops queuing new steps once 16 sit unread",
    { timeout: 30_000 },
    async () => {
      await withPage(async (page) => {
        // Every wheel switches between a pinch and a scroll, so none fold.
        await wheels(
          page,
          Array.from({ length: 21 }, (_, i) => ({
            deltaY: 10,
            ctrlKey: i % 2 === 1,
          })),
        );
        for (let i = 0; i < 20; i += 1) {
          await read(page);
          await page.waitForTimeout(5);
        }
        expect(await posted(page)).toHaveLength(17);
      });
    },
  );

  it(
    "keeps a pinch and a scroll in separate steps, one unread at a time",
    { timeout: 30_000 },
    async () => {
      await withPage(async (page) => {
        await wheels(page, [
          { deltaY: -4, ctrlKey: true },
          { deltaY: -6, ctrlKey: true },
          { deltaY: 30 },
          { deltaY: 10 },
        ]);
        const kinds = async () =>
          (await posted(page)).map(({ deltaY, ctrlKey, steps }) => ({
            deltaY,
            ctrlKey,
            steps,
          }));
        await read(page);
        await page.waitForTimeout(20);
        expect(await kinds()).toEqual([
          { deltaY: -4, ctrlKey: true, steps: 1 },
          { deltaY: -6, ctrlKey: true, steps: 1 },
        ]);

        await read(page);
        await page.waitForTimeout(20);
        expect((await kinds()).slice(2)).toEqual([
          { deltaY: 40, ctrlKey: false, steps: 2 },
        ]);
      });
    },
  );

  it(
    "keeps notch-sized zoom wheels out of a folded pinch, and folds them one way only",
    { timeout: 30_000 },
    async () => {
      await withPage(async (page) => {
        // MultiScreenCanvas judges a folded zoom step by its average wheel:
        // under 40px is a pinch, more is a mouse notch.
        await wheels(page, [
          { deltaY: -4, ctrlKey: true },
          { deltaY: -6, ctrlKey: true },
          { deltaY: -5, ctrlKey: true },
          { deltaY: -100, ctrlKey: true },
          { deltaY: -120, ctrlKey: true },
          { deltaY: 100, ctrlKey: true },
          { deltaY: -3, ctrlKey: true },
        ]);
        for (let i = 0; i < 4; i += 1) {
          await read(page);
          await page.waitForTimeout(20);
        }
        expect(
          (await posted(page)).map(({ deltaY, steps }) => ({ deltaY, steps })),
        ).toEqual([
          { deltaY: -4, steps: 1 },
          { deltaY: -11, steps: 2 },
          { deltaY: -220, steps: 2 },
          { deltaY: 100, steps: 1 },
          { deltaY: -3, steps: 1 },
        ]);
      });
    },
  );

  it(
    "folds a scroll's wheels whatever their size",
    { timeout: 30_000 },
    async () => {
      await withPage(async (page) => {
        await wheels(page, [{ deltaY: 20 }, { deltaY: 30 }, { deltaY: 100 }]);
        await read(page);
        await page.waitForTimeout(20);
        expect(
          (await posted(page)).map(({ deltaY, steps }) => ({ deltaY, steps })),
        ).toEqual([
          { deltaY: 20, steps: 1 },
          { deltaY: 130, steps: 2 },
        ]);
      });
    },
  );

  it(
    "ignores a late answer to a step the timer already gave up on",
    { timeout: 30_000 },
    async () => {
      await withPage(async (page) => {
        await wheels(page, [{ deltaY: 20 }, { deltaY: 30 }]);
        await page.clock.runFor(100);
        await page.waitForTimeout(20);
        await wheels(page, [{ deltaY: 10 }]);
        expect(await posted(page)).toHaveLength(2);

        // The first step's answer arrives after the timer sent the second.
        await read(page, 0);
        await page.waitForTimeout(20);
        expect(await posted(page)).toHaveLength(2);

        await read(page, 1);
        await page.waitForTimeout(20);
        expect(
          (await posted(page)).map(({ deltaY, steps }) => ({ deltaY, steps })),
        ).toEqual([
          { deltaY: 20, steps: 1 },
          { deltaY: 30, steps: 1 },
          { deltaY: 10, steps: 1 },
        ]);
      });
    },
  );

  it(
    "waits for a host that has answered, however slow its frames",
    { timeout: 30_000 },
    async () => {
      await withPage(async (page) => {
        await wheels(page, [{ deltaY: 20 }]);
        await read(page);
        await page.waitForTimeout(20);
        await wheels(page, [{ deltaY: 30 }, { deltaY: 10 }]);
        await page.clock.runFor(400);
        await page.waitForTimeout(20);
        expect(await posted(page)).toHaveLength(2);

        await read(page);
        await page.waitForTimeout(20);
        expect(
          (await posted(page)).map(({ deltaY, steps }) => ({ deltaY, steps })),
        ).toEqual([
          { deltaY: 20, steps: 1 },
          { deltaY: 30, steps: 1 },
          { deltaY: 10, steps: 1 },
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
        await page.clock.runFor(250);
        await page.waitForTimeout(20);
        expect(
          (await posted(page)).map(({ deltaY, steps }) => ({ deltaY, steps })),
        ).toEqual([
          { deltaY: 20, steps: 1 },
          { deltaY: 40, steps: 2 },
        ]);
      });
    },
  );

  it(
    "recovers pan and wheel state and logs diagnostics instead of swallowing postMessage failures",
    { timeout: 30_000 },
    async () => {
      await withPage(async (page) => {
        const result = await page.evaluate(() => {
          const warnings: unknown[][] = [];
          const originalWarn = console.warn;
          console.warn = (...args: unknown[]) => warnings.push(args);

          const originalPostMessage = window.postMessage.bind(window);
          let failNext = true;
          const delivered: Array<{
            type?: string;
            deltaY?: number;
            steps?: number;
            phase?: string;
            pointerId?: number;
          }> = [];
          window.postMessage = ((message: unknown, targetOrigin: string) => {
            if (failNext) {
              failNext = false;
              throw new Error("parent channel closed");
            }
            delivered.push(
              message as {
                type?: string;
                deltaY?: number;
                steps?: number;
                phase?: string;
                pointerId?: number;
              },
            );
            return originalPostMessage(message, targetOrigin);
          }) as typeof window.postMessage;

          document.body.dispatchEvent(
            new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              deltaY: 24,
              clientX: 10,
              clientY: 10,
            }),
          );
          document.body.dispatchEvent(
            new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              deltaY: 36,
              clientX: 10,
              clientY: 10,
            }),
          );

          failNext = true;
          document.body.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              cancelable: true,
              button: 1,
              pointerId: 7,
              clientX: 10,
              clientY: 10,
            }),
          );
          document.body.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              cancelable: true,
              button: 1,
              pointerId: 8,
              clientX: 20,
              clientY: 20,
            }),
          );
          document.body.dispatchEvent(
            new PointerEvent("pointerup", {
              bubbles: true,
              cancelable: true,
              button: 1,
              pointerId: 8,
              clientX: 20,
              clientY: 20,
            }),
          );

          console.warn = originalWarn;
          window.postMessage = originalPostMessage;
          return {
            warningCount: warnings.length,
            firstWarning: String(warnings[0]?.[0] ?? ""),
            delivered,
          };
        });

        expect(result.warningCount).toBe(1);
        expect(result.firstWarning).toContain("postMessage failed");
        expect(
          result.delivered.filter((m) => m.type === "embedded-canvas-wheel"),
        ).toEqual([expect.objectContaining({ deltaY: 36, steps: 1 })]);
        expect(
          result.delivered
            .filter((m) => m.type === "embedded-canvas-pan")
            .map((m) => ({ phase: m.phase, pointerId: m.pointerId })),
        ).toEqual([
          { phase: "start", pointerId: 8 },
          { phase: "end", pointerId: 8 },
        ]);
      });
    },
  );

  it(
    "does not toggle editing-safety stylesheet disabled state on resize when no animations are frozen",
    { timeout: 30_000 },
    async () => {
      await withPage(async (page) => {
        const disabledWrites = await page.evaluate(() => {
          const styleEl = document.querySelector<HTMLStyleElement>(
            "style[data-agent-native-editing-safety-style]",
          );
          if (!styleEl?.sheet) return -1;
          let writes = 0;
          const sheet = styleEl.sheet;
          const desc = Object.getOwnPropertyDescriptor(
            StyleSheet.prototype,
            "disabled",
          );
          if (!desc?.get || !desc.set) return -2;
          const origGet = desc.get;
          const origSet = desc.set;
          Object.defineProperty(sheet, "disabled", {
            configurable: true,
            get() {
              return origGet.call(this);
            },
            set(value: boolean) {
              writes += 1;
              origSet.call(this, value);
            },
          });
          window.dispatchEvent(new Event("resize"));
          return writes;
        });
        expect(disabledWrites).toBe(0);
      });
    },
  );
});
