import { type Page } from "@playwright/test";

import { appPath } from "./helpers";
import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

const SCREEN_W = 1280;
const SCREEN_H = 900;
const LIVE_SCREEN =
  'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])';

test.use({ viewport: { width: 1600, height: 1000 } });

const SCREEN_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Snap guides</title></head>
  <body style="margin:0;min-height:${SCREEN_H}px;background:#0f1115;color:#fff">
    <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A"
         style="position:absolute;left:30px;top:280px;width:120px;height:80px;background:#3b82f6"></div>
    <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B"
         style="position:absolute;left:30px;top:440px;width:120px;height:80px;background:#22c55e"></div>
    <div data-agent-native-node-id="box-c" data-agent-native-layer-name="Box C"
         style="position:absolute;left:30px;top:620px;width:120px;height:80px;background:#f59e0b"></div>
  </body>
</html>`;

async function seedScreens(app: App, frames: { x: number; y: number }[]) {
  const files = Object.fromEntries(
    frames
      .slice(1)
      .map((_, index) => [`screen-${index + 2}.html`, SCREEN_HTML]),
  );
  const designId = await app.seed(SCREEN_HTML, {
    title: "Snap guides QA",
    files,
  });
  const record = await designRecord(app.page, designId);
  const fileIds = frames.map(
    (_, index) =>
      record.files.find(
        (file) =>
          file.filename ===
          (index === 0 ? "index.html" : `screen-${index + 1}.html`),
      )!.id,
  );
  const response = await app.page.request.post(
    appPath("/_agent-native/actions/update-design"),
    {
      data: {
        id: designId,
        dataOperations: fileIds.flatMap((fileId, index) => [
          {
            op: "set",
            path: ["screenMetadata", fileId],
            value: { sourceType: "inline", width: SCREEN_W, height: SCREEN_H },
          },
          {
            op: "set",
            path: ["canvasFrames", fileId],
            value: {
              x: frames[index]!.x,
              y: frames[index]!.y,
              width: SCREEN_W,
              height: SCREEN_H,
              z: index,
            },
          },
        ]),
      },
    },
  );
  expect(response.ok()).toBe(true);
  return { designId, fileIds };
}

async function designRecord(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    files: { id: string; filename: string }[];
    data: string;
  };
}

async function savedFrames(page: Page, designId: string) {
  const record = await designRecord(page, designId);
  return (
    JSON.parse(record.data) as {
      canvasFrames: Record<
        string,
        { x: number; y: number; width: number; height: number }
      >;
    }
  ).canvasFrames;
}

async function openOverview(page: Page, designId: string, screens: number) {
  await page.goto(appPath(`/design/${designId}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("[data-screen-shell]")).toHaveCount(screens, {
    timeout: 30_000,
  });
  await expect(page.locator("[data-screen-card]").first()).toBeVisible();
}

/** Selects a screen by its label, then Shift+1 and waits until the cards stop moving. */
async function selectScreenAndFit(page: Page, index: number) {
  await page.locator("[data-frame-label]").nth(index).click();
  await expect(page.locator("[data-frame-drag-surface]")).toBeVisible();
  const card = page.locator("[data-screen-card]").first();
  await page.keyboard.press("Shift+1");
  let previous = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await card.boundingBox());
        const stable = now === previous;
        previous = now;
        return stable;
      },
      { intervals: [150], timeout: 10_000 },
    )
    .toBe(true);
  return (await card.boundingBox())!.width / SCREEN_W;
}

async function dragSurfaceCentre(page: Page) {
  const box = (await page.locator("[data-frame-drag-surface]").boundingBox())!;
  const view = page.viewportSize()!;
  return {
    x: (Math.max(box.x, 0) + Math.min(box.x + box.width, view.width)) / 2,
    y: (Math.max(box.y, 0) + Math.min(box.y + box.height, view.height)) / 2,
  };
}

async function canvasGuides(page: Page, kind: "alignment" | "spacing") {
  return page.evaluate((selector) => {
    return Array.from(document.querySelectorAll<HTMLElement>(selector)).map(
      (node) => {
        const rect = node.getBoundingClientRect();
        const painted = node.children[0] ?? node;
        return {
          width: rect.width,
          height: rect.height,
          paint: getComputedStyle(painted).backgroundColor,
        };
      },
    );
  }, `[data-canvas-guide="${kind}"]`);
}

