import { appPath, selectTool } from "./helpers";
import { expect, test } from "./rails";

test("canvas stays drawable while the first screen is generating", async ({
  app,
  page,
}) => {
  const created = await page.request.post(
    appPath("/_agent-native/actions/create-design"),
    {
      data: {
        title: "generation-keeps-canvas-live",
        projectType: "prototype",
      },
    },
  );
  expect(created.ok()).toBe(true);
  const { id: designId } = (await created.json()) as { id: string };
  app.adopt(designId);
  app.allowFailure(
    new RegExp(`unexpected page load: .*/design/${designId}`),
    "the generation marker is seeded before the first load",
  );

  await page.addInitScript((id) => {
    if (window !== window.top) return;
    const key = `design.pending-generation.${id}`;
    if (sessionStorage.getItem(key)) return;
    const now = Date.now();
    sessionStorage.setItem(
      key,
      JSON.stringify({
        prompt: "a coffee shop landing page",
        createdAt: now,
        startedAt: now,
        runTabId: "e2e-run-tab",
        attempt: 1,
      }),
    );
  }, designId);
  await page.goto(appPath(`/design/${designId}`), {
    waitUntil: "domcontentloaded",
  });

  const canvas = page.locator("[data-design-canvas-container]");
  await expect(canvas).toBeVisible();
  await expect(page.locator("[data-generating-screen-ghost]")).toBeVisible();

  const box = (await canvas.boundingBox())!;
  const ghostTracksCanvas = () =>
    page.evaluate(() => {
      const ghost = document
        .querySelector("[data-generating-screen-ghost]")!
        .getBoundingClientRect();
      const world = document.querySelector("[data-multi-screen-canvas-world]")!;
      const origin = world.getBoundingClientRect();
      const camera = new DOMMatrix(getComputedStyle(world).transform);
      return {
        scale: camera.a,
        panX: camera.e,
        panY: camera.f,
        offsetX: ghost.x - origin.x - 240 * camera.a,
        offsetY: ghost.y - origin.y - (240 - 24) * camera.a,
        width: ghost.width - 1440 * camera.a,
      };
    });
  const resting = await ghostTracksCanvas();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45);
  await page.mouse.wheel(60, 90);
  await page.waitForTimeout(40);
  const mid = await ghostTracksCanvas();
  expect(
    Math.abs(mid.panX - resting.panX) + Math.abs(mid.panY - resting.panY),
    "the wheel moved the camera",
  ).toBeGreaterThan(5);
  expect(Math.abs(mid.offsetX)).toBeLessThan(1.5);
  expect(Math.abs(mid.offsetY)).toBeLessThan(1.5);
  expect(Math.abs(mid.width)).toBeLessThan(1.5);

  await selectTool(page, "Rectangle");
  const from = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.45 };
  await page.waitForTimeout(250);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 120, from.y + 90, { steps: 12 });
  await page.waitForTimeout(300);
  await page.mouse.up();

  const rectangleLayer = page.getByText("Rectangle", { exact: true }).first();
  await expect(rectangleLayer).toBeVisible();
  await expect(page.locator("[data-generating-screen-ghost]")).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Layers", exact: true }).click();
  await expect(rectangleLayer).toBeVisible();
});
