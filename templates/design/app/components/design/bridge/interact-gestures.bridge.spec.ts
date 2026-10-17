import { chromium, type Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { embeddedWheelBridgeScript } from "../../../../.generated/bridge/embedded-wheel.generated";
import { zoomBridgeScript } from "../../../../.generated/bridge/zoom.generated";

// The strongest forwarding the editor ever turns on, so a gesture that still
// leaks in Interact has nothing else to hide behind.
function gestureBridgeScript(interact: boolean): string {
  return embeddedWheelBridgeScript
    .replace("__EMBEDDED_WHEEL_FORWARDING_ENABLED__", "true")
    .replace("__EMBEDDED_SPACE_KEY_FORWARDING_ENABLED__", "true")
    .replace("__EDITING_SAFETY_ENABLED__", String(!interact))
    .replace("__INTERACTION_MODE__", String(interact));
}

const PAGE = `<!doctype html><html><body style="margin:0">
  <button id="action" style="margin:40px;width:160px;height:60px">Go</button>
  <div style="height:3000px">a page taller than its frame</div>
</body></html>`;

interface Observed {
  wheels: boolean[];
  keydowns: { key: string; defaultPrevented: boolean }[];
  clicks: number;
  posted: { type: string }[];
}

async function openPage(page: Page, interact: boolean) {
  await page.setContent(PAGE);
  await page.evaluate(() => {
    const observed: Observed = {
      wheels: [],
      keydowns: [],
      clicks: 0,
      posted: [],
    };
    (window as unknown as { __observed: Observed }).__observed = observed;
    // Bubble phase and non-passive, as a page's own handler would be. A
    // bridge that takes a wheel stops it before it gets here.
    window.addEventListener(
      "wheel",
      (event) => observed.wheels.push(event.defaultPrevented),
      { passive: false },
    );
    window.addEventListener("keydown", (event) =>
      observed.keydowns.push({
        key: event.key,
        defaultPrevented: event.defaultPrevented,
      }),
    );
    document
      .getElementById("action")
      ?.addEventListener("click", () => (observed.clicks += 1));
    // With no host above the page, `parent` is the page itself, so what the
    // bridges post to the host arrives here.
    window.addEventListener("message", (event) => {
      const type = (event.data as { type?: string } | null)?.type;
      if (type) observed.posted.push({ type });
    });
  });
  await page.addScriptTag({ content: zoomBridgeScript });
  await page.addScriptTag({ content: gestureBridgeScript(interact) });
  // The host announces the mode on every load, as the pinch bridge learns it.
  await page.evaluate((interact) => {
    window.postMessage({ type: "set-interaction-mode", interact }, "*");
  }, interact);
  await page.waitForTimeout(50);
  await page.evaluate(() => {
    (window as unknown as { __observed: Observed }).__observed.posted = [];
  });
}

const observed = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __observed: Observed }).__observed,
  );

async function pinch(page: Page) {
  await page.mouse.move(200, 200);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -120);
  await page.keyboard.up("Control");
  await page.waitForTimeout(50);
}

async function withPage(run: (page: Page) => Promise<void>, interact: boolean) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await openPage(page, interact);
    await run(page);
  } finally {
    await browser.close();
  }
}

describe("the canvas bridges in Interact", () => {
  it(
    "leave a pinch, the wheel and Space to the page",
    { timeout: 30_000 },
    async () => {
      await withPage(async (page) => {
        await page.focus("#action");
        await page.keyboard.press("Space");
        await pinch(page);
        await page.mouse.wheel(0, 200);
        await page.waitForTimeout(50);

        const seen = await observed(page);
        expect(seen.wheels).toEqual([false, false]);
        expect(
          seen.keydowns.filter((keydown) => keydown.key === " "),
          "the page's own Space handlers see the key uncancelled",
        ).toEqual([{ key: " ", defaultPrevented: false }]);
        expect(
          seen.clicks,
          "Space activates the focused button as it does in any page",
        ).toBe(1);
        expect(seen.posted).toEqual([]);
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      }, true);
    },
  );

  it(
    "leave a middle-button drag and a Space-drag to the page",
    { timeout: 30_000 },
    async () => {
      await withPage(async (page) => {
        await page.evaluate(() => {
          // A page that handles Space itself, so the press does not scroll it.
          window.addEventListener("keydown", (event) => {
            if (event.key === " ") event.preventDefault();
          });
          window.postMessage(
            { type: "embedded-canvas-pan-mode", leftButtonEnabled: true },
            "*",
          );
        });
        await page.mouse.move(120, 70);
        await page.mouse.down({ button: "middle" });
        await page.mouse.move(150, 80, { steps: 3 });
        await page.mouse.up({ button: "middle" });
        await page.keyboard.down("Space");
        await page.mouse.down();
        await page.mouse.move(140, 80, { steps: 3 });
        await page.mouse.up();
        await page.keyboard.up("Space");
        await page.waitForTimeout(50);

        const seen = await observed(page);
        expect(
          seen.posted.filter(({ type }) => type.startsWith("embedded-canvas")),
          "only the host's own pan-mode message above, never a pan",
        ).toEqual([{ type: "embedded-canvas-pan-mode" }]);
        expect(seen.clicks, "a drag the page owns still clicks").toBe(1);
      }, true);
    },
  );

  it(
    "still take them in Design, so the checks above fail if the gate is removed",
    { timeout: 30_000 },
    async () => {
      await withPage(async (page) => {
        await pinch(page);
        const seen = await observed(page);
        expect(seen.wheels, "the bridge stops the pinch").toEqual([]);
        expect(seen.posted.map(({ type }) => type)).toContain(
          "embedded-canvas-wheel",
        );
      }, false);
    },
  );

  it("follow the mode the host switches to", { timeout: 30_000 }, async () => {
    await withPage(async (page) => {
      await page.evaluate(() =>
        window.postMessage(
          { type: "set-interaction-mode", interact: true },
          "*",
        ),
      );
      await page.waitForTimeout(50);
      await pinch(page);
      expect((await observed(page)).wheels).toEqual([false]);

      await page.evaluate(() =>
        window.postMessage(
          { type: "set-interaction-mode", interact: false },
          "*",
        ),
      );
      await page.waitForTimeout(50);
      await pinch(page);
      expect(
        (await observed(page)).wheels,
        "back in Design the second pinch is taken",
      ).toEqual([false]);
    }, false);
  });
});
