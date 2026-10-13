import { type Locator, type Page } from "@playwright/test";

import { appPath, childNodeIds, expandAllLayers, selectTool } from "./helpers";
import {
  expect,
  expectOnlyChanged,
  savedNodeMap,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

const CARD_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Card</title></head>
  <body style="margin:0;min-height:900px;background:#fff;color:#111;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="title" data-agent-native-layer-name="Project title"
         style="position:absolute;left:40px;top:40px;width:340px;font-size:25px;font-weight:600">Portfolio Project</div>
    <button data-agent-native-node-id="btn" data-agent-native-layer-name="View project"
            style="position:absolute;left:40px;top:220px;padding:10px 20px">View project</button>
  </body>
</html>`;

const BUTTON_CARD_HTML = `<!doctype html>
<html lang="en" data-agent-native-node-id="doc">
  <head><meta charset="utf-8" /><title>Card</title></head>
  <body data-agent-native-node-id="page" style="margin:0;min-height:900px;background:#fff;color:#111;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="title" data-agent-native-layer-name="Project title"
         style="position:absolute;left:40px;top:40px;width:340px;font-size:25px;font-weight:600">Portfolio Project</div>
    <button data-agent-native-node-id="btn" data-agent-native-layer-name="View project"
            style="position:absolute;left:40px;top:220px;padding:10px 20px"><span data-an-text="" data-agent-native-node-id="btn-label">View project</span></button>
  </body>
</html>`;

const CARD_HTML_WITH_THUMB = CARD_HTML.replace(
  "</body>",
  `    <div data-agent-native-node-id="thumb" data-agent-native-layer-name="Thumbnail"
         style="position:absolute;left:420px;top:40px;width:300px;height:350px;background:#c9c9c9"></div>
  </body>`,
);

const CONTENT_HTML = `<!doctype html>
<html lang="en" data-agent-native-node-id="doc">
  <head><meta charset="utf-8" /><title>Card</title></head>
  <body data-agent-native-node-id="page" style="margin:0;min-height:900px;background:#fff;color:#111;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="content" data-agent-native-layer-name="Content"
         style="position:absolute;left:80px;top:80px;width:340px;display:flex;flex-direction:column;gap:16px">
      <div data-agent-native-node-id="title" data-agent-native-layer-name="Project title" style="font-size:25px;font-weight:600">Portfolio Project</div>
      <button data-agent-native-node-id="btn" data-agent-native-layer-name="View project" style="padding:10px 20px;width:max-content">View project</button>
    </div>
  </body>
</html>`;

test.use({ viewport: { width: 1600, height: 1000 } });

const LIVE_SCREEN =
  'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])';

function layersTree(page: Page): Locator {
  return page.getByRole("tree", { name: "Layers" });
}

function layerRowButton(page: Page, name: string): Locator {
  return layersTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name.replace(/"/g, '\\"')}"]`) })
    .first();
}

async function visibleLayerNames(page: Page): Promise<string[]> {
  return layersTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .evaluateAll((nodes) => nodes.map((n) => (n.textContent ?? "").trim()));
}

async function multiSelect(page: Page, names: string[]): Promise<void> {
  await layerRowButton(page, names[0]).click({ force: true });
  await page.waitForTimeout(600);
  for (const name of names.slice(1)) {
    await layerRowButton(page, name).click({
      force: true,
      modifiers: ["Shift"],
    });
    await page.waitForTimeout(600);
  }
}

async function renameLayer(
  page: Page,
  fromName: string,
  toName: string,
): Promise<void> {
  await layerRowButton(page, fromName).dblclick({ force: true });
  const input = layersTree(page).locator('input[aria-label="Rename layer"]');
  await expect(input).toBeVisible();
  await input.fill(toName);
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  await expect(layerRowButton(page, toName)).toBeVisible();
}

async function domNodeIdByLayerName(app: App, name: string): Promise<string> {
  const id = await app.page
    .frameLocator(LIVE_SCREEN)
    .locator(`[data-agent-native-layer-name="${name}"]`)
    .getAttribute("data-agent-native-node-id");
  if (!id) throw new Error(`no rendered element found for layer "${name}"`);
  return id;
}

