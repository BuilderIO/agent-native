import { type Locator, type Page } from "@playwright/test";

import { appPath, selectTool, type ToolbarTool } from "./helpers";
import {
  childrenOf,
  expect,
  expectOnlyChanged,
  savedNodeMap,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const LIVE_SCREEN =
  'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])';
const BOARD_IFRAME = "[data-board-surface-layer] iframe";
const DEFAULT_DROP_SHADOW = "0px 4px 12px 0px rgba(0, 0, 0, 0.25)";

const EMPTY_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Card</title></head>
  <body data-agent-native-node-id="page" style="margin:0;position:relative;min-height:900px;background:#ffffff">
    <h1 data-agent-native-node-id="heading" data-agent-native-layer-name="Heading" style="position:absolute;left:40px;top:40px;margin:0;font:600 32px system-ui">Now playing</h1>
  </body>
</html>`;

const ALBUM_ART_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Card</title></head>
  <body data-agent-native-node-id="page" style="margin:0;position:relative;min-height:900px;background:#ffffff">
    <div data-agent-native-node-id="album-art" data-agent-native-layer-name="album-art" data-an-primitive="frame"
         style="position:absolute;left:200px;top:120px;width:800px;height:600px;background:#e4e4e7;overflow:hidden">
      <div data-agent-native-node-id="cover" data-agent-native-layer-name="cover"
           style="position:absolute;left:40px;top:40px;width:200px;height:200px;background:#a1a1aa"></div>
    </div>
  </body>
</html>`;

const TITLE_CREATOR_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Card</title></head>
  <body data-agent-native-node-id="page" style="margin:0;position:relative;min-height:900px;background:#ffffff;font-family:system-ui,sans-serif">
    <p data-agent-native-node-id="title" data-agent-native-layer-name="title"
       style="position:absolute;left:40px;top:40px;margin:0;font-size:20px;line-height:24px">Midnight City</p>
    <p data-agent-native-node-id="creator" data-agent-native-layer-name="creator"
       style="position:absolute;left:40px;top:72px;margin:0;font-size:14px;line-height:18px">M83</p>
  </body>
</html>`;

const CARD_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Card</title></head>
  <body data-agent-native-node-id="page" style="margin:0;position:relative;min-height:900px;background:#ffffff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="card" data-agent-native-layer-name="card" data-an-primitive="frame"
         style="position:absolute;left:40px;top:40px;width:320px;display:flex;flex-direction:column;gap:12px;padding:16px;box-sizing:border-box;background:#f4f4f5">
      <div data-agent-native-node-id="album-art" data-agent-native-layer-name="album-art"
           style="width:200px;height:120px;background:#a1a1aa;flex-shrink:0"></div>
      <p data-agent-native-node-id="metadata" data-agent-native-layer-name="metadata"
         style="margin:0;font-size:14px;line-height:18px">Midnight City</p>
    </div>
  </body>
</html>`;

test.use({ viewport: { width: 1600, height: 1000 } });

type DesignRecord = {
  files: { filename: string; content?: string }[];
};

async function designRecord(app: App, id: string): Promise<DesignRecord> {
  const response = await app.page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${id}`),
  );
  expect(response.ok(), `get-design ${response.status()}`).toBe(true);
  return response.json();
}

function fileContent(record: DesignRecord, filename: string) {
  return record.files.find((file) => file.filename === filename)?.content ?? "";
}

function boardNodes(record: DesignRecord) {
  return savedNodeMap(fileContent(record, "__board__.html"));
}

function boardBodyId(nodes: Map<string, SavedNode>) {
  const body = [...nodes.values()].find((node) => node.tag === "body");
  if (!body) throw new Error("the board file has no body");
  return body.id;
}

function newIds(before: Map<string, SavedNode>, after: Map<string, SavedNode>) {
  return [...after.keys()].filter((id) => !before.has(id));
}

/** Below 100% zoom one page pixel spans several design pixels, so drawn and dropped geometry rounds. */
function expectNearPx(actual: string | undefined, expected: number) {
  const value = parseFloat(actual ?? "");
  expect(
    Math.abs(value - expected),
    `${actual} should be within 4px of ${expected}`,
  ).toBeLessThanOrEqual(4);
}

function expectNearBox(
  actual: { x: number; y: number; width: number; height: number } | null,
  expected: { x: number; y: number; width: number; height: number },
) {
  expect(actual, "the element has no rendered box").not.toBeNull();
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(
      Math.abs(actual![key] - expected[key]),
      `rendered ${key} ${actual![key]} should be within 3px of ${expected[key]}`,
    ).toBeLessThanOrEqual(3);
  }
}

/** Opens the design zoomed out far enough that empty board shows beside the screen. */
async function openOnBoard(app: App, id: string) {
  await app.open(id);
  await app.page.goto(appPath(`/design/${id}?view=overview&zoom=30`), {
    waitUntil: "domcontentloaded",
  });
  await expect(app.page.locator(LIVE_SCREEN)).toBeVisible({ timeout: 30_000 });
  await expect(app.node("page")).toBeVisible();
  await expect(app.page.getByRole("tree", { name: "Layers" })).toBeVisible();
}

async function drawWithTool(
  page: Page,
  tool: ToolbarTool,
  from: { x: number; y: number },
  size: { width: number; height: number },
) {
  await selectTool(page, tool);
  await expect(
    page.locator(`[data-design-bottom-toolbar] button[aria-label="${tool}"]`),
  ).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + size.width, from.y + size.height, {
    steps: 16,
  });
  await page.mouse.up();
}

function boardNode(page: Page, nodeId: string) {
  return page
    .frameLocator(BOARD_IFRAME)
    .locator(`[data-agent-native-node-id="${nodeId}"]`);
}

async function clickCenter(
  app: App,
  nodeId: string,
  modifiers: ("Shift" | "Alt")[] = [],
) {
  const rect = await app.designRect(nodeId);
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  for (const key of modifiers) await app.page.keyboard.down(key);
  await app.page.mouse.click(point.x, point.y);
  for (const key of modifiers) await app.page.keyboard.up(key);
  return point;
}

function layerRow(page: Page, name: string): Locator {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) });
}

async function renameLayer(page: Page, from: string, to: string) {
  await layerRow(page, from).dblclick();
  const input = page
    .getByRole("tree", { name: "Layers" })
    .locator('input[aria-label="Rename layer"]');
  await input.fill(to);
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  await expect(layerRow(page, to)).toHaveCount(1);
}

function inspectorSection(page: Page, title: RegExp) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: title }) })
    .first();
}

async function chooseWidthMenuItem(page: Page, item: RegExp) {
  await page
    .locator('button[aria-label*="sizing mode" i], button[aria-label^="W "]')
    .first()
    .click();
  await page.getByRole("menuitem", { name: item }).click();
}

test.describe("interaction: responsive card with auto layout and constraints", () => {
  test("step 1-2: Frame tool draws a board frame outside any screen; rename, corner radius, and drop shadow commit via the inspector", async ({
    app,
    page,
  }) => {
    const id = await app.seed(EMPTY_SCREEN);
    await openOnBoard(app, id);
    const start = await designRecord(app, id);
    const boardBefore = boardNodes(start);
    const boardBody = boardBodyId(boardBefore);
    expect(
      childrenOf(boardBefore, boardBody),
      "the board starts empty",
    ).toEqual([]);
    const screen = (await page.locator(LIVE_SCREEN).boundingBox())!;
    const { scale } = await app.pagePoint(0, 0);
    const from = { x: screen.x + screen.width + 80, y: screen.y + 40 };

    await drawWithTool(page, "Frame", from, { width: 120, height: 90 });
    await app.settled();

    const drawn = boardNodes(await designRecord(app, id));
    const [frameId] = newIds(boardBefore, drawn);
    expect(newIds(boardBefore, drawn), "one board frame").toHaveLength(1);
    expect(drawn.get(frameId)).toMatchObject({
      tag: "div",
      parent: boardBody,
      attrs: {
        "data-an-primitive": "frame",
        "data-agent-native-layer-name": "Frame",
      },
    });
    const drawnStyle = styleOf(drawn.get(frameId));
    expectNearPx(drawnStyle.width, 120 / scale);
    expectNearPx(drawnStyle.height, 90 / scale);
    expectNearBox(await boardNode(page, frameId).boundingBox(), {
      ...from,
      width: 120,
      height: 90,
    });
    await expect.poll(() => app.selectedLayers()).toEqual(["Frame"]);

    await renameLayer(page, "Frame", "play-button");
    const radius = page.locator('input[aria-label="Corner radius" i]');
    await radius.fill("100");
    await radius.press("Enter");
    await inspectorSection(page, /^Effects$/i)
      .getByRole("button", { name: "Add effect" })
      .click();
    await page.getByRole("menuitem", { name: "Drop shadow" }).click();
    await app.settled();

    const end = await designRecord(app, id);
    const board = boardNodes(end);
    expect(board.get(frameId)?.attrs["data-agent-native-layer-name"]).toBe(
      "play-button",
    );
    expect(styleOf(board.get(frameId))).toEqual({
      ...drawnStyle,
      "border-radius": "100px",
      "border-top-left-radius": "100px",
      "border-top-right-radius": "100px",
      "border-bottom-right-radius": "100px",
      "border-bottom-left-radius": "100px",
      "box-shadow": DEFAULT_DROP_SHADOW,
    });
    expectOnlyChanged(drawn, board, [frameId]);
    expect(fileContent(end, "index.html")).toBe(
      fileContent(start, "index.html"),
    );
    await expect(boardNode(page, frameId)).toHaveCSS(
      "border-top-left-radius",
      "100px",
    );
  });

  test("a rectangle drawn inside a board frame becomes that frame's child at the drawn spot", async ({
    app,
    page,
  }) => {
    const id = await app.seed(EMPTY_SCREEN);
    await openOnBoard(app, id);
    const start = await designRecord(app, id);
    const boardBefore = boardNodes(start);
    const screen = (await page.locator(LIVE_SCREEN).boundingBox())!;
    const { scale } = await app.pagePoint(0, 0);
    const frameAt = { x: screen.x + screen.width + 80, y: screen.y + 40 };
    await drawWithTool(page, "Frame", frameAt, { width: 160, height: 120 });
    await app.settled();
    const withFrame = boardNodes(await designRecord(app, id));
    const [frameId] = newIds(boardBefore, withFrame);
    expect(
      newIds(boardBefore, withFrame),
      "precondition: one board frame",
    ).toHaveLength(1);

    const rectAt = { x: frameAt.x + 40, y: frameAt.y + 30 };
    await drawWithTool(page, "Rectangle", rectAt, { width: 30, height: 24 });
    await app.settled();

    const end = await designRecord(app, id);
    const after = boardNodes(end);
    const [rectId] = newIds(withFrame, after);
    expect(newIds(withFrame, after), "one new rectangle").toHaveLength(1);
    expect(after.get(rectId)).toMatchObject({
      parent: frameId,
      attrs: { "data-an-primitive": "rectangle" },
    });
    const rect = styleOf(after.get(rectId));
    expectNearPx(rect.left, 40 / scale);
    expectNearPx(rect.top, 30 / scale);
    expectNearPx(rect.width, 30 / scale);
    expectNearPx(rect.height, 24 / scale);
    expectOnlyChanged(withFrame, after, [rectId]);
    expect(fileContent(end, "index.html")).toBe(
      fileContent(start, "index.html"),
    );
    expectNearBox(await boardNode(page, rectId).boundingBox(), {
      ...rectAt,
      width: 30,
      height: 24,
    });
  });

  test("step 3-4 (crossing the screen boundary): Option-dragging a board frame into an in-screen frame drops a copy at the drop point and leaves the original; Shift+Arrow nudges the copy 10px", async ({
    app,
    page,
  }) => {
    const id = await app.seed(ALBUM_ART_SCREEN);
    await openOnBoard(app, id);
    const boardBefore = boardNodes(await designRecord(app, id));
    const screen = (await page.locator(LIVE_SCREEN).boundingBox())!;
    const from = { x: screen.x + screen.width + 80, y: screen.y + 40 };
    await drawWithTool(page, "Frame", from, { width: 60, height: 45 });
    await app.settled();
    const start = await designRecord(app, id);
    const board = boardNodes(start);
    const [sourceId] = newIds(boardBefore, board);
    expect(
      newIds(boardBefore, board),
      "precondition: one board frame",
    ).toHaveLength(1);
    const source = styleOf(board.get(sourceId));
    const width = parseFloat(source.width);
    const height = parseFloat(source.height);
    const screenBefore = savedNodeMap(fileContent(start, "index.html"));

    const drop = await app.pagePoint(600, 420);
    await page.mouse.move(from.x + 30, from.y + 22);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(drop.x, drop.y, { steps: 20 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await app.settled();

    const dropped = await designRecord(app, id);
    expectOnlyChanged(board, boardNodes(dropped), []);
    const screenAfter = savedNodeMap(fileContent(dropped, "index.html"));
    const [copyId] = newIds(screenBefore, screenAfter);
    expect(newIds(screenBefore, screenAfter), "one copy").toHaveLength(1);
    expect(childrenOf(screenAfter, "album-art")).toEqual(["cover", copyId]);
    expectOnlyChanged(screenBefore, screenAfter, [copyId]);
    const copy = styleOf(screenAfter.get(copyId));
    expect(copy.position).toBe("absolute");
    expectNearPx(copy.left, 600 - 200 - width / 2);
    expectNearPx(copy.top, 420 - 120 - height / 2);
    expect({ width: copy.width, height: copy.height }).toEqual({
      width: source.width,
      height: source.height,
    });

    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    await app.settled();

    const nudged = await designRecord(app, id);
    const screenNudged = savedNodeMap(fileContent(nudged, "index.html"));
    expect(styleOf(screenNudged.get(copyId))).toEqual({
      ...copy,
      left: `${parseFloat(copy.left) + 10}px`,
      top: `${parseFloat(copy.top) + 10}px`,
    });
    expectOnlyChanged(screenAfter, screenNudged, [copyId]);
    expectOnlyChanged(board, boardNodes(nudged), []);
    expectNearBox(await app.designRect(copyId), {
      x: 200 + parseFloat(copy.left) + 10,
      y: 120 + parseFloat(copy.top) + 10,
      width,
      height,
    });
  });

  // fixme: product bug: Add auto layout stretches the creator text from its 30px hug width to the wrapper's 117px. The wrapper is saved without align-items, so
  test.fixme("steps 7-8: Shift+A wraps the shift-clicked title and creator into a vertical auto-layout frame without moving them, and gap 4 saves on that frame", async ({
    app,
    page,
  }) => {
    const id = await app.seed(TITLE_CREATOR_SCREEN);
    await app.open(id);
    await app.zoomToFit();
    const before = await app.savedNodes(id);
    const title = await app.designRect("title");
    const creator = await app.designRect("creator");

    await clickCenter(app, "title");
    await clickCenter(app, "creator", ["Shift"]);
    await expect.poll(() => app.selectedLayers()).toEqual(["creator", "title"]);
    await page.keyboard.press("Shift+A");
    await app.settled();

    const wrapped = await app.savedNodes(id);
    const [wrapperId] = newIds(before, wrapped);
    expect(newIds(before, wrapped), "one wrapper frame").toHaveLength(1);
    expect(wrapped.get(wrapperId)?.parent).toBe("page");
    expect(childrenOf(wrapped, wrapperId)).toEqual(["title", "creator"]);
    expect(styleOf(wrapped.get(wrapperId))).toMatchObject({
      position: "absolute",
      left: "40px",
      top: "40px",
      display: "flex",
      "flex-direction": "column",
      gap: "8px",
    });
    expect(styleOf(wrapped.get("title"))).toEqual({
      margin: "0",
      "font-size": "20px",
      "line-height": "24px",
    });
    expect(styleOf(wrapped.get("creator"))).toEqual({
      margin: "0",
      "font-size": "14px",
      "line-height": "18px",
    });
    expectOnlyChanged(before, wrapped, [wrapperId, "title", "creator"]);
    expect(await app.designRect("title")).toEqual(title);
    const wrappedCreator = await app.designRect("creator");
    expect({ x: wrappedCreator.x, y: wrappedCreator.y }).toEqual({
      x: creator.x,
      y: creator.y,
    });

    const gap = page.locator('input[aria-label="Gap" i]').first();
    await gap.fill("4");
    await gap.press("Enter");
    await app.settled();

    const end = await app.savedNodes(id);
    expect(styleOf(end.get(wrapperId))).toEqual({
      ...styleOf(wrapped.get(wrapperId)),
      gap: "4px",
    });
    expectOnlyChanged(wrapped, end, [wrapperId]);
    expect(await app.designRect("title")).toEqual(title);
    expect(
      await app.designRect("creator"),
      "the creator sits 4px under the title and keeps its own hug width",
    ).toEqual({ ...creator, y: title.y + title.height + 4 });
  });

  // fixme: product bug: The Min width inspector field clips its value: it holds '200px' but shows '200p:' (scrollWidth > clientWidth). The card's Gap field also
  test.fixme("step 9-11: Fill width on a card child stretches it to the card's content box, and min width commits on the card", async ({
    app,
    page,
  }) => {
    const id = await app.seed(CARD_SCREEN);
    await app.open(id);
    await app.zoomToFit();
    const before = await app.savedNodes(id);

    await clickCenter(app, "album-art");
    await expect.poll(() => app.selectedLayers()).toEqual(["album-art"]);
    await chooseWidthMenuItem(page, /^Fill/i);
    await app.settled();

    const filled = await app.savedNodes(id);
    expect(styleOf(filled.get("album-art"))).toEqual({
      ...styleOf(before.get("album-art")),
      width: "auto",
      "align-self": "stretch",
    });
    expectOnlyChanged(before, filled, ["album-art"]);
    expect((await app.designRect("album-art")).width).toBe(288);

    const card = await app.designRect("card");
    const padding = await app.pagePoint(card.x + 6, card.y + 6);
    await page.mouse.click(padding.x, padding.y);
    await expect.poll(() => app.selectedLayers()).toEqual(["card"]);
    await chooseWidthMenuItem(page, /Add min width/i);
    const minWidth = page.locator('input[aria-label="Min width" i]:visible');
    await minWidth.fill("200");
    await minWidth.press("Enter");
    await app.settled();

    const end = await app.savedNodes(id);
    expect(styleOf(end.get("card"))).toEqual({
      ...styleOf(filled.get("card")),
      "min-width": "200px",
    });
    expectOnlyChanged(filled, end, ["card"]);
    expect(await app.designRect("card")).toEqual(card);
    await expect(minWidth).toHaveValue("200px");
    expect(
      await minWidth.evaluate(
        (input: HTMLInputElement) => input.scrollWidth <= input.clientWidth,
      ),
      'the Min width field clips "200px"',
    ).toBe(true);
  });

  test("Cmd+Opt+K turns the clicked frame into a main component and changes nothing else", async ({
    app,
    page,
  }) => {
    const id = await app.seed(CARD_SCREEN);
    await app.open(id);
    await app.zoomToFit();
    const before = await app.savedNodes(id);
    const card = await app.designRect("card");
    const padding = await app.pagePoint(card.x + 6, card.y + 6);
    await page.mouse.click(padding.x, padding.y);
    await expect.poll(() => app.selectedLayers()).toEqual(["card"]);

    await page.keyboard.press(`${MOD}+Alt+k`);
    await app.settled();

    const after = await app.savedNodes(id);
    const { "data-agent-native-component-id": componentId, ...attrs } =
      after.get("card")!.attrs;
    expect(componentId).toMatch(/^[\w-]{8,}$/);
    expect(attrs).toEqual({
      ...before.get("card")!.attrs,
      "data-agent-native-component": "Card",
    });
    expectOnlyChanged(before, after, ["card"]);
  });
});
