import { expect, test, type Locator, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { expandAllLayers, gotoEditor } from "./helpers";


const baseURL = e2eBaseURL();

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const res = await page.request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok()) {
    throw new Error(
      `${name}: ${res.status()} ${(await res.text()).slice(0, 200)}`,
    );
  }
  return res.json();
}

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Layers panel parity</title></head>
  <body style="margin:0;min-height:1200px;background:#fff;color:#111;font-family:system-ui,sans-serif">
    <header data-agent-native-node-id="header" data-agent-native-layer-name="Site Header" style="height:80px;background:#1d4ed8;color:#fff">Site Header</header>
    <nav data-agent-native-node-id="nav" data-agent-native-layer-name="Nav" style="height:48px;background:#f3f4f6;display:flex;gap:16px">
      <a data-agent-native-node-id="nav-shop" data-agent-native-layer-name="Shop" href="#">Shop</a>
      <a data-agent-native-node-id="nav-about" data-agent-native-layer-name="About" href="#">About</a>
      <a data-agent-native-node-id="nav-contact" data-agent-native-layer-name="Contact" href="#">Contact</a>
    </nav>
    <main data-agent-native-node-id="main" data-agent-native-layer-name="Main" style="min-height:600px;padding:24px">
      <div data-agent-native-node-id="panel" data-agent-native-layer-name="Panel" style="position:relative;width:300px;height:200px;background:#e5e7eb">
        <div data-agent-native-node-id="panel-child" data-agent-native-layer-name="Panel Child" style="width:100px;height:60px;background:#93c5fd"></div>
      </div>
      <div data-agent-native-node-id="loose" data-agent-native-layer-name="Loose Card" style="width:120px;height:60px;background:#fca5a5;margin-top:16px"></div>
      <div data-agent-native-node-id="loose2" style="width:120px;height:60px;background:#86efac;margin-top:16px">Untitled</div>
    </main>
    <div data-agent-native-node-id="sticker" data-agent-native-layer-name="Sticker" style="position:absolute;left:500px;top:1000px;width:60px;height:40px;background:#fb923c"></div>
    <footer data-agent-native-node-id="footer" data-agent-native-layer-name="Footer" style="height:80px;background:#111827;color:#fff">Footer</footer>
  </body>
</html>`;

const BOARD_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Board</title></head>
  <body style="margin:0;min-height:900px;background:#e5e5e5">
    <div data-agent-native-node-id="board-a" data-agent-native-layer-name="Board Sticker" style="position:absolute;left:20px;top:520px;width:120px;height:80px;background:#f59e0b"></div>
  </body>
</html>`;

async function newDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "layers panel parity",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId: id,
    filename: "index.html",
    content: FIXTURE,
    fileType: "html",
  });
  return id;
}

async function newDesignWithBoard(page: Page): Promise<string> {
  const id = await newDesign(page);
  const board = await postAction(page, "create-file", {
    designId: id,
    filename: "__board__.html",
    content: BOARD_FIXTURE,
    fileType: "html",
  });
  const boardFileId = board?.id ?? board?.data?.id;
  if (!boardFileId) throw new Error("create-file returned no board id");
  await postAction(page, "update-design", {
    id,
    dataOperations: [{ op: "set", path: ["boardFileId"], value: boardFileId }],
  });
  return id;
}

async function openEditorAndExpandLayers(
  page: Page,
  designId: string,
): Promise<void> {
  await gotoEditor(page, designId);
  await expandAllLayers(page);
}

function layerTree(page: Page): Locator {
  return page.getByRole("tree", { name: "Layers" });
}

function layerRowButton(page: Page, name: string): Locator {
  return layerTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${cssString(name)}"]`) })
    .first();
}

function layerRow(page: Page, name: string): Locator {
  return layerRowButton(page, name).locator(
    'xpath=ancestor::*[@role="treeitem"][1]',
  );
}

async function visibleLayerNames(page: Page): Promise<string[]> {
  return layerTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => (node.textContent ?? "").trim())
        .filter((name) => name.length > 0),
    );
}

async function rowLevel(page: Page, name: string): Promise<number> {
  const level = await layerRow(page, name).getAttribute("aria-level");
  if (!level) throw new Error(`missing aria-level for layer row ${name}`);
  return Number(level);
}

