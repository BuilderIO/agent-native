import type { Page } from "@playwright/test";

import { sourceContentHash } from "../shared/source-workspace.js";
import {
  appPath,
  cdpScreenshot,
  designFrame,
  expandAllLayers,
} from "./helpers";
import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

const FRAME_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; width: 400px; height: 400px; }
      .frame { position: absolute; box-sizing: border-box; left: 100px; top: 100px; display: flex; gap: 10px; padding: 8px; width: 200px; height: 160px; border: solid; border-width: 1px 2px 3px 4px; background: #ddd; }
      .fixed { width: 60px; height: 40px; border: solid; border-width: 1px 2px 3px 4px; background: #2563eb; }
      .fill { flex: 1 1 0%; height: 40px; background: #ef4444; }
    </style>
  </head>
  <body>
    <main id="frame" class="frame" data-agent-native-node-id="ordinary-frame" data-agent-native-layer-name="Ordinary Frame" data-an-primitive="frame">
      <div class="fixed" data-agent-native-node-id="fixed-child" data-agent-native-layer-name="Fixed child"></div>
      <div class="fill" data-agent-native-node-id="fill-child" data-agent-native-layer-name="Fill child"></div>
    </main>
  </body>
</html>`;

const REFUSAL_HTML = `<!doctype html>
<html><head><style>html,body{margin:0;width:400px;height:400px}</style></head>
<body><div id="child" data-agent-native-node-id="child" style="position:absolute;left:24px;top:20px;width:60px;height:40px;background:#ef4444"></div></body></html>`;

const GROUP_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><style>
  html, body { margin: 0; width: 600px; height: 400px; }
  .frame { position: absolute; box-sizing: border-box; display: flex; gap: 10px; padding: 8px; border: 2px solid #222; }
  #nested-frame { left: 90px; top: 100px; width: 180px; height: 80px; }
  #other-frame { left: 286px; top: 100px; width: 204px; height: 120px; }
  .fixed-child { flex: none; width: 60px; height: 40px; background: #2563eb; }
  .fill-child { flex: 1 1 0%; min-width: 0; height: 40px; background: #ef4444; }
  .other-child { width: 40px; height: 30px; background: #22c55e; }
</style></head><body>
  <main id="nested-frame" class="frame" data-agent-native-node-id="nested-frame" data-agent-native-layer-name="Nested frame" data-an-primitive="frame">
    <div class="fixed-child" data-agent-native-node-id="fixed-child" data-agent-native-layer-name="Fixed child"></div>
    <div class="fill-child" data-agent-native-node-id="fill-child" data-agent-native-layer-name="Fill child"></div>
  </main>
  <section id="other-frame" class="frame" data-agent-native-node-id="other-frame" data-agent-native-layer-name="Other frame" data-an-primitive="frame">
    <div class="other-child" data-agent-native-node-id="other-child" data-agent-native-layer-name="Other child"></div>
  </section>
</body></html>`;

const BOARD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><style>
  html, body { margin: 0; background: transparent; }
  body { position: relative; overflow: visible; }
</style></head><body>
  <main id="board-frame" data-agent-native-node-id="board-frame" data-agent-native-layer-name="Board frame" data-an-primitive="frame" style="position:absolute;left:420px;top:100px;box-sizing:border-box;width:120px;height:90px;display:flex;gap:8px;padding:6px;background:#ddd">
    <div id="board-child" data-agent-native-node-id="board-child" data-agent-native-layer-name="Board child" style="width:30px;height:20px;background:#2563eb"></div>
  </main>
</body></html>`;

const VECTOR_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><style>html,body{margin:0;width:400px;height:400px}</style></head><body>
    <main id="vector-frame" data-agent-native-node-id="vector-frame" data-agent-native-layer-name="Vector frame" data-an-primitive="frame" style="position:absolute;left:100px;top:100px;width:200px;height:160px;display:flex;align-items:flex-start"><svg id="vector" data-agent-native-node-id="vector" data-agent-native-layer-name="Vector symbol" viewBox="0 0 80 60" style="width:80px;height:60px"><rect width="80" height="60" rx="8" fill="#2563eb" /></svg></main>
  </body></html>`;

const UNDO = process.platform === "darwin" ? "Meta+Z" : "Control+Z";
const REDO = process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z";

async function action(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok())
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  return response.json() as Promise<Record<string, unknown>>;
}

/** Seeds a design whose index.html screen has a fixed size, the way the canvas lays out authored screens. */
async function seedSizedScreen(
  app: App,
  html: string,
  width: number,
  height: number,
  files: Record<string, string> = {},
) {
  const designId = await app.seed(html, { files });
  const record = await app.savedRecord(designId);
  const fileId = record.files.find(
    (file) => file.filename === "index.html",
  )!.id;
  await action(app.page, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: { sourceType: "inline", width, height },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 0, y: 0, width, height, z: 0 },
      },
    ],
  });
  return { designId, fileId, files: record.files };
}

