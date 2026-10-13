import { type Locator, type Page } from "@playwright/test";

import { appPath, expandAllLayers } from "./helpers";
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

const CARD_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Card</title></head>
  <body data-agent-native-node-id="page" style="margin:0;position:relative;min-height:900px;background:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="card" data-agent-native-layer-name="Card"
         style="position:absolute;left:40px;top:40px;width:320px;height:360px;background:#fff">
      <div data-agent-native-node-id="image" data-agent-native-layer-name="Image"
           style="position:absolute;left:0;top:0;width:320px;height:180px;background:#e5e5e5"></div>
      <div data-agent-native-node-id="cardbody" data-agent-native-layer-name="CardBody"
           style="position:absolute;left:0;top:180px;width:320px;height:180px;padding:16px">
        <div data-agent-native-node-id="title" data-agent-native-layer-name="Wireless Headphones"
             style="position:absolute;left:16px;top:16px">Wireless Headphones</div>
        <div data-agent-native-node-id="desc" data-agent-native-layer-name="Description"
             style="position:absolute;left:16px;top:44px;color:#6b7280">Noise-cancelling, 30-hour battery</div>
        <div data-agent-native-node-id="statustag" data-agent-native-layer-name="StatusTag"
             style="position:absolute;left:16px;top:96px;background:#dcfce7;padding:4px 8px">In Stock</div>
        <div data-agent-native-node-id="price" data-agent-native-layer-name="Price"
             style="position:absolute;left:16px;top:72px;font-weight:700">$149</div>
      </div>
    </div>
  </body>
