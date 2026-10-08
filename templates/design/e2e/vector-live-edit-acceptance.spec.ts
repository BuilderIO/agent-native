import { expect, test, type Page } from "@playwright/test";

import {
  appPath,
  designFrame,
  enterDirectMode,
  expandAllLayers,
  gotoEditor,
} from "./helpers";

const HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><main style="position:relative;width:640px;height:480px"></main></body></html>`;
const GROUPED_SVG =
  '<svg width="80" height="40" viewBox="0 0 80 40"><g><path d="M0 0h30v30z" fill="#f97316"/><path d="M50 0h30v30z" fill="#16a34a"/></g></svg>';
const EDITABLE_SVG =
  '<svg width="80" height="40" viewBox="0 0 80 40"><path d="M0 0h30v30q10 10 20 0L0 30Z" fill="#f97316"/></svg>';
const GROUPED_EDITABLE_SVG =
  '<svg width="80" height="40" viewBox="0 0 80 40"><g><path d="M0 0L30 0L30 30Z" fill="#f97316"/><path d="M50 0L80 0L80 30Z" fill="#16a34a"/></g></svg>';
const OPEN_PASTED_SVG =
  '<svg width="120" height="80" viewBox="0 0 120 80"><path d="M10 30L70 30" fill="none" stroke="#111827" stroke-width="2" /></svg>';
const OPEN_PASTED_SVG_WITH_AUTHORED_OPACITY =
  '<svg width="120" height="80" viewBox="0 0 120 80"><path d="M10 30L70 30" fill="#f97316" fill-opacity="0.4" style="fill-opacity: 0.4" stroke="#111827" stroke-width="2" /></svg>';
const PEN_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;min-height:600px"><main data-agent-native-node-id="main" style="position:relative;min-height:600px"><div data-agent-native-node-id="frame" data-agent-native-layer-name="Frame" data-an-primitive="frame" style="position:absolute;left:40px;top:120px;width:600px;height:400px"><div data-agent-native-node-id="nested" data-agent-native-layer-name="Nested" style="position:absolute;left:80px;top:70px;width:280px;height:200px;transform:translate(10px,5px)"><svg data-agent-native-node-id="nested-path" data-agent-native-layer-name="Nested path" data-an-primitive="path" data-an-pen-nodes='[1,[0,0,null,null,null,null],[100,0,null,null,null,null],[100,80,null,null,null,null],[0,80,null,null,null,null]]' viewBox="0 0 100 80" preserveAspectRatio="none" style="position:absolute;left:15.25px;top:20.5px;width:100px;height:80px;overflow:visible;opacity:0.5;filter:drop-shadow(0 1px 2px #000)"><path d="M 0 0 L 100 0 L 100 80 L 0 80 Z" fill="#336699" stroke="none" /></svg></div></div></main></body></html>`;

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
  return response.json();
}

async function readSource(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(
      `/_agent-native/actions/read-source-file?designId=${encodeURIComponent(designId)}&path=screen.html`,
    ),
  );
  if (!response.ok())
    throw new Error(
      `read-source-file: ${response.status()} ${await response.text()}`,
    );
  return (await response.json()).content as string;
}

