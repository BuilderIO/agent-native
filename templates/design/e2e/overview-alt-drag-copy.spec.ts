import { appPath } from "./helpers";
import {
  expect,
  expectOnlyChanged,
  test,
  type App,
  type SavedNode,
} from "./rails";

const SCREEN_HTML = `<!doctype html>
<html><body style="margin:0;min-height:900px">
<main data-agent-native-node-id="main" style="position:relative;min-height:900px">
  <h1 data-agent-native-node-id="hero" style="position:absolute;left:40px;top:48px">Hero</h1>
</main></body></html>`;

type Frame = { x: number; y: number; width: number; height: number; z: number };

async function seedScreens(app: App, frames: Frame[]) {
  const extra = Object.fromEntries(
    frames
      .slice(1)
      .map((_, index) => [`screen-${index + 2}.html`, SCREEN_HTML]),
  );
  const id = await app.seed(SCREEN_HTML, { files: extra });
  const { files } = await app.savedRecord(id);
  const fileIds = ["index.html", ...Object.keys(extra)].map(
    (filename) => files.find((file) => file.filename === filename)!.id,
  );
  const response = await app.page.request.post(
    appPath("/_agent-native/actions/update-design"),
    {
      data: {
        id,
        dataOperations: fileIds.flatMap((fileId, index) => [
          {
            op: "set",
            path: ["screenMetadata", fileId],
            value: { sourceType: "inline", width: 1280, height: 900 },
          },
          { op: "set", path: ["canvasFrames", fileId], value: frames[index] },
        ]),
      },
    },
  );
  expect(response.ok()).toBe(true);
  return { id, fileIds };
}

/** Sets the zoom to 25% through the zoom field, so canvas distances map to whole page pixels. */
async function zoomTo25(app: App) {
  const zoomControl = app.page.getByRole("button", { name: /^\d+%$/ }).first();
  await zoomControl.click();
  const zoomInput = app.page.getByRole("textbox", { name: "Zoom percentage" });
  await zoomInput.fill("25%");
  await zoomInput.press("Enter");
  await expect(zoomControl).toHaveText("25%");
}

/** Waits for the camera to stop moving and returns the selection box, which must be drawn at 25%. */
async function settledSelection(app: App, selectedWidth: number) {
  const box = app.page.locator("[data-frame-selection-box]");
  let previous = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await box.boundingBox());
        const stable = now === previous;
        previous = now;
        return stable;
      },
      { intervals: [200], message: "the camera never settled" },
    )
    .toBe(true);
  const rect = (await box.boundingBox())!;
  expect(rect.width, "selection box drawn at 25%").toBeCloseTo(
    selectedWidth * 0.25,
    1,
  );
  return rect;
}

/** Alt-drags the selection from its centre by a distance in canvas px, at 25% zoom. */
async function altDragBy(
  app: App,
  rect: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
) {
  const start = {
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
  };
  await app.page.mouse.move(start.x, start.y);
  await app.page.keyboard.down("Alt");
  await app.page.mouse.down();
  await app.page.mouse.move(start.x + dx / 4, start.y + dy / 4, { steps: 12 });
  await expect(
    app.page.locator("[data-duplicate-preview-ghost]"),
  ).toBeVisible();
  await app.page.mouse.up();
  await app.page.keyboard.up("Alt");
}

/** Saved canvas frames keyed by screen filename, so copies can be named literally. */
async function savedFrames(app: App, id: string) {
  const record = await app.savedRecord(id);
  const { canvasFrames } = record.data as {
    canvasFrames: Record<string, Frame>;
  };
  return Object.fromEntries(
    Object.entries(canvasFrames).map(([fileId, frame]) => [
      record.files.find((file) => file.id === fileId)?.filename ?? fileId,
      frame,
    ]),
  );
}

async function framesOnceCount(app: App, id: string, count: number) {
  await expect
    .poll(async () => Object.keys(await savedFrames(app, id)).length, {
      timeout: 20_000,
    })
    .toBe(count);
  await app.settled();
  return savedFrames(app, id);
}

/** The document with node ids dropped: a duplicated screen gets fresh ids but must match everywhere else. */
function withoutIds(nodes: Map<string, SavedNode>) {
  const order = [...nodes.keys()];
  return [...nodes.values()].map(({ tag, parent, attrs, text }) => {
    const { "data-agent-native-node-id": _id, ...rest } = attrs;
    return {
      tag,
      parent: parent === null ? null : order.indexOf(parent),
      attrs: rest,
      text,
    };
  });
}