</html>`;

async function openSeeded(app: App, html: string) {
  const id = await app.seed(html);
  await app.open(id);
  await app.zoomToFit();
  return id;
}

/** A canvas click inside the Card picks the child under the pointer, so the Card itself is picked in Layers. */
async function selectCardRow(app: App) {
  await expandAllLayers(app.page);
  await layerRowButton(app.page, "Card").click();
  await expect(
    layerTree(app.page).locator('[role="treeitem"][aria-selected="true"]'),
  ).toHaveCount(1);
  await expect(layerRow(app.page, "Card")).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

/** Every node under `rootId` in document order, without ids, so a copy can be compared to its source. */
function subtreeShape(nodes: Map<string, SavedNode>, rootId: string) {
  const shape: { tag: string; attrs: Record<string, string>; text: string }[] =
    [];
  const visit = (id: string) => {
    const node = nodes.get(id)!;
    const { "data-agent-native-node-id": _id, ...attrs } = node.attrs;
    shape.push({ tag: node.tag, attrs, text: node.text });
    for (const child of childrenOf(nodes, id)) visit(child);
  };
  visit(rootId);
  return shape;
}

function attrsBesidesStyle(node: SavedNode | undefined) {
  const { style: _style, ...attrs } = node?.attrs ?? {};
  return attrs;
}

function subtreeIds(nodes: Map<string, SavedNode>, rootId: string): string[] {
  return [
    rootId,
    ...childrenOf(nodes, rootId).flatMap((child) => subtreeIds(nodes, child)),
  ];
}

type Frame = { x: number; y: number; width: number; height: number };

async function savedCanvasFrames(app: App, designId: string) {
  const { data } = await app.savedRecord(designId);
  return (data as { canvasFrames: Record<string, Frame> }).canvasFrames;
}

function layerTree(page: Page): Locator {
  return page.getByRole("tree", { name: "Layers" });
}

function layerRowButton(page: Page, name: string): Locator {
  return layerTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) });
}

function layerRow(page: Page, name: string): Locator {
  return layerRowButton(page, name).locator(
    'xpath=ancestor::*[@role="treeitem"][1]',
  );
}

/** Names of a layer's direct children as the Layers panel lists them, top row first. */
async function layerChildNames(page: Page, parentName: string) {
  const rows = await layerTree(page)
    .locator('[role="treeitem"]')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        level: Number(element.getAttribute("aria-level")),
        name:
          element
            .querySelector("[data-layer-row-name]")
            ?.getAttribute("title") ?? "",
      })),
    );
  const start = rows.findIndex((row) => row.name === parentName);
  const names: string[] = [];
  for (const row of rows.slice(start + 1)) {
    if (row.level <= rows[start].level) break;
    if (row.level === rows[start].level + 1) names.push(row.name);
  }
  return names;
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe("card component: structure, duplicate, rename, reorder, group", () => {
  test("Cmd+D duplicates the Card: same name, same position, inserted directly above, selection moves to the copy", async ({
    app,
  }) => {
    const id = await openSeeded(app, CARD_HTML);
    const before = await app.savedNodes(id);
    await selectCardRow(app);

    await app.page.keyboard.press(`${MOD}+d`);
    await app.settled();

    const after = await app.savedNodes(id);
    const copyId = childrenOf(after, "page")[1];
    expect(childrenOf(after, "page")).toStrictEqual(["card", copyId]);
    expect(subtreeShape(after, copyId)).toEqual(subtreeShape(before, "card"));
    const copyIds = subtreeIds(after, copyId);
    expect(
      copyIds.filter((nodeId) => before.has(nodeId)),
      "every node in the copy has a fresh id",
    ).toEqual([]);
    expectOnlyChanged(before, after, copyIds);
    expect(await app.designRect(copyId)).toEqual({
      x: 40,
      y: 40,
      width: 320,
      height: 360,
    });
    await expect(layerRow(app.page, "Card")).toHaveCount(2);
    await expect(layerRow(app.page, "Card").first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(layerRow(app.page, "Card").last()).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  test("renaming the duplicate's title layer in the layers panel only changes that layer, leaving the original untouched", async ({
    app,
  }) => {
    const id = await openSeeded(app, CARD_HTML);
    await selectCardRow(app);
    await app.page.keyboard.press(`${MOD}+d`);
    await app.settled();
    const duplicated = await app.savedNodes(id);
    const copyId = childrenOf(duplicated, "page")[1];
    const copyTitleId = subtreeIds(duplicated, copyId).find(
      (nodeId) =>
        duplicated.get(nodeId)?.attrs["data-agent-native-layer-name"] ===
        "Wireless Headphones",
    )!;
    expect(copyTitleId, "precondition: the copy has its own title").not.toBe(
      "title",
    );

    await expandAllLayers(app.page);
    await layerRowButton(app.page, "Wireless Headphones")
      .first()
      .dblclick({ force: true });
    const input = layerTree(app.page).locator(
      'input[aria-label="Rename layer"]',
    );
    await expect(input).toBeVisible();
    await input.fill("Bluetooth Speaker Title");
    await input.press("Enter");
    await expect(input).toHaveCount(0);
    await app.settled();

    const after = await app.savedNodes(id);
    expect(after.get(copyTitleId)?.attrs["data-agent-native-layer-name"]).toBe(
      "Bluetooth Speaker Title",
    );
    expect(after.get("title")?.attrs["data-agent-native-layer-name"]).toBe(
      "Wireless Headphones",
    );
    expectOnlyChanged(duplicated, after, [copyTitleId]);
    await expect(
      layerRowButton(app.page, "Bluetooth Speaker Title"),
    ).toHaveCount(1);
    await expect(layerRowButton(app.page, "Wireless Headphones")).toHaveCount(
      1,
    );
  });

  test("dragging Price below StatusTag in the layers panel reorders the DOM and persists after reload", async ({
    app,
  }) => {
    const id = await openSeeded(app, CARD_HTML);
    const before = await app.savedNodes(id);
    expect(childrenOf(before, "cardbody")).toEqual([
      "title",
      "desc",
      "statustag",
      "price",
    ]);
    await expandAllLayers(app.page);
    const statusTagRow = layerRow(app.page, "StatusTag");
    await statusTagRow.getByRole("button", { name: "Collapse layer" }).click();
    await expect(statusTagRow).toHaveAttribute("aria-expanded", "false");
    const statusTagBox = (await statusTagRow.boundingBox())!;

    await layerRow(app.page, "Price").dragTo(statusTagRow, {
      targetPosition: { x: 24, y: statusTagBox.height - 1 },
    });
    await app.settled();

    const after = await app.savedNodes(id);
    expect(childrenOf(after, "cardbody")).toEqual([
      "title",
      "desc",
      "price",
      "statustag",
    ]);
    expectOnlyChanged(before, after, ["price"]);
    expect(styleOf(after.get("price"))).toEqual(styleOf(before.get("price")));
    expect(await app.designRect("price")).toMatchObject({ x: 56, y: 292 });

    await app.open(id);
    await expandAllLayers(app.page);
    expect(await layerChildNames(app.page, "CardBody")).toEqual([
      "StatusTag",
      "Price",
      "Description",
      "Wireless Headphones",
    ]);
  });

  // fixme: product bug: The saved group wrapper has no style, so inside the absolute Card it renders 320x0: a flat selection outline and inspector H 0px instead
  test.fixme("Cmd+G on Image + CardBody makes a plain group with a tight bbox; one undo restores the two original siblings", async ({
    app,
  }) => {
    const id = await openSeeded(app, CARD_HTML);
    const beforeHtml = await app.savedHtml(id);
    const before = savedNodeMap(beforeHtml);
    await expandAllLayers(app.page);
    await layerRowButton(app.page, "Image").click();
    await layerRowButton(app.page, "CardBody").click({ modifiers: ["Shift"] });
    await expect(
      layerTree(app.page).locator('[role="treeitem"][aria-selected="true"]'),
    ).toHaveCount(2);

    await app.page.keyboard.press(`${MOD}+g`);
    await app.settled();

    const grouped = await app.savedNodes(id);
    const [groupId, ...others] = childrenOf(grouped, "card");
    expect(others).toEqual([]);
    expect(attrsBesidesStyle(grouped.get(groupId))).toEqual({
      "data-agent-native-node-id": groupId,
      "data-agent-native-layer-name": "Group",
      "data-agent-native-group-wrapper": "true",
      "data-agent-native-preserve-styles": "true",
      "data-agent-native-group": "true",
    });
    expect(childrenOf(grouped, groupId)).toEqual(["image", "cardbody"]);
    expect(styleOf(grouped.get(groupId)).overflow).toBeUndefined();
    expectOnlyChanged(before, grouped, [groupId, "image", "cardbody"]);
    expect(await app.designRect("image")).toEqual({
      x: 40,
      y: 40,
      width: 320,
      height: 180,
    });
    expect
      .soft(await app.designRect(groupId), "the group hugs Image + CardBody")
      .toEqual({ x: 40, y: 40, width: 320, height: 360 });
    await expect
      .soft(app.page.locator('input[aria-label="H size in pixels"]'))
      .toHaveValue("360px");

    await app.page.keyboard.press(`${MOD}+z`);
    await app.settled();
    expect(await app.savedHtml(id)).toBe(beforeHtml);
  });
});

function iconScreen(name: string) {
  return `<!doctype html><html><body style="margin:0;min-height:200px;background:#fff"><div data-agent-native-node-id="icon-${name.toLowerCase()}" data-agent-native-layer-name="${name} icon" style="position:absolute;left:20px;top:20px;width:80px;height:80px;background:#3b82f6"></div></body></html>`;
}

async function seedIconScreens(app: App) {
  const id = await app.seed(iconScreen("Home"), {
    files: {
      "search.html": iconScreen("Search"),
      "profile.html": iconScreen("Profile"),
    },
  });
  const { files } = await app.savedRecord(id);
  const fileIds = ["index.html", "search.html", "profile.html"].map(
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
            value: { sourceType: "inline", width: 200, height: 200 },
          },
          {
            op: "set",
            path: ["canvasFrames", fileId],
            value: { x: index * 400, y: 0, width: 200, height: 200, z: index },
          },
        ]),
      },
    },
  );
  expect(response.ok(), `update-design ${response.status()}`).toBe(true);
  return { id, fileIds };
}

async function stableBox(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  let last: { x: number; y: number; width: number } | null = null;
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox();
        const stable =
          box !== null &&
          last !== null &&
          Math.abs(box.x - last.x) < 1 &&
          Math.abs(box.y - last.y) < 1 &&
          Math.abs(box.width - last.width) < 1;
        last = box;
        return stable;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  return (await locator.boundingBox())!;
}

async function openOverview(page: Page, designId: string, screens: number) {
  await page.goto(appPath(`/design/${designId}?view=overview&zoom=60`), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("[data-screen-shell]")).toHaveCount(screens, {
    timeout: 30_000,
  });
  await stableBox(page.locator("[data-screen-card]").first());
  await expect(page.getByRole("button", { name: "60%" })).toBeVisible();
  for (const card of await page.locator("[data-screen-card]").all()) {
    await expect(card).toBeInViewport();
  }
}

async function selectedScreenIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.isArray((window as any).__designSelection?.selectedScreenIds)
      ? [...(window as any).__designSelection.selectedScreenIds]
      : [],
  );
}

/** Picking a Screen by its label fits the camera to it, so the next label has to be brought back into view. */
async function zoomTo50Percent(page: Page) {
  await page
    .getByRole("button", { name: /^\d+%$/ })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Zoom to 50%" }).click();
  await expect(page.getByRole("button", { name: "50%" })).toBeVisible();
}

test.describe("overview canvas: multi-select, marquee enclosure, pan/zoom", () => {
  test("shift-clicking the label of each icon screen selects all three together", async ({
    app,
  }) => {
    const { id, fileIds } = await seedIconScreens(app);
    const page = app.page;
    await openOverview(page, id, 3);
    const labels = page.locator("[data-frame-label]");
    await labels.nth(0).click();
    await expect.poll(() => selectedScreenIds(page)).toEqual([fileIds[0]]);
    await zoomTo50Percent(page);
    await expect(labels.nth(1)).toBeInViewport();
    await labels.nth(1).click({ modifiers: ["Shift"] });
    await zoomTo50Percent(page);
    await expect(labels.nth(2)).toBeInViewport();
    await labels.nth(2).click({ modifiers: ["Shift"] });

    await expect
      .poll(async () => [...(await selectedScreenIds(page))].sort())
      .toEqual([...fileIds].sort());
    await expect(page.getByRole("treeitem", { selected: true })).toHaveCount(3);
    await zoomTo50Percent(page);
    const cards = await Promise.all(
      (await page.locator("[data-screen-card]").all()).map((card) =>
        stableBox(card),
      ),
    );
    const selectionBox = page.locator("[data-frame-selection-box]");
    await expect(selectionBox).toHaveCount(1);
    const box = (await selectionBox.boundingBox())!;
    const edges = (rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => ({
      left: rect.x,
      top: rect.y,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
    });
    const union = {
      left: Math.min(...cards.map((card) => edges(card).left)),
      top: Math.min(...cards.map((card) => edges(card).top)),
      right: Math.max(...cards.map((card) => edges(card).right)),
      bottom: Math.max(...cards.map((card) => edges(card).bottom)),
    };
    const drift = Object.entries(edges(box)).map(([edge, value]) => [
      edge,
      Math.round(Math.abs(value - union[edge as keyof typeof union])),
    ]);
    expect(
      drift.filter(([, distance]) => (distance as number) > 2),
      "one selection box spans all three Screens",
    ).toEqual([]);
  });

  test("marquee must FULLY enclose a top-level screen frame to select it; partial intersection is not enough", async ({
    app,
  }) => {
    const { id } = await seedIconScreens(app);
    const page = app.page;
    await openOverview(page, id, 3);
    const screens = page.locator("[data-screen-shell]");
    const homeId = await screens.nth(0).getAttribute("data-frame-id");
    const activeScreenId = await screens.nth(1).getAttribute("data-frame-id");
    expect(homeId).toBeTruthy();
    expect(activeScreenId).toBeTruthy();
    const activeScreenLabel = page.locator(
      `[data-screen-shell][data-frame-id="${activeScreenId}"] [data-frame-label]`,
    );
    await expect(activeScreenLabel).toBeInViewport();
    await activeScreenLabel.click();
    await expect.poll(() => selectedScreenIds(page)).toEqual([activeScreenId]);
    const selectionBeforeEscape = await page.evaluate(() => {
      const selection = (window as any).__designSelection;
      return {
        activeTool: selection?.activeTool,
        mode: selection?.mode,
        viewMode: selection?.viewMode,
      };
    });
    expect(selectionBeforeEscape).toEqual({
      activeTool: "move",
      mode: "edit",
      viewMode: "overview",
    });
    await expect(page.locator("[data-frame-selection-box]")).toHaveCount(1);
    await expect(page.getByRole("treeitem", { selected: true })).toHaveCount(1);
    const surface = page.locator("[data-multi-screen-canvas-surface]");
    await surface.evaluate((element: HTMLElement) =>
      element.focus({ preventScroll: true }),
    );
    await expect
      .poll(() =>
        surface.evaluate((element) => document.activeElement === element),
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect.poll(() => selectedScreenIds(page)).toEqual([activeScreenId]);
    await expect(page.locator("[data-frame-selection-box]")).toHaveCount(0);
    await expect(page.getByRole("treeitem", { selected: true })).toHaveCount(0);
    await zoomTo50Percent(page);
    await expect.poll(() => selectedScreenIds(page)).toEqual([activeScreenId]);
    const homeShell = (await page
      .locator(`[data-screen-shell][data-frame-id="${homeId}"]`)
      .first()
      .boundingBox())!;
    const surfaceBox = (await surface.boundingBox())!;

    const marqueeFrom = { x: homeShell.x - 30, y: homeShell.y - 30 };
    const partialMarqueeTo = { x: homeShell.x + 15, y: homeShell.y + 15 };
    const fullMarqueeTo = {
      x: homeShell.x + homeShell.width + 30,
      y: homeShell.y + homeShell.height + 30,
    };
    expect(marqueeFrom.x).toBeGreaterThanOrEqual(surfaceBox.x);
    expect(marqueeFrom.y).toBeGreaterThanOrEqual(surfaceBox.y);
    expect(fullMarqueeTo.x).toBeLessThanOrEqual(
      surfaceBox.x + surfaceBox.width,
    );
    expect(fullMarqueeTo.y).toBeLessThanOrEqual(
      surfaceBox.y + surfaceBox.height,
    );

    await page.mouse.move(marqueeFrom.x, marqueeFrom.y);
    await page.mouse.down();
    await page.mouse.move(partialMarqueeTo.x, partialMarqueeTo.y, {
      steps: 10,
    });
    await page.mouse.up();
    await expect.poll(() => selectedScreenIds(page)).toEqual([activeScreenId]);
    await expect(page.locator("[data-frame-selection-box]")).toHaveCount(0);
    await expect(page.getByRole("treeitem", { selected: true })).toHaveCount(0);

    await page.mouse.move(marqueeFrom.x, marqueeFrom.y);
    await page.mouse.down();
    await page.mouse.move(fullMarqueeTo.x, fullMarqueeTo.y, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => selectedScreenIds(page)).toEqual([homeId]);
    await expect(page.locator("[data-frame-selection-box]")).toHaveCount(1);
    await expect(page.getByRole("treeitem", { selected: true })).toContainText(
      "Home",
    );
  });

  test("cmd+scroll zooms the overview canvas around the pointer", async ({
    app,
  }) => {
    const { id, fileIds } = await seedIconScreens(app);
    const page = app.page;
    await openOverview(page, id, 3);
    const seededFrames = {
      [fileIds[0]]: { x: 0, y: 0, width: 200, height: 200, z: 0 },
      [fileIds[1]]: { x: 400, y: 0, width: 200, height: 200, z: 1 },
      [fileIds[2]]: { x: 800, y: 0, width: 200, height: 200, z: 2 },
    };
    expect(await savedCanvasFrames(app, id)).toStrictEqual(seededFrames);
    const firstCard = page.locator("[data-screen-card]").first();
    const card = await stableBox(firstCard);
    const anchor = {
      x: card.x + card.width * 0.75,
      y: card.y + card.width * 0.25,
    };

    await page.mouse.move(anchor.x, anchor.y);
    await page.keyboard.down(MOD);
    await page.mouse.wheel(0, -400);
    await page.keyboard.up(MOD);
    await expect(page.getByRole("button", { name: "75%" })).toBeVisible();

    const zoomed = await stableBox(firstCard);
    const ratio = zoomed.width / card.width;
    expect(
      {
        x: Math.round(zoomed.x + (anchor.x - card.x) * ratio),
        y: Math.round(zoomed.y + (anchor.y - card.y) * ratio),
      },
      "the design point under the pointer stays under the pointer",
    ).toEqual({ x: Math.round(anchor.x), y: Math.round(anchor.y) });
    await app.settled();
    expect(await savedCanvasFrames(app, id)).toStrictEqual(seededFrames);
  });
});

test.describe("crossing the screen boundary", () => {
  test("dragging the Price element out of the card's screen onto the empty board turns it into a board object; one undo restores it inside CardBody", async ({
    app,
  }) => {
    const id = await openSeeded(app, CARD_HTML);
    const screenFile = (await app.savedRecord(id)).files.find(
      (file) => file.filename === "index.html",
    )!;
    const frame = (await savedCanvasFrames(app, id))[screenFile.id];
    const beforeHtml = await app.savedHtml(id);
    const before = savedNodeMap(beforeHtml);
    expect(frame).toStrictEqual({ x: 0, y: 736, width: 1440, height: 1024 });
    const price = await app.designRect("price");
    expect(price).toMatchObject({ x: 56, y: 292 });
    const grab = await app.pagePoint(
      price.x + price.width / 2,
      price.y + price.height / 2,
    );
    const drop = { x: 300, y: 1130 };

    const to = await app.pagePoint(drop.x, drop.y);
    await app.page.mouse.move(grab.x, grab.y);
    await app.page.mouse.down();
    await app.page.mouse.move(to.x, to.y, { steps: 30 });
    await app.page.mouse.up();
    await app.settled();

    const screenAfter = await app.savedNodes(id);
    expect(screenAfter.has("price")).toBe(false);
    expectOnlyChanged(before, screenAfter, subtreeIds(before, "price"));
    await expect.poll(() => app.selectedLayers()).toEqual(["Price"]);
    const board = savedNodeMap(await app.savedHtml(id, "__board__.html"));
    expect(board.get("price")?.text).toBe("$149");
    expect(attrsBesidesStyle(board.get("price"))).toEqual({
      "data-agent-native-node-id": "price",
      "data-agent-native-layer-name": "Price",
      "data-agent-native-clone-root": "true",
      "data-agent-native-preserve-styles": "true",
    });
    const boardPrice = styleOf(board.get("price"));
    expect(boardPrice.position).toBe("absolute");
    expect(boardPrice.font, "Price keeps its bold inherited font").toBe(
      "700 16px system-ui, sans-serif",
    );
    const expected = {
      left: frame.x + drop.x - price.width / 2,
      top: frame.y + drop.y - price.height / 2,
    };
    expect(
      Math.abs(parseFloat(boardPrice.left) - expected.left),
      `board left ${boardPrice.left}, released at ${expected.left}`,
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(parseFloat(boardPrice.top) - expected.top),
      `board top ${boardPrice.top}, released at ${expected.top}`,
    ).toBeLessThanOrEqual(2);

    await app.page.keyboard.press(`${MOD}+z`);
    await app.settled();
    expect(await app.savedHtml(id)).toBe(beforeHtml);
    expect(
      savedNodeMap(await app.savedHtml(id, "__board__.html")).has("price"),
    ).toBe(false);
    expect(await app.designRect("price")).toMatchObject({ x: 56, y: 292 });
  });
});
