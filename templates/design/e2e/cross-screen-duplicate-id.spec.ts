import { type Page } from "@playwright/test";

import { buildCodeLayerProjection } from "../shared/code-layer";
import {
  appPath,
  expandAllLayers,
  gotoEditor,
  resetPersistedCanvasState,
} from "./helpers";
import { expect, test, type App } from "./rails";

const SHARED_NODE_ID = "cross-screen-shared-button";
const SCREEN_A_HTML = `<!doctype html><html lang="en"><head><title>Screen A</title></head><body style="margin:0;background:#fff"><button data-agent-native-node-id="${SHARED_NODE_ID}" data-agent-native-layer-name="Screen A Button" style="box-sizing:border-box;position:absolute;left:30px;top:50px;width:100px;height:48px;background:#dc2626;color:white">Screen A Button</button></body></html>`;
const SCREEN_B_HTML = `<!doctype html><html lang="en"><head><title>Screen B</title></head><body style="margin:0;background:#fff"><button data-agent-native-node-id="${SHARED_NODE_ID}" data-agent-native-layer-name="Screen B Button" style="box-sizing:border-box;position:absolute;left:30px;top:50px;width:140px;height:48px;background:#16a34a;color:white">Screen B Button</button></body></html>`;
const COMMAND_COMPANION_ID = "cross-screen-shared-companion";
const SCREEN_A_COMMANDS_HTML = `<!doctype html><html lang="en"><head><title>Screen A</title></head><body style="margin:0;background:#fff"><div class="primary" data-agent-native-node-id="${SHARED_NODE_ID}" data-agent-native-layer-name="Screen A Button" style="box-sizing:border-box;position:absolute;left:30px;top:50px;width:100px;height:48px;background:#dc2626"></div><div class="companion" data-agent-native-node-id="${COMMAND_COMPANION_ID}" data-agent-native-layer-name="Screen A Companion" style="box-sizing:border-box;position:absolute;left:160px;top:50px;width:80px;height:48px;background:#dc2626"></div></body></html>`;
const SCREEN_B_COMMANDS_HTML = `<!doctype html><html lang="en"><head><title>Screen B</title></head><body style="margin:0;background:#fff"><div class="primary" data-agent-native-node-id="${SHARED_NODE_ID}" data-agent-native-layer-name="Screen B Button" style="box-sizing:border-box;position:absolute;left:30px;top:50px;width:140px;height:48px;background:#16a34a"></div><div class="companion" data-agent-native-node-id="${COMMAND_COMPANION_ID}" data-agent-native-layer-name="Screen B Companion" style="box-sizing:border-box;position:absolute;left:160px;top:50px;width:80px;height:48px;background:#dc2626"></div></body></html>`;
const MOD = process.platform === "darwin" ? "Meta" : "Control";

type Screens = { designId: string; screenAId: string; screenBId: string };

/** Seeds two 500x320 Screens side by side: A at canvas 0,0 and B at 600,0. */
async function seedTwoScreens(
  app: App,
  screenAHtml: string,
  screenBHtml: string,
): Promise<Screens> {
  const designId = await app.seed(screenAHtml, {
    files: { "screen-b.html": screenBHtml },
  });
  const { files } = await app.savedRecord(designId);
  const screenAId = files.find((file) => file.filename === "index.html")!.id;
  const screenBId = files.find((file) => file.filename === "screen-b.html")!.id;
  const metadata = {
    width: 500,
    height: 320,
    heightMode: "fixed",
    heightPinned: true,
  };
  const response = await app.page.request.post(
    appPath("/_agent-native/actions/update-design"),
    {
      data: {
        id: designId,
        dataOperations: [
          {
            op: "set",
            path: ["canvasFrames", screenAId],
            value: { x: 0, y: 0, width: 500, height: 320 },
          },
          {
            op: "set",
            path: ["canvasFrames", screenBId],
            value: { x: 600, y: 0, width: 500, height: 320 },
          },
          { op: "set", path: ["screenMetadata", screenAId], value: metadata },
          { op: "set", path: ["screenMetadata", screenBId], value: metadata },
        ],
      },
    },
  );
  expect(response.ok()).toBe(true);
  return { designId, screenAId, screenBId };
}

async function screenSources(
  app: App,
  { designId, screenAId, screenBId }: Screens,
) {
  const { files } = await app.savedRecord(designId);
  const screenA = files.find((file) => file.id === screenAId)?.content;
  const screenB = files.find((file) => file.id === screenBId)?.content;
  if (!screenA || !screenB) {
    throw new Error("Could not read both Screen source documents");
  }
  return { screenA, screenB };
}

