import { type Page } from "@playwright/test";

import { buildCodeLayerProjection } from "../shared/code-layer";
import { enterDirectMode, installBridge, waitForBridge } from "./helpers";
import { expect, test, type App } from "./rails";

const STACK_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Select layer fixture</title></head>
  <body style="margin:0;min-height:100vh;padding:20px">
    <div data-agent-native-node-id="stage" data-agent-native-layer-name="Stage frame" style="position:relative;width:440px;height:360px;background:#eee">
      <div data-agent-native-node-id="back" data-agent-native-layer-name="Back sibling" style="position:absolute;left:40px;top:40px;width:280px;height:260px;background:#bfdbfe">Back sibling</div>
      <div data-agent-native-node-id="nested-parent" data-agent-native-layer-name="Nested parent" style="position:absolute;z-index:1;left:80px;top:80px;width:220px;height:210px;background:#bbf7d0">
        <div data-agent-native-node-id="nested-child" data-agent-native-layer-name="Nested child" style="position:absolute;left:20px;top:20px;width:150px;height:150px;background:#fef08a">Nested child</div>
      </div>
      <div data-agent-native-node-id="front" data-agent-native-layer-name="Front sibling" style="position:absolute;z-index:2;left:120px;top:120px;width:120px;height:120px;background:#fecaca">Front sibling</div>
      <div data-agent-native-node-id="hidden-cover" data-agent-native-layer-name="Hidden cover" data-agent-native-hidden="true" style="position:absolute;z-index:3;left:130px;top:130px;width:90px;height:90px;background:#000">Hidden cover</div>
      <div data-agent-native-node-id="locked-cover" data-agent-native-layer-name="Locked cover" data-agent-native-locked="true" style="position:absolute;z-index:4;left:140px;top:140px;width:70px;height:70px;background:#fff">Locked cover</div>
    </div>
  </body>