async function openAndFit(app: App, designId: string) {
  await app.open(designId);
  await app.zoomToFit();
  await app.settled();
}

/** Clicks 20px above the node's bottom edge, below the fixtures' top-aligned children, so the Frame itself is hit. */
async function selectOnCanvas(app: App, nodeId: string, layerName: string) {
  const rect = await app.designRect(nodeId);
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height - 20,
  );
  await app.page.mouse.click(point.x, point.y);
  await expect.poll(() => app.selectedLayers()).toEqual([layerName]);
}

/** Drags the selection's south-east handle by a distance given in design px. */
async function dragHandleBy(app: App, fileId: string, dx: number, dy: number) {
  const handle = designFrame(app.page, fileId).locator(
    '[data-agent-native-edit-handle="se"]',
  );
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  const { scale } = await app.pagePoint(0, 0);
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move(start.x + dx * scale, start.y + dy * scale, {
    steps: 12,
  });
  await app.page.mouse.up();
  await app.settled();
}

async function renderedBox(app: App, nodeId: string) {
  return app.node(nodeId).evaluate((element) => {
    const r = element.getBoundingClientRect();
    return {
      width: Math.round(r.width * 100) / 100,
      height: Math.round(r.height * 100) / 100,
    };
  });
}

function layerRow(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first()
    .locator('xpath=ancestor::*[@role="treeitem"][1]');
}

async function chooseBoardLayer(page: Page, name: string) {
  const input = page.getByPlaceholder("Search layers...");
  if (!(await input.isVisible().catch(() => false))) {
    await page
      .getByRole("button", { name: "Search layers...", exact: true })
      .click();
    await expect(input).toBeVisible();
  }
  await input.fill(name);
  const row = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click({ force: true });
  await page.waitForTimeout(700);
}