/** A plain canvas click at the centre of the node with this id inside one Screen. */
async function clickNode(app: App, nodeId: string, fileId: string) {
  const rect = await app.designRect(nodeId, { fileId });
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
    { fileId },
  );
  await app.page.mouse.click(point.x, point.y);
}

/** Boxes of the canvas selection chrome drawn around each selected layer in one Screen, in design px. */
async function canvasSelectionBoxes(page: Page, fileId: string) {
  return page
    .locator(
      `iframe[data-design-preview-iframe][data-screen-iframe-id="${fileId}"]`,
    )
    .contentFrame()
    .locator(
      '[data-agent-native-edit-overlay="selection"], [data-agent-native-edit-overlay="multi-selection"]:not([data-agent-native-multi-selection-bounds])',
    )
    .evaluateAll((overlays) =>
      overlays
        .filter((overlay) => getComputedStyle(overlay).display !== "none")
        .map((overlay) => {
          const r = overlay.getBoundingClientRect();
          return {
            x: Math.round(r.x),
            y: Math.round(r.y),
            width: Math.round(r.width),
            height: Math.round(r.height),
          };
        })
        .sort((a, b) => a.x - b.x),
    );
}

function widthFor(html: string): string | undefined {
  const tag = new RegExp(
    `<button\\b(?=[^>]*data-agent-native-node-id="${SHARED_NODE_ID}")([^>]*)>`,
    "i",
  ).exec(html)?.[1];
  const style = /\bstyle="([^"]*)"/i.exec(tag ?? "")?.[1] ?? "";
  return style
    .split(";")
    .map((declaration) => declaration.trim())
    .find((declaration) => declaration.toLowerCase().startsWith("width:"))
    ?.slice("width:".length)
    .trim();
}

async function screenWidths(app: App, screens: Screens) {
  const { screenA, screenB } = await screenSources(app, screens);
  return [widthFor(screenA), widthFor(screenB)];
}

async function commandLayerState(app: App, screens: Screens) {
  const { screenA, screenB } = await screenSources(app, screens);
  return app.page.evaluate(
    ({ screenAHtml, screenBHtml }) => {
      const inspect = (html: string) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const read = (selector: string) =>
          Array.from(doc.querySelectorAll<HTMLElement>(selector)).map(
            (node) => ({
              id: node.getAttribute("data-agent-native-node-id"),
              name: node.getAttribute("data-agent-native-layer-name"),
              left: node.style.left,
              backgroundColor: node.style.backgroundColor,
              group: Boolean(node.closest('[data-agent-native-group="true"]')),
            }),
          );
        return {
          primary: read(".primary"),
          companion: read(".companion"),
          groupCount: doc.querySelectorAll('[data-agent-native-group="true"]')
            .length,
        };
      };
      return {
        screenA: inspect(screenAHtml),
        screenB: inspect(screenBHtml),
      };
    },
    { screenAHtml: screenA, screenBHtml: screenB },
  );
}

async function editSelectedWidth(page: Page, width: string) {
  const input = page.getByRole("textbox", {
    name: /^W(?: size in pixels)?$/,
  });
  await expect(input).toBeVisible();
  await input.fill(width);
  await input.press("Enter");
  await expect(input).toHaveValue(`${width}px`);
}

const LEGACY_SELECTION_ID = buildCodeLayerProjection(SCREEN_A_HTML).nodes.find(
  (node) => node.dataAttributes["data-agent-native-node-id"] === SHARED_NODE_ID,
)!.id;