function nestedPathNodes(source: string) {
  const element = source.match(
    /<[^>]*\bdata-agent-native-node-id=(["'])nested-path\1[^>]*>/,
  );
  const attribute = element?.[0].match(/\bdata-an-pen-nodes=(["'])(.*?)\1/);
  if (!attribute) throw new Error("nested-path source nodes are missing");
  return JSON.parse(attribute[2]) as [number, ...Array<Array<number | null>>];
}

function pastedPathMarkup(source: string) {
  const svg = source.match(
    /<svg[^>]*data-agent-native-layer-name=(['"])Pasted SVG\1[^>]*>([\s\S]*?)<\/svg>/,
  );
  if (!svg) throw new Error("pasted SVG source is missing");
  const path = svg[2].match(/<path\b([^>]*)>/);
  if (!path) throw new Error("pasted SVG path source is missing");
  return {
    d: path[1].match(/\bd=(['"])(.*?)\1/)?.[2] ?? "",
    fill: path[1].match(/\bfill=(['"])(.*?)\1/)?.[2] ?? "",
    stroke: path[1].match(/\bstroke=(['"])(.*?)\1/)?.[2] ?? "",
  };
}

function pastedPathNodes(source: string) {
  const svg = source.match(
    /<svg[^>]*data-agent-native-layer-name=(['"])Pasted SVG\1[^>]*>/,
  );
  const nodes = svg?.[0].match(/\bdata-an-pen-nodes=(['"])(.*?)\1/);
  if (!nodes) throw new Error("pasted SVG path nodes are missing");
  return JSON.parse(nodes[2]) as [
    number,
    ...Array<
      [
        number,
        number,
        number | null,
        number | null,
        number | null,
        number | null,
      ]
    >,
  ];
}

async function createDesign(page: Page, content = HTML) {
  const design = await action(page, "create-design", {
    title: `Vector live acceptance ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = design.id ?? design.data?.id;
  const file = await action(page, "create-file", {
    designId,
    filename: "screen.html",
    fileType: "html",
    content,
  });
  const screenId = file.id ?? file.data?.id;
  await action(page, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["canvasFrames", screenId],
        value: { x: 0, y: 0, width: 800, height: 600, z: 0 },
      },
      {
        op: "set",
        path: ["screenMetadata", screenId],
        value: { sourceType: "inline", width: 800, height: 600 },
      },
    ],
  });
  return { designId, screenId };
}

async function pasteSvg(
  target: import("@playwright/test").Locator,
  source: string,
) {
  return target.evaluate((body, svg) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([svg], "clipboard.svg", { type: "image/svg+xml" }),
    );
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    });
    body.dispatchEvent(event);
    return event.defaultPrevented;
  }, source);
}

async function selectLayer(page: Page, name: string) {
  const row = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first()
    .locator('xpath=ancestor::*[@role="treeitem"][1]');
  await expect(row).toBeVisible();
  await row.locator("[data-layer-row-button]").click();
  await expect(row).toHaveAttribute("aria-selected", "true");
}

test("grouped clipboard SVG keeps path identities and edits only the selected sibling", async ({
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
    expect(await pasteSvg(page.locator("body"), GROUPED_SVG)).toBe(true);

    const svg = designFrame(page, screenId).locator(
      'svg[data-agent-native-layer-name="Pasted SVG"]',
    );
    const paths = svg.locator("g > path");
    await expect(paths).toHaveCount(2);
    await expect(svg.locator("g")).toHaveCount(1);
    await expandAllLayers(page);
    const pathIds = await paths.evaluateAll((elements) =>
      elements.map((element) =>
        element.getAttribute("data-agent-native-node-id"),
      ),
    );
    expect(pathIds.every(Boolean)).toBe(true);
    expect(new Set(pathIds).size).toBe(2);

    const target = paths.nth(0);
    const sibling = paths.nth(1);
    const siblingBefore = await sibling.evaluate(
      (element) => getComputedStyle(element).fill,
    );
    const layers = page.getByRole("tree", { name: "Layers" });
    const pathRows = layers.getByRole("treeitem", { level: 4 }).filter({
      has: page.getByRole("button", { name: "PATH", exact: true }),
    });
    await expect(pathRows).toHaveCount(2);
    const row = pathRows.nth(1);
    await expect(row).toBeVisible();
    await row.locator("[data-layer-row-button]").click();
    await expect(row).toHaveAttribute("aria-selected", "true");
    const fill = page
      .getByRole("heading", { name: "Fill", exact: true })
      .locator("xpath=ancestor::section");
    await fill.getByRole("button", { name: "Open color picker" }).click();
    const hex = page.getByRole("textbox", { name: "Hex", exact: true });
    await hex.fill("3B82F6");
    await hex.press("Enter");
    await expect(target).toHaveCSS("fill", "rgb(59, 130, 246)");
    await expect(sibling).toHaveCSS("fill", siblingBefore);
    await expect
      .poll(() => readSource(page, designId))
      .toMatch(/fill:\s*#3b82f6/i);
    const html = await readSource(page, designId);
    expect(html).toContain(pathIds[0]!);
    expect(html).toMatch(/fill:\s*#3b82f6/i);
    await page.reload();
    const reloaded = designFrame(page, screenId).locator(
      'svg[data-agent-native-layer-name="Pasted SVG"] g > path',
    );
    await expect(reloaded.nth(0)).toHaveCSS("fill", "rgb(59, 130, 246)");
    await expect(reloaded.nth(1)).toHaveCSS("fill", siblingBefore);
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("a pasted SVG path can be edited, undone, redone, and reopened", async ({
  page,
}) => {
  const { designId, screenId } = await createDesign(page);
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    await page
      .locator(
        `[data-screen-shell][data-frame-id="${screenId}"] [data-frame-title]`,
      )
      .click();
    expect(await pasteSvg(page.locator("body"), EDITABLE_SVG)).toBe(true);
    await expandAllLayers(page);
    await selectLayer(page, "Pasted SVG");

    const frame = designFrame(page, screenId);
    const svg = frame.locator('svg[data-agent-native-layer-name="Pasted SVG"]');
    const path = svg.locator("path");
    const originalPathData = await path.getAttribute("d");
    expect(originalPathData).toBe("M0 0h30v30q10 10 20 0L0 30Z");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
    const previewPath = page
      .locator("[data-vector-edit-overlay] svg path")
      .nth(0);
    const originalPreviewPathData = await previewPath.getAttribute("d");
    const anchor = page.locator("[data-vector-anchor]").nth(1);
    const box = await anchor.boundingBox();
    if (!box) throw new Error("pasted SVG anchor has no bounds");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 18,
      box.y + box.height / 2 + 10,
      { steps: 4 },
    );
    await expect
      .poll(() => previewPath.getAttribute("d"))
      .not.toBe(originalPreviewPathData);
    await page.mouse.up();
    await expect.poll(() => path.getAttribute("d")).not.toBe(originalPathData);
    const editedPathData = await path.getAttribute("d");
    await expect
      .poll(() => readSource(page, designId))
      .toContain(editedPathData);
    await page.keyboard.press("Enter");

    const undo = process.platform === "darwin" ? "Meta+Z" : "Control+Z";
    const redo =
      process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z";
    await page.keyboard.press(undo);
    await expect.poll(() => path.getAttribute("d")).toBe(originalPathData);
    await page.keyboard.press(redo);
    await expect.poll(() => path.getAttribute("d")).toBe(editedPathData);
    await page.reload();
    await enterDirectMode(page);
    await expandAllLayers(page);
    await selectLayer(page, "Pasted SVG");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
    await expect.poll(() => path.getAttribute("d")).toBe(editedPathData);
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("a grouped pasted SVG edits only the selected path through undo and reload", async ({
  page,
}, testInfo) => {
  const { designId, screenId } = await createDesign(page);
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    await page
      .locator(
        `[data-screen-shell][data-frame-id="${screenId}"] [data-frame-title]`,
      )
      .click();
    expect(await pasteSvg(page.locator("body"), GROUPED_EDITABLE_SVG)).toBe(
      true,
    );
    await expandAllLayers(page);

    const frame = designFrame(page, screenId);
    const svg = frame.locator('svg[data-agent-native-layer-name="Pasted SVG"]');
    const paths = svg.locator("g > path");
    await expect(paths).toHaveCount(2);
    const firstPath = paths.nth(0);
    const targetPath = paths.nth(1);
    const firstPathBefore = await firstPath.getAttribute("d");
    const targetPathBefore = await targetPath.getAttribute("d");
    const targetPathId = await targetPath.getAttribute(
      "data-agent-native-node-id",
    );
    if (!targetPathBefore || !targetPathId)
      throw new Error("grouped target path identity was not persisted");
    await expect.poll(() => readSource(page, designId)).toContain(targetPathId);
    const originalSource = await readSource(page, designId);

    const layers = page.getByRole("tree", { name: "Layers" });
    const pathRows = layers.getByRole("treeitem", { level: 4 }).filter({
      has: page.getByRole("button", { name: "PATH", exact: true }),
    });
    await expect(pathRows).toHaveCount(2);
    const targetRow = pathRows.nth(0);
    const layerButton = targetRow.locator("[data-layer-row-button]");
    await expect(layerButton).toBeVisible();
    await layerButton.click();
    const row = layerButton.locator("xpath=ancestor::*[@role='treeitem'][1]");
    await expect(row).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();

    const previewPath = page
      .locator("[data-vector-edit-overlay] svg path")
      .nth(0);
    const originalPreviewPathData = await previewPath.getAttribute("d");
    const anchor = page.locator("[data-vector-anchor]").nth(1);
    const box = await anchor.boundingBox();
    if (!box) throw new Error("grouped SVG anchor has no bounds");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 16,
      box.y + box.height / 2 + 9,
      { steps: 4 },
    );
    await expect
      .poll(() => previewPath.getAttribute("d"))
      .not.toBe(originalPreviewPathData);
    await expect(firstPath).toHaveAttribute("d", firstPathBefore!);
    await expect(targetPath).toHaveAttribute("d", targetPathBefore);
    expect(await readSource(page, designId)).toBe(originalSource);
    await page.screenshot({
      path: testInfo.outputPath("grouped-vector-live-preview.png"),
    });
    await page.mouse.up();
    await expect
      .poll(() => targetPath.getAttribute("d"))
      .not.toBe(targetPathBefore);
    const editedTargetPath = await targetPath.getAttribute("d");
    await expect
      .poll(() => readSource(page, designId))
      .toContain(editedTargetPath);
    await expect(firstPath).toHaveAttribute("d", firstPathBefore!);
    await page.screenshot({
      path: testInfo.outputPath("grouped-vector-committed.png"),
    });
    await page.keyboard.press("Escape");

    const undo = process.platform === "darwin" ? "Meta+Z" : "Control+Z";
    const redo =
      process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z";
    await page.keyboard.press(undo);
    await expect.poll(() => readSource(page, designId)).toBe(originalSource);
    await expect(targetPath).toHaveAttribute("d", targetPathBefore);
    await page.keyboard.press(redo);
    await expect
      .poll(() => targetPath.getAttribute("d"))
      .toBe(editedTargetPath);
    await page.reload();
    await enterDirectMode(page);
    await expandAllLayers(page);
    const reloadedPathRows = page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem", { level: 4 })
      .filter({
        has: page.getByRole("button", { name: "PATH", exact: true }),
      });
    await expect(reloadedPathRows).toHaveCount(2);
    const reloadedLayer = reloadedPathRows
      .nth(0)
      .locator("[data-layer-row-button]");
    await expect(reloadedLayer).toBeVisible();
    await reloadedLayer.click();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
    await expect
      .poll(() =>
        designFrame(page, screenId)
          .locator('svg[data-agent-native-layer-name="Pasted SVG"] g > path')
          .nth(1)
          .getAttribute("d"),
      )
      .toBe(editedTargetPath);
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("an open pasted SVG continues from its endpoint and closes without adding a fill", async ({
  page,
}) => {
  const { designId, screenId } = await createDesign(page);
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    await page
      .locator(
        `[data-screen-shell][data-frame-id="${screenId}"] [data-frame-title]`,
      )
      .click();
    expect(await pasteSvg(page.locator("body"), OPEN_PASTED_SVG)).toBe(true);
    await expandAllLayers(page);
    await selectLayer(page, "Pasted SVG");

    const frame = designFrame(page, screenId);
    const path = frame.locator(
      'svg[data-agent-native-layer-name="Pasted SVG"] path',
    );
    await expect(path).toHaveAttribute("d", "M10 30L70 30");
    await expect
      .poll(() => readSource(page, designId))
      .toMatch(/data-an-pen-nodes=/);
    const originalSource = await readSource(page, designId);
    const originalNodes = pastedPathNodes(originalSource);

    await page.keyboard.press("Enter");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
    const vectorPreview = page
      .locator("[data-vector-edit-overlay] svg path")
      .first();
    const originalVectorPreview = await vectorPreview.getAttribute("d");
    const terminalAnchor = page.locator("[data-vector-anchor]").nth(1);
    const terminalAnchorBox = await terminalAnchor.boundingBox();
    if (!terminalAnchorBox) throw new Error("terminal anchor has no bounds");
    const dragDelta = { x: 24, y: 12 };
    const terminalOrigin = {
      x: terminalAnchorBox.x + terminalAnchorBox.width / 2,
      y: terminalAnchorBox.y + terminalAnchorBox.height / 2,
    };
    const screenScale = await page
      .locator(`iframe[data-screen-iframe-id="${screenId}"]`)
      .evaluate((iframe) => {
        const element = iframe as HTMLIFrameElement;
        return element.getBoundingClientRect().width / element.clientWidth;
      });
    await page.mouse.move(terminalOrigin.x, terminalOrigin.y);
    await page.mouse.down();
    await page.mouse.move(
      terminalOrigin.x + dragDelta.x,
      terminalOrigin.y + dragDelta.y,
      { steps: 4 },
    );
    await expect
      .poll(() => vectorPreview.getAttribute("d"))
      .not.toBe(originalVectorPreview);
    expect(await readSource(page, designId)).toBe(originalSource);
    await page.mouse.up();
    await expect
      .poll(() => readSource(page, designId))
      .not.toBe(originalSource);
    const movedSource = await readSource(page, designId);
    const movedNodes = pastedPathNodes(movedSource);
    expect(movedNodes[2]![0] - originalNodes[2]![0]).toBeCloseTo(
      dragDelta.x / screenScale,
      1,
    );
    expect(movedNodes[2]![1] - originalNodes[2]![1]).toBeCloseTo(
      dragDelta.y / screenScale,
      1,
    );
    expect(movedNodes[1]).toEqual(originalNodes[1]);
    await expect
      .poll(() => readSource(page, designId))
      .toContain(pastedPathMarkup(movedSource).d);
    const movedTerminalAnchorBox = await terminalAnchor.boundingBox();
    if (!movedTerminalAnchorBox)
      throw new Error("moved terminal anchor has no bounds");
    const terminal = {
      x: movedTerminalAnchorBox.x + movedTerminalAnchorBox.width / 2,
      y: movedTerminalAnchorBox.y + movedTerminalAnchorBox.height / 2,
    };

    await page.keyboard.press("Escape");

    await page.keyboard.press("p");
    await expect(
      page.getByRole("button", { name: "Pen", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.mouse.click(terminal.x, terminal.y);
    await expect
      .poll(() =>
        page.locator("[data-pen-path-overlay] [data-pen-anchor]").count(),
      )
      .toBe(2);
    const resumedAnchorCenters = await page
      .locator("[data-pen-path-overlay] [data-pen-anchor]")
      .evaluateAll((anchors) =>
        anchors.map((anchor) => {
          const rect = anchor.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }),
      );
    expect(
      Math.hypot(
        resumedAnchorCenters[1]!.x - terminal.x,
        resumedAnchorCenters[1]!.y - terminal.y,
      ),
    ).toBeLessThan(3);

    const appended = { x: terminal.x + 32, y: terminal.y + 28 };
    await page.mouse.move(appended.x, appended.y);
    await page.mouse.down();
    await expect
      .poll(() =>
        page.locator("[data-pen-path-overlay] [data-pen-anchor]").count(),
      )
      .toBe(3);
    const appendedAnchorBox = await page
      .locator("[data-pen-path-overlay] [data-pen-anchor]")
      .nth(2)
      .boundingBox();
    if (!appendedAnchorBox) throw new Error("preview anchor has no bounds");
    expect(
      Math.hypot(
        appendedAnchorBox.x + appendedAnchorBox.width / 2 - appended.x,
        appendedAnchorBox.y + appendedAnchorBox.height / 2 - appended.y,
      ),
    ).toBeLessThan(3);
    const previewBeforeRelease = await page
      .locator("[data-pen-path-overlay] svg path")
      .first()
      .getAttribute("d");
    expect(previewBeforeRelease).toContain("L");
    expect(await readSource(page, designId)).toBe(movedSource);
    await page.mouse.up();
    expect(await readSource(page, designId)).toBe(movedSource);
    const closeTarget = resumedAnchorCenters[0]!;
    await page.mouse.move(closeTarget.x, closeTarget.y);
    await page.mouse.down();
    await expect
      .poll(() =>
        page
          .locator("[data-pen-path-overlay] svg path")
          .first()
          .getAttribute("d"),
      )
      .toMatch(/Z\s*$/i);
    expect(await readSource(page, designId)).toBe(movedSource);
    await page.mouse.up();
    await expect
      .poll(async () => pastedPathMarkup(await readSource(page, designId)).d)
      .toMatch(/Z\s*$/i);
    const closedSource = await readSource(page, designId);
    const closed = pastedPathMarkup(closedSource);
    expect(closed.fill).toMatch(/none/i);
    expect(closed.stroke).toBe("#111827");

    const undo = process.platform === "darwin" ? "Meta+Z" : "Control+Z";
    const redo =
      process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z";
    await page.keyboard.press(undo);
    await expect.poll(() => readSource(page, designId)).toBe(movedSource);
    await page.keyboard.press(undo);
    await expect.poll(() => readSource(page, designId)).toBe(originalSource);
    await page.keyboard.press(redo);
    await expect.poll(() => readSource(page, designId)).toBe(movedSource);
    await page.keyboard.press(redo);
    await expect.poll(() => readSource(page, designId)).toBe(closedSource);
    await expect
      .poll(async () => pastedPathMarkup(await readSource(page, designId)).d)
      .toMatch(/Z\s*$/i);

    await page.reload();
    await enterDirectMode(page);
    await expandAllLayers(page);
    await selectLayer(page, "Pasted SVG");
    const reopened = pastedPathMarkup(await readSource(page, designId));
    expect(reopened.d).toMatch(/Z\s*$/i);
    expect(reopened.fill).toMatch(/none/i);
    expect(reopened.stroke).toBe("#111827");
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("per-anchor radius previews, commits, and survives undo, redo, and reload", async ({
  page,
}) => {
  const { designId, screenId } = await createDesign(page, PEN_HTML);
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    const frame = designFrame(page, screenId);
    await expect(
      frame.locator('[data-agent-native-node-id="nested-path"] path'),
    ).toBeVisible();
    await expandAllLayers(page);
    await selectLayer(page, "Nested path");
    const originalSource = await readSource(page, designId);
    const contentUpdates: Array<Record<string, unknown>> = [];
    page.on("request", (request) => {
      if (!request.url().includes("/_agent-native/actions/update-file")) return;
      try {
        const body = request.postDataJSON() as Record<string, unknown>;
        if (body.id === screenId) contentUpdates.push(body);
      } catch {
        // Ignore non-JSON update requests from unrelated test setup.
      }
    });
    const renderedPath = frame.locator(
      '[data-agent-native-node-id="nested-path"] path',
    );
    const originalPathData = await renderedPath.getAttribute("d");
    expect(originalPathData).toBe("M 0 0 L 100 0 L 100 80 L 0 80 Z");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
    const anchor = page.locator("[data-vector-anchor]").nth(1);
    const box = await anchor.boundingBox();
    if (!box) throw new Error("selected vector anchor has no bounds");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const radius = page.getByRole("textbox", { name: "Corner radius" });
    await expect(radius).toHaveValue("0");
    await page.waitForTimeout(100);
    expect(contentUpdates).toHaveLength(0);
    expect(await readSource(page, designId)).toBe(originalSource);
    await radius.fill("14");
    await expect(radius).toHaveValue("14");
    expect(contentUpdates).toHaveLength(0);
    expect(await readSource(page, designId)).toBe(originalSource);
    await radius.press("Enter");
    await expect(radius).toHaveValue("14");
    await expect
      .poll(() => renderedPath.getAttribute("d"))
      .not.toBe(originalPathData);
    const roundedPathData = await renderedPath.getAttribute("d");
    expect(roundedPathData).toContain("A 14 14");
    await expect
      .poll(async () => nestedPathNodes(await readSource(page, designId))[2][6])
      .toBe(14);
    await page.keyboard.press("Escape");

    const undo = process.platform === "darwin" ? "Meta+Z" : "Control+Z";
    const redo =
      process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z";
    await page.keyboard.press(undo);
    await expect.poll(() => readSource(page, designId)).toBe(originalSource);
    await expect
      .poll(() => renderedPath.getAttribute("d"))
      .toBe(originalPathData);
    await expect
      .poll(async () => nestedPathNodes(await readSource(page, designId))[2][6])
      .toBeUndefined();
    await page.keyboard.press(redo);
    await expect
      .poll(() => renderedPath.getAttribute("d"))
      .toBe(roundedPathData);
    await expect
      .poll(async () => nestedPathNodes(await readSource(page, designId))[2][6])
      .toBe(14);
    await page.reload();
    await enterDirectMode(page);
    await expandAllLayers(page);
    await selectLayer(page, "Nested path");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
    await expect
      .poll(() => renderedPath.getAttribute("d"))
      .toBe(roundedPathData);
    await expect
      .poll(async () => nestedPathNodes(await readSource(page, designId))[2][6])
      .toBe(14);
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("closing an edited pasted SVG restores authored fill opacity through history and reload", async ({
  page,
}) => {
  const { designId, screenId } = await createDesign(page);
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    await page
      .locator(
        `[data-screen-shell][data-frame-id="${screenId}"] [data-frame-title]`,
      )
      .click();
    expect(
      await pasteSvg(
        page.locator("body"),
        OPEN_PASTED_SVG_WITH_AUTHORED_OPACITY,
      ),
    ).toBe(true);
    await expandAllLayers(page);
    await selectLayer(page, "Pasted SVG");

    const frame = designFrame(page, screenId);
    const path = frame.locator(
      'svg[data-agent-native-layer-name="Pasted SVG"] path',
    );
    await expect(path).toHaveAttribute("fill-opacity", "0.4");
    await expect
      .poll(async () => pastedPathMarkup(await readSource(page, designId)).d)
      .toBe("M10 30L70 30");
    const originalSource = await readSource(page, designId);
    const anchors = page.locator("[data-vector-anchor]");

    await page.keyboard.press("Enter");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
    const terminalAnchorBox = await anchors.nth(1).boundingBox();
    if (!terminalAnchorBox) {
      throw new Error("pasted path anchors have no bounds");
    }
    const terminalAnchor = {
      x: terminalAnchorBox.x + terminalAnchorBox.width / 2,
      y: terminalAnchorBox.y + terminalAnchorBox.height / 2,
    };
    await page.mouse.move(terminalAnchor.x, terminalAnchor.y);
    await page.mouse.down();
    await page.mouse.move(terminalAnchor.x + 18, terminalAnchor.y + 10, {
      steps: 4,
    });
    await expect
      .poll(() =>
        page
          .locator("[data-vector-edit-overlay] svg path")
          .first()
          .getAttribute("d"),
      )
      .not.toBe("M10 30L70 30");
    expect(await readSource(page, designId)).toBe(originalSource);
    await page.mouse.up();
    await expect
      .poll(() => readSource(page, designId))
      .not.toBe(originalSource);
    await expect
      .poll(() =>
        path.evaluate((element) => getComputedStyle(element).fillOpacity),
      )
      .toBe("0");
    await expect
      .poll(() =>
        path.evaluate((element) =>
          (element as SVGPathElement).style.getPropertyPriority("fill-opacity"),
        ),
      )
      .toBe("important");
    const movedTerminalAnchorBox = await anchors.nth(1).boundingBox();
    if (!movedTerminalAnchorBox) {
      throw new Error("moved pasted path endpoint has no bounds");
    }
    const movedTerminal = {
      x: movedTerminalAnchorBox.x + movedTerminalAnchorBox.width / 2,
      y: movedTerminalAnchorBox.y + movedTerminalAnchorBox.height / 2,
    };

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Pen", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.mouse.click(movedTerminal.x, movedTerminal.y);
    await expect
      .poll(() =>
        page.locator("[data-pen-path-overlay] [data-pen-anchor]").count(),
      )
      .toBe(2);
    const penAnchors = await page
      .locator("[data-pen-path-overlay] [data-pen-anchor]")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }),
      );
    const closeTarget = penAnchors[0];
    if (!closeTarget) throw new Error("pen start anchor has no bounds");
    await page.mouse.move(closeTarget.x, closeTarget.y);
    await page.mouse.down();
    await expect
      .poll(() =>
        page
          .locator("[data-pen-path-overlay] svg path")
          .first()
          .getAttribute("d"),
      )
      .toMatch(/Z\s*$/i);
    await page.mouse.up();
    await expect.poll(() => readSource(page, designId)).toMatch(/d="[^"]*Z"/i);

    const closedSource = await readSource(page, designId);
    const closedPath = frame.locator(
      'svg[data-agent-native-layer-name="Pasted SVG"] path',
    );
    await expect.poll(() => closedPath.getAttribute("d")).toMatch(/Z\s*$/i);
    await expect(closedPath).toHaveAttribute("fill-opacity", "0.4");
    await expect
      .poll(() =>
        closedPath.evaluate((element) => getComputedStyle(element).fillOpacity),
      )
      .toBe("0.4");

    const undo = process.platform === "darwin" ? "Meta+Z" : "Control+Z";
    const redo =
      process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z";
    await page.keyboard.press(undo);
    await expect.poll(() => readSource(page, designId)).not.toBe(closedSource);
    await page.keyboard.press(redo);
    await expect.poll(() => readSource(page, designId)).toBe(closedSource);
    await expect(closedPath).toHaveAttribute("fill-opacity", "0.4");
    await expect
      .poll(() =>
        closedPath.evaluate((element) => getComputedStyle(element).fillOpacity),
      )
      .toBe("0.4");

    await page.reload();
    await enterDirectMode(page);
    await expandAllLayers(page);
    await selectLayer(page, "Pasted SVG");
    const reloadedPath = designFrame(page, screenId).locator(
      'svg[data-agent-native-layer-name="Pasted SVG"] path',
    );
    await expect(reloadedPath).toHaveAttribute("fill-opacity", "0.4");
    await expect(reloadedPath).toHaveAttribute("d", /Z\s*$/i);
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("Pen continues an open vector from its selected endpoint while editing", async ({
  page,
}) => {
  const { designId, screenId } = await createDesign(page);
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    await page
      .locator(
        `[data-screen-shell][data-frame-id="${screenId}"] [data-frame-title]`,
      )
      .click();
    expect(await pasteSvg(page.locator("body"), OPEN_PASTED_SVG)).toBe(true);
    await expandAllLayers(page);
    await selectLayer(page, "Pasted SVG");
    const frame = designFrame(page, screenId);
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
    const originalSource = await readSource(page, designId);
    await page.keyboard.press("p");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
    const endpoint = page.locator("[data-vector-anchor]").first();
    const endpointBox = await endpoint.boundingBox();
    if (!endpointBox) throw new Error("vector endpoint has no bounds");
    const otherEndpointBox = await page
      .locator("[data-vector-anchor]")
      .nth(1)
      .boundingBox();
    if (!otherEndpointBox)
      throw new Error("other vector endpoint has no bounds");
    const start = {
      x: endpointBox.x + endpointBox.width / 2,
      y: endpointBox.y + endpointBox.height / 2,
    };
    const pathScale =
      (otherEndpointBox.x + otherEndpointBox.width / 2 - start.x) / 60;
    await page.mouse.click(start.x, start.y);
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
    await expect(page.locator("[data-pen-path-overlay]")).toBeVisible();
    await expect(
      page.locator("[data-pen-path-overlay] [data-pen-anchor]"),
    ).toHaveCount(2);
    expect(await readSource(page, designId)).toBe(originalSource);

    await page.mouse.click(start.x - 30, start.y + 28);
    await expect(
      page.locator("[data-pen-path-overlay] [data-pen-anchor]"),
    ).toHaveCount(3);
    await page.keyboard.press("Enter");
    await expect
      .poll(
        async () => pastedPathNodes(await readSource(page, designId)).length,
      )
      .toBe(4);
    await expect(page.locator("[data-vector-edit-overlay]")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const nodes = pastedPathNodes(await readSource(page, designId));
    expect(nodes[1]?.slice(0, 2)).toEqual([70, 30]);
    expect(nodes[2]?.slice(0, 2)).toEqual([10, 30]);
    expect(nodes[3]?.[0]).toBeCloseTo(10 - 30 / pathScale, 3);
    expect(nodes[3]?.[1]).toBeCloseTo(30 + 28 / pathScale, 3);
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("dragging a vector segment previews its bend and commits both handles", async ({
  page,
}) => {
  const { designId, screenId } = await createDesign(page, PEN_HTML);
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page);
    await expandAllLayers(page);
    await selectLayer(page, "Nested path");
    const frame = designFrame(page, screenId);
    const renderedPath = frame.locator(
      '[data-agent-native-node-id="nested-path"] path',
    );
    const originalSource = await readSource(page, designId);
    const originalPathData = await renderedPath.getAttribute("d");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
    const anchors = page.locator("[data-vector-anchor]");
    const firstBox = await anchors.nth(0).boundingBox();
    const secondBox = await anchors.nth(1).boundingBox();
    if (!firstBox || !secondBox) throw new Error("segment anchors are missing");
    const origin = {
      x: (firstBox.x + secondBox.x + firstBox.width + secondBox.width) / 2,
      y: (firstBox.y + secondBox.y + firstBox.height + secondBox.height) / 2,
    };
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x, origin.y + 24, { steps: 4 });
    const preview = page.locator("[data-vector-edit-overlay] svg path").first();
    await expect.poll(() => preview.getAttribute("d")).toContain("C");
    expect(await readSource(page, designId)).toBe(originalSource);
    await page.mouse.up();
    await expect
      .poll(() => renderedPath.getAttribute("d"))
      .not.toBe(originalPathData);
    const nodes = nestedPathNodes(await readSource(page, designId));
    expect(nodes[1]?.slice(0, 2)).toEqual([0, 0]);
    expect(nodes[2]?.slice(0, 2)).toEqual([100, 0]);
    expect(nodes[1]?.[4]).not.toBeNull();
    expect(nodes[1]?.[5]).toBeGreaterThan(0);
    expect(nodes[2]?.[2]).not.toBeNull();
    expect(nodes[2]?.[3]).toBeGreaterThan(0);
    expect(nodes[1]?.[5]).toBeCloseTo(nodes[2]?.[3] ?? 0, 4);
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});