async function clickLayerRow(page: Page, name: string): Promise<void> {
  const button = layerRowButton(page, name);
  await expect(button).toBeVisible();
  await button.click({ force: true });
}

async function clickLayerAction(
  page: Page,
  name: string,
  label: string,
): Promise<void> {
  const row = layerRow(page, name);
  await row.hover();
  await row.locator(`button[aria-label="${label}"]`).click({ force: true });
}

function cssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function node(page: Page, id: string): Locator {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator(`[data-agent-native-node-id="${id}"]`);
}

function renameInput(page: Page): Locator {
  return layerTree(page).locator('input[aria-label="Rename layer"]');
}

async function toastMessages(page: Page): Promise<string[]> {
  return page
    .locator("[data-sonner-toast]")
    .evaluateAll((nodes) => nodes.map((n) => (n.textContent ?? "").trim()));
}

test.describe("Figma parity — layers panel", () => {
  let designId: string;

  test.beforeEach(async ({ page }, testInfo) => {
    designId = testInfo.title.includes("board")
      ? await newDesignWithBoard(page)
      : await newDesign(page);
    await openEditorAndExpandLayers(page, designId);
  });

  test("top row is topmost-rendered, matching DOM order (Steve's footer-above-header report)", async ({
    page,
  }) => {
    const names = await visibleLayerNames(page);
    const footerIdx = names.indexOf("Footer");
    const headerIdx = names.indexOf("Site Header");
    expect(footerIdx).toBeGreaterThan(-1);
    expect(headerIdx).toBeGreaterThan(-1);
    expect(footerIdx).toBeLessThan(headerIdx);
    const topLevelInPanelOrder = [
      names.indexOf("Footer"),
      names.indexOf("Main"),
      names.indexOf("Nav"),
      names.indexOf("Site Header"),
    ];
    expect(topLevelInPanelOrder).toEqual(
      [...topLevelInPanelOrder].sort((a, b) => a - b),
    );
  });

  test('dragging a nav link row inserts exactly "above Shop"', async ({
    page,
  }) => {
    const before = await visibleLayerNames(page);
    expect(before.indexOf("Contact")).toBeGreaterThan(-1);
    expect(before.indexOf("About")).toBeGreaterThan(-1);
    expect(before.indexOf("Shop")).toBeGreaterThan(-1);

    const shopRow = layerRow(page, "Shop");
    const box = await shopRow.boundingBox();
    if (!box) throw new Error("Shop row has no bounding box");
    await layerRowButton(page, "Contact").dragTo(shopRow, {
      targetPosition: { x: box.width / 2, y: 2 },
    });

    await expect
      .poll(
        async () => {
          const names = await visibleLayerNames(page);
          const contactIdx = names.indexOf("Contact");
          const shopIdx = names.indexOf("Shop");
          const aboutIdx = names.indexOf("About");
          return (
            contactIdx > -1 &&
            shopIdx > -1 &&
            aboutIdx > -1 &&
            contactIdx === shopIdx - 1 &&
            aboutIdx < contactIdx
          );
        },
        {
          message:
            "expected Contact to land directly between About and Shop after the drag",
        },
      )
      .toBe(true);
    await expect(toastMessages(page)).resolves.not.toContain(
      "Could not move that layer",
    );
  });

  test("dropping a row onto a container row reparents it as the topmost child", async ({
    page,
  }) => {
    const containerLevel = await rowLevel(page, "Panel");
    const panelRow = layerRow(page, "Panel");
    const panelBox = await panelRow.boundingBox();
    if (!panelBox) throw new Error("Panel row has no bounding box");
    await layerRowButton(page, "Loose Card").dragTo(panelRow, {
      targetPosition: { x: 96, y: panelBox.height / 2 },
    });

    await expect
      .poll(async () => rowLevel(page, "Loose Card"))
      .toBe(containerLevel + 1);
    await expect
      .poll(async () => {
        const names = await visibleLayerNames(page);
        return (
          names.indexOf("Loose Card") > -1 &&
          names.indexOf("Panel Child") > -1 &&
          names.indexOf("Loose Card") < names.indexOf("Panel Child")
        );
      })
      .toBe(true);
    await expect
      .poll(() =>
        node(page, "panel").evaluate(
          (el, childId) =>
            Boolean(
              el.querySelector(`[data-agent-native-node-id="${childId}"]`),
            ),
          "loose",
        ),
      )
      .toBe(true);
  });

  test("dropping an absolutely positioned layer row onto a Frame row keeps its on-screen position", async ({
    page,
  }) => {
    const before = await node(page, "sticker").boundingBox();
    if (!before) throw new Error("Sticker has no bounding box");

    const panelRow = layerRow(page, "Panel");
    const panelBox = await panelRow.boundingBox();
    if (!panelBox) throw new Error("Panel row has no bounding box");
    await layerRowButton(page, "Sticker").dragTo(panelRow, {
      targetPosition: { x: 96, y: panelBox.height / 2 },
    });

    await expect
      .poll(() =>
        node(page, "panel").evaluate((el) =>
          Boolean(el.querySelector('[data-agent-native-node-id="sticker"]')),
        ),
      )
      .toBe(true);

    const after = await node(page, "sticker").boundingBox();
    if (!after) throw new Error("Sticker has no bounding box after the move");
    expect(
      after.x,
      `reparenting via the panel must not move the element on screen — was x=${before.x}, now x=${after.x}`,
    ).toBeCloseTo(before.x, 0);
    expect(
      after.y,
      `reparenting via the panel must not move the element on screen — was y=${before.y}, now y=${after.y}`,
    ).toBeCloseTo(before.y, 0);
  });

  test("Could not move that layer never appears for an ordinary, default-named layer (Logan's repro)", async ({
    page,
  }) => {
    const before = await visibleLayerNames(page);
    const looseCardRow = layerRow(page, "Loose Card");
    const untitledRow = layerRowButton(page, "Untitled");
    expect(before.includes("Untitled")).toBe(true);

    await untitledRow.dragTo(looseCardRow, {
      targetPosition: { x: 96, y: 2 },
    });

    await page.waitForTimeout(300);
    await expect(toastMessages(page)).resolves.not.toContain(
      "Could not move that layer",
    );
    await expect
      .poll(async () => {
        const names = await visibleLayerNames(page);
        return names.indexOf("Untitled") < names.indexOf("Loose Card");
      })
      .toBe(true);
  });

  test("rename via double-click commits on Enter and cancels on Escape", async ({
    page,
  }) => {
    await layerRowButton(page, "Loose Card").dblclick({ force: true });
    const input = renameInput(page);
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("Loose Card");

    await input.fill("Renamed Via Escape");
    await input.press("Escape");
    await expect(renameInput(page)).toHaveCount(0);
    await expect(layerRowButton(page, "Loose Card")).toBeVisible();
    await expect(layerRowButton(page, "Renamed Via Escape")).toHaveCount(0);

    await layerRowButton(page, "Loose Card").dblclick({ force: true });
    const input2 = renameInput(page);
    await expect(input2).toBeVisible();
    await input2.fill("Committed Card");
    await input2.press("Enter");
    await expect(renameInput(page)).toHaveCount(0);
    await expect(layerRowButton(page, "Committed Card")).toBeVisible();
    await expect(layerRowButton(page, "Loose Card")).toHaveCount(0);

    await expect(node(page, "loose")).toHaveAttribute(
      "data-agent-native-layer-name",
      "Committed Card",
    );

    await expect
      .poll(() => getIndexHtml(page, designId), {
        timeout: 15_000,
        message: "the renamed layer must reach persisted source HTML",
      })
      .toContain('data-agent-native-layer-name="Committed Card"');

    await gotoEditor(page, designId);
    await expandAllLayers(page);
    await expect(layerRowButton(page, "Committed Card")).toBeVisible();
    await expect(layerRowButton(page, "Loose Card")).toHaveCount(0);
    await expect(node(page, "loose")).toHaveAttribute(
      "data-agent-native-layer-name",
      "Committed Card",
    );
  });

  test("Cmd+R opens the rename editor for the selection (spec §15)", async ({
    page,
  }) => {
    await clickLayerRow(page, "Loose Card");
    await expect(layerRow(page, "Loose Card")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.down(mod);
    await page.keyboard.press("r");
    await page.keyboard.up(mod);
    await expect(renameInput(page)).toBeVisible({ timeout: 2000 });
  });

  test("hide and lock toggle from the row: locked layer is not canvas-selectable but stays panel-selectable", async ({
    page,
  }) => {
    await clickLayerAction(page, "Loose Card", "Lock layer");
    await expect(
      layerRow(page, "Loose Card").locator('button[aria-label="Unlock layer"]'),
    ).toBeVisible();
    await expect(node(page, "loose")).toHaveAttribute(
      "data-agent-native-locked",
      "true",
    );

    await clickLayerRow(page, "Loose Card");
    await expect(layerRow(page, "Loose Card")).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const box = await node(page, "loose").boundingBox();
    if (!box) throw new Error("loose node has no bounding box");
    await clickLayerRow(page, "Site Header");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
    await expect(layerRow(page, "Loose Card")).toHaveAttribute(
      "aria-selected",
      "false",
    );

    await clickLayerAction(page, "Loose Card", "Hide layer");
    await expect(node(page, "loose")).toBeHidden();
    await expect(
      layerRow(page, "Loose Card").locator('button[aria-label="Show layer"]'),
    ).toBeVisible();
  });

  test("one undo fully restores parent and position after a panel-drag reparent", async ({
    page,
  }) => {
    const beforeBox = await node(page, "loose").boundingBox();
    if (!beforeBox) throw new Error("no bounding box for loose before move");
    const beforeParentIsMain = await node(page, "loose").evaluate(
      (el) =>
        Boolean(el.closest('[data-agent-native-node-id="main"]')) &&
        !el.closest('[data-agent-native-node-id="panel"]'),
    );
    expect(beforeParentIsMain).toBe(true);

    const panelRowForUndo = layerRow(page, "Panel");
    const panelBoxForUndo = await panelRowForUndo.boundingBox();
    if (!panelBoxForUndo) throw new Error("Panel row has no bounding box");
    await layerRowButton(page, "Loose Card").dragTo(panelRowForUndo, {
      targetPosition: { x: 96, y: panelBoxForUndo.height / 2 },
    });
    await expect
      .poll(() =>
        node(page, "loose").evaluate((el) =>
          Boolean(el.closest('[data-agent-native-node-id="panel"]')),
        ),
      )
      .toBe(true);

    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.down(mod);
    await page.keyboard.press("z");
    await page.keyboard.up(mod);

    await expect
      .poll(() =>
        node(page, "loose").evaluate((el) =>
          Boolean(el.closest('[data-agent-native-node-id="panel"]')),
        ),
      )
      .toBe(false);
    const afterUndoBox = await node(page, "loose").boundingBox();
    if (!afterUndoBox) throw new Error("no bounding box for loose after undo");
    expect(Math.abs(afterUndoBox.x - beforeBox.x)).toBeLessThan(5);
    expect(Math.abs(afterUndoBox.y - beforeBox.y)).toBeLessThan(5);
  });

  test("dragging a board-object row onto a screen's file row moves it into the screen (board -> in)", async ({
    page,
  }) => {
    await expandAllLayers(page);
    const names = await visibleLayerNames(page);
    expect(names.includes("Board Sticker")).toBe(true);

    const screenFileRowButton = layerRowButton(page, "Home");
    await expect(
      screenFileRowButton,
      "the screen's own layer row must be visible to drop a board object onto it",
    ).toBeVisible({ timeout: 10_000 });
    const screenFileRow = layerRow(page, "Home");
    const screenFileBox = await screenFileRow.boundingBox();
    if (!screenFileBox) throw new Error("screen file row has no bounding box");

    await layerRowButton(page, "Board Sticker").dragTo(screenFileRow, {
      targetPosition: { x: 96, y: screenFileBox.height / 2 },
    });

    await expect
      .poll(() =>
        page
          .locator("iframe[data-design-preview-iframe]")
          .first()
          .contentFrame()
          .locator('[data-agent-native-node-id="board-a"]')
          .count(),
      )
      .toBeGreaterThan(0);
  });
});

const SIBLING_REORDER_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Sibling reorder parity</title></head>
  <body style="margin:0;min-height:300px;background:#fff">
    <div data-agent-native-node-id="wrap" data-agent-native-layer-name="Wrap" style="position:relative;width:300px;height:150px">
      <div data-agent-native-node-id="node-b" data-agent-native-layer-name="B" style="position:absolute;left:140px;top:20px;width:80px;height:80px;background:#3b82f6"></div>
      <div data-agent-native-node-id="node-a" data-agent-native-layer-name="A" style="position:absolute;left:20px;top:20px;width:80px;height:80px;background:#ef4444"></div>
    </div>
    <div data-agent-native-node-id="other" data-agent-native-layer-name="Other" style="position:absolute;left:20px;top:200px;width:80px;height:40px;background:#10b981"></div>
  </body>
</html>`;

async function newSiblingReorderDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "sibling reorder parity",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  await postAction(page, "create-file", {
    designId: id,
    filename: "index.html",
    content: SIBLING_REORDER_FIXTURE,
    fileType: "html",
  });
  return id;
}

async function getIndexHtml(page: Page, designId: string): Promise<string> {
  const res = await page.request.get(
    `${baseURL}/_agent-native/actions/get-design?id=${designId}`,
  );
  if (!res.ok()) {
    throw new Error(`get-design failed: ${res.status()} ${await res.text()}`);
  }
  const result = await res.json();
  const files = result.files ?? result.data?.files;
  const file = files?.find((f: any) => f.filename === "index.html");
  if (!file) throw new Error("index.html missing from get-design response");
  return file.content as string;
}

function domOrder(html: string): "AB" | "BA" {
  const aIdx = html.indexOf('data-agent-native-node-id="node-a"');
  const bIdx = html.indexOf('data-agent-native-node-id="node-b"');
  if (aIdx < 0 || bIdx < 0) throw new Error("node-a/node-b missing from html");
  return aIdx < bIdx ? "AB" : "BA";
}

async function livePreviewBodyOrder(page: Page): Promise<string[]> {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator('[data-agent-native-node-id="wrap"] > [data-agent-native-node-id]')
    .evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("data-agent-native-node-id") ?? ""),
    );
}

async function stampPreviewWindowMarker(page: Page): Promise<void> {
  await page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator("html")
    .evaluate((el) => {
      (el.ownerDocument.defaultView as any).__parityReorderMarker = "alive";
    });
}

async function previewWindowMarkerSurvived(page: Page): Promise<boolean> {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator("html")
    .evaluate(
      (el) =>
        (el.ownerDocument.defaultView as any).__parityReorderMarker === "alive",
    );
}

test.describe("Figma parity — layers panel sibling reorder / preview sync", () => {
  let siblingDesignId: string;

  test.beforeEach(async ({ page }) => {
    siblingDesignId = await newSiblingReorderDesign(page);
    await openEditorAndExpandLayers(page, siblingDesignId);
  });

  test("dragging B above A in the panel reaches the persisted file, the live iframe, and the panel alike; one undo restores B,A", async ({
    page,
  }) => {
    expect(domOrder(await getIndexHtml(page, siblingDesignId))).toBe("BA");
    expect(await livePreviewBodyOrder(page)).toEqual(["node-b", "node-a"]);

    await clickLayerRow(page, "Other");
    await stampPreviewWindowMarker(page);

    const aRow = layerRow(page, "A");
    const aBox = await aRow.boundingBox();
    if (!aBox) throw new Error("A row has no bounding box");
    await layerRowButton(page, "B").dragTo(aRow, {
      targetPosition: { x: aBox.width / 2, y: 2 },
    });

    await expect
      .poll(async () => domOrder(await getIndexHtml(page, siblingDesignId)), {
        message:
          "expected the persisted index.html sibling order to become A,B",
      })
      .toBe("AB");

    await expect
      .poll(() => livePreviewBodyOrder(page), {
        message:
          "expected the live preview iframe's body child order to become node-a,node-b",
      })
      .toEqual(["node-a", "node-b"]);

    await expect
      .poll(
        async () => {
          const names = await visibleLayerNames(page);
          return (
            names.indexOf("B") > -1 && names.indexOf("B") < names.indexOf("A")
          );
        },
        { message: "expected B's row to move directly before A's row" },
      )
      .toBe(true);

    expect(await previewWindowMarkerSurvived(page)).toBe(true);
    await expect(toastMessages(page)).resolves.not.toContain(
      "Could not move that layer",
    );

    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.down(mod);
    await page.keyboard.press("z");
    await page.keyboard.up(mod);

    await expect
      .poll(async () => domOrder(await getIndexHtml(page, siblingDesignId)))
      .toBe("BA");
    await expect
      .poll(() => livePreviewBodyOrder(page))
      .toEqual(["node-b", "node-a"]);
    await expect
      .poll(async () => {
        const names = await visibleLayerNames(page);
        return (
          names.indexOf("A") > -1 && names.indexOf("A") < names.indexOf("B")
        );
      })
      .toBe(true);
  });
});
