import { type Page } from "@playwright/test";

import { appPath, expandAllLayers } from "./helpers";
import { expect, expectOnlyChanged, test, type App } from "./rails";

const ROW_FRAME_ID = "fixed-size-row-frame";
const COLUMN_LEAF_ID = "fixed-size-column-leaf";

type DesignRecord = {
  files?: Array<{ id: string; filename?: string; content?: string }>;
};

const CONSTRAINED_FLEX_HTML = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="box-sizing:border-box;width:480px;height:360px;margin:0;padding:20px;display:flex;flex-direction:column;gap:20px">
  <section data-agent-native-node-id="fixed-size-row-parent" data-agent-native-layer-name="Row Parent" data-an-primitive="frame" style="box-sizing:border-box;width:180px;height:140px;padding:8px;display:flex;flex-direction:row;align-items:stretch;gap:8px;flex:0 0 auto;background:#e2e8f0">
    <div data-agent-native-node-id="${ROW_FRAME_ID}" data-agent-native-layer-name="Row Frame" data-an-primitive="frame" style="box-sizing:border-box;width:120px;height:100%;min-width:0;flex:0 1 auto;display:flex;align-items:center;background:#2563eb"><span>Frame</span></div>
    <div data-agent-native-node-id="fixed-size-row-companion" data-agent-native-layer-name="Row Companion" data-an-primitive="rectangle" style="box-sizing:border-box;width:30px;height:40px;flex:0 1 auto;background:#f97316"></div>
  </section>
  <section data-agent-native-node-id="fixed-size-column-parent" data-agent-native-layer-name="Column Parent" data-an-primitive="frame" style="box-sizing:border-box;width:180px;height:140px;padding:8px;display:flex;flex-direction:column;align-items:stretch;gap:8px;flex:0 0 auto;background:#e2e8f0">
    <div data-agent-native-node-id="${COLUMN_LEAF_ID}" data-agent-native-layer-name="Column Leaf" data-an-primitive="rectangle" style="box-sizing:border-box;width:100%;height:80px;min-height:0;flex:0 1 auto;background:#16a34a"></div>
    <div data-agent-native-node-id="fixed-size-column-companion" data-agent-native-layer-name="Column Companion" data-an-primitive="rectangle" style="box-sizing:border-box;width:40px;height:24px;flex:0 1 auto;background:#f97316"></div>
  </section>
</body></html>`;

async function readDesign(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()) as DesignRecord;
}

async function readInlineSizingStyles(
  page: Page,
  designId: string,
  screenId: string,
  nodeId: string,
) {
  const design = await readDesign(page, designId);
  const content = design.files?.find((file) => file.id === screenId)?.content;
  if (!content) throw new Error(`missing saved source for ${screenId}`);
  return page.evaluate(
    ({ html, id }) => {
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const node = parsed.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${id}"]`,
      );
      if (!node) throw new Error(`missing source node ${id}`);
      return {
        width: node.style.width,
        height: node.style.height,
        alignSelf: node.style.getPropertyValue("align-self"),
        flexShrink: node.style.flexShrink,
      };
    },
    { html: content, id: nodeId },
  );
}

async function renderedSize(app: App, nodeId: string) {
  const rect = await app.designRect(nodeId);
  return { width: rect.width, height: rect.height };
}

async function selectLayer(page: Page, name: string) {
  const row = page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem", { name: new RegExp(`\\b${name}\\b`) })
    .first();
  const button = row.getByRole("button", { name, exact: true });
  await expect(button).toHaveCount(1);
  await button.click();
  await expect(row).toHaveAttribute("aria-selected", "true");
}

async function setDimension(page: Page, axis: "W" | "H", value: number) {
  const input = page.getByRole("textbox", { name: `${axis} size in pixels` });
  await expect(input).toBeVisible();
  await input.fill(String(value));
  await input.press("Enter");
}

function sizingMode(page: Page, axis: "W" | "H", mode: "Fixed" | "Fill") {
  return page.getByRole("button", {
    name: new RegExp(`^${axis}(?: sizing mode — | \\d+ )${mode}$`),
  });
}

async function setSizingMode(
  page: Page,
  axis: "W" | "H",
  currentMode: "Fixed" | "Fill",
  nextMode: "Fixed" | "Fill",
) {
  await sizingMode(page, axis, currentMode).click();
  await page
    .getByRole("menuitem", {
      name: nextMode === "Fill" ? "Fill container" : "Fixed",
      exact: true,
    })
    .click();
}

async function reopenAndSelect(app: App, designId: string, layer: string) {
  await app.open(designId);
  await expandAllLayers(app.page);
  await selectLayer(app.page, layer);
}

async function screenFileId(page: Page, designId: string) {
  const design = await readDesign(page, designId);
  const file = design.files?.find(
    (candidate) => candidate.filename === "index.html",
  );
  if (!file) throw new Error("seeded design has no index.html");
  return file.id;
}

