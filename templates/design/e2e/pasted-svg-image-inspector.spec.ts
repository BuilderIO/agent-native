import { readFile } from "node:fs/promises";
import path from "node:path";

import { type Locator, type Page } from "@playwright/test";

import {
  appPath,
  cdpScreenshot,
  designFrame,
  expandAllLayers,
  gotoEditor,
} from "./helpers";
import {
  expect,
  expectOnlyChanged,
  savedNodeMap,
  styleOf,
  test,
  type App,
} from "./rails";

const HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><main style="position:relative;width:640px;height:480px"><img data-agent-native-node-id="fit-target" data-agent-native-layer-name="Fit target" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" style="position:absolute;left:20px;top:20px;width:120px;height:80px" /></main></body></html>`;
const DUAL_STROKE_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><main style="position:relative;width:640px;height:480px"><img data-agent-native-node-id="dual-stroke" data-agent-native-layer-name="Dual stroke image" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" style="position:absolute;left:20px;top:20px;width:120px;height:80px;border:9px solid #fff;outline:9px solid #fff;outline-offset:0" /></main></body></html>`;

async function action(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(app: App, content = HTML) {
  const designId = await app.seed(content);
  const screenId = (await app.savedRecord(designId)).files.find(
    (file) => file.filename === "index.html",
  )!.id;
  await action(app.page, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["canvasFrames", screenId],
        value: { x: 100, y: 100, width: 640, height: 480 },
      },
    ],
  });
  return { designId, screenId };
}
test("image border and outline remain separate inside and outside strokes", async ({
  app,
  page,
}) => {
  const { designId, screenId } = await createDesign(app, DUAL_STROKE_HTML);
  await gotoEditor(page, designId);
  await expandAllLayers(page);
  await page
    .getByRole("treeitem")
    .filter({ hasText: "Dual stroke image" })
    .first()
    .locator("[data-layer-row-button]")
    .click();

  const stroke = page
    .getByRole("heading", { name: "Stroke", exact: true })
    .locator("xpath=ancestor::section");
  const positions = stroke.getByRole("combobox");
  const weights = stroke.locator('input[aria-label="Weight"]');
  await expect(positions).toHaveCount(2);
  await expect(positions.nth(0)).toHaveText("Inside");
  await expect(positions.nth(1)).toHaveText("Outside");
  await expect(weights).toHaveCount(2);
  await expect(weights.nth(0)).toHaveValue("9px");
  await expect(weights.nth(1)).toHaveValue("9px");

  await stroke.getByRole("button", { name: "Remove layer" }).first().click();
  const image = designFrame(page, screenId).locator(
    '[data-agent-native-node-id="dual-stroke"]',
  );
  await expect
    .poll(() =>
      image.evaluate((element) => {
        const style = getComputedStyle(element);
        return [style.borderWidth, style.outlineWidth].join("|");
      }),
    )
    .toBe("0px|9px");

  await page.reload();
  await expandAllLayers(page);
  await page
    .getByRole("treeitem")
    .filter({ hasText: "Dual stroke image" })
    .first()
    .locator("[data-layer-row-button]")
    .click();
  const reloadedStroke = page
    .getByRole("heading", { name: "Stroke", exact: true })
    .locator("xpath=ancestor::section");
  await expect(reloadedStroke.getByRole("combobox")).toHaveCount(1);
  await expect(reloadedStroke.getByRole("combobox")).toHaveText("Outside");
  await expect(
    reloadedStroke.locator('input[aria-label="Weight"]'),
  ).toHaveValue("9px");
});

async function createSecondScreen(page: Page, designId: string) {
  const file = await action(page, "create-file", {
    designId,
    filename: "screen-target.html",
    fileType: "html",
    content: HTML,
  });
  const fileId = file.id ?? file.data?.id;
  if (typeof fileId !== "string") throw new Error("missing target screen id");
  await action(page, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 900, y: 100, width: 640, height: 480 },
      },
    ],
  });
  return fileId;
}

async function createBoardSurface(page: Page, designId: string) {
  const board = await action(page, "create-file", {
    designId,
    filename: "__board__.html",
    fileType: "html",
    content:
      '<!doctype html><html><body style="margin:0"><div data-agent-native-node-id="board-anchor" data-agent-native-layer-name="Board anchor" style="position:absolute;left:120px;top:120px;width:40px;height:40px;background:#ddd"></div></body></html>',
  });
  const boardFileId = board.id ?? board.data?.id;
  if (typeof boardFileId !== "string") throw new Error("missing board file id");
  await action(page, "update-design", {
    id: designId,
    dataOperations: [{ op: "set", path: ["boardFileId"], value: boardFileId }],
  });
  return boardFileId;
}

async function pasteSvgFile(
  target: import("@playwright/test").Locator,
  svg: string,
) {
  return target.evaluate((body, source) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([source], "clipboard.svg", { type: "image/svg+xml" }),
    );
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    });
    body.dispatchEvent(event);
    return event.defaultPrevented;
  }, svg);
}

const SVG_FILE =
  '<svg width="80" height="40" viewBox="0 0 80 40"><g><path d="M0 0h30v30z" fill="#f97316"/><path d="M50 0h30v30z" fill="#16a34a"/></g></svg>';