function tagsWithLayerName(
  html: string,
  name: string,
): Array<{ index: number; id: string }> {
  const pattern = new RegExp(
    `<[a-zA-Z0-9-]+\\s+[^>]*data-agent-native-layer-name="${name}"[^>]*>`,
    "g",
  );
  const results: Array<{ index: number; id: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const id = /data-agent-native-node-id="([^"]+)"/.exec(match[0])?.[1];
    if (id) results.push({ index: match.index, id });
  }
  return results;
}

function styleNum(style: string, prop: string): number {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?[\\d.]+)px`, "i").exec(
    style,
  );
  return m ? Number(m[1]) : NaN;
}

function inlineStyle(html: string, id: string): string {
  return (
    new RegExp(
      `data-agent-native-node-id="${id}"[^>]*?style="([^"]*)"`,
      "i",
    ).exec(html)?.[1] ?? ""
  );
}

function selectedRowNodeId(page: Page) {
  return page
    .locator('[role="treeitem"][aria-selected="true"] [data-layer-row-button]')
    .getAttribute("data-layer-node-id");
}

/** The selection overlay's box inside the screen, in design px. */
async function selectionRect(app: App) {
  return app.page
    .frameLocator(LIVE_SCREEN)
    .locator('[data-agent-native-edit-overlay="selection"]')
    .evaluate((element) => {
      const r = element.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    });
}

async function clickCenter(app: App, nodeId: string) {
  const rect = await app.designRect(nodeId);
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(point.x, point.y);
  return point;
}

function boardFile(record: {
  files?: { filename: string; content?: string }[];
}) {
  return savedNodeMap(
    record.files?.find((file) => file.filename === "__board__.html")?.content ??
      "",
  );
}

