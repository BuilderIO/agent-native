import { type Page } from "@playwright/test";

import { appPath } from "./helpers";
import { expect, test, type App } from "./rails";

const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Wheel zoom</title></head>
<body style="margin:0;min-height:900px;background:#101418;color:#fff">
<main data-agent-native-node-id="main" style="position:relative;min-height:900px">
  <h1 data-agent-native-node-id="hero" style="position:absolute;left:40px;top:48px">Hero</h1>
</main></body></html>`;

test.use({ viewport: { width: 1600, height: 1000 } });

async function openScreenAtOrigin(app: App) {
  const id = await app.seed(SCREEN_HTML);
  const { files } = await app.savedRecord(id);
  const fileId = files.find((file) => file.filename === "index.html")!.id;
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
  await app.open(id);
  await settledCamera(app.page);
}

async function worldScale(page: Page) {
  return page.evaluate(() => {
    const world = document.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-world]",
    )!;
    const transform = getComputedStyle(world).transform;
    return transform === "none" ? 1 : new DOMMatrixReadOnly(transform).a;
  });
}

async function cardBox(page: Page) {
  return (await page.locator("[data-screen-card]").first().boundingBox())!;
}

/** Waits until the canvas transform and the screen card stop changing, then returns both. */
async function settledCamera(page: Page) {
  let previous = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify([
          await worldScale(page),
          await cardBox(page),
        ]);
        const stable = now === previous;
        previous = now;
        return stable;
      },
      { intervals: [150], message: "the canvas never stopped moving" },
    )
    .toBe(true);
  return { scale: await worldScale(page), card: await cardBox(page) };
}

async function pointOverScreen(page: Page) {
  const box = await cardBox(page);
  return {
    x: Math.round(box.x + Math.min(box.width, 400) / 2),
    y: Math.round(box.y + Math.min(box.height, 400) / 2),
  };
}

async function ctrlWheel(page: Page, deltaY: number) {
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, deltaY);
  await page.keyboard.up("Control");
}

test("Ctrl+wheel over screen content zooms the canvas about the cursor", async ({
  app,
}) => {
  const page = app.page;
  await openScreenAtOrigin(app);
  const before = await settledCamera(page);
  const cursor = await pointOverScreen(page);
  await page.mouse.move(cursor.x, cursor.y);

  await ctrlWheel(page, -100);

  await expect.poll(() => worldScale(page)).not.toBe(before.scale);
  const after = await settledCamera(page);
  expect(after.scale / before.scale).toBeCloseTo(1.1, 3);
  const anchoredX = cursor.x - (cursor.x - before.card.x) * 1.1;
  const anchoredY = cursor.y - (cursor.y - before.card.y) * 1.1;
  expect(
    Math.abs(after.card.x - anchoredX),
    `card x ${after.card.x}, anchored at ${anchoredX}`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(after.card.y - anchoredY),
    `card y ${after.card.y}, anchored at ${anchoredY}`,
  ).toBeLessThanOrEqual(1);
});

test("one mouse notch moves zoom by a notch-sized step, not the pinch curve", async ({
  app,
}) => {
  const page = app.page;
  await openScreenAtOrigin(app);
  const before = await settledCamera(page);
  const cursor = await pointOverScreen(page);
  await page.mouse.move(cursor.x, cursor.y);

  await ctrlWheel(page, -66.7);

  await expect.poll(() => worldScale(page)).not.toBe(before.scale);
  const after = await settledCamera(page);
  expect(after.scale / before.scale).toBeCloseTo(Math.pow(1.1, 66.7 / 100), 2);
});

test("a wheel burst over screen content does not log a scroll Intervention", async ({
  app,
}) => {
  const page = app.page;
  const interventions: string[] = [];
  page.on("console", (message) => {
    if (message.text().toLowerCase().includes("intervention"))
      interventions.push(message.text());
  });
  await openScreenAtOrigin(app);
  const before = await settledCamera(page);
  const cursor = await pointOverScreen(page);
  await page.mouse.move(cursor.x, cursor.y);

  for (let notch = 0; notch < 12; notch += 1) await page.mouse.wheel(0, 60);
  await expect
    .poll(async () => Math.round((await cardBox(page)).y))
    .toBe(Math.round(before.card.y - 720));
  const panned = await settledCamera(page);
  expect(panned.scale, "a plain wheel pans without zooming").toBe(before.scale);
  expect(panned.card.x).toBe(before.card.x);
  await page.keyboard.down("Control");
  for (let notch = 0; notch < 12; notch += 1) await page.mouse.wheel(0, -60);
  await page.keyboard.up("Control");
  await expect.poll(() => worldScale(page)).not.toBe(before.scale);
  const zoomed = await settledCamera(page);

  expect(zoomed.scale / before.scale).toBeCloseTo(
    Math.pow(1.1, (12 * 60) / 100),
    2,
  );
  expect(interventions).toEqual([]);
});

test("the zoom percentage input updates the overview canvas scale", async ({
  app,
}) => {
  const page = app.page;
  await openScreenAtOrigin(app);
  const zoomControl = page.getByRole("button", { name: /^\d+%$/ }).first();
  await zoomControl.click();
  const zoomInput = page.getByRole("textbox", { name: "Zoom percentage" });
  await zoomInput.fill("25%");
  await zoomInput.press("Enter");

  await expect(zoomControl).toHaveText("25%");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("zoom"))
    .toBe("25");
  await expect.poll(() => worldScale(page)).toBe(0.25);
});

test("clearing the zoom percentage keeps the current overview scale", async ({
  app,
}) => {
  const page = app.page;
  await openScreenAtOrigin(app);
  const before = await settledCamera(page);
  const beforeZoomQuery = new URL(page.url()).searchParams.get("zoom");
  const zoomControl = page.getByRole("button", { name: /^\d+%$/ }).first();
  await zoomControl.click();
  const zoomInput = page.getByRole("textbox", { name: "Zoom percentage" });
  await zoomInput.fill("");
  await zoomInput.press("Enter");

  await expect(zoomInput).toHaveValue(String(Math.round(before.scale * 100)));
  await expect
    .poll(() => new URL(page.url()).searchParams.get("zoom"))
    .toBe(beforeZoomQuery);
  expect((await settledCamera(page)).scale).toBe(before.scale);
});