const FIGMA_PASTED_FRAME = {
  title: "Synthetic imported frame",
  width: 104,
  height: 72,
  content: `<!doctype html><html><head></head><body><div data-agent-native-node-id="synthetic-imported-frame" data-agent-native-layer-name="Synthetic imported frame" data-an-primitive="frame" style="position:absolute;left:613px;top:417px;width:104px;height:72px;background-color:#4A70C8"></div></body></html>`,
  wrapsLooseNode: false,
  origin: { x: 613, y: 417 },
  sourceOffset: { x: 31, y: 27 },
};

const FIGMA_CLIPBOARD_HTML = `<!doctype html><html><body><svg width="104" height="72"><rect width="104" height="72" fill="#4A70C8"/></svg><!--(figmeta)${Buffer.from(JSON.stringify({ fileKey: "e2e-synthetic-file", selectedNodeData: "1:7|1|0" })).toString("base64")}(/figmeta)--></body></html>`;

async function pasteFigmaClipboard(page: Page) {
  return page.locator("body").evaluate((body, html) => {
    const transfer = new DataTransfer();
    transfer.setData("text/html", html);
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    });
    body.dispatchEvent(event);
    return event.defaultPrevented;
  }, FIGMA_CLIPBOARD_HTML);
}

async function fillHexInspector(page: Page, expectedHex: string) {
  const fill = page
    .getByRole("heading", { name: "Fill", exact: true })
    .locator("xpath=ancestor::section");
  await expect(
    fill.getByRole("button", { name: "Open color picker" }),
  ).toBeVisible();
  await fill.getByRole("button", { name: "Open color picker" }).click();
  await expect(
    page.getByRole("textbox", { name: "Hex", exact: true }),
  ).toHaveValue(expectedHex);
  await page.keyboard.press("Escape");
}

async function recolorNestedPath(page: Page, screenId: string) {
  const svg = designFrame(page, screenId).locator(
    'svg[data-agent-native-layer-name="Pasted SVG"]',
  );
  const paths = svg.locator("g > path");
  await expect(paths).toHaveCount(2);
  const layers = page.getByRole("tree", { name: "Layers" });
  const svgRow = layers
    .getByRole("treeitem")
    .filter({ hasText: "Pasted SVG" })
    .first();
  await svgRow.getByRole("button", { name: "Expand layer" }).click();
  const groupRow = layers.getByRole("treeitem", { level: 3 }).first();
  await groupRow.getByRole("button", { name: "Expand layer" }).click();
  const pathRow = layers
    .getByRole("treeitem", { level: 4 })
    .filter({ has: page.getByRole("button", { name: "PATH", exact: true }) })
    // Layers are stacked in reverse SVG document order.
    .nth(1);
  await expect(pathRow).toBeVisible();
  await pathRow.locator("[data-layer-row-button]").click();
  await expect(pathRow).toHaveAttribute("aria-selected", "true");
  const fill = page
    .getByRole("heading", { name: "Fill", exact: true })
    .locator("xpath=ancestor::section");
  await fill.getByRole("button", { name: "Open color picker" }).click();
  const hex = page.getByRole("textbox", { name: "Hex", exact: true });
  await hex.fill("3B82F6");
  await hex.press("Enter");
  await expect(paths.nth(0)).toHaveCSS("fill", "rgb(59, 130, 246)");
  await expect(paths.nth(1)).toHaveCSS("fill", "rgb(22, 163, 74)");
  return svg;
}