/** Opens the editor at a deep link carrying a pre-scoping selection id. */
async function openLegacySelectionLink(page: Page, query: string) {
  await resetPersistedCanvasState(page);
  await page.goto(appPath(query), { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
}

test("a legacy unscoped selection link resolves inside the Screen the link names", async ({
  app,
}) => {
  const { designId, screenAId } = await seedTwoScreens(
    app,
    SCREEN_A_HTML,
    SCREEN_B_HTML,
  );

  await openLegacySelectionLink(
    app.page,
    `/design/${designId}?view=overview&screen=${encodeURIComponent(screenAId)}&selection=${encodeURIComponent(LEGACY_SELECTION_ID)}`,
  );

  await expect.poll(() => app.selectedLayers()).toEqual(["Screen A Button"]);
  await expect(
    app.page.getByRole("textbox", { name: /^W(?: size in pixels)?$/ }),
  ).toHaveValue("100px");
});

test("a legacy unscoped selection link without a Screen selects nothing", async ({
  app,
}) => {
  const { designId } = await seedTwoScreens(app, SCREEN_A_HTML, SCREEN_B_HTML);

  await openLegacySelectionLink(
    app.page,
    `/design/${designId}?view=overview&selection=${encodeURIComponent(LEGACY_SELECTION_ID)}`,
  );
  await expect(
    app.page.locator('[role="treeitem"][aria-level="1"]'),
  ).toHaveCount(2);
  await app.settled();

  expect(await app.selectedLayers()).toEqual([]);
  await expect(
    app.page.getByRole("textbox", { name: /^W(?: size in pixels)?$/ }),
  ).toHaveCount(0);
});

test("identical authored node IDs stay scoped to their Screen", async ({
  app,
}) => {
  test.setTimeout(120_000);
  const page = app.page;
  const screens = await seedTwoScreens(app, SCREEN_A_HTML, SCREEN_B_HTML);
  const { designId, screenAId, screenBId } = screens;

  await gotoEditor(page, designId);
  await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
  await expandAllLayers(page);
  await app.zoomToFit();
  const layerRows = page.locator(
    '[role="treeitem"][aria-level="2"] [data-layer-row-button]',
  );
  await expect(layerRows).toHaveCount(2);
  const rowIds = await layerRows.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("data-layer-node-id")),
  );
  expect(new Set(rowIds).size).toBe(2);

  await clickNode(app, SHARED_NODE_ID, screenAId);
  const widthInput = page.getByRole("textbox", {
    name: /^W(?: size in pixels)?$/,
  });
  await expect(widthInput).toHaveValue("100px");
  await editSelectedWidth(page, "105");
  await expect
    .poll(() => screenWidths(app, screens))
    .toEqual(["105px", "140px"]);

  const screenALayer = layerRows.filter({ hasText: "Screen A Button" });
  await expect(screenALayer).toHaveCount(1);
  await screenALayer.click();
  await expect(widthInput).toHaveValue("105px");
  await editSelectedWidth(page, "111");
  await expect
    .poll(() => screenWidths(app, screens))
    .toEqual(["111px", "140px"]);

  const screenBLayer = layerRows.filter({ hasText: "Screen B Button" });
  await expect(screenBLayer).toHaveCount(1);
  const screenBTreeRow = screenBLayer.locator(
    'xpath=ancestor::*[@role="treeitem"][1]',
  );
  const screenBRowBox = await screenBTreeRow
    .locator("[data-layer-row-content]")
    .boundingBox();
  if (!screenBRowBox) throw new Error("Screen B layer row has no bounds");
  await page.mouse.click(
    screenBRowBox.x + 2,
    screenBRowBox.y + screenBRowBox.height / 2,
  );
  await expect(screenBTreeRow).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("screen"))
    .toBe(screenBId);
  await expect(widthInput).toHaveValue("140px");

  await clickNode(app, SHARED_NODE_ID, screenBId);
  await expect(widthInput).toHaveValue("140px");
  await editSelectedWidth(page, "222");
  await expect
    .poll(() => screenWidths(app, screens))
    .toEqual(["111px", "222px"]);

  await screenBLayer.click();
  await expect(widthInput).toHaveValue("222px");
  await editSelectedWidth(page, "233");
  await expect
    .poll(() => screenWidths(app, screens))
    .toEqual(["111px", "233px"]);

  await app.settled();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
  await expandAllLayers(page);
  expect(await screenWidths(app, screens)).toEqual(["111px", "233px"]);
  await layerRows.filter({ hasText: "Screen A Button" }).click();
  await expect(widthInput).toHaveValue("111px");
  await layerRows.filter({ hasText: "Screen B Button" }).click();
  await expect(widthInput).toHaveValue("233px");
});