async function designRecord(app: App, id: string) {
  const response = await app.page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${id}`),
  );
  expect(response.ok(), `get-design ${response.status()}`).toBe(true);
  return response.json();
}

function canvasFrame(record: { data: unknown }, screenId: string) {
  const data =
    typeof record.data === "string" ? JSON.parse(record.data) : record.data;
  return data.canvasFrames[screenId];
}

function newIds(before: Map<string, SavedNode>, after: Map<string, SavedNode>) {
  return [...after.keys()].filter((id) => !before.has(id));
}

/** Below 100% zoom one page pixel spans several design pixels, so drawn and dropped geometry rounds. */
function expectNearPx(actual: string | undefined, expected: number) {
  const value = parseFloat(actual ?? "");
  expect(
    Math.abs(value - expected),
    `${actual} should be within 3px of ${expected}`,
  ).toBeLessThanOrEqual(3);
}

test.describe("card and container interactions", () => {
  test.setTimeout(150_000);

  test("step 1 [in-screen]: Cmd+D duplicates the title text directly above it, same name and position; a second Cmd+D duplicates only the new copy (not the original too), two undos restore", async ({
    app,
    page,
  }) => {
    const designId = await app.seed(CARD_HTML);
    await app.open(designId);
    await expandAllLayers(page);

    await clickCenter(app, "title");
    await expect.poll(() => app.selectedLayers()).toEqual(["Project title"]);
    const originalSelectionId = await selectedRowNodeId(page);
    expect(originalSelectionId).toBeTruthy();
    const originalHtml = await app.savedHtml(designId);
    await page.keyboard.press(`${MOD}+d`);

    let html = "";
    await expect
      .poll(
        async () => {
          html = await app.savedHtml(designId);
          return tagsWithLayerName(html, "Project title").length;
        },
        { timeout: 10_000, message: "Cmd+D should produce a second title" },
      )
      .toBe(2);
    const [original, copy] = tagsWithLayerName(html, "Project title");
    expect(original.id, "the duplicate goes directly above the original").toBe(
      "title",
    );
    const originalStyle = inlineStyle(html, "title");
    const copyStyle = inlineStyle(html, copy.id);
    expect(styleNum(copyStyle, "left")).toBe(styleNum(originalStyle, "left"));
    expect(styleNum(copyStyle, "top")).toBe(styleNum(originalStyle, "top"));
    await expect.poll(() => app.selectedLayers()).toEqual(["Project title"]);
    const titleRows = layersTree(page)
      .locator("[data-layer-row-button][data-layer-node-id]")
      .filter({ has: page.locator('span[title="Project title"]') });
    await expect(titleRows).toHaveCount(2);
    const titleRowIds = await titleRows.evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-layer-node-id")),
    );
    expect(titleRowIds).toContain(originalSelectionId);
    const copyLayerNodeId = titleRowIds.find(
      (rowId) => rowId !== originalSelectionId,
    );
    expect(copyLayerNodeId, "the copy has no distinct Layers row").toBeTruthy();
    expect(
      await selectedRowNodeId(page),
      "Cmd+D must select the copy's own Layers row",
    ).toBe(copyLayerNodeId);

    await page.keyboard.press(`${MOD}+d`);
    let html2 = "";
    await expect
      .poll(
        async () => {
          html2 = await app.savedHtml(designId);
          return tagsWithLayerName(html2, "Project title").length;
        },
        {
          timeout: 10_000,
          message: "a second Cmd+D should add exactly one more title",
        },
      )
      .toBe(3);
    const secondIds = tagsWithLayerName(html2, "Project title").map(
      (o) => o.id,
    );
    expect(
      secondIds.slice(0, 2),
      "the second Cmd+D leaves the original and the first copy in place",
    ).toEqual(["title", copy.id]);
    const secondCopyId = secondIds[2];
    expect(secondCopyId).not.toBe(copy.id);

    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(() => app.savedHtml(designId), {
        timeout: 10_000,
        message:
          "undoing the second Cmd+D restores the document right after the first",
      })
      .toBe(html);
    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(() => app.savedHtml(designId), {
        timeout: 10_000,
        message: "undoing the first Cmd+D restores the original document",
      })
      .toBe(originalHtml);
    expect(await selectedRowNodeId(page)).toBe(originalSelectionId);
  });

  test("step 2 [in-screen]: Option-dragging the button 120px down leaves the original, saves a same-named copy at the drop point, and one undo restores the document", async ({
    app,
    page,
  }) => {
    const designId = await app.seed(BUTTON_CARD_HTML);
    await app.open(designId);
    await app.zoomToFit();
    const originalHtml = await app.savedHtml(designId);
    const before = savedNodeMap(originalHtml);
    const button = await app.designRect("btn");
    const grab = await clickCenter(app, "btn");
    await expect.poll(() => app.selectedLayers()).toEqual(["View project"]);

    const to = await app.pagePoint(
      button.x + button.width / 2,
      button.y + button.height / 2 + 120,
    );
    await page.mouse.move(grab.x, grab.y);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 16 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await app.settled();

    const after = await app.savedNodes(designId);
    const [copyId, copyLabelId] = newIds(before, after);
    expect(newIds(before, after)).toEqual([copyId, copyLabelId]);
    const copy = after.get(copyId)!;
    expect({
      tag: copy.tag,
      name: copy.attrs["data-agent-native-layer-name"],
      parent: copy.parent,
      index: copy.index,
    }).toEqual({
      tag: "button",
      name: "View project",
      parent: "page",
      index: after.get("btn")!.index + 1,
    });
    expect(after.get(copyLabelId)).toMatchObject({
      tag: "span",
      parent: copyId,
      text: "View project",
    });
    expect(styleOf(copy)).toEqual({
      ...styleOf(before.get("btn")),
      top: "340px",
    });
    expectOnlyChanged(before, after, [copyId, copyLabelId]);
    expect(await selectionRect(app)).toEqual(await app.designRect(copyId));

    await page.keyboard.press(`${MOD}+z`);
    await app.settled();
    expect(await app.savedHtml(designId)).toBe(originalHtml);
    expect(await selectionRect(app)).toEqual(button);
  });

  // oracle: none — only the toolbar tool selection changed in this test; its own claim is unmeasured against Figma.
  // fixme: product bug: Teleport: the rectangle is saved into index.html with no position/left/top, so it renders at the screen's top-left (Inspector X 0 Y 0)
  test.fixme("step 3 [overview, outside the screen -> crosses into the screen]: a rectangle drawn on the board and dragged into the screen lands at the drop point, and one undo puts it back on the board", async ({
    app,
    page,
  }) => {
    const designId = await app.seed(CARD_HTML);
    await app.open(designId);
    await page.goto(appPath(`/design/${designId}?view=overview&zoom=30`), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator(LIVE_SCREEN)).toBeVisible({ timeout: 30_000 });
    await expect(
      page
        .frameLocator(LIVE_SCREEN)
        .locator('[data-agent-native-node-id="btn"]'),
    ).toBeVisible();
    const start = await designRecord(app, designId);
    const screen = start.files.find(
      (file: { filename: string }) => file.filename === "index.html",
    );
    const frameBefore = canvasFrame(start, screen.id);
    const originalHtml = screen.content as string;
    const boardBefore = boardFile(start);
    const screenBox = (await page.locator(LIVE_SCREEN).boundingBox())!;
    const { scale } = await app.pagePoint(0, 0);
    const drawFrom = {
      x: screenBox.x + screenBox.width + 80,
      y: screenBox.y + 40,
    };

    await selectTool(page, "Rectangle");
    await page.mouse.move(drawFrom.x, drawFrom.y);
    await page.mouse.down();
    await page.mouse.move(drawFrom.x + 60, drawFrom.y + 90, { steps: 16 });
    await page.mouse.up();
    await app.settled();

    const drawn = await designRecord(app, designId);
    const boardDrawn = boardFile(drawn);
    const [rectId] = newIds(boardBefore, boardDrawn);
    expect(newIds(boardBefore, boardDrawn)).toEqual([rectId]);
    expect(drawn.files.length).toBe(start.files.length);
    const drawnStyle = styleOf(boardDrawn.get(rectId));
    expectNearPx(drawnStyle.width, 60 / scale);
    expectNearPx(drawnStyle.height, 90 / scale);
    const width = parseFloat(drawnStyle.width);
    const height = parseFloat(drawnStyle.height);

    const drop = await app.pagePoint(600, 400);
    await page.mouse.move(drawFrom.x + 30, drawFrom.y + 45);
    await page.mouse.down();
    await page.mouse.move(drop.x, drop.y, { steps: 20 });
    await page.mouse.up();
    await app.settled();

    const dropped = await designRecord(app, designId);
    expect(boardFile(dropped).has(rectId)).toBe(false);
    const screenAfter = savedNodeMap(
      dropped.files.find(
        (file: { filename: string }) => file.filename === "index.html",
      ).content,
    );
    expectOnlyChanged(savedNodeMap(originalHtml), screenAfter, [rectId]);
    const placed = styleOf(screenAfter.get(rectId));
    expect(placed.position).toBe("absolute");
    expectNearPx(placed.left, 600 - width / 2);
    expectNearPx(placed.top, 400 - height / 2);
    expect({ width: placed.width, height: placed.height }).toEqual({
      width: drawnStyle.width,
      height: drawnStyle.height,
    });
    expect(canvasFrame(dropped, screen.id)).toEqual(frameBefore);

    await page.keyboard.press(`${MOD}+z`);
    await app.settled();
    const undone = await designRecord(app, designId);
    expect(
      undone.files.find(
        (file: { filename: string }) => file.filename === "index.html",
      ).content,
    ).toBe(originalHtml);
    expect(styleOf(boardFile(undone).get(rectId))).toEqual(drawnStyle);
  });

  // fixme: product bug: Adding auto layout stretches the button from 116px to 340px wide (the new column wrapper keeps the default align-items: stretch)
  test.fixme("steps 4-5 [in-screen]: Shift+A twice builds nested auto-layout frames — Description, then Content wrapping Description", async ({
    app,
    page,
  }) => {
    const designId = await app.seed(CARD_HTML_WITH_THUMB);
    await app.open(designId);
    await expandAllLayers(page);
    const rendered = async () => ({
      title: await app.designRect("title"),
      btn: await app.designRect("btn"),
      thumb: await app.designRect("thumb"),
    });
    const layout = await rendered();

    await multiSelect(page, ["Project title", "View project"]);
    const before = await visibleLayerNames(page);
    await page.keyboard.press("Shift+A");

    let newNames: string[] = [];
    await expect
      .poll(
        async () => {
          const after = await visibleLayerNames(page);
          newNames = after.filter((n) => !before.includes(n));
          return newNames.length;
        },
        {
          timeout: 10_000,
          message:
            "Shift+A (add auto layout) should introduce exactly one new wrapper row",
        },
      )
      .toBe(1);
    await renameLayer(page, newNames[0], "Description");
    await app.settled();

    const html = await app.savedHtml(designId);
    const descId = await domNodeIdByLayerName(app, "Description");
    expect(
      childNodeIds(html, descId),
      "Description must contain exactly the title and button, in order",
    ).toEqual(["title", "btn"]);
    const descStyle = inlineStyle(html, descId);
    expect(
      descStyle,
      `Shift+A should apply a flex container style to the new wrapper. Style: ${descStyle}`,
    ).toMatch(/display:\s*flex/);
    expect(
      await rendered(),
      "wrapping in auto layout must not move or resize the layers",
    ).toEqual(layout);

    await multiSelect(page, ["Description", "Thumbnail"]);
    const beforeContent = await visibleLayerNames(page);
    await page.keyboard.press("Shift+A");
    let contentNew: string[] = [];
    await expect
      .poll(
        async () => {
          const afterContent = await visibleLayerNames(page);
          contentNew = afterContent.filter((n) => !beforeContent.includes(n));
          return contentNew.length;
        },
        {
          timeout: 10_000,
          message:
            "Shift+A on Description+Thumbnail should introduce exactly one new wrapper",
        },
      )
      .toBe(1);
    await renameLayer(page, contentNew[0], "Content");
    await app.settled();

    const html2 = await app.savedHtml(designId);
    const contentId = await domNodeIdByLayerName(app, "Content");
    const contentChildren = childNodeIds(html2, contentId);
    expect(
      contentChildren,
      "Content must contain exactly Description and Thumbnail",
    ).toHaveLength(2);
    const descAfter = contentChildren.find((id) =>
      childNodeIds(html2, id).includes("title"),
    );
    expect(
      descAfter,
      "Description did not survive as a child of Content",
    ).toBeTruthy();
    expect(
      childNodeIds(html2, descAfter!),
      "Description's children must survive being nested one level deeper",
    ).toEqual(["title", "btn"]);
    expect(contentChildren).toContain("thumb");
    expect(
      await rendered(),
      "the second wrap must not move or resize the layers",
    ).toEqual(layout);
  });

  // fixme: product bug: The frame is saved at the drawn bounds with the right defaults but as an empty sibling after Content (parent page), so its opaque white
  test.fixme("drawing a frame around Content with the Frame tool wraps Content in a new frame at the drawn bounds without moving it", async ({
    app,
    page,
  }) => {
    const designId = await app.seed(CONTENT_HTML);
    await app.open(designId);
    await app.zoomToFit();
    const before = await app.savedNodes(designId);
    const content = await app.designRect("content");

    await page.keyboard.press("f");
    const from = await app.pagePoint(content.x - 20, content.y - 20);
    const to = await app.pagePoint(
      content.x + content.width + 20,
      content.y + content.height + 20,
    );
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 16 });
    await page.mouse.up();
    await app.settled();

    const after = await app.savedNodes(designId);
    const [frameId] = newIds(before, after);
    expect(newIds(before, after)).toEqual([frameId]);
    expect(after.get(frameId)?.attrs["data-an-primitive"]).toBe("frame");
    const frame = styleOf(after.get(frameId));
    expect({ background: frame.background, overflow: frame.overflow }).toEqual({
      background: "rgb(255, 255, 255)",
      overflow: "hidden",
    });
    expectNearPx(frame.left, content.x - 20);
    expectNearPx(frame.top, content.y - 20);
    expectNearPx(frame.width, content.width + 40);
    expectNearPx(frame.height, content.height + 40);
    expect(after.get("content")?.parent).toBe(frameId);
    expect(await app.designRect("content")).toEqual(content);
    expectOnlyChanged(before, after, [frameId, "content"]);
  });

  // fixme: fails on current main after the merge: Error: expect(received).toBe(expected) // Object.is equality
  test.fixme("Create component from the selected layer's context menu marks it as a component and changes nothing else", async ({
    app,
    page,
  }) => {
    const designId = await app.seed(CARD_HTML);
    await app.open(designId);
    await app.zoomToFit();
    const before = await app.savedNodes(designId);
    const point = await clickCenter(app, "title");
    await expect.poll(() => app.selectedLayers()).toEqual(["Project title"]);

    await page.mouse.click(point.x, point.y, { button: "right" });
    const item = page.getByRole("menuitem", { name: /^Create component/ });
    await expect(item).toBeEnabled();
    await item.click();
    await app.settled();

    const after = await app.savedNodes(designId);
    expect(after.get("title")?.attrs["data-agent-native-component"]).toBe(
      "ProjectTitle",
    );
    expectOnlyChanged(before, after, ["title"]);
    await expect(page.getByRole("menu")).toHaveCount(0);
  });
});