function isPainted(paint: string): boolean {
  return paint !== "" && !/rgba\(0, 0, 0, 0\)|transparent/.test(paint);
}

test("dragging a screen into line draws a guide through every screen it aligns with", async ({
  app,
  page,
}) => {
  const { designId, fileIds } = await seedScreens(app, [
    { x: 0, y: 0 },
    { x: 0, y: 1200 },
    { x: 2600, y: 2400 },
  ]);
  await openOverview(page, designId, 3);
  const scale = await selectScreenAndFit(page, 2);
  const start = await dragSurfaceCentre(page);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 2600 * scale, start.y, { steps: 24 });
  await expect
    .poll(
      async () =>
        (await canvasGuides(page, "alignment")).filter(
          (box) => box.height > box.width,
        ).length,
    )
    .toBe(3);
  const verticalGuides = (await canvasGuides(page, "alignment")).filter(
    (box) => box.height > box.width,
  );
  expect(verticalGuides.map((box) => isPainted(box.paint))).toEqual([
    true,
    true,
    true,
  ]);
  expect(Math.min(...verticalGuides.map((box) => box.height))).toBeGreaterThan(
    3000 * scale,
  );
  expect((await savedFrames(page, designId))[fileIds[2]!]).toMatchObject({
    x: 2600,
    y: 2400,
  });
  await page.mouse.up();
  await app.settled();

  const frames = await savedFrames(page, designId);
  expect(frames[fileIds[2]!]).toMatchObject({
    x: 0,
    y: 2400,
    width: SCREEN_W,
    height: SCREEN_H,
  });
  expect(frames[fileIds[0]!]).toMatchObject({ x: 0, y: 0 });
  expect(frames[fileIds[1]!]).toMatchObject({ x: 0, y: 1200 });
});

test("dragging a screen near an existing gap snaps the spacing to match it", async ({
  app,
  page,
}) => {
  const { designId, fileIds } = await seedScreens(app, [
    { x: 0, y: 0 },
    { x: 1600, y: 0 },
    { x: 3400, y: 0 },
  ]);
  await openOverview(page, designId, 3);
  const scale = await selectScreenAndFit(page, 2);
  const start = await dragSurfaceCentre(page);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 196 * scale, start.y, { steps: 20 });
  await expect
    .poll(async () => (await canvasGuides(page, "spacing")).length)
    .toBe(2);
  const marks = await canvasGuides(page, "spacing");
  expect(marks.map((mark) => isPainted(mark.paint))).toEqual([true, true]);
  await page.mouse.up();
  await app.settled();

  const frames = await savedFrames(page, designId);
  expect(frames[fileIds[2]!]).toMatchObject({
    x: 3200,
    y: 0,
    width: SCREEN_W,
    height: SCREEN_H,
  });
  expect(frames[fileIds[0]!]).toMatchObject({ x: 0, y: 0 });
  expect(frames[fileIds[1]!]).toMatchObject({ x: 1600, y: 0 });
});

/** The snap-guide, constraint and size overlays inside the live screen while a drag is held. */
async function heldOverlays(page: Page) {
  return page
    .frameLocator(LIVE_SCREEN)
    .locator("body")
    .evaluate(() => {
      const layer = document.querySelector<HTMLElement>(
        '[data-agent-native-edit-overlay="snap-guide"]',
      );
      const children =
        layer && layer.style.display !== "none"
          ? Array.from(layer.children)
          : [];
      const lines = children
        .filter((child) => !(child.textContent ?? "").trim())
        .map((child) => {
          const rect = child.getBoundingClientRect();
          return {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            paint: getComputedStyle(child).backgroundColor,
          };
        });
      const constraints = document.querySelector<HTMLElement>(
        '[data-agent-native-edit-overlay="constraint-guide"]',
      );
      const sizeBadge = document.querySelector<HTMLElement>(
        '[data-agent-native-edit-overlay="size-badge"]',
      );
      return {
        verticalLines: lines
          .filter((line) => line.height > 100 && line.height > line.width)
          .map((line) => line.x)
          .sort((a, b) => a - b),
        paints: [...new Set(lines.map((line) => line.paint))],
        labels: children
          .map((child) => (child.textContent ?? "").trim())
          .filter(Boolean),
        constraintLines:
          constraints && constraints.style.display !== "none"
            ? constraints.children.length
            : 0,
        sizeBadge:
          sizeBadge && sizeBadge.style.display !== "none"
            ? (sizeBadge.textContent ?? "")
            : "",
      };
    });
}

