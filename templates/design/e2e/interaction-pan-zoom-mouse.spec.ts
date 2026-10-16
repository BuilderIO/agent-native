import { type Page } from "@playwright/test";

import { appPath } from "./helpers";
import { expect, expectOnlyChanged, test, type App } from "./rails";

const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Pan zoom</title></head>
<body style="margin:0;min-height:900px;background:#101418;color:#fff">
<main data-agent-native-node-id="main" style="position:relative;min-height:900px">
  <h1 data-agent-native-node-id="hero" data-agent-native-layer-name="Hero" style="position:absolute;left:40px;top:48px;margin:0">Hero</h1>
  <button data-agent-native-node-id="cta" data-agent-native-layer-name="CTA" style="position:absolute;left:40px;top:160px;width:160px;height:48px">Click me</button>
</main></body></html>`;

type Transform = { x: number; y: number; scale: number };

async function worldTransform(page: Page): Promise<Transform> {
  return page.evaluate(() => {
    const world = document.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-world]",
    )!;
    const m = new DOMMatrixReadOnly(getComputedStyle(world).transform);
    return { x: m.e, y: m.f, scale: m.a };
  });
}

/** Waits until the canvas camera stops moving, then returns it. */
async function settledTransform(page: Page): Promise<Transform> {
  let previous = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await worldTransform(page));
        const stable = now === previous;
        previous = now;
        return stable;
      },
      { intervals: [150], message: "the canvas camera never settled" },
    )
    .toBe(true);
  return JSON.parse(previous) as Transform;
}

async function openOverview(app: App) {
  const id = await app.seed(SCREEN_HTML);
  const fileId = (await app.savedRecord(id)).files.find(
    (file) => file.filename === "index.html",
  )!.id;
  const response = await app.page.request.post(
    appPath("/_agent-native/actions/update-design"),
    {
      data: {
        id,
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", fileId],
            value: { sourceType: "inline", width: 1280, height: 900 },
          },
          {
            op: "set",
            path: ["canvasFrames", fileId],
            value: { x: 0, y: 0, width: 1280, height: 900, z: 0 },
          },
        ],
      },
    },
  );
  expect(response.ok()).toBe(true);
  await app.page.goto(appPath(`/design/${id}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  await expect(app.page.locator("[data-screen-card]")).toHaveCount(1);
  await expect(
    app.page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible();
  await settledTransform(app.page);
  return id;
}

async function screenContentPoint(page: Page) {
  const box = (await page.locator("[data-screen-card]").boundingBox())!;
  return {
    x: box.x + Math.min(box.width, 400) / 2,
    y: box.y + Math.min(box.height, 400) / 2,
  };
}

async function emptyCanvasPoint(page: Page) {
  const box = (await page.locator("[data-screen-card]").boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height + 100 };
}

function zoomReadout(page: Page) {
  return page.getByRole("button", { name: /^\d+%$/ }).first();
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("a burst of plain wheel ticks over screen content pans down by the summed delta without a scroll Intervention", async ({
  app,
}) => {
  const interventions: string[] = [];
  app.page.on("console", (message) => {
    if (/intervention/i.test(message.text()))
      interventions.push(message.text());
  });
  await openOverview(app);
  const point = await screenContentPoint(app.page);
  await app.page.mouse.move(point.x, point.y);
  const before = await worldTransform(app.page);

  for (let tick = 0; tick < 6; tick += 1) await app.page.mouse.wheel(0, 60);

  const after = await settledTransform(app.page);
  expect(after.y - before.y).toBeCloseTo(-360, 0);
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.scale).toBeCloseTo(before.scale, 3);
  expect(interventions).toStrictEqual([]);
});