async function fileId(app: App, id: string, filename: string) {
  return (await app.savedRecord(id)).files.find(
    (file) => file.filename === filename,
  )!.id;
}

test("alt-dragging a selected frame drops a copy and leaves the original in place", async ({
  app,
}) => {
  const source = { x: 0, y: 0, width: 1280, height: 900, z: 0 };
  const { id, fileIds } = await seedScreens(app, [source]);
  await app.open(id);
  await app.page.locator("[data-frame-label]").first().click();
  await zoomTo25(app);
  const rect = await settledSelection(app, 1280);
  await app.settled();
  const sourceNodes = await app.savedNodes(id);

  await altDragBy(app, rect, 240, 160);

  expect(await framesOnceCount(app, id, 2)).toEqual({
    "index.html": source,
    "index-copy.html": { x: 240, y: 160, width: 1280, height: 900, z: 1 },
  });
  expectOnlyChanged(sourceNodes, await app.savedNodes(id), []);
  expect(withoutIds(await app.savedNodes(id, "index-copy.html"))).toEqual(
    withoutIds(sourceNodes),
  );
  await expect.poll(() => app.selectedLayers()).toEqual(["Index copy"]);
  const copyId = await fileId(app, id, "index-copy.html");
  const sourceShell = (await app.page
    .locator(`[data-frame-id="${fileIds[0]}"]`)
    .boundingBox())!;
  const copyShell = (await app.page
    .locator(`[data-frame-id="${copyId}"]`)
    .boundingBox())!;
  expect(
    Math.abs(copyShell.x - sourceShell.x - 60),
    "copy drawn 240 canvas px right",
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(copyShell.y - sourceShell.y - 40),
    "copy drawn 160 canvas px down",
  ).toBeLessThanOrEqual(1);
});

test("alt-dragging a frame over an occupied screen keeps the copy above it", async ({
  app,
}) => {
  const source = { x: 0, y: 0, width: 1280, height: 900, z: 0 };
  const occupied = { x: 1600, y: 0, width: 1280, height: 900, z: 90 };
  const { id, fileIds } = await seedScreens(app, [source, occupied]);
  await app.open(id);
  await app.page.locator("[data-frame-label]").first().click();
  await zoomTo25(app);
  const rect = await settledSelection(app, 1280);

  await altDragBy(app, rect, 1600, 300);

  expect(await framesOnceCount(app, id, 3)).toEqual({
    "index.html": source,
    "screen-2.html": occupied,
    "index-copy.html": { x: 1600, y: 300, width: 1280, height: 900, z: 91 },
  });
  const copyId = await fileId(app, id, "index-copy.html");
  const zIndex = (frameId: string) =>
    app.page
      .locator(`[data-frame-id="${frameId}"]`)
      .evaluate((node) => Number(getComputedStyle(node).zIndex));
  expect(
    await zIndex(copyId),
    "the copy renders above the occupied screen",
  ).toBeGreaterThan(await zIndex(fileIds[1]!));
});

test("alt-dragging a multi-frame selection copies every frame and keeps their spacing", async ({
  app,
}) => {
  const left = { x: 0, y: 0, width: 1280, height: 900, z: 0 };
  const right = { x: 1600, y: 0, width: 1280, height: 900, z: 1 };
  const { id } = await seedScreens(app, [left, right]);
  await app.open(id);
  await app.page.locator("[data-frame-label]").first().click();
  await app.page.keyboard.press("ControlOrMeta+a");
  await zoomTo25(app);
  const rect = await settledSelection(app, 2880);
  const withCopies = {
    "index.html": left,
    "screen-2.html": right,
    "index-copy.html": { x: 0, y: 1100, width: 1280, height: 900, z: 2 },
    "screen-2-copy.html": { x: 1600, y: 1100, width: 1280, height: 900, z: 3 },
  };

  await altDragBy(app, rect, 0, 1100);

  expect(await framesOnceCount(app, id, 4)).toEqual(withCopies);

  await app.page.keyboard.press("ControlOrMeta+z");
  await expect(app.page.locator("[data-screen-shell]")).toHaveCount(2);
  expect(await framesOnceCount(app, id, 2)).toEqual({
    "index.html": left,
    "screen-2.html": right,
  });

  await app.page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(app.page.locator("[data-screen-shell]")).toHaveCount(4);
  expect(await framesOnceCount(app, id, 4)).toEqual(withCopies);
  await expect
    .poll(() => app.selectedLayers())
    .toEqual(["Screen 2 copy", "Index copy"]);
});