async function assertNestedPathColorPersists(
  page: Page,
  designId: string,
  screenId: string,
  filePath = "index.html",
) {
  const svg = await recolorNestedPath(page, screenId);
  await expect
    .poll(() => readSource(page, designId, filePath))
    .toMatch(/fill:\s*#3b82f6/i);
  await page.reload();
  const reloadedSvg = designFrame(page, screenId).locator(
    'svg[data-agent-native-layer-name="Pasted SVG"]',
  );
  await expect(reloadedSvg.locator("g > path").nth(0)).toHaveCSS(
    "fill",
    "rgb(59, 130, 246)",
  );
  await expect(reloadedSvg.locator("g > path").nth(1)).toHaveCSS(
    "fill",
    "rgb(22, 163, 74)",
  );
}

async function readSource(page: Page, designId: string, filePath: string) {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/read-source-file?designId=${encodeURIComponent(designId)}&path=${encodeURIComponent(filePath)}`,
    ),
  );
  if (!response.ok()) return "";
  const source = await response.json();
  return typeof source.content === "string" ? source.content : "";
}

async function readBoardContent(
  page: Page,
  designId: string,
  boardFileId: string,
) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) {
    throw new Error(`get-design failed: ${response.status()}`);
  }
  const design = await response.json();
  const board = design.files?.find(
    (file: { id?: string }) => file.id === boardFileId,
  );
  if (typeof board?.content !== "string") {
    throw new Error("get-design returned no board file content");
  }
  return board.content as string;
}
// fixme: product bug: With Fit target selected, the pasted SVG is saved as a static child of <main> and renders at the Screen's 0,0, over Fit target. The paste
test.fixme("pasted SVG is an editable sized layer and image scale mode writes object-fit", async ({
  app,
  page,
}, testInfo) => {
  const { designId, screenId } = await createDesign(app);
  await gotoEditor(page, designId);
  await expandAllLayers(page);
  const imageRow = page
    .getByRole("treeitem")
    .filter({ hasText: "Fit target" })
    .first();
  await imageRow.locator("[data-layer-row-button]").click();
  await page.getByRole("button", { name: "Image adjustments" }).click();
  await page.getByRole("combobox", { name: "Image scale mode" }).click();
  await page.getByRole("option", { name: "Crop", exact: true }).click();
  await expect
    .poll(() =>
      designFrame(page, screenId)
        .locator('[data-agent-native-node-id="fit-target"]')
        .evaluate((node) => (node as HTMLElement).style.objectFit),
    )
    .toBe("cover");
  await expect
    .poll(async () => {
      const response = await page.request.get(
        appPath(
          `/_agent-native/actions/read-source-file?designId=${encodeURIComponent(designId)}&path=index.html`,
        ),
      );
      if (!response.ok()) return "";
      const source = await response.json();
      return typeof source.content === "string" ? source.content : "";
    })
    .toContain("object-fit: cover");
  await page.reload();
  await expect
    .poll(() =>
      designFrame(page, screenId)
        .locator('[data-agent-native-node-id="fit-target"]')
        .evaluate((node) => (node as HTMLElement).style.objectFit),
    )
    .toBe("cover");

  const pasteWasPrevented = await designFrame(page, screenId)
    .locator("body")
    .evaluate((body) => {
      const transfer = new DataTransfer();
      transfer.setData(
        "text/plain",
        '<svg width="80" height="40" viewBox="0 0 80 40" fill="#111111"><defs><linearGradient id="unused"><stop offset="0" stop-color="red"/></linearGradient></defs><g id="grouped-art"><path d="M0 0h30v30z" fill="#f97316"/><circle cx="60" cy="20" r="15" fill="#16a34a"/></g></svg>',
      );
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      });
      body.dispatchEvent(event);
      return event.defaultPrevented;
    });
  expect(pasteWasPrevented).toBe(true);
  await expect(
    designFrame(page, screenId).locator(
      'svg[data-agent-native-layer-name="Pasted SVG"]',
    ),
  ).toHaveAttribute("width", "80");
  await expect(
    designFrame(page, screenId).locator(
      'svg[data-agent-native-layer-name="Pasted SVG"]',
    ),
  ).toHaveAttribute("height", "40");
  await expect(
    designFrame(page, screenId).locator(
      'svg[data-agent-native-layer-name="Pasted SVG"]',
    ),
  ).toHaveAttribute("data-an-primitive", "pasted-svg");
  await expect(
    designFrame(page, screenId).locator(
      'svg[data-agent-native-layer-name="Pasted SVG"] path',
    ),
  ).toHaveAttribute("d", "M0 0h30v30z");
  await expect(
    designFrame(page, screenId).locator(
      'svg[data-agent-native-layer-name="Pasted SVG"] > defs',
    ),
  ).toHaveCount(1);
  await expect(
    designFrame(page, screenId).locator(
      'svg[data-agent-native-layer-name="Pasted SVG"] g > circle',
    ),
  ).toHaveCount(1);
  await expect
    .soft(
      designFrame(page, screenId).locator(
        'svg[data-agent-native-layer-name="Pasted SVG"]',
      ),
      "the pasted SVG is placed, not stacked at its container's top-left over Fit target",
    )
    .toHaveCSS("position", "absolute");
  await cdpScreenshot(page, testInfo.outputPath("pasted-svg-live.png"));
  await expect
    .poll(async () => {
      const response = await page.request.get(
        appPath(
          `/_agent-native/actions/read-source-file?designId=${encodeURIComponent(designId)}&path=index.html`,
        ),
      );
      if (!response.ok()) return "";
      const source = await response.json();
      return typeof source.content === "string" ? source.content : "";
    })
    .toContain('data-agent-native-layer-name="Pasted SVG"');

  const editablePath = designFrame(page, screenId).locator(
    'svg[data-agent-native-layer-name="Pasted SVG"] g > path',
  );
  const siblingShape = designFrame(page, screenId).locator(
    'svg[data-agent-native-layer-name="Pasted SVG"] g > circle',
  );
  await page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name: "Pasted SVG", exact: true })
    .click();
  const selectionColors = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Selection colors",
        exact: true,
      }),
    })
    .first();
  const showSelectionColors = selectionColors.getByRole("button", {
    name: "Show selection colors",
  });
  if (await showSelectionColors.count()) await showSelectionColors.click();
  const sourceColor = selectionColors.locator('button[aria-label="#f97316"]');
  await expect(sourceColor).toBeVisible();
  await sourceColor.click();
  const selectionHexInput = page.getByRole("textbox", {
    name: "Hex",
    exact: true,
  });
  await selectionHexInput.fill("8B5CF6");
  await selectionHexInput.press("Enter");
  await expect(editablePath).toHaveCSS("fill", "rgb(139, 92, 246)");
  await expect(siblingShape).toHaveCSS("fill", "rgb(22, 163, 74)");

  const pastedSvgRow = page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem")
    .filter({ hasText: "Pasted SVG" })
    .first();
  await pastedSvgRow.getByRole("button", { name: "Expand layer" }).click();
  const tree = page.getByRole("tree", { name: "Layers" });
  const svgLevel = Number(await pastedSvgRow.getAttribute("aria-level"));
  const groupRow = tree.getByRole("treeitem", { level: svgLevel + 1 }).first();
  await expect(groupRow).toBeVisible();
  if ((await groupRow.getAttribute("aria-expanded")) !== "true") {
    await groupRow.getByRole("button", { name: "Expand layer" }).click();
  }
  await expect(groupRow).toHaveAttribute("aria-expanded", "true");
  const pathRow = tree
    .getByRole("treeitem", { level: svgLevel + 2 })
    .filter({ has: page.getByRole("button", { name: "PATH", exact: true }) });
  await expect(pathRow).toBeVisible();
  await clickLayerRowAndAssertSelected(pathRow);
  const fillSection = page
    .getByRole("heading", { name: "Fill", exact: true })
    .locator("xpath=ancestor::section");
  await expect(fillSection).toBeVisible();
  await fillSection.getByRole("button", { name: "Open color picker" }).click();
  const hexInput = page.getByRole("textbox", { name: "Hex", exact: true });
  await hexInput.fill("3B82F6");
  await hexInput.press("Enter");
  await expect(editablePath).toHaveCSS("fill", "rgb(59, 130, 246)");
  await expect(siblingShape).toHaveCSS("fill", "rgb(22, 163, 74)");
  await expect
    .poll(async () => {
      const response = await page.request.get(
        appPath(
          `/_agent-native/actions/read-source-file?designId=${encodeURIComponent(designId)}&path=index.html`,
        ),
      );
      if (!response.ok()) return "";
      const source = await response.json();
      return typeof source.content === "string" ? source.content : "";
    })
    .toMatch(/<path[^>]*style="[^\"]*fill:\s*#3b82f6/i);
  await page.reload();
  await expect(
    designFrame(page, screenId).locator(
      'svg[data-agent-native-layer-name="Pasted SVG"] path',
    ),
  ).toHaveAttribute("d", "M0 0h30v30z");
  await expect(
    designFrame(page, screenId).locator(
      'svg[data-agent-native-layer-name="Pasted SVG"] path',
    ),
  ).toHaveCSS("fill", "rgb(59, 130, 246)");
  await expect(siblingShape).toHaveCSS("fill", "rgb(22, 163, 74)");
});

// fixme: product bug: The pasted paths' ids 'first'/'second' are rewritten to copy-id-<uuid>, and Layers shows them as 'Copy Id 97d7cf34 0c8f 4820 B234
test.fixme("stroke gradient edits stay on the selected nested pasted-SVG shape", async ({
  app,
  page,
}, testInfo) => {
  const { designId, screenId } = await createDesign(app);
  await gotoEditor(page, designId);
  await expandAllLayers(page);
  const pasted = await designFrame(page, screenId)
    .locator("body")
    .evaluate((body) => {
      const transfer = new DataTransfer();
      transfer.setData(
        "text/plain",
        '<svg width="80" height="40" viewBox="0 0 80 40"><g><path id="first" d="M0 0h30v30z" fill="none" stroke="#111827" stroke-width="2"/><path id="second" d="M50 0h30v30z" fill="none" stroke="#7c3aed" stroke-width="2"/></g></svg>',
      );
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      });
      body.dispatchEvent(event);
      return event.defaultPrevented;
    });
  expect(pasted).toBe(true);

  const svg = designFrame(page, screenId).locator(
    'svg[data-agent-native-layer-name="Pasted SVG"]',
  );
  const paths = svg.locator("g > path");
  await expect(paths).toHaveCount(2);
  const layers = page.getByRole("tree", { name: "Layers" });
  const svgRow = layers
    .getByRole("treeitem")
    .filter({ hasText: "Pasted SVG" })
    .first();
  await svgRow.getByRole("button", { name: "Expand layer" }).click();
  const groupRow = layers.getByRole("treeitem", { level: 3 }).first();
  await groupRow.getByRole("button", { name: "Expand layer" }).click();
  const shapeRows = layers.getByRole("treeitem", { level: 4 });
  await expect(shapeRows).toHaveCount(2);
  const shapeNames = await shapeRows
    .locator("[data-layer-row-name]")
    .evaluateAll((names) => names.map((name) => name.getAttribute("title")));
  expect
    .soft(
      shapeNames.filter((name) => /^Copy Id /.test(name ?? "")),
      "imported shapes keep readable names, not regenerated copy ids",
    )
    .toEqual([]);
  await shapeRows.nth(0).locator("[data-layer-row-button]").click();
  await expect(shapeRows.nth(0)).toHaveAttribute("aria-selected", "true");

  const stroke = page
    .getByRole("heading", { name: "Stroke", exact: true })
    .locator("xpath=ancestor::section");
  await stroke.getByRole("button", { name: "Add stroke" }).first().click();
  await stroke.getByRole("button", { name: "Open color picker" }).click();
  await page.getByRole("button", { name: "Gradient", exact: true }).click();

  const paint = async () =>
    paths.evaluateAll((elements) =>
      elements.map((element) => ({
        style: element.getAttribute("style") ?? "",
        stroke: element.getAttribute("stroke"),
      })),
    );
  await expect
    .poll(async () => (await paint())[1]?.style ?? "")
    .toContain("--an-vector-stroke-gradient:");
  const updated = await paint();
  expect(updated[0]?.stroke).toBe("#111827");
  expect(updated[0]?.style).not.toContain("--an-vector-stroke-gradient:");
  expect(updated[1]?.stroke).toBe("#7c3aed");
  expect(updated[1]?.style).toMatch(/stroke: url\(["']?#/);

  await expect
    .poll(async () => {
      const response = await page.request.get(
        appPath(
          `/_agent-native/actions/read-source-file?designId=${encodeURIComponent(designId)}&path=index.html`,
        ),
      );
      if (!response.ok()) return "";
      const source = await response.json();
      return typeof source.content === "string" ? source.content : "";
    })
    .toContain("data-an-vector-stroke-gradient");
  await page.reload();
  const reloadedSvg = designFrame(page, screenId).locator(
    'svg[data-agent-native-layer-name="Pasted SVG"]',
  );
  const reloadedPaths = reloadedSvg.locator("g > path");
  await expect(reloadedPaths).toHaveCount(2);
  const reloadedPaint = await reloadedPaths.evaluateAll((elements) =>
    elements.map((element) => ({
      style: element.getAttribute("style") ?? "",
      stroke: element.getAttribute("stroke"),
    })),
  );
  expect(reloadedPaint[0]?.stroke).toBe("#111827");
  expect(reloadedPaint[0]?.style).not.toContain("--an-vector-stroke-gradient:");
  expect(reloadedPaint[1]?.style).toContain("--an-vector-stroke-gradient:");
  expect(reloadedPaint[1]?.style).toMatch(/stroke: url\(["']?#/);
  await expandAllLayers(page);
  const reloadedTarget = page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem", { level: 4 })
    .first();
  await expect(reloadedTarget).toBeVisible();
  await clickLayerRowAndAssertSelected(reloadedTarget);
  const reloadedStroke = page
    .getByRole("heading", { name: "Stroke", exact: true })
    .locator("xpath=ancestor::section");
  const reloadedPicker = reloadedStroke.getByRole("button", {
    name: "Open color picker",
  });
  await expect(reloadedPicker).toContainText("Linear");
  await reloadedPicker.click();
  const reloadedPopoverId = await reloadedPicker.getAttribute("aria-controls");
  expect(reloadedPopoverId).toBeTruthy();
  await expect(
    page
      .locator(`[id="${reloadedPopoverId}"]`)
      .getByRole("button", { name: "Gradient", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: testInfo.outputPath("nested-svg-stroke-gradient.png"),
  });
});

test("clipboard SVG File paste in the parent editor stays editable after reload", async ({
  app,
  page,
}) => {
  const { designId, screenId } = await createDesign(app);
  await gotoEditor(page, designId);
  await expandAllLayers(page);
  await page
    .locator(
      `[data-screen-shell][data-frame-id="${screenId}"] [data-frame-title]`,
    )
    .click();

  expect(await pasteSvgFile(page.locator("body"), SVG_FILE)).toBe(true);
  await expect(
    designFrame(page, screenId).locator(
      'svg[data-agent-native-layer-name="Pasted SVG"] g > path',
    ),
  ).toHaveCount(2);
  await expect
    .poll(() => readSource(page, designId, "index.html"))
    .toContain('data-agent-native-layer-name="Pasted SVG"');
  await expect
    .poll(() => readSource(page, designId, "index.html"))
    .not.toContain('data-agent-native-layer-name="clipboard.svg"');
  await expect(
    designFrame(page, screenId).locator(
      'img[data-agent-native-layer-name="clipboard.svg"]',
    ),
  ).toHaveCount(0);
  await assertNestedPathColorPersists(page, designId, screenId);
});

test("pasting a 17 by 9 SVG keeps the selected layer at its copied size", async ({
  app,
  page,
}) => {
  const { designId, screenId } = await createDesign(app);
  const copiedSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="9" viewBox="0 0 17 9"><path d="M0 0h17v9H0z" fill="#111827"/></svg>';
  await gotoEditor(page, designId);
  await expandAllLayers(page);
  await page
    .locator(
      `[data-screen-shell][data-frame-id="${screenId}"] [data-frame-title]`,
    )
    .click();

  expect(await pasteSvgFile(page.locator("body"), copiedSvg)).toBe(true);
  const pastedSvg = designFrame(page, screenId).locator(
    'svg[data-agent-native-layer-name="Pasted SVG"]',
  );
  await expect(pastedSvg).toBeVisible();
  await expect(pastedSvg).toHaveAttribute("data-an-primitive", "pasted-svg");
  await expect
    .poll(() =>
      pastedSvg.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      }),
    )
    .toEqual({ width: 17, height: 9 });

  const selectedLayer = page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem")
    .filter({
      has: page.getByRole("button", { name: "Pasted SVG", exact: true }),
    });
  await expect(selectedLayer).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("textbox", { name: "W size in pixels" }),
  ).toHaveValue("17px");
  await expect(
    page.getByRole("textbox", { name: "H size in pixels" }),
  ).toHaveValue("9px");
});

test("Figma frame paste uses the live Design scene and updates the selected frame inspector", async ({
  app,
  page,
}) => {
  const content = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><main style="position:relative;width:640px;height:480px"><section data-agent-native-node-id="target-container" data-agent-native-layer-name="Target container" data-an-primitive="frame" style="position:absolute;left:80px;top:90px;width:260px;height:180px;background:#eeeeee"><div data-agent-native-node-id="old-child" data-agent-native-layer-name="Old child" style="position:absolute;left:8px;top:8px;width:24px;height:20px;background:#ff0000"></div></section></main></body></html>`;
  const { designId, screenId } = await createDesign(app, content);
  const pasteRequests: Array<Record<string, unknown>> = [];
  await page.route(
    "**/_agent-native/actions/import-figma-clipboard",
    async (route) => {
      const request = route.request().postDataJSON() as Record<string, unknown>;
      pasteRequests.push(request);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layers: [FIGMA_PASTED_FRAME],
          plan: {
            kind: "layers",
            fileId: screenId,
            selector: '[data-agent-native-node-id="target-container"]',
            positions: [{ x: 31, y: 27 }],
          },
          warnings: [],
        }),
      });
    },
  );

  await gotoEditor(page, designId);
  await expandAllLayers(page);
  const targetRow = page
    .getByRole("treeitem")
    .filter({ hasText: "Target container" })
    .first();
  await targetRow.locator("[data-layer-row-button]").click();
  await expect(targetRow).toHaveAttribute("aria-selected", "true");

  expect(await pasteFigmaClipboard(page)).toBe(true);
  await expect.poll(() => pasteRequests.length).toBe(1);
  expect(pasteRequests[0]).toMatchObject({
    designId,
    pasteScene: {
      container: {
        fileId: screenId,
        selector: '[data-agent-native-node-id="target-container"]',
        width: 260,
        height: 180,
      },
    },
  });

  const pasted = designFrame(page, screenId).locator(
    '[data-agent-native-layer-name="Synthetic imported frame"]',
  );
  await expect(pasted).toHaveCount(1);
  await expect
    .poll(() =>
      pasted.evaluate((element) => {
        const style = (element as HTMLElement).style;
        return {
          parent: element.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ),
          left: style.left,
          top: style.top,
          width: style.width,
          height: style.height,
          backgroundColor: getComputedStyle(element).backgroundColor,
        };
      }),
    )
    .toEqual({
      parent: "target-container",
      left: "31px",
      top: "27px",
      width: "104px",
      height: "72px",
      backgroundColor: "rgb(74, 112, 200)",
    });

  const pastedRow = page
    .getByRole("treeitem")
    .filter({ hasText: "Synthetic imported frame" })
    .first();
  await expect(pastedRow).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("textbox", { name: "W size in pixels" }),
  ).toHaveValue("104px");
  await expect(
    page.getByRole("textbox", { name: "H size in pixels" }),
  ).toHaveValue("72px");
  await fillHexInspector(page, "4A70C8");

  await expect
    .poll(() => readSource(page, designId, "index.html"))
    .toContain('data-agent-native-layer-name="Synthetic imported frame"');
  await page.reload();
  await expandAllLayers(page);
  const reloadedRow = page
    .getByRole("treeitem")
    .filter({ hasText: "Synthetic imported frame" })
    .first();
  await reloadedRow.locator("[data-layer-row-button]").click();
  await expect(reloadedRow).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("textbox", { name: "W size in pixels" }),
  ).toHaveValue("104px");
  await expect(
    page.getByRole("textbox", { name: "H size in pixels" }),
  ).toHaveValue("72px");
  await fillHexInspector(page, "4A70C8");
  await expect
    .poll(() =>
      designFrame(page, screenId)
        .locator('[data-agent-native-layer-name="Synthetic imported frame"]')
        .evaluate((element) => ({
          parent: element.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ),
          left: (element as HTMLElement).style.left,
          top: (element as HTMLElement).style.top,
        })),
    )
    .toEqual({ parent: "target-container", left: "31px", top: "27px" });
});