// fixme: product bug: After Cmd+Shift+G the panel and inspector show 2 selected, but the canvas size badge reads 80 × 48 (Companion only) instead of 209 × 48
test.fixme("structural commands stay in the selected Screen with duplicate authored IDs", async ({
  app,
}) => {
  test.setTimeout(120_000);
  const page = app.page;
  const screens = await seedTwoScreens(
    app,
    SCREEN_A_COMMANDS_HTML,
    SCREEN_B_COMMANDS_HTML,
  );
  const { designId, screenAId } = screens;
  await gotoEditor(page, designId);
  await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
  await expandAllLayers(page);
  await app.zoomToFit();

  const readState = () => commandLayerState(app, screens);
  const initial = await readState();
  expect(initial.screenA.primary).toHaveLength(1);
  expect(initial.screenB.primary).toHaveLength(1);
  expect(initial.screenA.companion).toHaveLength(1);
  expect(initial.screenB.companion).toHaveLength(1);

  await clickNode(app, SHARED_NODE_ID, screenAId);
  const widthInput = page.getByRole("textbox", {
    name: /^W(?: size in pixels)?$/,
  });
  await expect(widthInput).toHaveValue("100px");
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => {
      const state = await readState();
      return [state.screenA.primary[0]?.left, state.screenB.primary[0]?.left];
    })
    .toEqual(["31px", "30px"]);

  const layers = page.getByRole("tree", { name: "Layers" });
  const rowFor = (name: string) =>
    layers
      .locator("[data-layer-row-button][data-layer-node-id]")
      .filter({ has: page.locator(`span[title="${name}"]`) })
      .locator('xpath=ancestor::*[@role="treeitem"][1]');
  const buttonRow = rowFor("Screen A Button");
  const companionRow = rowFor("Screen A Companion");
  await buttonRow.click();
  await companionRow.click({ modifiers: ["Shift"] });
  await expect(
    layers.locator('[role="treeitem"][aria-selected="true"]'),
  ).toHaveCount(2);

  await page.keyboard.press(`${MOD}+g`);
  const groupRow = rowFor("Group");
  await expect(groupRow).toBeVisible();
  await expect(
    layers.locator('[role="treeitem"][aria-selected="true"]'),
  ).toHaveCount(1);
  await expect(
    layers.locator('[role="treeitem"][aria-selected="true"]'),
  ).toContainText("Group");
  await groupRow.click();

  const fillSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Fill", exact: true }) })
    .first();
  await expect(fillSection).toBeVisible();
  await fillSection.getByRole("button", { name: "Open color picker" }).click();
  const hex = page.getByRole("textbox", { name: "Hex", exact: true });
  await expect(hex).toHaveValue("DC2626");
  await hex.fill("3B82F6");
  await hex.press("Enter");
  await page.keyboard.press("Escape");
  const fillsAndGroups = async () => {
    const state = await readState();
    return {
      a: [
        state.screenA.primary[0]?.backgroundColor,
        state.screenA.companion[0]?.backgroundColor,
        state.screenA.groupCount,
      ],
      b: [
        state.screenB.primary[0]?.backgroundColor,
        state.screenB.companion[0]?.backgroundColor,
        state.screenB.groupCount,
      ],
    };
  };
  await expect.poll(fillsAndGroups).toEqual({
    a: ["rgb(59, 130, 246)", "rgb(59, 130, 246)", 1],
    b: ["rgb(22, 163, 74)", "rgb(220, 38, 38)", 0],
  });

  await page.keyboard.press(`${MOD}+Shift+g`);
  await expect(groupRow).toHaveCount(0);
  await expect(
    layers.locator('[role="treeitem"][aria-selected="true"]'),
  ).toHaveCount(2);
  await expect.poll(fillsAndGroups).toEqual({
    a: ["rgb(59, 130, 246)", "rgb(59, 130, 246)", 0],
    b: ["rgb(22, 163, 74)", "rgb(220, 38, 38)", 0],
  });
  await app.settled();
  await expect
    .poll(() => canvasSelectionBoxes(page, screenAId), {
      message:
        "after ungroup the canvas chrome must outline both layers the panel shows selected",
    })
    .toEqual([
      { x: 31, y: 50, width: 100, height: 48 },
      { x: 160, y: 50, width: 80, height: 48 },
    ]);
  await expect(
    page
      .locator(
        `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenAId}"]`,
      )
      .contentFrame()
      .locator('[data-agent-native-edit-overlay="size-badge"]'),
  ).toHaveText("209 × 48");
});

test("delete and Undo stay in the selected Screen with duplicate authored IDs", async ({
  app,
}) => {
  test.setTimeout(120_000);
  const page = app.page;
  const screens = await seedTwoScreens(
    app,
    SCREEN_A_COMMANDS_HTML,
    SCREEN_B_COMMANDS_HTML,
  );
  await gotoEditor(page, screens.designId);
  await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
  await expandAllLayers(page);
  await app.zoomToFit();

  const readState = () => commandLayerState(app, screens);
  const before = await readState();
  expect(before.screenA.primary).toHaveLength(1);
  expect(before.screenB.primary).toHaveLength(1);
  expect(before.screenA.companion).toHaveLength(1);
  expect(before.screenB.companion).toHaveLength(1);

  await clickNode(app, SHARED_NODE_ID, screens.screenAId);
  await expect.poll(() => app.selectedLayers()).toEqual(["Screen A Button"]);
  await page.keyboard.press("Delete");

  await expect
    .poll(async () => {
      const state = await readState();
      return {
        a: [state.screenA.primary.length, state.screenA.companion.length],
        b: [state.screenB.primary.length, state.screenB.companion.length],
      };
    })
    .toEqual({ a: [0, 1], b: [1, 1] });

  await page.keyboard.press(`${MOD}+z`);
  await expect.poll(readState).toEqual(before);
});
