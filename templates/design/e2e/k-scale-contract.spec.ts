import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { sourceContentHash } from "../shared/source-workspace.js";
import { appPath, cdpScreenshot, expandAllLayers, gotoEditor } from "./helpers";

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

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(`/_agent-native/actions/${name}`, {
    data: input,
  });
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

async function createDesign(
  request: APIRequestContext,
  title: string,
  content: string = FRAME_HTML,
  width = 400,
  height = 400,
) {
  const created = await action(request, "create-design", {
    title: `${title} ${Date.now()}`,
    projectType: "prototype",
  });
  const designId =
    created.id ?? (created.data as Record<string, unknown> | undefined)?.id;
  if (typeof designId !== "string")
    throw new Error("create-design returned no id");
  const file = await action(request, "create-file", {
    designId,
    filename: "index.html",
    content,
    fileType: "html",
  });
  const fileId =
    file.id ?? (file.data as Record<string, unknown> | undefined)?.id;
  if (typeof fileId !== "string") throw new Error("create-file returned no id");
  await action(request, "update-design", {
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
  return designId;
}

function layerRow(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first()
    .locator('xpath=ancestor::*[@role="treeitem"][1]');
}

async function enterFocusedEditMode(page: Page) {
  const home = page
    .locator("aside")
    .first()
    .locator('button[title="index.html"]');
  await home.click();
  await expect(home).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Edit", exact: true }).press("Enter");
  await expect(
    page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator('[data-agent-native-edit-overlay="shield"]'),
  ).toBeAttached();
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

async function readFrame(page: Page) {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator("#frame")
    .evaluate((element) => {
      const frame = element as HTMLElement;
      const fixed = frame.querySelector<HTMLElement>(".fixed")!;
      const fill = frame.querySelector<HTMLElement>(".fill")!;
      const bounds = frame.getBoundingClientRect();
      const fixedBounds = fixed.getBoundingClientRect();
      const fillBounds = fill.getBoundingClientRect();
      const style = getComputedStyle(frame);
      const fixedStyle = getComputedStyle(fixed);
      const fillStyle = getComputedStyle(fill);
      return {
        frame: {
          width: bounds.width,
          height: bounds.height,
          styleWidth: Number.parseFloat(style.width),
          styleHeight: Number.parseFloat(style.height),
          borderWidths: [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth,
          ].map(Number.parseFloat),
          authoredBorderWidths: [
            frame.style.borderTopWidth,
            frame.style.borderRightWidth,
            frame.style.borderBottomWidth,
            frame.style.borderLeftWidth,
          ].map(Number.parseFloat),
        },
        gap: Number.parseFloat(style.columnGap),
        paddingLeft: Number.parseFloat(style.paddingLeft),
        fixed: {
          width: fixedBounds.width,
          height: fixedBounds.height,
          styleWidth: Number.parseFloat(fixedStyle.width),
          styleHeight: Number.parseFloat(fixedStyle.height),
          authoredWidth: fixed.style.width,
          borderWidths: [
            fixedStyle.borderTopWidth,
            fixedStyle.borderRightWidth,
            fixedStyle.borderBottomWidth,
            fixedStyle.borderLeftWidth,
          ].map(Number.parseFloat),
          authoredBorderWidths: [
            fixed.style.borderTopWidth,
            fixed.style.borderRightWidth,
            fixed.style.borderBottomWidth,
            fixed.style.borderLeftWidth,
          ].map(Number.parseFloat),
        },
        fill: {
          width: fillBounds.width,
          height: fillBounds.height,
          authoredWidth: fill.style.width,
          flex: fillStyle.flex,
        },
      };
    });
}

async function sourceFile(
  request: APIRequestContext,
  designId: string,
  path: string,
) {
  if (path === "__board__.html") {
    const response = await request.get(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
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
  const response = await request.get(
    `/_agent-native/actions/read-source-file?${query.toString()}`,
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

test("K scaling preserves ordinary Frame proportions and Fill behavior across history, reload, and resize", async ({
  page,
  request,
}, testInfo) => {
  const designId = await createDesign(
    request,
    "K scale Frame contract",
    FRAME_HTML,
  );
  try {
    await gotoEditor(page, designId);
    await enterFocusedEditMode(page);
    await expandAllLayers(page);
    await layerRow(page, "Ordinary Frame")
      .locator("[data-layer-row-button]")
      .click();
    const before = await readFrame(page);
    const widthInput = page.getByRole("textbox", { name: "W size in pixels" });
    const heightInput = page.getByRole("textbox", { name: "H size in pixels" });
    await expect(widthInput).toBeVisible();
    expect(Number.parseFloat(await widthInput.inputValue())).toBeCloseTo(
      before.frame.width,
      0,
    );
    expect(Number.parseFloat(await heightInput.inputValue())).toBeCloseTo(
      before.frame.height,
      0,
    );

    await page.keyboard.press("k");
    const se = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator('[data-agent-native-edit-handle="se"]');
    await expect(se).toBeVisible();
    const handleBox = await se.boundingBox();
    if (!handleBox) throw new Error("K-scale handle has no bounds");
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 30, startY + 24, { steps: 4 });
    const framePreview = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame();
    const liveBadge = framePreview.locator(
      "[data-agent-native-transform-badge]",
    );
    await expect(liveBadge).toBeVisible();
    await expect(liveBadge).toHaveText(/\d+\s+x\s+\d+/);
    const midway = await readFrame(page);
    expect(midway.frame.width).toBeGreaterThan(before.frame.width);
    expect(midway.frame.height).toBeGreaterThan(before.frame.height);
    await cdpScreenshot(page, testInfo.outputPath("k-scale-in-progress.png"));
    await page.mouse.move(startX + 60, startY + 48, { steps: 4 });
    await expect
      .poll(async () => (await readFrame(page)).frame.width)
      .toBeGreaterThan(midway.frame.width);
    await page.mouse.up();
    await expect(liveBadge).toBeHidden();
    await expect
      .poll(async () => (await readFrame(page)).frame.width)
      .toBeGreaterThan(before.frame.width);
    const afterK = await readFrame(page);
    const scaleX = afterK.frame.width / before.frame.width;
    const scaleY = afterK.frame.height / before.frame.height;
    expect(afterK.frame.height).toBeGreaterThan(before.frame.height);
    expect(afterK.frame.styleWidth).toBeCloseTo(
      before.frame.styleWidth * scaleX,
      2,
    );
    expect(afterK.frame.styleHeight).toBeCloseTo(
      before.frame.styleHeight * scaleY,
      2,
    );
    expect(afterK.fixed.styleWidth).toBeCloseTo(
      before.fixed.styleWidth * scaleX,
      2,
    );
    expect(afterK.fixed.styleHeight).toBeCloseTo(
      before.fixed.styleHeight * scaleY,
      2,
    );
    expect(afterK.fixed.width).toBeCloseTo(before.fixed.width * scaleX, 0);
    expect(
      Math.abs(afterK.fixed.height - before.fixed.height * scaleY),
    ).toBeLessThanOrEqual(1);
    afterK.frame.authoredBorderWidths.forEach((value, index) =>
      expect(value).toBeCloseTo(before.frame.borderWidths[index] * scaleX, 2),
    );
    afterK.fixed.authoredBorderWidths.forEach((value, index) =>
      expect(value).toBeCloseTo(before.fixed.borderWidths[index] * scaleX, 2),
    );
    afterK.frame.borderWidths.forEach((value, index) =>
      expect(value).toBe(Math.floor(before.frame.borderWidths[index] * scaleX)),
    );
    afterK.fixed.borderWidths.forEach((value, index) =>
      expect(value).toBe(Math.floor(before.fixed.borderWidths[index] * scaleX)),
    );
    expect(afterK.gap).toBeCloseTo(before.gap * scaleX, 0);
    expect(afterK.paddingLeft).toBeCloseTo(before.paddingLeft * scaleX, 0);
    expect(afterK.fill.authoredWidth).toBe("");
    expect(afterK.fill.flex).toBe(before.fill.flex);
    expect(afterK.fill.width).toBeCloseTo(before.fill.width * scaleX, 0);
    expect(Number.parseFloat(await widthInput.inputValue())).toBeCloseTo(
      afterK.frame.width,
      0,
    );
    expect(Number.parseFloat(await heightInput.inputValue())).toBeCloseTo(
      afterK.frame.height,
      0,
    );

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: /^Edit$/ }).hover();
    await expect(page.getByRole("menuitem", { name: /Undo/ })).toBeEnabled();
    await page.keyboard.press("Escape");
    const undoShortcut = process.platform === "darwin" ? "Meta+Z" : "Control+Z";
    const redoShortcut =
      process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z";
    await page.keyboard.press(undoShortcut);
    await expect
      .poll(async () => (await readFrame(page)).frame.width)
      .toBeCloseTo(before.frame.width, 0);
    await expect
      .poll(async () => (await readFrame(page)).fixed.width)
      .toBeCloseTo(before.fixed.width, 0);
    const afterUndo = await readFrame(page);
    expect(afterUndo.frame.authoredBorderWidths).toEqual(
      before.frame.authoredBorderWidths,
    );
    expect(afterUndo.fixed.authoredBorderWidths).toEqual(
      before.fixed.authoredBorderWidths,
    );
    await page.keyboard.press(redoShortcut);
    await expect
      .poll(async () => (await readFrame(page)).frame.width)
      .toBeCloseTo(afterK.frame.width, 0);
    await expect
      .poll(async () => (await readFrame(page)).fixed.width)
      .toBeCloseTo(afterK.fixed.width, 0);
    const afterRedo = await readFrame(page);
    expect(afterRedo.frame.authoredBorderWidths).toEqual(
      afterK.frame.authoredBorderWidths,
    );
    expect(afterRedo.fixed.authoredBorderWidths).toEqual(
      afterK.fixed.authoredBorderWidths,
    );

    await page.reload();
    await enterFocusedEditMode(page);
    await expandAllLayers(page);
    await layerRow(page, "Ordinary Frame")
      .locator("[data-layer-row-button]")
      .click();
    const afterReload = await readFrame(page);
    expect(afterReload.frame.width).toBeCloseTo(afterK.frame.width, 0);
    expect(afterReload.frame.height).toBeCloseTo(afterK.frame.height, 0);
    expect(afterReload.frame.borderWidths).toEqual(afterK.frame.borderWidths);
    expect(afterReload.frame.authoredBorderWidths).toEqual(
      afterK.frame.authoredBorderWidths,
    );
    expect(afterReload.fixed.width).toBeCloseTo(afterK.fixed.width, 0);
    expect(afterReload.fixed.borderWidths).toEqual(afterK.fixed.borderWidths);
    expect(afterReload.fixed.authoredBorderWidths).toEqual(
      afterK.fixed.authoredBorderWidths,
    );
    expect(afterReload.fill.width).toBeCloseTo(afterK.fill.width, 0);
    expect(Number.parseFloat(await widthInput.inputValue())).toBeCloseTo(
      afterK.frame.width,
      0,
    );
    expect(Number.parseFloat(await heightInput.inputValue())).toBeCloseTo(
      afterK.frame.height,
      0,
    );
    const persistedSourceResponse = await request.get(
      `/_agent-native/actions/read-source-file?designId=${designId}&path=index.html`,
    );
    expect(persistedSourceResponse.ok()).toBe(true);
    const persistedSource = (await persistedSourceResponse.json()) as {
      content: string;
    };
    expect(persistedSource.content).toMatch(
      /data-agent-native-node-id="ordinary-frame"[^>]*style="[^"]*width:\s*300px/,
    );

    const moveTool = page.getByRole("button", { name: "Move", exact: true });
    const scaleTool = page.getByRole("button", {
      name: "Scale",
      exact: true,
    });
    await page.keyboard.press("k");
    await expect(scaleTool).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("v");
    await expect(moveTool).toHaveAttribute("aria-pressed", "true");
    const east = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator('[data-agent-native-edit-handle="se"]');
    await expect(east).toBeVisible();
    await drag(page, east, 40, 0);
    const afterNormalResize = await readFrame(page);
    expect(afterNormalResize.frame.width).toBeGreaterThan(
      afterReload.frame.width,
    );
    expect(afterNormalResize.fixed.width).toBeCloseTo(
      afterReload.fixed.width,
      0,
    );
    expect(afterNormalResize.fill.authoredWidth).toBe("");
    expect(afterNormalResize.fill.width).toBeGreaterThan(
      afterReload.fill.width,
    );
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("group K scales a nested Frame batch once and persists one undoable edit", async ({
  page,
  request,
}) => {
  const designId = await createDesign(
    request,
    "K scale nested multi-selection",
    GROUP_HTML,
    600,
    400,
  );
  try {
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
    const selectedLayerIds = await page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button][data-layer-node-id]")
      .evaluateAll((buttons) =>
        buttons
          .filter(
            (button) =>
              button
                .closest('[role="treeitem"]')
                ?.getAttribute("aria-selected") === "true",
          )
          .map((button) =>
            button.querySelector("span[title]")?.getAttribute("title"),
          )
          .sort(),
      );
    expect(selectedLayerIds).toEqual(["Nested frame", "Other frame"]);

    const before = await groupState(page);
    const originalSource = await sourceFile(request, designId, "index.html");
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
    expect((await sourceFile(request, designId, "index.html")).content).toBe(
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
    expect((await sourceFile(request, designId, "index.html")).content).toBe(
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
    expect(after.nestedFrame.gap / before.nestedFrame.gap).toBeCloseTo(
      scale,
      1,
    );
    expect(
      after.nestedFrame.paddingLeft / before.nestedFrame.paddingLeft,
    ).toBeCloseTo(scale, 1);
    expect(after.fillChild.authoredWidth).toBe("");
    expect(after.fillChild.flex).toBe(before.fillChild.flex);
    expect(after.fillChild.width).toBeGreaterThan(before.fillChild.width);

    const afterSource = await sourceFile(request, designId, "index.html");
    expect(afterSource.content).toContain(
      'data-agent-native-node-id="nested-frame"',
    );
    expect(afterSource.content).toContain(
      `width: ${after.nestedFrame.authoredWidth}`,
    );
    expect(afterSource.content).toContain(
      `width: ${after.otherFrame.authoredWidth}`,
    );

    const undoShortcut = process.platform === "darwin" ? "Meta+Z" : "Control+Z";
    const redoShortcut =
      process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z";

    const designResponse = await request.get(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    );
    if (!designResponse.ok())
      throw new Error(`get-design failed: ${designResponse.status()}`);
    const currentDesign = (await designResponse.json()) as {
      files?: Array<{ id?: string; filename: string }>;
    };
    const indexFileId = currentDesign.files?.find(
      (file) => file.filename === "index.html",
    )?.id;
    if (!indexFileId)
      throw new Error("get-design did not return index.html id");

    const undoSaveResponsePromise = page.waitForResponse((response) => {
      const request = response.request();
      if (
        request.method() !== "POST" ||
        new URL(response.url()).pathname !==
          "/_agent-native/actions/update-file"
      ) {
        return false;
      }
      const body = request.postDataJSON() as {
        id?: unknown;
        content?: unknown;
      };
      return body.id === indexFileId && body.content === originalSource.content;
    });
    await page.keyboard.press(undoShortcut);
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
    const afterUndoSource = await sourceFile(request, designId, "index.html");
    expect(afterUndoSource.content).toBe(originalSource.content);

    await page.keyboard.press(redoShortcut);
    await expect
      .poll(async () => (await groupState(page)).nestedFrame.width)
      .toBeCloseTo(after.nestedFrame.width, 0);
    const expectedRedoWidth = `width: ${after.nestedFrame.authoredWidth}`;
    await expect
      .poll(
        async () => (await sourceFile(request, designId, "index.html")).content,
      )
      .toContain(expectedRedoWidth);
    const afterRedoSource = await sourceFile(request, designId, "index.html");
    expect(afterRedoSource.content).toContain(expectedRedoWidth);

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
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("board K scales a selected nested Frame through the reserved board file", async ({
  page,
  request,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const designId = await createDesign(request, "K scale board");
  const board = await action(request, "create-file", {
    designId,
    filename: "__board__.html",
    content: BOARD_HTML,
    fileType: "html",
  });
  const boardFileId =
    board.id ?? (board.data as Record<string, unknown> | undefined)?.id;
  if (typeof boardFileId !== "string") {
    throw new Error("create-file did not return the board file id");
  }
  await action(request, "update-design", {
    id: designId,
    dataOperations: [{ op: "set", path: ["boardFileId"], value: boardFileId }],
  });
  try {
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
        async () =>
          (await sourceFile(request, designId, "__board__.html")).content,
      )
      .toContain(expectedBoardWidth);
    const afterSource = await sourceFile(request, designId, "__board__.html");
    expect(afterSource.content).toContain(expectedBoardWidth);
    expect(afterSource.content).toContain(expectedBoardChildWidth);

    const undoShortcut = process.platform === "darwin" ? "Meta+Z" : "Control+Z";
    const redoShortcut =
      process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z";
    await page.keyboard.press(undoShortcut);
    await expect
      .poll(async () => (await boardState(page)).frame.width)
      .toBeCloseTo(before.frame.width, 0);
    await expect
      .poll(
        async () =>
          (await sourceFile(request, designId, "__board__.html")).content,
      )
      .toContain("width:120px");
    const undoSource = await sourceFile(request, designId, "__board__.html");
    expect(undoSource.content).toContain("width:120px");

    await page.keyboard.press(redoShortcut);
    await expect
      .poll(async () => (await boardState(page)).frame.width)
      .toBeCloseTo(after.frame.width, 0);
    await expect
      .poll(
        async () =>
          (await sourceFile(request, designId, "__board__.html")).content,
      )
      .toContain(expectedBoardWidth);
    await page.reload();
    await expect(boardFrame).toBeVisible();
    const afterReload = await boardState(page);
    expect(afterReload.frame.width).toBeCloseTo(after.frame.width, 0);
    expect(afterReload.child.width).toBeCloseTo(after.child.width, 0);
    const persistedSource = await sourceFile(
      request,
      designId,
      "__board__.html",
    );
    expect(persistedSource.content).toContain(
      `width: ${after.frame.authoredWidth}`,
    );

    await chooseBoardLayer(page, "Board frame");
    await page.keyboard.press("v");
    const moveTool = page.getByRole("button", { name: "Move", exact: true });
    await expect(moveTool).toHaveAttribute("aria-pressed", "true");
    const normalResizeHandle = page.locator(
      '[data-board-object-selection-box] [data-resize-handle="se"]',
    );
    await expect(normalResizeHandle).toBeVisible();
    const beforeNormalResize = await boardState(page);
    const beforeNormalSource = await sourceFile(
      request,
      designId,
      "__board__.html",
    );
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
        async () =>
          (await sourceFile(request, designId, "__board__.html")).content,
      )
      .toContain(expectedNormalWidth);

    await page.keyboard.press(undoShortcut);
    await expect
      .poll(async () => (await boardState(page)).frame.width)
      .toBeCloseTo(beforeNormalResize.frame.width, 0);
    await expect
      .poll(
        async () =>
          (await sourceFile(request, designId, "__board__.html")).content,
      )
      .toContain(`width: ${beforeNormalResize.frame.authoredWidth}`);
    const normalUndoSource = await sourceFile(
      request,
      designId,
      "__board__.html",
    );
    expect(normalUndoSource.content).toBe(beforeNormalSource.content);

    await page.keyboard.press(redoShortcut);
    await expect
      .poll(async () => (await boardState(page)).frame.width)
      .toBeCloseTo(afterNormalResize.frame.width, 0);
    await expect
      .poll(
        async () =>
          (await sourceFile(request, designId, "__board__.html")).content,
      )
      .toContain(expectedNormalWidth);
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("a refused K-scale source update restores the live preview", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request, "K scale refusal", REFUSAL_HTML);
  try {
    await gotoEditor(page, designId);
    await enterFocusedEditMode(page);
    const frame = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame();
    const child = frame.locator("#child");
    await expect(child).toBeVisible();
    await child.evaluate((element) => {
      const win = element.ownerDocument.defaultView as
        | (Window & {
            __designCanvasScaleContents?: (
              factor: number,
              phase: string,
            ) => unknown;
          })
        | null;
      if (!win) throw new Error("Preview window unavailable");
      win.__designCanvasScaleContents?.(1, "begin");
      win.__designCanvasScaleContents?.(1.5, "preview");
    });
    await expect
      .poll(() => child.evaluate((element) => getComputedStyle(element).width))
      .toBe("90px");

    await child.evaluate((element) => {
      const win = element.ownerDocument.defaultView;
      if (!win) throw new Error("Preview window unavailable");
      win.parent.postMessage(
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
    await expect
      .poll(() => child.evaluate((element) => getComputedStyle(element).width))
      .toBe("60px");
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("a malformed K-scale batch cannot partially commit valid entries", async ({
  page,
  request,
}) => {
  const designId = await createDesign(
    request,
    "K scale malformed batch",
    REFUSAL_HTML,
  );
  try {
    await gotoEditor(page, designId);
    await enterFocusedEditMode(page);
    const child = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator("#child");
    await expect(child).toBeVisible();
    await child.evaluate((element) => {
      const win = element.ownerDocument.defaultView;
      if (!win) throw new Error("Preview window unavailable");
      const scale = (
        win as Window & {
          __designCanvasScaleContents?: (
            factor: number,
            phase: string,
          ) => unknown;
        }
      ).__designCanvasScaleContents;
      if (!scale) throw new Error("K-scale bridge unavailable");
      scale(1, "begin");
      scale(1.5, "preview");
      if (getComputedStyle(element).width !== "90px") {
        throw new Error("K-scale preview did not reach 90px");
      }
      win.parent.postMessage(
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
            {
              selector: 7,
              sourceId: "missing",
              styles: { width: "120px" },
            },
          ],
        },
        "*",
      );
    });
    await expect
      .poll(() => child.evaluate((element) => getComputedStyle(element).width))
      .toBe("60px");
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: /^Edit$/ }).hover();
    await expect(page.getByRole("menuitem", { name: /Undo/ })).toBeDisabled();
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("K scales an SVG vector through the semantic style fallback with history", async ({
  page,
  request,
}) => {
  const svgHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><style>html,body{margin:0;width:400px;height:400px}</style></head><body>
    <main id="vector-frame" data-agent-native-node-id="vector-frame" data-agent-native-layer-name="Vector frame" data-an-primitive="frame" style="position:absolute;left:100px;top:100px;width:200px;height:160px;display:flex;align-items:flex-start"><svg id="vector" data-agent-native-node-id="vector" data-agent-native-layer-name="Vector symbol" viewBox="0 0 80 60" style="width:80px;height:60px"><rect width="80" height="60" rx="8" fill="#2563eb" /></svg></main>
  </body></html>`;
  const designId = await createDesign(
    request,
    "K scale semantic SVG fallback",
    svgHtml,
  );
  const readVectorState = () =>
    page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator("#vector-frame")
      .evaluate((element) => {
        const frame = element as HTMLElement;
        const svg = frame.querySelector<SVGSVGElement>("#vector");
        if (!svg) throw new Error("Missing semantic vector child");
        const frameRect = frame.getBoundingClientRect();
        const rect = svg.getBoundingClientRect();
        return {
          frame: { width: frameRect.width, height: frameRect.height },
          vector: {
            width: rect.width,
            height: rect.height,
            authoredWidth: svg.style.width,
            authoredHeight: svg.style.height,
          },
        };
      });
  try {
    await gotoEditor(page, designId);
    await enterFocusedEditMode(page);
    await expandAllLayers(page);
    await layerRow(page, "Vector frame")
      .locator("[data-layer-row-button]")
      .click();
    const before = await readVectorState();
    expect(before.frame.width).toBeCloseTo(200, 0);
    expect(before.frame.height).toBeCloseTo(160, 0);
    expect(before.vector.width).toBeCloseTo(80, 0);
    expect(before.vector.height).toBeCloseTo(60, 0);

    await page.keyboard.press("k");
    const frame = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame();
    const scaleTool = page.getByRole("button", {
      name: "Scale",
      exact: true,
    });
    await expect(scaleTool).toHaveAttribute("aria-pressed", "true");
    const handle = frame.locator('[data-agent-native-edit-handle="se"]');
    await expect(handle).toBeVisible();
    await drag(page, handle, 40, 30);
    await expect
      .poll(async () => (await readVectorState()).vector.width)
      .toBeGreaterThan(before.vector.width);
    const after = await readVectorState();
    expect(after.frame.width).toBeGreaterThan(before.frame.width);
    expect(after.vector.width).toBeGreaterThan(before.vector.width);
    expect(after.vector.height).toBeGreaterThan(before.vector.height);
    const scale = after.frame.width / before.frame.width;
    expect(after.vector.width / before.vector.width).toBeCloseTo(scale, 2);
    expect(after.vector.height / before.vector.height).toBeCloseTo(scale, 2);

    const undoShortcut = process.platform === "darwin" ? "Meta+Z" : "Control+Z";
    const redoShortcut =
      process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z";
    await page.keyboard.press(undoShortcut);
    await expect.poll(readVectorState).toMatchObject({
      frame: before.frame,
      vector: {
        width: before.vector.width,
        height: before.vector.height,
      },
    });
    await page.keyboard.press(redoShortcut);
    await expect.poll(readVectorState).toMatchObject({
      frame: after.frame,
      vector: {
        width: after.vector.width,
        height: after.vector.height,
      },
    });

    await page.reload();
    await enterFocusedEditMode(page);
    await expandAllLayers(page);
    await layerRow(page, "Vector frame")
      .locator("[data-layer-row-button]")
      .click();
    await expect.poll(readVectorState).toMatchObject({
      frame: after.frame,
      vector: {
        width: after.vector.width,
        height: after.vector.height,
      },
    });
    const saved = await sourceFile(request, designId, "index.html");
    expect(saved.content).toContain('data-agent-native-node-id="vector"');
    const savedSvgStyle = saved.content.match(
      /<svg\b[^>]*data-agent-native-node-id="vector"[^>]*style="([^"]*)"/,
    )?.[1];
    if (!savedSvgStyle) throw new Error("Missing saved vector style");
    for (const [property, expected] of [
      ["width", Number.parseFloat(after.vector.authoredWidth)],
      ["height", Number.parseFloat(after.vector.authoredHeight)],
    ] as const) {
      const value = savedSvgStyle.match(
        new RegExp(`(?:^|;)\\s*${property}:\\s*([0-9.]+)px(?:;|$)`),
      )?.[1];
      expect(Number(value)).toBeCloseTo(expected, 2);
    }
    expect(saved.content).toMatch(
      /<svg\b[^>]*data-agent-native-node-id="vector"[^>]*style="[^"]*word-spacing:\s*0px(?:;|"|$)/,
    );
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("K opens the inspector Scale section, tracks the live factor, and applies a typed factor", async ({
  page,
  request,
}) => {
  const designId = await createDesign(
    request,
    "K scale inspector section",
    FRAME_HTML,
  );
  try {
    await gotoEditor(page, designId);
    await enterFocusedEditMode(page);
    await expandAllLayers(page);
    await layerRow(page, "Ordinary Frame")
      .locator("[data-layer-row-button]")
      .click();
    const before = await readFrame(page);

    await page.keyboard.press("k");
    const factor = page.getByLabel("Scale factor", { exact: true });
    await expect(factor).toHaveValue(/^1x?$/);

    const se = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator('[data-agent-native-edit-handle="se"]');
    await expect(se).toBeVisible();
    await drag(page, se, 40, 32);
    await expect
      .poll(async () => Number.parseFloat(await factor.inputValue()))
      .toBeGreaterThan(1);
    const afterDrag = await readFrame(page);

    await factor.fill("2");
    await factor.press("Enter");
    await expect
      .poll(async () => (await readFrame(page)).frame.width)
      .toBeCloseTo(before.frame.width * 2, 0);
    expect((await readFrame(page)).frame.width).toBeGreaterThan(
      afterDrag.frame.width,
    );
    await expect(factor).toBeHidden();

    await layerRow(page, "Fixed child")
      .locator("[data-layer-row-button]")
      .click();
    await layerRow(page, "Fill child")
      .locator("[data-layer-row-button]")
      .click({ modifiers: ["Shift"] });
    await expect(
      page.locator('[role="treeitem"][aria-selected="true"]'),
    ).toHaveCount(2);
    await page.keyboard.press("k");
    await expect(
      page.locator('button[aria-label="Scale"][aria-pressed="true"]'),
    ).toBeVisible();
    await expect(factor).toBeHidden();
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});
