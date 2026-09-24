import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  appPath,
  cdpScreenshot,
  designFrame,
  expandAllLayers,
  gotoEditor,
} from "./helpers";

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

async function createDesign(page: Page, content = HTML) {
  const design = await action(page, "create-design", {
    title: `Pasted SVG image ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = design.id ?? design.data?.id;
  if (typeof designId !== "string") throw new Error("missing design id");
  const file = await action(page, "create-file", {
    designId,
    filename: "screen.html",
    fileType: "html",
    content,
  });
  const fileId = file.id ?? file.data?.id;
  if (typeof fileId !== "string") throw new Error("missing screen id");
  await action(page, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 100, y: 100, width: 640, height: 480 },
      },
    ],
  });
  return { designId, screenId: fileId };
}

test("image border and outline remain separate inside and outside strokes", async ({
  page,
}) => {
  const { designId, screenId } = await createDesign(page, DUAL_STROKE_HTML);
  try {
    await gotoEditor(page, designId);
    await page.getByRole("tab", { name: "Design", exact: true }).click();
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
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
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
  title: "Pasted Figma frame",
  width: 96,
  height: 64,
  content: `<!doctype html><html><head></head><body><div data-agent-native-node-id="figma-pasted-frame" data-agent-native-layer-name="Pasted Figma frame" data-an-primitive="frame" style="position:absolute;left:700px;top:500px;width:96px;height:64px;background-color:#123456"></div></body></html>`,
  wrapsLooseNode: false,
  origin: { x: 700, y: 500 },
  sourceOffset: { x: 24, y: 34 },
};

const FIGMA_CLIPBOARD_HTML = `<!doctype html><html><body><svg width="96" height="64"><rect width="96" height="64" fill="#123456"/></svg><!--(figmeta)${Buffer.from(JSON.stringify({ fileKey: "e2e-figma-file", selectedNodeData: "1:2|4|0" })).toString("base64")}(/figmeta)--></body></html>`;

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
  await pathRow.click();
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
  filePath = "screen.html",
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

test("pasted SVG is an editable sized layer and image scale mode writes object-fit", async ({
  page,
}, testInfo) => {
  const { designId, screenId } = await createDesign(page);
  try {
    await gotoEditor(page, designId);
    await page.getByRole("tab", { name: "Design", exact: true }).click();
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
            `/_agent-native/actions/read-source-file?designId=${encodeURIComponent(designId)}&path=screen.html`,
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
    await cdpScreenshot(page, testInfo.outputPath("pasted-svg-live.png"));
    await expect
      .poll(async () => {
        const response = await page.request.get(
          appPath(
            `/_agent-native/actions/read-source-file?designId=${encodeURIComponent(designId)}&path=screen.html`,
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
    const groupRow = page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem", { level: 3 })
      .first();
    await expect(groupRow).toBeVisible();
    await groupRow.getByRole("button", { name: "Expand layer" }).click();
    const pathRow = page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem", { level: 4 })
      .filter({ has: page.getByRole("button", { name: "PATH", exact: true }) });
    await expect(pathRow).toBeVisible();
    await pathRow.click();
    const fillSection = page
      .getByRole("heading", { name: "Fill", exact: true })
      .locator("xpath=ancestor::section");
    await expect(fillSection).toBeVisible();
    await fillSection
      .getByRole("button", { name: "Open color picker" })
      .click();
    const hexInput = page.getByRole("textbox", { name: "Hex", exact: true });
    await hexInput.fill("3B82F6");
    await hexInput.press("Enter");
    await expect(editablePath).toHaveCSS("fill", "rgb(59, 130, 246)");
    await expect(siblingShape).toHaveCSS("fill", "rgb(22, 163, 74)");
    await expect
      .poll(async () => {
        const response = await page.request.get(
          appPath(
            `/_agent-native/actions/read-source-file?designId=${encodeURIComponent(designId)}&path=screen.html`,
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
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("stroke gradient edits stay on the selected nested pasted-SVG shape", async ({
  page,
}, testInfo) => {
  const { designId, screenId } = await createDesign(page);
  try {
    await gotoEditor(page, designId);
    await page.getByRole("tab", { name: "Design", exact: true }).click();
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
    // Imported SVG paths can have authored IDs, so Layers exposes their
    // generated copy-ID actions instead of a generic PATH label.
    const shapeRows = layers.getByRole("treeitem", { level: 4 });
    await expect(shapeRows).toHaveCount(2);
    // Layers orders the imported paths in reverse authored order: the first
    // row is the authored `second` path.
    await shapeRows.nth(0).click();
    await expect(shapeRows.nth(0)).toHaveAttribute("aria-selected", "true");

    const stroke = page
      .getByRole("heading", { name: "Stroke", exact: true })
      .locator("xpath=ancestor::section");
    await stroke.getByRole("button", { name: "Add stroke" }).first().click();
    await stroke.getByRole("button", { name: "Open color picker" }).click();
    await page.getByRole("button", { name: "Linear", exact: true }).click();

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
            `/_agent-native/actions/read-source-file?designId=${encodeURIComponent(designId)}&path=screen.html`,
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
    expect(reloadedPaint[0]?.style).not.toContain(
      "--an-vector-stroke-gradient:",
    );
    expect(reloadedPaint[1]?.style).toContain("--an-vector-stroke-gradient:");
    expect(reloadedPaint[1]?.style).toMatch(/stroke: url\(["']?#/);
    await expandAllLayers(page);
    const reloadedTarget = page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem", { level: 4 })
      .first();
    await expect(reloadedTarget).toBeVisible();
    await reloadedTarget.click();
    const reloadedStroke = page
      .getByRole("heading", { name: "Stroke", exact: true })
      .locator("xpath=ancestor::section");
    const reloadedPicker = reloadedStroke.getByRole("button", {
      name: "Open color picker",
    });
    await expect(reloadedPicker).toContainText("Linear");
    await reloadedPicker.click();
    const reloadedPopoverId =
      await reloadedPicker.getAttribute("aria-controls");
    expect(reloadedPopoverId).toBeTruthy();
    await expect(
      page
        .locator(`[id="${reloadedPopoverId}"]`)
        .getByRole("button", { name: "Linear", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({
      path: testInfo.outputPath("nested-svg-stroke-gradient.png"),
    });
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("clipboard SVG File paste in the parent editor stays editable after reload", async ({
  page,
}) => {
  const { designId, screenId } = await createDesign(page);
  try {
    await gotoEditor(page, designId);
    await page.getByRole("tab", { name: "Design", exact: true }).click();
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
      .poll(() => readSource(page, designId, "screen.html"))
      .toContain('data-agent-native-layer-name="Pasted SVG"');
    await expect
      .poll(() => readSource(page, designId, "screen.html"))
      .not.toContain('data-agent-native-layer-name="clipboard.svg"');
    await expect(
      designFrame(page, screenId).locator(
        'img[data-agent-native-layer-name="clipboard.svg"]',
      ),
    ).toHaveCount(0);
    await assertNestedPathColorPersists(page, designId, screenId);
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("pasting a 17 by 9 SVG keeps the selected layer at its copied size", async ({
  page,
}) => {
  const { designId, screenId } = await createDesign(page);
  const copiedSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="9" viewBox="0 0 17 9"><path d="M0 0h17v9H0z" fill="#111827"/></svg>';
  try {
    await gotoEditor(page, designId);
    await page.getByRole("tab", { name: "Design", exact: true }).click();
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
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("Figma frame paste uses the live Design scene and updates the selected frame inspector", async ({
  page,
}) => {
  const content = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><main style="position:relative;width:640px;height:480px"><section data-agent-native-node-id="target-container" data-agent-native-layer-name="Target container" data-an-primitive="frame" style="position:absolute;left:80px;top:90px;width:260px;height:180px;background:#eeeeee"><div data-agent-native-node-id="old-child" data-agent-native-layer-name="Old child" style="position:absolute;left:8px;top:8px;width:24px;height:20px;background:#ff0000"></div></section></main></body></html>`;
  const { designId, screenId } = await createDesign(page, content);
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
            positions: [{ x: 24, y: 34 }],
          },
          warnings: [],
        }),
      });
    },
  );

  try {
    await gotoEditor(page, designId);
    await page.getByRole("tab", { name: "Design", exact: true }).click();
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
      '[data-agent-native-layer-name="Pasted Figma frame"]',
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
        left: "24px",
        top: "34px",
        width: "96px",
        height: "64px",
        backgroundColor: "rgb(18, 52, 86)",
      });

    const pastedRow = page
      .getByRole("treeitem")
      .filter({ hasText: "Pasted Figma frame" })
      .first();
    await expect(pastedRow).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("textbox", { name: "W size in pixels" }),
    ).toHaveValue("96px");
    await expect(
      page.getByRole("textbox", { name: "H size in pixels" }),
    ).toHaveValue("64px");
    await fillHexInspector(page, "123456");

    await expect
      .poll(() => readSource(page, designId, "screen.html"))
      .toContain('data-agent-native-layer-name="Pasted Figma frame"');
    await page.reload();
    await expandAllLayers(page);
    const reloadedRow = page
      .getByRole("treeitem")
      .filter({ hasText: "Pasted Figma frame" })
      .first();
    await reloadedRow.locator("[data-layer-row-button]").click();
    await expect(reloadedRow).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("textbox", { name: "W size in pixels" }),
    ).toHaveValue("96px");
    await expect(
      page.getByRole("textbox", { name: "H size in pixels" }),
    ).toHaveValue("64px");
    await fillHexInspector(page, "123456");
    await expect
      .poll(() =>
        designFrame(page, screenId)
          .locator('[data-agent-native-layer-name="Pasted Figma frame"]')
          .evaluate((element) => ({
            parent: element.parentElement?.getAttribute(
              "data-agent-native-node-id",
            ),
            left: (element as HTMLElement).style.left,
            top: (element as HTMLElement).style.top,
          })),
      )
      .toEqual({ parent: "target-container", left: "24px", top: "34px" });
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("Figma paste plans can insert a frame into the Design board and persist it", async ({
  page,
}) => {
  const { designId, screenId } = await createDesign(page);
  const boardFileId = await createBoardSurface(page, designId);
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

  try {
    await gotoEditor(page, designId);
    await page.getByRole("tab", { name: "Design", exact: true }).click();
    const boardFrame = page
      .locator("[data-board-surface-layer] iframe[data-design-preview-iframe]")
      .contentFrame();
    const pasted = boardFrame.locator(
      '[data-agent-native-layer-name="Pasted Figma frame"]',
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
    await expect
      .poll(() => readBoardContent(page, designId, boardFileId))
      .toContain('data-agent-native-layer-name="Pasted Figma frame"');
    await expect(pasted).toBeVisible();
    await expect(pasted).toHaveCSS("background-color", "rgb(18, 52, 86)", {
      timeout: 15_000,
    });
    await page.reload();
    const reloadedBoardFrame = page
      .locator("[data-board-surface-layer] iframe[data-design-preview-iframe]")
      .contentFrame();
    await expect(
      reloadedBoardFrame.locator(
        '[data-agent-native-layer-name="Pasted Figma frame"]',
      ),
    ).toHaveCSS("background-color", "rgb(18, 52, 86)");
    await expect
      .poll(() => readBoardContent(page, designId, boardFileId))
      .toContain("left: 45px");
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("pasting a PNG identifies its image inspector and persists Fit, Crop, adjustments, and opacity", async ({
  page,
}, testInfo) => {
  const { designId, screenId } = await createDesign(page);
  const fixture = path.resolve(
    import.meta.dirname,
    "fixtures/responsive-card-art-photo.png",
  );
  const bytes = [...(await readFile(fixture))];
  const assetUrl = "/e2e-assets/clipboard-image.png";
  try {
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
    await page.getByRole("tab", { name: "Design", exact: true }).click();
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
      .poll(() => readSource(page, designId, "screen.html"))
      .toContain('data-agent-native-layer-name="clipboard-image.png"');
    expect(await readSource(page, designId, "screen.html")).not.toContain(
      "blob:",
    );

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
      .poll(() => readSource(page, designId, "screen.html"))
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
      .poll(() => readSource(page, designId, "screen.html"))
      .toMatch(/object-fit:\s*cover/i);
    await expect
      .poll(() => readSource(page, designId, "screen.html"))
      .toMatch(/opacity\(0\.63\)/i);
    await expect
      .poll(() => readSource(page, designId, "screen.html"))
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
      .poll(() => readSource(page, designId, "screen.html"))
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
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("clipboard SVG File paste relayed from a Screen iframe stays in that Screen", async ({
  page,
}) => {
  const { designId, screenId: firstScreenId } = await createDesign(page);
  try {
    const targetScreenId = await createSecondScreen(page, designId);
    await gotoEditor(page, designId);
    await page.getByRole("tab", { name: "Design", exact: true }).click();
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
      .poll(() => readSource(page, designId, "screen.html"))
      .not.toContain('data-agent-native-layer-name="Pasted SVG"');
    await assertNestedPathColorPersists(
      page,
      designId,
      targetScreenId,
      "screen-target.html",
    );
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("clipboard SVG File paste from the board iframe targets the selected Screen", async ({
  page,
}) => {
  const { designId, screenId } = await createDesign(page);
  try {
    const boardFileId = await createBoardSurface(page, designId);
    await gotoEditor(page, designId);
    await page
      .locator(
        `[data-screen-shell][data-frame-id="${screenId}"] [data-frame-title]`,
      )
      .click();

    const boardFrame = page
      .locator(
        "iframe[data-design-preview-iframe]:not([data-screen-iframe-id])",
      )
      .contentFrame();
    await expect(boardFrame.locator("body")).toBeAttached();
    expect(await pasteSvgFile(boardFrame.locator("body"), SVG_FILE)).toBe(true);

    await expect(
      designFrame(page, screenId).locator(
        'svg[data-agent-native-layer-name="Pasted SVG"] g > path',
      ),
    ).toHaveCount(2);
    await expect
      .poll(() => readSource(page, designId, "screen.html"))
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
      .poll(() => readSource(page, designId, "screen.html"))
      .not.toContain('data-agent-native-layer-name="clipboard.svg"');
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});
