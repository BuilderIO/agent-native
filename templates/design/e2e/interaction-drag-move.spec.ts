import { type Page } from "@playwright/test";

import { appPath } from "./helpers";
import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

test.use({ viewport: { width: 1600, height: 1000 } });

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const LIVE_SCREEN =
  'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])';

const SHAPES = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Move</title></head>
  <body data-agent-native-node-id="page" style="margin:0;min-height:900px;background:#0f1115">
    <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A" data-an-primitive="rectangle"
         style="position:absolute;left:100px;top:100px;width:120px;height:80px;background:#3b82f6"></div>
    <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B" data-an-primitive="rectangle"
         style="position:absolute;left:400px;top:300px;width:120px;height:80px;background:#22c55e"></div>
  </body>
</html>`;

const SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Board move</title></head>
  <body style="margin:0;min-height:900px;background:#0f1115"></body>
</html>`;

async function openShapes(app: App) {
  const id = await app.seed(SHAPES);
  await app.open(id);
  await app.zoomToFit();
  return id;
}

async function clickCentre(app: App, nodeId: string) {
  const rect = await app.designRect(nodeId);
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(point.x, point.y);
  return point;
}

/** Presses a node's centre, drags by a design-px delta and returns its rendered box while still held. */
async function pressAndDrag(app: App, nodeId: string, dx: number, dy: number) {
  const resting = await app.designRect(nodeId);
  const from = await app.pagePoint(
    resting.x + resting.width / 2,
    resting.y + resting.height / 2,
  );
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(
    from.x + dx * from.scale,
    from.y + dy * from.scale,
    {
      steps: 16,
    },
  );
  await expect
    .poll(() => app.designRect(nodeId), {
      message: `precondition: ${nodeId} follows the pointer`,
    })
    .not.toEqual(resting);
  return app.designRect(nodeId);
}

/** Visible snap guides and measurements inside the live screen. */
function guideCount(page: Page) {
  return page
    .frameLocator(LIVE_SCREEN)
    .locator("body")
    .evaluate(
      () =>
        Array.from(
          document.querySelectorAll("[data-agent-native-edit-overlay]"),
        ).filter((element) => {
          const kind =
            element.getAttribute("data-agent-native-edit-overlay") ?? "";
          const rect = element.getBoundingClientRect();
          return (
            /snap-guide|measurement/.test(kind) &&
            (rect.width > 0 || rect.height > 0)
          );
        }).length,
    );
}

type Frame = { x: number; y: number; width: number; height: number };

async function designRecord(app: App, id: string) {
  const response = await app.page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${id}`),
  );
  expect(response.ok(), `get-design ${response.status()}`).toBe(true);
  const record = await response.json();
  const fileIds: Record<string, string> = Object.fromEntries(
    record.files.map((file: { filename: string; id: string }) => [
      file.filename,
      file.id,
    ]),
  );
  const data =
    typeof record.data === "string" ? JSON.parse(record.data) : record.data;
  return { data, fileIds };
}

async function savedFrames(app: App, id: string) {
  const { data, fileIds } = await designRecord(app, id);
  return {
    first: data.canvasFrames[fileIds["index.html"]] as Frame,
    second: data.canvasFrames[fileIds["screen-2.html"]] as Frame,
  };
}

/** Two 1280x900 screens far apart on the board, the second selected by its name label. */
async function selectSecondScreen(app: App) {
  const id = await app.seed(SCREEN, { files: { "screen-2.html": SCREEN } });
  const { fileIds: files } = await designRecord(app, id);
  const placed = await app.page.request.post(
    appPath("/_agent-native/actions/update-design"),
    {
      data: {
        id,
        dataOperations: [
          [files["index.html"], 0],
          [files["screen-2.html"], 3000],
        ].flatMap(([fileId, at], z) => [
          {
            op: "set",
            path: ["screenMetadata", fileId],
            value: { sourceType: "inline", width: 1280, height: 900 },
          },
          {
            op: "set",
            path: ["canvasFrames", fileId],
            value: { x: at, y: at, width: 1280, height: 900, z },
          },
        ]),
      },
    },
  );
  expect(placed.ok(), `update-design ${placed.status()}`).toBe(true);
  await app.page.goto(appPath(`/design/${id}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  await expect(app.page.locator("[data-screen-shell]")).toHaveCount(2, {
    timeout: 30_000,
  });
  await app.page.locator("[data-frame-label]").nth(1).click();
  const surface = app.page.locator("[data-frame-drag-surface]");
  await expect(surface).toBeVisible();
  const card = app.page.locator("[data-screen-card]").nth(1);
  let previous = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await card.boundingBox());
        const stable = now === previous;
        previous = now;
        return stable;
      },
      { intervals: [150], message: "the camera never settled on the screen" },
    )
    .toBe(true);
  await app.settled();
  const before = await savedFrames(app, id);
  const box = (await surface.boundingBox())!;
  const view = app.page.viewportSize()!;
  const start = {
    x: (Math.max(box.x, 0) + Math.min(box.x + box.width, view.width)) / 2,
    y: (Math.max(box.y, 0) + Math.min(box.y + box.height, view.height)) / 2,
  };
  const scale = (await card.boundingBox())!.width / 1280;
  return { id, before, start, scale };
}