</html>`;

async function openLayerStack(
  app: App,
  screen?: string,
  openSelectLayer = true,
) {
  const page = app.page;
  await installBridge(page);
  await page.evaluate(() => ((window as any).__bridge = []));
  const stage = await app.designRect("stage", screen);
  const point = await app.pagePoint(stage.x + 165, stage.y + 165, screen);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await waitForBridge(page, "element-contextmenu");
  const trigger = page.getByText("Select layer", { exact: true });
  await expect(trigger).toBeVisible();
  if (!openSelectLayer) return page.getByRole("menu").last();
  await trigger.hover();
  const submenu = page.getByRole("menu").last();
  await expect(
    submenu.getByText("Front sibling", { exact: true }),
  ).toBeVisible();
  return submenu;
}

/** The e2e server has no AI provider, so the composer renders but stays disabled. */
async function openAgentFromMenu(page: Page) {
  await expect(page.locator("[data-design-agent-panel]")).toBeHidden();
  await page
    .getByRole("menuitem", { name: "Edit with Agent", exact: true })
    .click();
  await expect(page.getByText("Select layer", { exact: true })).toBeHidden();
  await expect(
    page.locator("[data-design-agent-panel] .ProseMirror"),
  ).toBeVisible();
}

async function selectedTreeLabel(page: Page) {
  return (
    (await page
      .getByRole("treeitem", { selected: true })
      .first()
      .textContent()) ?? ""
  );
}

test("Select layer lists the exact visible unlocked hit stack and dismisses without mutation", async ({
  app,
  page,
}) => {
  const designId = await app.seed(STACK_HTML);
  await app.open(designId);
  await enterDirectMode(page);
  const baselineContent = await app.savedHtml(designId);

  const submenu = await openLayerStack(app);
  const visibleLabels = [
    "Front sibling",
    "Nested child",
    "Nested parent",
    "Back sibling",
    "Stage frame",
  ];
  for (const label of visibleLabels) {
    await expect(submenu.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(submenu.getByText("Locked cover", { exact: true })).toHaveCount(
    0,
  );
  await expect(submenu.getByText("Hidden cover", { exact: true })).toHaveCount(
    0,
  );

  const submenuItems = submenu
    .getByRole("menuitem")
    .filter({ has: page.locator("svg") });
  const labelsInOrder = await submenuItems.allTextContents();
  const orderedHits = labelsInOrder.filter((label) =>
    visibleLabels.includes(label.trim()),
  );
  expect(orderedHits).toEqual(visibleLabels);

  await page.keyboard.press("Escape");
  await expect(page.getByText("Select layer", { exact: true })).toBeHidden();
  await expect.poll(() => selectedTreeLabel(page)).toContain("Front sibling");

  const childMenu = await openLayerStack(app);
  await childMenu.getByText("Nested child", { exact: true }).click();
  await expect.poll(() => selectedTreeLabel(page)).toContain("Nested child");

  const parentMenu = await openLayerStack(app);
  await parentMenu.getByText("Nested parent", { exact: true }).click();
  await expect.poll(() => selectedTreeLabel(page)).toContain("Nested parent");

  const backMenu = await openLayerStack(app);
  await backMenu.getByText("Back sibling", { exact: true }).click();
  await expect.poll(() => selectedTreeLabel(page)).toContain("Back sibling");

  await app.settled();
  expect(await app.savedHtml(designId)).toBe(baselineContent);
});

test("Select layer on a non-active overview screen preserves exact screen and layer identity", async ({
  app,
  page,
}) => {
  const designId = await app.seed(STACK_HTML, {
    files: { "about.html": STACK_HTML },
  });
  const { files } = await app.savedRecord(designId);
  const homeId = files.find((file) => file.filename === "index.html")!.id;
  const aboutId = files.find((file) => file.filename === "about.html")!.id;

  await app.open(designId);
  await expect(
    page.getByRole("button", { name: "Interact" }).first(),
  ).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("screen"))
    .toBe(homeId);

  const homeBaseline = await app.savedHtml(designId, "index.html");
  const aboutBaseline = await app.savedHtml(designId, "about.html");
  const nestedChild = buildCodeLayerProjection(aboutBaseline, {
    source: { kind: "design-file", fileId: aboutId },
  }).nodes.find(
    (node) =>
      node.dataAttributes["data-agent-native-node-id"] === "nested-child",
  );
  if (!nestedChild) {
    throw new Error("The saved About screen does not project its nested child");
  }

  const menu = await openLayerStack(app, "about.html");
  await menu.getByText("Nested child", { exact: true }).click();

  await expect
    .poll(() => new URL(page.url()).searchParams.get("screen"))
    .toBe(aboutId);
  const selectedRow = page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem", { selected: true });
  await expect(selectedRow).toHaveCount(1);
  await expect(selectedRow.locator("[data-layer-row-button]")).toHaveAttribute(
    "data-layer-node-id",
    nestedChild.id,
  );
  await expect(selectedRow.locator("[data-layer-row-name]")).toHaveText(
    "Nested child",
  );

  await app.settled();
  expect(await app.savedHtml(designId, "index.html")).toBe(homeBaseline);
  expect(await app.savedHtml(designId, "about.html")).toBe(aboutBaseline);
});

test("Select layer on a non-active overview screen routes selection to that exact screen", async ({
  app,
  page,
}) => {
  const designId = await app.seed(STACK_HTML, {
    files: { "about.html": STACK_HTML },
  });
  const { files } = await app.savedRecord(designId);
  const homeId = files.find((file) => file.filename === "index.html")!.id;
  const aboutId = files.find((file) => file.filename === "about.html")!.id;
  await app.open(designId);
  await expect(
    page.getByRole("button", { name: "Interact" }).first(),
  ).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("screen"))
    .toBe(homeId);

  const aboutBaseline = await app.savedHtml(designId, "about.html");
  const menu = await openLayerStack(app, "about.html");
  await menu.getByText("Nested child", { exact: true }).click();

  await expect
    .poll(() => new URL(page.url()).searchParams.get("screen"))
    .toBe(aboutId);
  await expect.poll(() => selectedTreeLabel(page)).toContain("Nested child");

  await openLayerStack(app, "about.html", false);
  await openAgentFromMenu(page);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("screen"))
    .toBe(aboutId);

  await app.settled();
  expect(await app.savedHtml(designId, "about.html")).toBe(aboutBaseline);
});

test("Edit with Agent opened from direct mode opens the Agent panel and leaves the design unchanged", async ({
  app,
  page,
}) => {
  const designId = await app.seed(STACK_HTML);
  await app.open(designId);
  await enterDirectMode(page);
  const baselineContent = await app.savedHtml(designId);

  await openLayerStack(app, undefined, false);
  await openAgentFromMenu(page);

  await app.settled();
  expect(await app.savedHtml(designId)).toBe(baselineContent);
});