test("Figma paste plans can insert a frame into the Design board and persist it", async ({
  app,
  page,
}) => {
  const { designId, screenId } = await createDesign(app);
  const boardFileId = await createBoardSurface(page, designId);
  const screenBefore = await app.savedNodes(designId);
  const pasteRequests: Array<Record<string, unknown>> = [];
  await page.route(
    "**/_agent-native/actions/import-figma-clipboard",
    async (route) => {
      const request = route.request().postDataJSON() as Record<string, unknown>;
      pasteRequests.push(request);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          layers: [FIGMA_PASTED_FRAME],
          plan: { kind: "board", positions: [{ x: 45, y: 55 }] },
          warnings: [],
        }),
      });
    },
  );

  await gotoEditor(page, designId);
  const boardFrame = page
    .locator("[data-board-surface-layer] iframe[data-design-preview-iframe]")
    .contentFrame();
  const pasted = boardFrame.locator(
    '[data-agent-native-layer-name="Synthetic imported frame"]',
  );
  await expect
    .poll(() =>
      boardFrame.locator("body").evaluate((body) => {
        const frameWindow = body.ownerDocument.defaultView as
          | (Window & {
              __anEditorChromeBridge?: boolean;
            })
          | null;
        return frameWindow?.__anEditorChromeBridge === true;
      }),
    )
    .toBe(true);
  expect(await pasteFigmaClipboard(page)).toBe(true);
  await expect.poll(() => pasteRequests.length).toBe(1);
  expect(pasteRequests[0]).toMatchObject({
    designId,
    pasteScene: {
      viewport: expect.objectContaining({
        width: expect.any(Number),
        height: expect.any(Number),
      }),
      screens: expect.arrayContaining([
        expect.objectContaining({ fileId: screenId }),
      ]),
    },
  });
  await app.settled();
  const board = savedNodeMap(
    await readBoardContent(page, designId, boardFileId),
  );
  const boardBody =
    [...board.values()].find((node) => node.tag === "body")?.id ?? null;
  const frames = [...board.values()].filter(
    (node) =>
      node.attrs["data-agent-native-layer-name"] === "Synthetic imported frame",
  );
  expect(frames).toHaveLength(1);
  expect(frames[0]).toMatchObject({
    parent: boardBody,
    attrs: expect.objectContaining({ "data-an-primitive": "frame" }),
  });
  expect(styleOf(frames[0])).toMatchObject({
    position: "absolute",
    left: "45px",
    top: "55px",
    width: "104px",
    height: "72px",
  });
  expectOnlyChanged(screenBefore, await app.savedNodes(designId), []);
  await expect(pasted).toBeVisible();
  await expect(pasted).toHaveCSS("background-color", "rgb(74, 112, 200)");

  await page.reload();
  const reloadedBoardFrame = page
    .locator("[data-board-surface-layer] iframe[data-design-preview-iframe]")
    .contentFrame();
  const reloaded = reloadedBoardFrame.locator(
    '[data-agent-native-layer-name="Synthetic imported frame"]',
  );
  await expect(reloaded).toHaveCSS("background-color", "rgb(74, 112, 200)");
  expect(
    await reloaded.evaluate((element) => {
      const r = element.getBoundingClientRect();
      return { width: r.width, height: r.height };
    }),
  ).toEqual({ width: 104, height: 72 });
});