test.describe("in-screen moves", () => {
  test("in-screen drag: a delayed cancel for gesture A does not cancel gesture B once B has started", async ({
    app,
    page,
  }) => {
    const id = await openShapes(app);
    const start = await app.savedNodes(id);
    await clickCentre(app, "box-a");
    await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
    const heldA = await pressAndDrag(app, "box-a", 200, 100);
    const stalePressedAt = await page.evaluate(() => Date.now());
    await page.mouse.up();
    await app.settled();
    const afterA = await app.savedNodes(id);
    expect(styleOf(afterA.get("box-a")), "precondition: A committed").toEqual({
      ...styleOf(start.get("box-a")),
      left: `${heldA.x}px`,
      top: `${heldA.y}px`,
    });

    await clickCentre(app, "box-b");
    await expect.poll(() => app.selectedLayers()).toEqual(["Box B"]);
    const heldB = await pressAndDrag(app, "box-b", 200, 100);
    await page.evaluate((pressedAt) => {
      document
        .querySelectorAll<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        )
        .forEach((iframe) => {
          iframe.contentWindow?.postMessage(
            { type: "agent-native:cancel-active-drag", pressedAt },
            "*",
          );
        });
    }, stalePressedAt);
    await expect
      .poll(() => app.designRect("box-b"), {
        message: "A's stale cancel must not snap B back mid-drag",
      })
      .toEqual(heldB);
    await page.mouse.up();
    await app.settled();

    const end = await app.savedNodes(id);
    expect(styleOf(end.get("box-b"))).toEqual({
      ...styleOf(start.get("box-b")),
      left: `${heldB.x}px`,
      top: `${heldB.y}px`,
    });
    expectOnlyChanged(afterA, end, ["box-b"]);
    expect(await app.designRect("box-b")).toEqual(heldB);
  });

  test("in-screen: smart guides disappear once the drop commits", async ({
    app,
    page,
  }) => {
    const id = await openShapes(app);
    const grab = await clickCentre(app, "box-a");
    await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
    const before = await app.savedNodes(id);
    const nearlyFlush = await app.pagePoint(402 + 60, 218 + 40);

    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(nearlyFlush.x, nearlyFlush.y, {
      steps: Math.ceil(
        Math.hypot(nearlyFlush.x - grab.x, nearlyFlush.y - grab.y) / 3,
      ),
    });
    await expect
      .poll(() => guideCount(page), {
        message: "precondition: the held drag shows a guide",
      })
      .toBeGreaterThan(0);
    await page.mouse.up();
    await app.settled();

    expect(await guideCount(page)).toBe(0);
    const after = await app.savedNodes(id);
    expect(styleOf(after.get("box-a"))).toEqual({
      ...styleOf(before.get("box-a")),
      left: "400px",
      top: "220px",
    });
    expectOnlyChanged(before, after, ["box-a"]);
  });

  test("in-screen: arrow-nudge after a drag continues from the dropped position", async ({
    app,
    page,
  }) => {
    const id = await openShapes(app);
    await clickCentre(app, "box-a");
    await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
    const before = await app.savedNodes(id);
    const held = await pressAndDrag(app, "box-a", 90, 55);
    await page.mouse.up();
    await app.settled();
    const dropped = await app.savedNodes(id);
    expect(
      styleOf(dropped.get("box-a")),
      "precondition: the drop committed",
    ).toEqual({
      ...styleOf(before.get("box-a")),
      left: `${held.x}px`,
      top: `${held.y}px`,
    });

    await page.keyboard.press("ArrowRight");
    await app.settled();

    const nudged = await app.savedNodes(id);
    expect(styleOf(nudged.get("box-a"))).toEqual({
      ...styleOf(dropped.get("box-a")),
      left: `${held.x + 1}px`,
    });
    expectOnlyChanged(dropped, nudged, ["box-a"]);
    expect(await app.designRect("box-a")).toEqual({ ...held, x: held.x + 1 });
  });

  test("in-screen: one plain drag is exactly one undo step", async ({
    app,
    page,
  }) => {
    const id = await openShapes(app);
    await clickCentre(app, "box-a");
    await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
    const original = await app.savedHtml(id);
    const held = await pressAndDrag(app, "box-a", 150, 90);
    await page.mouse.up();
    await app.settled();
    const dropped = await app.savedHtml(id);
    expect(dropped, "precondition: the drop committed").not.toBe(original);

    await page.keyboard.press(`${MOD}+z`);
    await app.settled();
    expect(await app.savedHtml(id)).toBe(original);
    expect(await app.designRect("box-a")).toEqual({
      x: 100,
      y: 100,
      width: 120,
      height: 80,
    });

    await page.keyboard.press(`${MOD}+Shift+z`);
    await app.settled();
    expect(await app.savedHtml(id)).toBe(dropped);
    expect(await app.designRect("box-a")).toEqual(held);
  });
});