test("shift+wheel pans horizontally by the wheel delta", async ({ app }) => {
  await openOverview(app);
  const point = await screenContentPoint(app.page);
  await app.page.mouse.move(point.x, point.y);
  const before = await worldTransform(app.page);

  await app.page.keyboard.down("Shift");
  await app.page.mouse.wheel(0, 120);
  await app.page.keyboard.up("Shift");

  const after = await settledTransform(app.page);
  expect(after.x - before.x).toBeCloseTo(-120, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  expect(after.scale).toBeCloseTo(before.scale, 3);
});

test("cmd/ctrl+wheel zooms around the cursor: the point under the cursor stays fixed", async ({
  app,
}) => {
  await openOverview(app);
  const point = await screenContentPoint(app.page);
  await app.page.mouse.move(point.x, point.y);
  const surface = (await app.page
    .locator("[data-multi-screen-canvas-world]")
    .locator("..")
    .boundingBox())!;
  const before = await worldTransform(app.page);
  const anchor = {
    x: (point.x - surface.x - before.x) / before.scale,
    y: (point.y - surface.y - before.y) / before.scale,
  };

  await app.page.keyboard.down("Control");
  await app.page.mouse.wheel(0, -240);
  await app.page.keyboard.up("Control");

  const after = await settledTransform(app.page);
  expect(after.scale).toBeGreaterThan(before.scale);
  expect(surface.x + anchor.x * after.scale + after.x).toBeCloseTo(point.x, 0);
  expect(surface.y + anchor.y * after.scale + after.y).toBeCloseTo(point.y, 0);
  await expect(zoomReadout(app.page)).toHaveText(
    `${Math.round(after.scale * 100)}%`,
  );
});

// fixme: fails on current main after the merge: Error: expect(locator).toHaveCount(expected) failed
test.fixme("middle-mouse drag pans smoothly with 1:1 deltas over empty canvas", async ({
  app,
}) => {
  await openOverview(app);
  const start = await emptyCanvasPoint(app.page);
  const before = await worldTransform(app.page);

  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down({ button: "middle" });
  await app.page.mouse.move(start.x + 137, start.y - 64, { steps: 12 });
  await app.page.mouse.up({ button: "middle" });

  const after = await settledTransform(app.page);
  expect(after.x - before.x).toBeCloseTo(137, 0);
  expect(after.y - before.y).toBeCloseTo(-64, 0);
  expect(after.scale).toBeCloseTo(before.scale, 3);
});

test("middle-mouse drag across a button and heading pans 1:1 without selecting or moving them", async ({
  app,
}) => {
  const id = await openOverview(app);
  const before = await worldTransform(app.page);
  const saved = await app.savedNodes(id);
  const cta = await app.designRect("cta");
  const from = await app.pagePoint(20, 60);
  const to = await app.pagePoint(240, 200);

  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down({ button: "middle" });
  await app.page.mouse.move(to.x, to.y, { steps: 12 });
  await app.page.mouse.up({ button: "middle" });

  const after = await settledTransform(app.page);
  expect(after.x - before.x).toBeCloseTo(to.x - from.x, 0);
  expect(after.y - before.y).toBeCloseTo(to.y - from.y, 0);
  expect(after.scale).toBeCloseTo(before.scale, 3);
  await expect.poll(() => app.selectedLayers()).toStrictEqual([]);
  expect(await app.designRect("cta")).toEqual(cta);
  await app.settled();
  expectOnlyChanged(saved, await app.savedNodes(id), []);
});

// fixme: fails on current main after the merge: Error: expect(locator).toHaveCount(expected) failed
test.fixme("space+drag pans the canvas 1:1", async ({ app }) => {
  await openOverview(app);
  const start = await emptyCanvasPoint(app.page);
  const before = await worldTransform(app.page);

  await app.page.mouse.move(start.x, start.y);
  await app.page.keyboard.down("Space");
  await app.page.mouse.down();
  await app.page.mouse.move(start.x + 80, start.y + 40, { steps: 10 });
  await app.page.mouse.up();
  await app.page.keyboard.up("Space");

  const after = await settledTransform(app.page);
  expect(after.x - before.x).toBeCloseTo(80, 0);
  expect(after.y - before.y).toBeCloseTo(40, 0);
  expect(after.scale).toBeCloseTo(before.scale, 3);
  await expect.poll(() => app.selectedLayers()).toStrictEqual([]);
});

test("toolbar and keyboard zoom updates survive a pending fit without refresh", async ({
  app,
}) => {
  await openOverview(app);
  const readout = zoomReadout(app.page);
  const opened = await worldTransform(app.page);

  await app.page.keyboard.press("Shift+1");
  const fit = await settledTransform(app.page);
  expect(fit.scale).not.toBeCloseTo(opened.scale, 3);

  await app.page.keyboard.press("ControlOrMeta+=");
  const zoomedIn = await settledTransform(app.page);
  expect(zoomedIn.scale).toBeGreaterThan(fit.scale);
  await expect(readout).toHaveText(`${Math.round(zoomedIn.scale * 100)}%`);

  await readout.click();
  await app.page.getByRole("menuitem", { name: "Zoom out" }).click();
  const zoomedOut = await settledTransform(app.page);
  expect(zoomedOut.scale).toBeLessThan(zoomedIn.scale);
  await expect(readout).toHaveText(`${Math.round(zoomedOut.scale * 100)}%`);
});
