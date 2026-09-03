import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { appPath } from "./helpers";

/**
 * Cmd/Ctrl+wheel over a screen, in a real browser, with real trusted wheel
 * events. Both halves of the report need that: the gesture has to survive the
 * iframe bridge at all, and a mouse notch has to move zoom by a notch-sized
 * step rather than the trackpad curve's ~1.65x.
 */

const BASE_URL =
  process.env.E2E_BASE_URL ??
  `http://127.0.0.1:${process.env.E2E_PORT ?? "9333"}`;

const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Wheel zoom</title></head>
<body style="margin:0;min-height:900px;background:#101418;color:#fff">
<main data-agent-native-node-id="main" style="position:relative;min-height:900px">
  <h1 data-agent-native-node-id="hero" style="position:absolute;left:40px;top:48px">Hero</h1>
</main></body></html>`;

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${BASE_URL}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(request: APIRequestContext) {
  const created = await action(request, "create-design", {
    title: `Wheel zoom QA ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const file = await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: SCREEN_HTML,
    fileType: "html",
  });
  const fileId = file.id ?? file.data?.id;
  if (!fileId) throw new Error("create-file returned no id");
  await action(request, "update-design", {
    id: designId,
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
  });
  return { designId, fileId };
}

/** The scale the world layer is actually painted at. */
async function worldScale(page: Page) {
  return page.evaluate(() => {
    const world = document.querySelector<HTMLElement>(
      "[data-multi-screen-canvas-world]",
    );
    if (!world) return null;
    const transform = getComputedStyle(world).transform;
    if (!transform || transform === "none") return 1;
    return new DOMMatrixReadOnly(transform).a;
  });
}

async function openOverview(page: Page, designId: string) {
  await page.goto(appPath(`/design/${designId}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  await expect
    .poll(async () => page.locator("[data-screen-shell]").count(), {
      timeout: 40_000,
    })
    .toBeGreaterThan(0);
  // The gesture bridge is injected with the screen document; give it the same
  // settle the other overview specs use before driving input.
  await page.waitForTimeout(2500);
}

/** Centre of the live screen preview — the pointer must be over iframe
 *  content, which is where the gesture was being swallowed. */
async function screenContentPoint(page: Page) {
  const box = await page.locator("[data-screen-card]").first().boundingBox();
  if (!box) throw new Error("no screen card rendered");
  return {
    x: box.x + Math.min(box.width, 400) / 2,
    y: box.y + Math.min(box.height, 400) / 2,
  };
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("Ctrl+wheel over screen content zooms the canvas", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  try {
    await openOverview(page, designId);
    const before = await worldScale(page);
    expect(before).not.toBeNull();

    const point = await screenContentPoint(page);
    await page.mouse.move(point.x, point.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await page.waitForTimeout(600);

    const after = await worldScale(page);
    expect(after).not.toBeNull();
    expect(after!).toBeGreaterThan(before!);
    expect(pageErrors).toEqual([]);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("one mouse notch moves zoom by a notch-sized step, not the pinch curve", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  try {
    await openOverview(page, designId);
    const before = await worldScale(page);

    // 66.7 is what a Windows notch reports at fractional display scaling, and
    // the shape macOS sends for an accelerated wheel. Read as a pinch it
    // multiplies zoom by ~1.65 per detent.
    const point = await screenContentPoint(page);
    await page.mouse.move(point.x, point.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -66.7);
    await page.keyboard.up("Control");
    await page.waitForTimeout(600);

    const after = await worldScale(page);
    const ratio = after! / before!;
    expect(ratio).toBeGreaterThan(1);
    expect(ratio).toBeLessThan(1.2);
    expect(ratio).toBeCloseTo(Math.pow(1.1, 66.7 / 100), 2);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("a wheel burst over screen content does not log a scroll Intervention", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  const interventions: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/intervention/i.test(text)) interventions.push(text);
  });
  try {
    await openOverview(page, designId);
    const point = await screenContentPoint(page);
    await page.mouse.move(point.x, point.y);
    for (let i = 0; i < 12; i += 1) await page.mouse.wheel(0, 60);
    await page.keyboard.down("Control");
    for (let i = 0; i < 12; i += 1) await page.mouse.wheel(0, -60);
    await page.keyboard.up("Control");
    await page.waitForTimeout(600);

    expect(interventions).toEqual([]);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