test.describe("overview screen-frame moves", () => {
  test("overview: dragging a screen frame moves it by exactly the pointer delta at the current zoom", async ({
    app,
    page,
  }) => {
    const { id, before, start, scale } = await selectSecondScreen(app);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 240, start.y + 120, { steps: 20 });
    await page.mouse.up();
    await app.settled();

    const after = await savedFrames(app, id);
    expect(after.second).toEqual({
      ...before.second,
      x: before.second.x + Math.round(240 / scale),
      y: before.second.y + Math.round(120 / scale),
    });
    expect(after.first).toEqual(before.first);
  });

  test("overview: Shift+drag constrains a screen frame move to one axis", async ({
    app,
    page,
  }) => {
    const { id, before, start, scale } = await selectSecondScreen(app);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 20, start.y + 2, { steps: 4 });
    await page.keyboard.down("Shift");
    await page.mouse.move(start.x + 260, start.y + 20, { steps: 20 });
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await app.settled();

    const after = await savedFrames(app, id);
    expect(after.second).toEqual({
      ...before.second,
      x: before.second.x + Math.round(260 / scale),
    });
    expect(after.first).toEqual(before.first);
  });

  test("overview: Escape mid-drag cancels a screen-frame drag and restores its original position", async ({
    app,
    page,
  }) => {
    const { id, before, start } = await selectSecondScreen(app);
    const surface = page.locator("[data-frame-drag-surface]");
    const resting = await surface.boundingBox();

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 240, start.y + 120, { steps: 20 });
    await expect
      .poll(() => surface.boundingBox(), {
        message: "precondition: the screen follows the pointer",
      })
      .not.toEqual(resting);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await app.settled();

    expect(await savedFrames(app, id)).toEqual(before);
    await expect.poll(() => surface.boundingBox()).toEqual(resting);
  });
});