// fixme: product bug: Fixing Row Frame at 260px inside a 164px-wide row collapses the sibling Row Companion (authored width:30px) to 0px wide: the row gives
test.fixme("numeric Fixed size sticks on a Frame's row main axis while its cross axis stays Fill", async ({
  app,
  page,
}) => {
  const designId = await app.seed(CONSTRAINED_FLEX_HTML);
  const screenId = await screenFileId(page, designId);
  await reopenAndSelect(app, designId, "Row Frame");
  await setSizingMode(page, "H", "Fill", "Fill");
  await expect
    .poll(() => readInlineSizingStyles(page, designId, screenId, ROW_FRAME_ID))
    .toMatchObject({ height: "auto", alignSelf: "stretch" });
  await app.settled();
  const before = await app.savedNodes(designId);

  await setDimension(page, "W", 260);
  await app.settled();

  expect(
    await readInlineSizingStyles(page, designId, screenId, ROW_FRAME_ID),
  ).toEqual({
    width: "260px",
    height: "auto",
    alignSelf: "stretch",
    flexShrink: "0",
  });
  expectOnlyChanged(before, await app.savedNodes(designId), [ROW_FRAME_ID]);
  expect(await renderedSize(app, ROW_FRAME_ID)).toEqual({
    width: 260,
    height: 124,
  });

  await reopenAndSelect(app, designId, "Row Frame");
  await expect(sizingMode(page, "W", "Fixed")).toBeVisible();
  await expect(sizingMode(page, "H", "Fill")).toBeVisible();
  expect(await renderedSize(app, ROW_FRAME_ID)).toEqual({
    width: 260,
    height: 124,
  });

  await setSizingMode(page, "H", "Fill", "Fixed");
  await app.settled();
  expect(
    await readInlineSizingStyles(page, designId, screenId, ROW_FRAME_ID),
  ).toEqual({
    width: "260px",
    height: "124px",
    alignSelf: "auto",
    flexShrink: "0",
  });
  await expect(sizingMode(page, "H", "Fixed")).toBeVisible();
  expect(await renderedSize(app, ROW_FRAME_ID)).toEqual({
    width: 260,
    height: 124,
  });
  expect(
    await renderedSize(app, "fixed-size-row-companion"),
    "the fixed 30x40 sibling keeps its size",
  ).toEqual({ width: 30, height: 40 });
});

// fixme: product bug: Column Companion (authored height:24px) collapses to 0px tall once Column Leaf is fixed at 220px in a 124px-tall column. Same root cause
test.fixme("numeric Fixed size sticks on a leaf's column main axis while its cross axis stays Fill", async ({
  app,
  page,
}) => {
  const designId = await app.seed(CONSTRAINED_FLEX_HTML);
  const screenId = await screenFileId(page, designId);
  await reopenAndSelect(app, designId, "Column Leaf");
  await setSizingMode(page, "W", "Fill", "Fill");
  await expect
    .poll(() =>
      readInlineSizingStyles(page, designId, screenId, COLUMN_LEAF_ID),
    )
    .toMatchObject({ width: "auto", alignSelf: "stretch" });
  await app.settled();
  const before = await app.savedNodes(designId);

  await setDimension(page, "H", 220);
  await app.settled();

  expect(
    await readInlineSizingStyles(page, designId, screenId, COLUMN_LEAF_ID),
  ).toEqual({
    width: "auto",
    height: "220px",
    alignSelf: "stretch",
    flexShrink: "0",
  });
  expectOnlyChanged(before, await app.savedNodes(designId), [COLUMN_LEAF_ID]);
  expect(await renderedSize(app, COLUMN_LEAF_ID)).toEqual({
    width: 164,
    height: 220,
  });

  await reopenAndSelect(app, designId, "Column Leaf");
  await expect(sizingMode(page, "W", "Fill")).toBeVisible();
  await expect(sizingMode(page, "H", "Fixed")).toBeVisible();
  expect(await renderedSize(app, COLUMN_LEAF_ID)).toEqual({
    width: 164,
    height: 220,
  });

  await setSizingMode(page, "W", "Fill", "Fixed");
  await app.settled();
  expect(
    await readInlineSizingStyles(page, designId, screenId, COLUMN_LEAF_ID),
  ).toEqual({
    width: "164px",
    height: "220px",
    alignSelf: "auto",
    flexShrink: "0",
  });
  await expect(sizingMode(page, "W", "Fixed")).toBeVisible();
  expect(await renderedSize(app, COLUMN_LEAF_ID)).toEqual({
    width: 164,
    height: 220,
  });
  expect(
    await renderedSize(app, "fixed-size-column-companion"),
    "the fixed 40x24 sibling keeps its size",
  ).toEqual({ width: 40, height: 24 });
});