/** Selects Box A on the canvas and starts a real drag of it by (dx, dy) design px in ~3px steps; the caller releases. */
async function holdBoxADraggedBy(app: App, dx: number, dy: number) {
  const box = await app.designRect("box-a");
  const grab = await app.pagePoint(
    box.x + box.width / 2,
    box.y + box.height / 2,
  );
  await app.page.mouse.click(grab.x, grab.y);
  await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
  const to = await app.pagePoint(
    box.x + box.width / 2 + dx,
    box.y + box.height / 2 + dy,
  );
  await app.page.mouse.move(grab.x, grab.y);
  await app.page.mouse.down();
  await app.page.mouse.move(to.x, to.y, {
    steps: Math.ceil(Math.hypot(to.x - grab.x, to.y - grab.y) / 3),
  });
}

test("dragging an element inside a screen lights up every edge it lines up with", async ({
  app,
  page,
}) => {
  const id = await app.seed(SCREEN_HTML);
  await app.open(id);
  await app.zoomToFit();
  const before = await app.savedNodes(id);

  await holdBoxADraggedBy(app, 0, 32);
  await expect
    .poll(async () => (await heldOverlays(page)).verticalLines)
    .toEqual([30, 90, 150]);
  const held = await heldOverlays(page);
  expect(held.paints.map(isPainted)).toEqual([true]);
  expect(await app.savedNodes(id)).toEqual(before);
  await page.mouse.up();
  await app.settled();

  const after = await app.savedNodes(id);
  expect(styleOf(after.get("box-a")).left).toBe("30px");
  expectOnlyChanged(before, after, ["box-a"]);
});

test("dragging an element near an existing gap snaps to the matching 100px gap, labels it and saves it", async ({
  app,
  page,
}) => {
  const id = await app.seed(SCREEN_HTML);
  await app.open(id);
  await app.zoomToFit();
  const before = await app.savedNodes(id);

  await holdBoxADraggedBy(app, 0, -19);
  await expect
    .poll(async () => (await heldOverlays(page)).labels)
    .toContain("100");
  expect(await app.savedNodes(id)).toEqual(before);
  await page.mouse.up();
  await app.settled();

  const after = await app.savedNodes(id);
  expect(styleOf(after.get("box-a"))).toEqual({
    ...styleOf(before.get("box-a")),
    top: "260px",
  });
  expectOnlyChanged(before, after, ["box-a"]);
  expect(await app.designRect("box-a")).toEqual({
    x: 30,
    y: 260,
    width: 120,
    height: 80,
  });
});

test("dragging an element shows its constraint lines and pixel size", async ({
  app,
  page,
}) => {
  const id = await app.seed(SCREEN_HTML);
  await app.open(id);
  await app.zoomToFit();

  await holdBoxADraggedBy(app, 0, 32);
  await expect
    .poll(async () => {
      const held = await heldOverlays(page);
      return {
        sizeBadge: held.sizeBadge,
        constraintLines: held.constraintLines,
      };
    })
    .toEqual({ sizeBadge: "120 × 80", constraintLines: 2 });
  await page.mouse.up();
});

test("a lone element far from anything stays quiet", async ({ app, page }) => {
  const id = await app.seed(SCREEN_HTML);
  await app.open(id);
  await app.zoomToFit();
  const before = await app.savedNodes(id);

  await holdBoxADraggedBy(app, 0, -240);
  await expect
    .poll(async () => (await app.designRect("box-a")).y)
    .toBeLessThan(60);
  expect((await heldOverlays(page)).labels).toEqual([]);
  await page.mouse.up();
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), ["box-a"]);
});