async function drag(
  page: Page,
  handle: ReturnType<Page["locator"]>,
  dx: number,
  dy: number,
) {
  const box = await handle.boundingBox();
  if (!box) throw new Error("K-scale handle has no bounds");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

async function sourceFile(page: Page, designId: string, path: string) {
  if (path === "__board__.html") {
    const response = await page.request.get(
      appPath(
        `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
      ),
    );
    if (!response.ok())
      throw new Error(`get-design failed: ${response.status()}`);
    const design = (await response.json()) as {
      files?: Array<{ filename: string; content?: string | null }>;
    };
    const board = design.files?.find((file) => file.filename === path);
    if (!board) throw new Error("get-design did not return the board file");
    return { content: board.content ?? "" };
  }
  const query = new URLSearchParams({ designId, path });
  const response = await page.request.get(
    appPath(`/_agent-native/actions/read-source-file?${query.toString()}`),
  );
  if (!response.ok())
    throw new Error(`read-source-file failed: ${response.status()}`);
  return (await response.json()) as { content: string };
}

async function openOverview(
  page: Page,
  designId: string,
  previewSelector: string,
  contentSelector: string,
) {
  await page.goto(appPath(`/design/${designId}?view=overview&zoom=100`), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("[data-screen-shell]").first()).toBeVisible({
    timeout: 40_000,
  });
  const preview = page.locator(previewSelector).first().contentFrame();
  await expect(preview.locator(contentSelector)).toBeVisible({
    timeout: 20_000,
  });
}

async function groupState(page: Page) {
  const frame = page
    .locator("iframe[data-screen-iframe-id]")
    .first()
    .contentFrame();
  return frame.locator("html").evaluate(() => {
    const read = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element)
        throw new Error(`Missing K-scale fixture element: ${selector}`);
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        left: Number.parseFloat(style.left),
        top: Number.parseFloat(style.top),
        width: rect.width,
        height: rect.height,
        authoredWidth: element.style.width,
        authoredHeight: element.style.height,
        gap: Number.parseFloat(style.columnGap),
        paddingLeft: Number.parseFloat(style.paddingLeft),
        flex: style.flex,
      };
    };
    return {
      nestedFrame: read("#nested-frame"),
      fixedChild: read("#nested-frame .fixed-child"),
      fillChild: read("#nested-frame .fill-child"),
      otherFrame: read("#other-frame"),
      otherChild: read("#other-frame .other-child"),
    };
  });
}

async function boardState(page: Page) {
  const frame = page
    .locator("iframe[data-design-preview-iframe]:not([data-screen-iframe-id])")
    .first()
    .contentFrame();
  return frame.locator("html").evaluate(() => {
    const read = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element)
        throw new Error(`Missing board K-scale fixture: ${selector}`);
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        authoredWidth: element.style.width,
        authoredHeight: element.style.height,
        gap: Number.parseFloat(style.columnGap),
        paddingLeft: Number.parseFloat(style.paddingLeft),
      };
    };
    return { frame: read("#board-frame"), child: read("#board-child") };
  });
}

// fixme: product bug: K-scale writes phantom outline-width: 4.50px on frame, fixed and fill children and border-width: 4.50px x4 on the borderless fill child.
test.fixme("K-dragging a Frame to 1.5x scales its size, borders, spacing and fixed child, keeps Fill flexing, and undoes in one step", async ({
  app,
  page,
}) => {
  const { designId, fileId } = await seedSizedScreen(app, FRAME_HTML, 400, 400);
  await openAndFit(app, designId);
  await selectOnCanvas(app, "ordinary-frame", "Ordinary Frame");
  const widthInput = page.getByRole("textbox", { name: "W size in pixels" });
  await expect(widthInput).toHaveValue("200px");
  expect(await renderedBox(app, "ordinary-frame")).toEqual({
    width: 200,
    height: 160,
  });
  const before = await app.savedNodes(designId);

  await page.keyboard.press("k");
  await expect(
    page.getByRole("button", { name: "Scale", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dragHandleBy(app, fileId, 100, 80);

  expect(await renderedBox(app, "ordinary-frame")).toEqual({
    width: 300,
    height: 240,
  });
  // Chrome lays out 1.5px and 4.5px borders as 1px and 4px.
  expect(await renderedBox(app, "fixed-child")).toEqual({
    width: 99,
    height: 65,
  });
  expect(await renderedBox(app, "fill-child")).toEqual({
    width: 153,
    height: 60,
  });
  await expect(widthInput).toHaveValue("300px");
  const scaled = await app.savedNodes(designId);
  expectOnlyChanged(before, scaled, [
    "ordinary-frame",
    "fixed-child",
    "fill-child",
  ]);

  await page.keyboard.press(UNDO);
  await app.settled();
  expect(await renderedBox(app, "ordinary-frame")).toEqual({
    width: 200,
    height: 160,
  });
  expectOnlyChanged(before, await app.savedNodes(designId), []);

  await page.keyboard.press(REDO);
  await app.settled();
  expect(await renderedBox(app, "ordinary-frame")).toEqual({
    width: 300,
    height: 240,
  });
  expectOnlyChanged(scaled, await app.savedNodes(designId), []);

  await app.open(designId);
  expect(await renderedBox(app, "ordinary-frame")).toEqual({
    width: 300,
    height: 240,
  });
  expect(await renderedBox(app, "fill-child")).toEqual({
    width: 153,
    height: 60,
  });
  expect(styleOf(scaled.get("ordinary-frame"))).toEqual({
    "padding-top": "12px",
    "padding-right": "12px",
    "padding-bottom": "12px",
    "padding-left": "12px",
    "row-gap": "15px",
    "column-gap": "15px",
    "border-width": "1.50px 3px 4.50px 6px",
    left: "100px",
    top: "100px",
    width: "300px",
    height: "240px",
    "font-size": "24px",
  });
  expect(styleOf(scaled.get("fixed-child"))).toEqual({
    width: "90px",
    height: "60px",
    "font-size": "24px",
    "border-width": "1.50px 3px 4.50px 6px",
  });
  expect(styleOf(scaled.get("fill-child"))).toEqual({
    height: "60px",
    "font-size": "24px",
  });
});

// fixme: product bug: Same phantom-width family: outline-width 3.80px on all five nodes and border-width 3.80px x4 on the borderless children.
test.fixme("group K scales a nested Frame batch once and persists one undoable edit", async ({
  app,
  page,
}) => {
  const { designId } = await seedSizedScreen(app, GROUP_HTML, 600, 400);
  await openOverview(
    page,
    designId,
    "iframe[data-screen-iframe-id]",
    "#nested-frame",
  );
  await expandAllLayers(page);
  const screen = page
    .locator("iframe[data-screen-iframe-id]")
    .first()
    .contentFrame();
  await layerRow(page, "Nested frame")
    .locator("[data-layer-row-button]")
    .click();
  await layerRow(page, "Other frame")
    .locator("[data-layer-row-button]")
    .click({ modifiers: ["Shift"] });
  await expect(page.getByText("2 selected")).toBeVisible();
  await expect
    .poll(async () => (await app.selectedLayers()).sort())
    .toEqual(["Nested frame", "Other frame"]);

  const before = await groupState(page);
  const originalSource = await sourceFile(page, designId, "index.html");
  await page.keyboard.press("k");
  const bounds = screen.locator(
    "[data-agent-native-multi-selection-bounds] [data-corner='se']",
  );
  await expect(bounds).toBeVisible();

  const handleBox = await bounds.boundingBox();
  if (!handleBox) throw new Error("group K-scale handle has no bounds");
  const handleX = handleBox.x + handleBox.width / 2;
  const handleY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await page.mouse.up();
  await expect
    .poll(async () => (await groupState(page)).nestedFrame.width)
    .toBeCloseTo(before.nestedFrame.width, 0);
  expect((await sourceFile(page, designId, "index.html")).content).toBe(
    originalSource.content,
  );

  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await page.mouse.move(handleX + 24, handleY + 18, { steps: 4 });
  await expect
    .poll(async () => (await groupState(page)).nestedFrame.width)
    .toBeGreaterThan(before.nestedFrame.width);
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await groupState(page)).nestedFrame.width)
    .toBeCloseTo(before.nestedFrame.width, 0);
  expect((await sourceFile(page, designId, "index.html")).content).toBe(
    originalSource.content,
  );

  await drag(page, bounds, 107, 32);
  await expect
    .poll(async () => (await groupState(page)).nestedFrame.width)
    .toBeGreaterThan(before.nestedFrame.width);
  await expect(page.getByText("2 selected")).toBeVisible();

  const after = await groupState(page);
  const scale = after.nestedFrame.width / before.nestedFrame.width;
  expect(scale).toBeCloseTo(1.2675, 3);
  const nestedContentScale = after.fixedChild.width / before.fixedChild.width;
  expect(Math.abs(scale - nestedContentScale)).toBeLessThan(0.001);
  expect(
    Math.abs(
      after.otherFrame.width / before.otherFrame.width - nestedContentScale,
    ),
  ).toBeLessThan(0.001);
  expect(after.nestedFrame.authoredWidth).toMatch(/\d+\.\d+px/);
  expect(after.nestedFrame.authoredHeight).toMatch(/\d+\.\d+px/);
  expect(after.otherFrame.authoredWidth).toMatch(/\d+\.\d+px/);
  expect(
    (after.otherFrame.left - after.nestedFrame.left) /
      (before.otherFrame.left - before.nestedFrame.left),
  ).toBeCloseTo(nestedContentScale, 3);
  expect(after.fixedChild.width / before.fixedChild.width).toBeCloseTo(
    scale,
    1,
  );
  expect(after.otherChild.width / before.otherChild.width).toBeCloseTo(
    scale,
    1,
  );
  expect(after.nestedFrame.gap / before.nestedFrame.gap).toBeCloseTo(scale, 1);
  expect(
    after.nestedFrame.paddingLeft / before.nestedFrame.paddingLeft,
  ).toBeCloseTo(scale, 1);
  expect(after.fillChild.authoredWidth).toBe("");
  expect(after.fillChild.flex).toBe(before.fillChild.flex);
  expect(after.fillChild.width).toBeGreaterThan(before.fillChild.width);

  await app.settled();
  const scaledNodes = await app.savedNodes(designId);
  const afterSource = await sourceFile(page, designId, "index.html");
  expect(afterSource.content).toContain(
    'data-agent-native-node-id="nested-frame"',
  );
  expect(afterSource.content).toContain(
    `width: ${after.nestedFrame.authoredWidth}`,
  );
  expect(afterSource.content).toContain(
    `width: ${after.otherFrame.authoredWidth}`,
  );

  const indexFileId = (await app.savedRecord(designId)).files.find(
    (file) => file.filename === "index.html",
  )!.id;
  const undoSaveResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    if (
      request.method() !== "POST" ||
      new URL(response.url()).pathname !== "/_agent-native/actions/update-file"
    ) {
      return false;
    }
    const body = request.postDataJSON() as { id?: unknown; content?: unknown };
    return body.id === indexFileId && body.content === originalSource.content;
  });
  await page.keyboard.press(UNDO);
  await expect
    .poll(async () => (await groupState(page)).nestedFrame.width)
    .toBeCloseTo(before.nestedFrame.width, 0);
  await expect
    .poll(async () => (await groupState(page)).fixedChild.width)
    .toBeCloseTo(before.fixedChild.width, 0);
  const undoSaveResponse = await undoSaveResponsePromise;
  expect(await undoSaveResponse.finished()).toBeNull();
  expect(undoSaveResponse.status()).toBe(200);
  const undoSaveResult = (await undoSaveResponse.json()) as {
    updated?: unknown;
    versionHash?: unknown;
    skippedStaleMirror?: unknown;
    skippedStaleOperation?: unknown;
  };
  expect(undoSaveResult.updated).toBe(true);
  expect(undoSaveResult.versionHash).toBe(
    sourceContentHash(originalSource.content),
  );
  expect(undoSaveResult.skippedStaleMirror).toBeUndefined();
  expect(undoSaveResult.skippedStaleOperation).toBeUndefined();
  expect((await sourceFile(page, designId, "index.html")).content).toBe(
    originalSource.content,
  );

  await page.keyboard.press(REDO);
  await expect
    .poll(async () => (await groupState(page)).nestedFrame.width)
    .toBeCloseTo(after.nestedFrame.width, 0);
  const expectedRedoWidth = `width: ${after.nestedFrame.authoredWidth}`;
  await expect
    .poll(async () => (await sourceFile(page, designId, "index.html")).content)
    .toContain(expectedRedoWidth);

  await page.reload();
  await expect(
    page.locator("iframe[data-screen-iframe-id]").first(),
  ).toBeVisible();
  await expect
    .poll(async () => (await groupState(page)).nestedFrame.width)
    .toBeCloseTo(after.nestedFrame.width, 0);
  const afterReload = await groupState(page);
  expect(afterReload.fixedChild.width).toBeCloseTo(after.fixedChild.width, 0);
  expect(afterReload.otherChild.width).toBeCloseTo(after.otherChild.width, 0);
  const frameSpacing = {
    "padding-top": "10.14px",
    "padding-right": "10.14px",
    "padding-bottom": "10.14px",
    "padding-left": "10.14px",
    "row-gap": "12.68px",
    "column-gap": "12.68px",
    "font-size": "20.28px",
    "border-width": "2.54px 2.54px 2.54px 2.54px",
    top: "100px",
  };
  expect(styleOf(scaledNodes.get("nested-frame"))).toEqual({
    ...frameSpacing,
    left: "90px",
    width: "228.15px",
    height: "101.4px",
  });
  expect(styleOf(scaledNodes.get("other-frame"))).toEqual({
    ...frameSpacing,
    left: "338.43px",
    width: "258.57px",
    height: "152.1px",
  });
  expect(styleOf(scaledNodes.get("fixed-child"))).toEqual({
    width: "76.05px",
    height: "50.70px",
    "font-size": "20.28px",
  });
  expect(styleOf(scaledNodes.get("fill-child"))).toEqual({
    height: "50.70px",
    "font-size": "20.28px",
  });
  expect(styleOf(scaledNodes.get("other-child"))).toEqual({
    width: "50.70px",
    height: "38.03px",
    "font-size": "20.28px",
  });
});

// fixme: product bug: Phantom outline-width/border-width 4px on board-frame and board-child. The frame also keeps its stale 'gap:8px;padding:6px' shorthands
test.fixme("board K scales a selected nested Frame through the reserved board file", async ({
  app,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { designId, files } = await seedSizedScreen(app, FRAME_HTML, 400, 400, {
    "__board__.html": BOARD_HTML,
  });
  const boardFileId = files.find(
    (file) => file.filename === "__board__.html",
  )!.id;
  await action(page, "update-design", {
    id: designId,
    dataOperations: [{ op: "set", path: ["boardFileId"], value: boardFileId }],
  });
  await openOverview(
    page,
    designId,
    "iframe[data-design-preview-iframe]:not([data-screen-iframe-id])",
    "#board-frame",
  );
  const boardFrame = page.locator(
    "iframe[data-design-preview-iframe]:not([data-screen-iframe-id])",
  );
  await expect(boardFrame).toBeVisible();
  await chooseBoardLayer(page, "Board frame");
  await expect(
    page.getByRole("textbox", { name: "W size in pixels" }),
  ).toHaveValue("120px");
  const before = await boardState(page);
  expect(before.frame.width).toBeCloseTo(120, 0);
  expect(before.frame.height).toBeCloseTo(90, 0);

  await page.keyboard.press("k");
  await expect(
    page.getByRole("button", { name: "Scale", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("textbox", { name: "W size in pixels" }),
  ).toHaveValue("120px");
  const se = boardFrame
    .first()
    .contentFrame()
    .locator('[data-agent-native-edit-handle="se"]');
  await expect(se).toBeVisible();
  const handleBox = await se.boundingBox();
  if (!handleBox) throw new Error("board K-scale handle has no bounds");
  const handleHit = await page.evaluate(
    ({ x, y }) => {
      const iframe = document.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]:not([data-screen-iframe-id])",
      );
      const frameDocument = iframe?.contentDocument;
      if (!iframe || !frameDocument) return null;
      const rect = iframe.getBoundingClientRect();
      const localX =
        ((x - rect.left) / rect.width) *
        frameDocument.documentElement.clientWidth;
      const localY =
        ((y - rect.top) / rect.height) *
        frameDocument.documentElement.clientHeight;
      const outerTarget = document.elementFromPoint(x, y);
      return {
        outerTag: outerTarget?.tagName,
        outerTargetIsBoardIframe: outerTarget === iframe,
        outerTargetIsBoardResizeHandle:
          outerTarget?.getAttribute("data-resize-handle") === "se" &&
          outerTarget.closest("[data-board-object-selection-box]") !== null,
        innerHandle: frameDocument
          .elementFromPoint(localX, localY)
          ?.getAttribute("data-agent-native-edit-handle"),
      };
    },
    {
      x: handleBox.x + handleBox.width / 2,
      y: handleBox.y + handleBox.height / 2,
    },
  );
  expect(handleHit).toMatchObject({
    outerTargetIsBoardResizeHandle: true,
    innerHandle: "se",
  });
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 20, startY + 15, { steps: 3 });
  await expect
    .poll(async () => (await boardState(page)).frame.width)
    .toBeGreaterThan(before.frame.width);
  await cdpScreenshot(
    page,
    testInfo.outputPath("board-k-scale-in-progress.png"),
  );
  await page.mouse.move(startX + 40, startY + 30, { steps: 3 });
  await page.mouse.up();
  await expect
    .poll(async () => (await boardState(page)).frame.width)
    .toBeGreaterThan(before.frame.width);
  const after = await boardState(page);
  const scale = after.frame.width / before.frame.width;
  expect(after.frame.height / before.frame.height).toBeCloseTo(scale, 1);
  expect(after.frame.gap / before.frame.gap).toBeCloseTo(scale, 1);
  expect(after.frame.paddingLeft / before.frame.paddingLeft).toBeCloseTo(
    scale,
    1,
  );
  expect(after.child.width / before.child.width).toBeCloseTo(scale, 1);

  const expectedBoardWidth = `width: ${after.frame.authoredWidth}`;
  const expectedBoardChildWidth = `width: ${after.child.authoredWidth}`;
  await expect
    .poll(
      async () => (await sourceFile(page, designId, "__board__.html")).content,
    )
    .toContain(expectedBoardWidth);
  const afterSource = await sourceFile(page, designId, "__board__.html");
  expect(afterSource.content).toContain(expectedBoardWidth);
  expect(afterSource.content).toContain(expectedBoardChildWidth);
  const scaledBoard = await app.savedNodes(designId, "__board__.html");

  await page.keyboard.press(UNDO);
  await expect
    .poll(async () => (await boardState(page)).frame.width)
    .toBeCloseTo(before.frame.width, 0);
  await expect
    .poll(
      async () => (await sourceFile(page, designId, "__board__.html")).content,
    )
    .toContain("width:120px");

  await page.keyboard.press(REDO);
  await expect
    .poll(async () => (await boardState(page)).frame.width)
    .toBeCloseTo(after.frame.width, 0);
  await expect
    .poll(
      async () => (await sourceFile(page, designId, "__board__.html")).content,
    )
    .toContain(expectedBoardWidth);
  await page.reload();
  await expect(boardFrame).toBeVisible();
  const afterReload = await boardState(page);
  expect(afterReload.frame.width).toBeCloseTo(after.frame.width, 0);
  expect(afterReload.child.width).toBeCloseTo(after.child.width, 0);
  expect(
    (await sourceFile(page, designId, "__board__.html")).content,
  ).toContain(`width: ${after.frame.authoredWidth}`);

  await chooseBoardLayer(page, "Board frame");
  await page.keyboard.press("v");
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const normalResizeHandle = page.locator(
    '[data-board-object-selection-box] [data-resize-handle="se"]',
  );
  await expect(normalResizeHandle).toBeVisible();
  const beforeNormalResize = await boardState(page);
  const beforeNormalSource = await sourceFile(page, designId, "__board__.html");
  await drag(page, normalResizeHandle, 40, 0);
  await expect
    .poll(async () => (await boardState(page)).frame.width)
    .toBeGreaterThan(beforeNormalResize.frame.width);
  const afterNormalResize = await boardState(page);
  expect(afterNormalResize.child.width).toBeCloseTo(
    beforeNormalResize.child.width,
    0,
  );
  const expectedNormalWidth = `width: ${afterNormalResize.frame.authoredWidth}`;
  await expect
    .poll(
      async () => (await sourceFile(page, designId, "__board__.html")).content,
    )
    .toContain(expectedNormalWidth);

  await page.keyboard.press(UNDO);
  await expect
    .poll(async () => (await boardState(page)).frame.width)
    .toBeCloseTo(beforeNormalResize.frame.width, 0);
  await expect
    .poll(
      async () => (await sourceFile(page, designId, "__board__.html")).content,
    )
    .toContain(`width: ${beforeNormalResize.frame.authoredWidth}`);
  expect((await sourceFile(page, designId, "__board__.html")).content).toBe(
    beforeNormalSource.content,
  );

  await page.keyboard.press(REDO);
  await expect
    .poll(async () => (await boardState(page)).frame.width)
    .toBeCloseTo(afterNormalResize.frame.width, 0);
  await expect
    .poll(
      async () => (await sourceFile(page, designId, "__board__.html")).content,
    )
    .toContain(expectedNormalWidth);
  expect(styleOf(scaledBoard.get("board-frame"))).toEqual({
    position: "absolute",
    left: "420px",
    top: "100px",
    "box-sizing": "border-box",
    width: "160px",
    height: "120px",
    display: "flex",
    background: "#ddd",
    "padding-top": "8px",
    "padding-right": "8px",
    "padding-bottom": "8px",
    "padding-left": "8px",
    "row-gap": "10.67px",
    "column-gap": "10.67px",
    "font-size": "21.33px",
  });
  expect(styleOf(scaledBoard.get("board-child"))).toEqual({
    width: "40px",
    height: "26.67px",
    background: "#2563eb",
    "font-size": "21.33px",
  });
});

// fixme: product bug: The refusal toast reads the raw status 'absent'. use-editor-screen-rendering passes patch.reason (a resolver status) to
test.fixme("a refused K-scale source update restores the live preview, saves nothing, and explains the refusal", async ({
  app,
  page,
}) => {
  const selectorMissing =
    "The selected element has no editable match in this screen's source. If a component renders it, apply the change through the agent.";
  app.allowFailure(
    /^error toast The selected element has no editable match/,
    "the scenario's refusal is reported",
  );
  const { designId } = await seedSizedScreen(app, REFUSAL_HTML, 400, 400);
  await openAndFit(app, designId);
  const child = app.node("child");
  const savedBefore = await app.savedHtml(designId);
  await child.evaluate((element) => {
    const scale = (
      element.ownerDocument.defaultView as unknown as {
        __designCanvasScaleContents: (factor: number, phase: string) => unknown;
      }
    ).__designCanvasScaleContents;
    scale(1, "begin");
    scale(1.5, "preview");
  });
  await expect(child).toHaveCSS("width", "90px");

  await child.evaluate((element) => {
    element.ownerDocument.defaultView!.parent.postMessage(
      {
        type: "visual-style-batch-change",
        changes: [
          {
            selector: '[data-agent-native-node-id="missing"]',
            sourceId: "missing",
            styles: { width: "90px" },
            originalStyles: { width: "60px" },
            preserveSelection: true,
          },
        ],
      },
      "*",
    );
  });
  await app.settled();

  await expect(child).toHaveCSS("width", "60px");
  expect(await app.savedHtml(designId)).toBe(savedBefore);
  await expect(page.getByText(selectorMissing, { exact: true })).toBeVisible();
});

test("a malformed K-scale batch commits none of its valid entries and leaves nothing to undo", async ({
  app,
  page,
}) => {
  const { designId } = await seedSizedScreen(app, REFUSAL_HTML, 400, 400);
  await openAndFit(app, designId);
  const child = app.node("child");
  const savedBefore = await app.savedHtml(designId);
  await child.evaluate((element) => {
    const scale = (
      element.ownerDocument.defaultView as unknown as {
        __designCanvasScaleContents: (factor: number, phase: string) => unknown;
      }
    ).__designCanvasScaleContents;
    scale(1, "begin");
    scale(1.5, "preview");
  });
  await expect(child).toHaveCSS("width", "90px");

  await child.evaluate((element) => {
    element.ownerDocument.defaultView!.parent.postMessage(
      {
        type: "visual-style-batch-change",
        changes: [
          {
            selector: '[data-agent-native-node-id="child"]',
            sourceId: "child",
            styles: { width: "90px" },
            originalStyles: { width: "60px" },
            preserveSelection: true,
          },
          { selector: 7, sourceId: "missing", styles: { width: "120px" } },
        ],
      },
      "*",
    );
  });
  await app.settled();

  await expect(child).toHaveCSS("width", "60px");
  expect(await app.savedHtml(designId)).toBe(savedBefore);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: /^Edit$/ }).hover();
  await expect(page.getByRole("menuitem", { name: /Undo/ })).toBeDisabled();
});

// fixme: product bug: Phantom outline-width 4.50px and border-width 4.50px x4 on both the frame and the borderless SVG.
test.fixme("K-dragging a Frame to 1.5x scales its SVG child to 120x90, saves it, and undo and redo restore each size", async ({
  app,
  page,
}) => {
  const { designId, fileId } = await seedSizedScreen(
    app,
    VECTOR_HTML,
    400,
    400,
  );
  await openAndFit(app, designId);
  await selectOnCanvas(app, "vector-frame", "Vector frame");
  expect(await renderedBox(app, "vector")).toEqual({ width: 80, height: 60 });
  const before = await app.savedNodes(designId);

  await page.keyboard.press("k");
  await expect(
    page.getByRole("button", { name: "Scale", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await dragHandleBy(app, fileId, 100, 80);

  expect(await renderedBox(app, "vector-frame")).toEqual({
    width: 300,
    height: 240,
  });
  expect(await renderedBox(app, "vector")).toEqual({ width: 120, height: 90 });
  const scaled = await app.savedNodes(designId);
  expectOnlyChanged(before, scaled, ["vector-frame", "vector"]);

  await page.keyboard.press(UNDO);
  await app.settled();
  expect(await renderedBox(app, "vector")).toEqual({ width: 80, height: 60 });
  expectOnlyChanged(before, await app.savedNodes(designId), []);

  await page.keyboard.press(REDO);
  await app.settled();
  expect(await renderedBox(app, "vector")).toEqual({ width: 120, height: 90 });
  expectOnlyChanged(scaled, await app.savedNodes(designId), []);
  expect(styleOf(scaled.get("vector-frame"))).toEqual({
    ...styleOf(before.get("vector-frame")),
    width: "300px",
    height: "240px",
    "font-size": "24px",
  });
  // The SVG keeps its pre-scale type metrics; its viewBox already scales any text inside.
  expect(styleOf(scaled.get("vector"))).toEqual({
    width: "120px",
    height: "90px",
    "font-size": "16px",
    "line-height": "normal",
    "letter-spacing": "normal",
    "word-spacing": "0px",
  });
});

// fixme: product bug: The typed factor rescales from browser-rounded computed borders. Chrome lays out 1.5px/4.5px as 1px/4px, so the saved border-width is
test.fixme("the inspector Scale factor follows a K-drag to 1.5x and a typed 2 scales the Frame about its centre to twice its original size", async ({
  app,
  page,
}) => {
  const { designId, fileId } = await seedSizedScreen(app, FRAME_HTML, 400, 400);
  await openAndFit(app, designId);
  await selectOnCanvas(app, "ordinary-frame", "Ordinary Frame");
  const before = await app.savedNodes(designId);

  await page.keyboard.press("k");
  const factor = page.getByLabel("Scale factor", { exact: true });
  await expect(factor).toHaveValue("1x");
  await dragHandleBy(app, fileId, 100, 80);
  await expect(factor).toHaveValue("1.5x");

  await factor.fill("2");
  await factor.press("Enter");
  await app.settled();

  expect(await renderedBox(app, "ordinary-frame")).toEqual({
    width: 400,
    height: 320,
  });
  await expect(factor).toBeHidden();
  const after = await app.savedNodes(designId);
  expectOnlyChanged(before, after, [
    "ordinary-frame",
    "fixed-child",
    "fill-child",
  ]);
  expect(styleOf(after.get("ordinary-frame"))).toEqual({
    "padding-top": "16px",
    "padding-right": "16px",
    "padding-bottom": "16px",
    "padding-left": "16px",
    "row-gap": "20px",
    "column-gap": "20px",
    "border-width": "2px 4px 6px 8px",
    left: "50px",
    top: "60px",
    width: "400px",
    height: "320px",
    "font-size": "32px",
  });
  expect(styleOf(after.get("fixed-child"))).toEqual({
    width: "120px",
    height: "80px",
    "font-size": "32px",
    "border-width": "2px 4px 6px 8px",
  });
  expect(styleOf(after.get("fill-child"))).toEqual({
    height: "80px",
    "font-size": "32px",
  });
});