test("pasting a PNG identifies its image inspector and persists Fit, Crop, adjustments, and opacity", async ({
  app,
  page,
}, testInfo) => {
  const { designId, screenId } = await createDesign(app);
  const fixture = path.resolve(
    import.meta.dirname,
    "fixtures/card-art-photo.png",
  );
  const bytes = [...(await readFile(fixture))];
  const assetUrl = "/e2e-assets/clipboard-image.png";
  await page.route("**/_agent-native/actions/upload-image", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ url: assetUrl }),
    }),
  );
  await page.route(`**${assetUrl}`, (route) =>
    route.fulfill({
      body: Buffer.from(bytes),
      contentType: "image/png",
    }),
  );
  await gotoEditor(page, designId);
  await expandAllLayers(page);
  await page
    .locator(
      `[data-screen-shell][data-frame-id="${screenId}"] [data-frame-title]`,
    )
    .click();
  const wasHandled = await designFrame(page, screenId)
    .locator("body")
    .evaluate((body, pngBytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([Uint8Array.from(pngBytes)], "clipboard-image.png", {
          type: "image/png",
        }),
      );
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      });
      body.dispatchEvent(event);
      return event.defaultPrevented;
    }, bytes);
  expect(wasHandled).toBe(true);

  const image = designFrame(page, screenId).locator(
    'img[data-agent-native-layer-name="clipboard-image.png"]',
  );
  const imageRow = page
    .getByRole("treeitem")
    .filter({ hasText: "clipboard-image.png" })
    .first();
  await expect(imageRow).toHaveAttribute("aria-selected", "true");
  await expect(image).toHaveAttribute("src", assetUrl);
  await expect
    .poll(() =>
      image.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      }),
    )
    .toEqual({ width: 640, height: 360 });
  await expect
    .poll(() => readSource(page, designId, "index.html"))
    .toContain('data-agent-native-layer-name="clipboard-image.png"');
  expect(await readSource(page, designId, "index.html")).not.toContain("blob:");

  await imageRow.locator("[data-layer-row-button]").click();
  const adjustments = page.getByRole("button", { name: "Image adjustments" });
  await expect(adjustments).toBeVisible();
  await adjustments.click();
  const imageAdjustmentsDialog = page.getByRole("dialog").filter({
    has: page.getByRole("combobox", { name: "Image scale mode" }),
  });
  const scaleMode = imageAdjustmentsDialog.getByRole("combobox", {
    name: "Image scale mode",
  });
  await scaleMode.click();
  await page.getByRole("option", { name: "Fit", exact: true }).click();
  await expect(image).toHaveCSS("object-fit", "contain");
  await expect
    .poll(() => readSource(page, designId, "index.html"))
    .toMatch(/object-fit:\s*contain/i);
  await scaleMode.click();
  await page.getByRole("option", { name: "Crop", exact: true }).click();
  await expect(image).toHaveCSS("object-fit", "cover");
  const exposure = imageAdjustmentsDialog.getByRole("slider", {
    name: "Exposure",
  });
  await expect(exposure).toBeVisible();
  await exposure.focus();
  await exposure.press("ArrowRight");
  await exposure.press("Enter");
  const fillSection = page
    .getByRole("heading", { name: "Fill", exact: true })
    .locator("xpath=ancestor::section");
  const opacity = fillSection.getByRole("textbox", { name: "Opacity" });
  await opacity.fill("63");
  await opacity.press("Enter");
  await expect
    .poll(() => readSource(page, designId, "index.html"))
    .toMatch(/object-fit:\s*cover/i);
  await expect
    .poll(() => readSource(page, designId, "index.html"))
    .toMatch(/opacity\(0\.63\)/i);
  await expect
    .poll(() => readSource(page, designId, "index.html"))
    .toMatch(/exposure/i);

  await page.reload();
  const reloaded = designFrame(page, screenId).locator(
    'img[data-agent-native-layer-name="clipboard-image.png"]',
  );
  await expect(reloaded).toHaveAttribute("src", assetUrl);
  await expect(reloaded).toHaveCSS("width", "640px");
  await expect(reloaded).toHaveCSS("height", "360px");
  await expect(reloaded).toHaveCSS("object-fit", "cover");
  await expect(reloaded).toHaveCSS("filter", /opacity\(0\.63\)/);
  await expect
    .poll(() =>
      reloaded.evaluate(
        (element) => (element as HTMLImageElement).naturalWidth,
      ),
    )
    .toBe(640);
  await expect
    .poll(() => readSource(page, designId, "index.html"))
    .toMatch(/object-fit:\s*cover/i);
  await page
    .getByRole("treeitem")
    .filter({ hasText: "clipboard-image.png" })
    .first()
    .locator("[data-layer-row-button]")
    .click();
  await expect(
    page.getByRole("button", { name: "Image adjustments" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Image adjustments" }).click();
  await expect(
    page.getByRole("combobox", { name: "Image scale mode" }),
  ).toHaveText("Crop");
  await expect(
    fillSection.getByRole("textbox", { name: "Opacity" }),
  ).toHaveValue("63");
  await expect(
    page.getByRole("slider", { name: "Exposure" }),
  ).not.toHaveAttribute("aria-valuenow", "0");
  await page.screenshot({
    path: testInfo.outputPath("pasted-png-inspector-after-reload.png"),
  });
});

test("clipboard SVG File paste relayed from a Screen iframe stays in that Screen", async ({
  app,
  page,
}) => {
  const { designId, screenId: firstScreenId } = await createDesign(app);
  const targetScreenId = await createSecondScreen(page, designId);
  await gotoEditor(page, designId);
  await expandAllLayers(page);

  expect(
    await pasteSvgFile(
      designFrame(page, targetScreenId).locator("body"),
      SVG_FILE,
    ),
  ).toBe(true);
  await expect(
    designFrame(page, targetScreenId).locator(
      'svg[data-agent-native-layer-name="Pasted SVG"] g > path',
    ),
  ).toHaveCount(2);
  await expect(
    designFrame(page, firstScreenId).locator(
      'svg[data-agent-native-layer-name="Pasted SVG"]',
    ),
  ).toHaveCount(0);
  await expect
    .poll(() => readSource(page, designId, "screen-target.html"))
    .toContain('data-agent-native-layer-name="Pasted SVG"');
  await expect
    .poll(() => readSource(page, designId, "screen-target.html"))
    .not.toContain('data-agent-native-layer-name="clipboard.svg"');
  await expect(
    designFrame(page, targetScreenId).locator(
      'img[data-agent-native-layer-name="clipboard.svg"]',
    ),
  ).toHaveCount(0);
  await expect
    .poll(() => readSource(page, designId, "index.html"))
    .not.toContain('data-agent-native-layer-name="Pasted SVG"');
  await assertNestedPathColorPersists(
    page,
    designId,
    targetScreenId,
    "screen-target.html",
  );
});
test("clipboard SVG File paste from the board iframe targets the selected Screen", async ({
  app,
  page,
}) => {
  const { designId, screenId } = await createDesign(app);
  const boardFileId = await createBoardSurface(page, designId);
  await gotoEditor(page, designId);
  await page
    .locator(
      `[data-screen-shell][data-frame-id="${screenId}"] [data-frame-title]`,
    )
    .click();

  const boardFrame = page
    .locator("iframe[data-design-preview-iframe]:not([data-screen-iframe-id])")
    .contentFrame();
  await expect(boardFrame.locator("body")).toBeAttached();
  expect(await pasteSvgFile(boardFrame.locator("body"), SVG_FILE)).toBe(true);

  await expect(
    designFrame(page, screenId).locator(
      'svg[data-agent-native-layer-name="Pasted SVG"] g > path',
    ),
  ).toHaveCount(2);
  await expect
    .poll(() => readSource(page, designId, "index.html"))
    .toContain('data-agent-native-layer-name="Pasted SVG"');
  await expect
    .poll(async () => {
      const response = await page.request.get(
        appPath(`/_agent-native/actions/get-design?id=${designId}`),
      );
      if (!response.ok()) {
        throw new Error(`get-design failed: ${response.status()}`);
      }
      const design = await response.json();
      const board = design.files?.find(
        (file: { filename?: string }) => file.filename === "__board__.html",
      );
      if (typeof board?.content !== "string") {
        throw new Error("get-design returned no board file content");
      }
      return board.content;
    })
    .not.toContain('data-agent-native-layer-name="Pasted SVG"');
  await expect
    .poll(() => readSource(page, designId, "index.html"))
    .not.toContain('data-agent-native-layer-name="clipboard.svg"');
});

async function clickLayerRowAndAssertSelected(row: Locator): Promise<void> {
  await row.locator("[data-layer-row-button]").click();
  await expect(row).toHaveAttribute("aria-selected", "true");
}
