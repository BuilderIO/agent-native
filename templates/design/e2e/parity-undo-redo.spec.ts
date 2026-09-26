import { expect, test, type Page } from "@playwright/test";

import {
  FIXTURE,
  MOD,
  geom,
  indexHtml,
  layerRow,
  newDesign,
  node,
  openEditor,
  postAction,
  selectViaTree,
  setBaseURL,
} from "./drag-and-drop.shared";
import { appPath, expandAllLayers } from "./helpers";


const UNDO = `${MOD}+Z`;
const REDO = process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z";

const SECOND_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Second Screen</title></head>
  <body style="margin:0;min-height:900px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="page2-target" data-agent-native-layer-name="Page2 Target"
         style="position:absolute;left:60px;top:60px;width:150px;height:100px;background:#312e81"></div>
  </body>
</html>`;

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

async function newTwoScreenDesign(page: Page): Promise<string> {
  const id = await newDesign(page);
  await postAction(page, "create-file", {
    designId: id,
    filename: "page-two.html",
    content: SECOND_SCREEN,
    fileType: "html",
  });
  return id;
}

async function readIndexFrame(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  const record = (await response.json()) as {
    data?: unknown;
    files?: Array<{ filename?: string; id?: string }>;
  };
  const data = (
    typeof record.data === "string"
      ? JSON.parse(record.data || "{}")
      : record.data
  ) as
    | {
        canvasFrames?: Record<
          string,
          { rotation?: number; x?: number; y?: number }
        >;
      }
    | undefined;
  const file = record.files?.find(
    (candidate) => candidate.filename === "index.html",
  );
  const frame = file?.id ? data?.canvasFrames?.[file.id] : undefined;
  if (!file?.id || !frame)
    throw new Error("index.html frame geometry is missing");
  return {
    id: file.id,
    rotation: frame.rotation ?? 0,
    x: frame.x ?? 0,
    y: frame.y ?? 0,
  };
}

async function box(page: Page, id: string) {
  const b = await node(page, id).boundingBox();
  if (!b) throw new Error(`no boundingBox for ${id}`);
  return b;
}

async function dragElement(
  page: Page,
  id: string,
  dx: number,
  dy: number,
): Promise<void> {
  await selectViaTree(page, id === "box-a" ? "Box A" : "Box B");
  const b = await box(page, id);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 16 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(600);
}

async function dumpTrace(page: Page): Promise<string> {
  return page
    .evaluate(() => (window as any).__designTrace?.dump?.() ?? "(no trace)")
    .catch(() => "(trace unavailable)");
}

async function pixelAt(page: Page, x: number, y: number): Promise<string> {
  const client = await page.context().newCDPSession(page);
  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
  });
  await client.detach();
  return page.evaluate(
    async ({ b64, px, py }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context for the screenshot");
      ctx.drawImage(img, 0, 0);
      const ratio = img.width / window.innerWidth;
      const d = ctx.getImageData(
        Math.round(px * ratio),
        Math.round(py * ratio),
        1,
        1,
      ).data;
      return `${d[0]},${d[1]},${d[2]}`;
    },
    { b64: data, px: x, py: y },
  );
}

async function sampleXY(page: Page): Promise<{ x: number; y: number }> {
  const canvasBox = await page
    .locator("[data-design-canvas-container]")
    .boundingBox();
  if (!canvasBox) throw new Error("no canvas container box");
  const leftShellBox = await page
    .locator('[data-design-chrome-region="left-shell"]')
    .boundingBox()
    .catch(() => null);
  const rightPanelBox = await page
    .locator('[data-design-chrome-region="right-panel"]')
    .boundingBox()
    .catch(() => null);
  const leftEdge = leftShellBox
    ? leftShellBox.x + leftShellBox.width
    : canvasBox.x;
  const rightEdge = rightPanelBox
    ? rightPanelBox.x
    : canvasBox.x + canvasBox.width;
  const x = Math.round(leftEdge + (rightEdge - leftEdge) * 0.5);
  const y = Math.round(canvasBox.y + canvasBox.height * 0.5);

  const hitInfo = await page.evaluate(
    ({ px, py }) => {
      const el = document.elementFromPoint(px, py) as HTMLElement | null;
      if (!el) return { ok: false, reason: "no element" };
      let cur: HTMLElement | null = el;
      for (let i = 0; i < 8 && cur; i++) {
        if (cur.dataset?.designChromeRegion) {
          return {
            ok: false,
            reason: `hit chrome:${cur.dataset.designChromeRegion}`,
          };
        }
        cur = cur.parentElement;
      }
      return { ok: true, reason: "clear" };
    },
    { px: x, py: y },
  );
  if (!hitInfo.ok) {
    throw new Error(
      `sampleXY point (${x},${y}) is not clear of chrome: ${hitInfo.reason}`,
    );
  }
  return { x, y };
}

test("one drag-move is exactly one undo step, and redo re-applies the exact dropped position", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);

  const before = await geom(page, id, "box-a");
  await dragElement(page, "box-a", 90, 40);
  const dropped = await geom(page, id, "box-a");
  expect(
    [dropped.left, dropped.top],
    "precondition: the drag must actually move box-a",
  ).not.toEqual([before.left, before.top]);

  await page.keyboard.press(UNDO);
  await page.waitForTimeout(400);
  const undone = await geom(page, id, "box-a");
  expect(
    [undone.left, undone.top],
    `one undo must fully restore the pre-drag position (${before.left},${before.top}); got (${undone.left},${undone.top}). Trace: ${(await dumpTrace(page)).slice(-500)}`,
  ).toEqual([before.left, before.top]);

  await page.keyboard.press(REDO);
  await page.waitForTimeout(400);
  const redone = await geom(page, id, "box-a");
  expect(
    [redone.left, redone.top],
    `redo must re-apply the EXACT dropped position (${dropped.left},${dropped.top}), not some other value; got (${redone.left},${redone.top})`,
  ).toEqual([dropped.left, dropped.top]);
});

test("rotating a screen then undoing immediately restores persisted geometry", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  await page.goto(appPath(`/design/${id}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("[data-screen-card]").first()).toBeVisible({
    timeout: 30_000,
  });

  const before = await readIndexFrame(page, id);
  await page
    .locator(`[data-frame-id="${before.id}"] [data-frame-label]`)
    .click();
  const handle = page
    .locator(
      "[data-frame-selection-box]:not([data-board-object-selection-box]) [data-rotate-handle]",
    )
    .first();
  await expect(handle).toBeVisible();
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("rotate handle has no bounding box");
  const frameBox = await page
    .locator(`[data-frame-id="${before.id}"]`)
    .boundingBox();
  if (!frameBox) throw new Error("screen frame has no bounding box");
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const centerX = frameBox.x + frameBox.width / 2;
  const centerY = frameBox.y + frameBox.height / 2;
  const vectorX = startX - centerX;
  const vectorY = startY - centerY;
  const dragAngle = Math.PI / 6;
  const endX =
    centerX + vectorX * Math.cos(dragAngle) - vectorY * Math.sin(dragAngle);
  const endY =
    centerY + vectorX * Math.sin(dragAngle) + vectorY * Math.cos(dragAngle);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.up();

  const renderedRotation = await page
    .locator(`[data-frame-id="${before.id}"]`)
    .evaluate((element) => {
      const transform = getComputedStyle(element).transform;
      if (!transform || transform === "none") return 0;
      const matrix = new DOMMatrix(transform);
      return (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
    });
  expect(renderedRotation).not.toBeCloseTo(before.rotation, 0);

  await page.keyboard.press(UNDO);
  await page.waitForTimeout(750);
  await expect
    .poll(async () => (await readIndexFrame(page, id)).rotation, {
      timeout: 15_000,
      message: "immediate undo must persist the pre-rotation frame geometry",
    })
    .toBe(before.rotation);
});

test("nudging a screen then undoing immediately restores persisted geometry", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  await page.goto(appPath(`/design/${id}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("[data-screen-card]").first()).toBeVisible({
    timeout: 30_000,
  });

  const before = await readIndexFrame(page, id);
  const screen = page.locator(`[data-frame-id="${before.id}"]`);
  await screen.locator("[data-frame-label]").click();
  const beforeBox = await screen.boundingBox();
  if (!beforeBox) throw new Error("screen frame has no bounding box");

  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowRight");
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("ArrowRight");
  const afterBox = await screen.boundingBox();
  expect(afterBox?.x).not.toBe(beforeBox.x);

  await page.keyboard.press(UNDO);
  await page.waitForTimeout(750);
  await expect
    .poll(
      async () => {
        const frame = await readIndexFrame(page, id);
        return [frame.x, frame.y];
      },
      {
        timeout: 15_000,
        message: "immediate undo must persist the pre-nudge frame geometry",
      },
    )
    .toEqual([before.x, before.y]);
});

test("a fresh edit after undo clears the redo stack", async ({ page }) => {
  const id = await newDesign(page);
  await openEditor(page, id);

  const aBefore = await geom(page, id, "box-a");
  await dragElement(page, "box-a", 90, 0);
  const aDropped = await geom(page, id, "box-a");
  expect(aDropped.left).not.toBe(aBefore.left);

  await page.keyboard.press(UNDO);
  await page.waitForTimeout(400);
  const aUndone = await geom(page, id, "box-a");
  expect([aUndone.left, aUndone.top]).toEqual([aBefore.left, aBefore.top]);

  const bBefore = await geom(page, id, "box-b");
  await dragElement(page, "box-b", 0, 60);
  const bDropped = await geom(page, id, "box-b");
  expect(bDropped.top).not.toBe(bBefore.top);

  await page.keyboard.press(REDO);
  await page.waitForTimeout(400);
  const aAfterRedo = await geom(page, id, "box-a");
  const bAfterRedo = await geom(page, id, "box-b");
  expect(
    [aAfterRedo.left, aAfterRedo.top],
    `redo after an intervening edit must NOT resurrect the discarded box-a drag; box-a should stay at its undone position (${aBefore.left},${aBefore.top}), got (${aAfterRedo.left},${aAfterRedo.top})`,
  ).toEqual([aBefore.left, aBefore.top]);
  expect(
    [bAfterRedo.left, bAfterRedo.top],
    "the box-b edit itself must be unaffected by the no-op redo",
  ).toEqual([bDropped.left, bDropped.top]);
});

test("deleting an element then one undo restores it with its original position, name and selection", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);

  await selectViaTree(page, "Box A");
  const before = await geom(page, id, "box-a");
  await page.keyboard.press("Delete");
  await page.waitForTimeout(500);
  await expect(node(page, "box-a")).toHaveCount(0);

  await page.keyboard.press(UNDO);
  await page.waitForTimeout(500);

  await expect(
    node(page, "box-a"),
    `one undo after Delete must bring box-a back. Trace: ${(await dumpTrace(page)).slice(-500)}`,
  ).toHaveCount(1);
  const restored = await geom(page, id, "box-a");
  expect([
    restored.left,
    restored.top,
    restored.width,
    restored.height,
  ]).toEqual([before.left, before.top, before.width, before.height]);
  await expect
    .poll(async () => {
      const bounds = await page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()
        .locator("body")
        .evaluate(() => {
          const el = document.querySelector(
            '[data-agent-native-edit-overlay="selection"]',
          );
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return r.width > 0 || r.height > 0;
        })
        .catch(() => null);
      return bounds;
    })
    .toBeTruthy();
});

test("renaming a layer then one undo restores its previous name", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);

  const row = page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem")
    .filter({ hasText: "Box B" })
    .first();
  await row
    .locator("[data-layer-row-button]")
    .first()
    .dblclick({ force: true });
  const input = page.locator('input[aria-label="Rename layer"]');
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill("Renamed Box");
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  await expect(
    page.getByRole("tree", { name: "Layers" }).getByRole("treeitem").filter({
      hasText: "Renamed Box",
    }),
  ).toHaveCount(1);

  await page.keyboard.press(UNDO);
  await page.waitForTimeout(400);

  await expect(
    page.getByRole("tree", { name: "Layers" }).getByRole("treeitem").filter({
      hasText: "Box B",
    }),
    "one undo after a layer-name commit must restore the exact previous name",
  ).toHaveCount(1);
  await expect(
    page.getByRole("tree", { name: "Layers" }).getByRole("treeitem").filter({
      hasText: "Renamed Box",
    }),
  ).toHaveCount(0);

  await page.keyboard.press(REDO);
  await page.waitForTimeout(400);
  await expect(
    page.getByRole("tree", { name: "Layers" }).getByRole("treeitem").filter({
      hasText: "Renamed Box",
    }),
    "redo after a layer-name undo must re-apply the renamed layer",
  ).toHaveCount(1);
  await expect(
    page.getByRole("tree", { name: "Layers" }).getByRole("treeitem").filter({
      hasText: "Box B",
    }),
  ).toHaveCount(0);
});

test("committing an inspector width value then one undo restores the exact previous width", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  await selectViaTree(page, "Box A");
  await page.getByRole("tab", { name: "Design", exact: true }).click();

  const wField = page.getByLabel("W size in pixels");
  await expect(wField).toBeVisible({ timeout: 10_000 });
  const before = await geom(page, id, "box-a");
  const wBefore = parseFloat(await wField.inputValue());
  expect(wBefore).toBeCloseTo(before.width, 0);

  await wField.fill("240");
  await wField.press("Enter");
  await page.waitForTimeout(500);
  const committed = await geom(page, id, "box-a");
  expect(
    committed.width,
    "precondition: the inspector commit must actually change the width",
  ).toBe(240);

  await page.keyboard.press(UNDO);
  await page.waitForTimeout(500);
  const undone = await geom(page, id, "box-a");
  expect(
    undone.width,
    `one undo after an inspector width commit must restore the exact prior width (${before.width}); got ${undone.width}`,
  ).toBe(before.width);
});

test("undo targets the file that was actually edited, not whichever screen currently has focus", async ({
  page,
}) => {
  const id = await newTwoScreenDesign(page);
  await openEditor(page, id);

  const before = await geom(page, id, "box-a");
  await dragElement(page, "box-a", 100, 0);
  const dropped = await geom(page, id, "box-a");
  expect(dropped.left).not.toBe(before.left);

  const page2Iframe = page.locator(
    "iframe[data-design-preview-iframe][data-screen-iframe-id]",
  );
  const target = page2Iframe
    .last()
    .contentFrame()
    .locator('[data-agent-native-node-id="page2-target"]');
  await target.click({ force: true });
  await page.waitForTimeout(300);

  await page.keyboard.press(UNDO);
  await page.waitForTimeout(500);
  await page.keyboard.press(UNDO);
  await page.waitForTimeout(500);

  const undone = await geom(page, id, "box-a");
  expect(
    [undone.left, undone.top],
    `undo must revert the box-a edit on screen one even though screen two currently has focus/selection; before=(${before.left},${before.top}) dropped=(${dropped.left},${dropped.top}) after-undo=(${undone.left},${undone.top}). Trace: ${(await dumpTrace(page)).slice(-500)}`,
  ).toEqual([before.left, before.top]);
});

test("redo re-selects the group Cmd+G produced, not the pre-group selection it undid back to", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);

  const layersTree = page.getByRole("tree", { name: "Layers" });
  const groupRows = () =>
    layersTree.getByRole("treeitem").filter({ hasText: "Group" });
  const layerRow = (name: string) =>
    layersTree.getByRole("treeitem").filter({ hasText: name }).first();
  const lastSelectedLayers = async (): Promise<string[]> =>
    page.evaluate(() => {
      const entries = (window as any).__designTrace?.entries?.() ?? [];
      const selects = entries.filter(
        (entry: { area: string }) => entry.area === "select",
      );
      return (
        (selects[selects.length - 1]?.data as { layers?: string[] })?.layers ??
        []
      );
    });

  await layerRow("Box A").click();
  await layerRow("Box B").click({ modifiers: [MOD] });
  const preGroupSelection = await lastSelectedLayers();

  await page.keyboard.press(`${MOD}+g`);
  await expect(groupRows()).toHaveCount(1);
  const postGroupSelection = await lastSelectedLayers();
  expect(postGroupSelection).not.toEqual(preGroupSelection);
  expect(postGroupSelection).toHaveLength(1);

  await page.keyboard.press(UNDO);
  await expect(groupRows()).toHaveCount(0);
  expect(
    await lastSelectedLayers(),
    "undo must restore the pre-group (ungrouped) selection",
  ).toEqual(preGroupSelection);

  await page.keyboard.press(REDO);
  await expect(groupRows()).toHaveCount(1);
  expect(
    await lastSelectedLayers(),
    "redo must re-select the group it just recreated (the gesture's own " +
      "result), not the pre-group selection undo restored",
  ).toEqual(postGroupSelection);
});

for (const theme of ["dark", "light"] as const) {
  test(`${theme} theme: undo does not flash the canvas background to the other theme's colour`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(
      (value) => localStorage.setItem("theme", value),
      theme,
    );

    const created = await postAction(page, "create-design", {
      title: `undo-redo background ${theme}`,
      projectType: "prototype",
    });
    const id: string = created?.id ?? created?.data?.id;
    await postAction(page, "create-file", {
      designId: id,
      filename: "index.html",
      content: FIXTURE,
      fileType: "html",
    });

    await page.goto(appPath(`/design/${id}`), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-design-bottom-toolbar]")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await expandAllLayers(page);

    const { x: sampleX, y: sampleY } = await sampleXY(page);

    const canvasRgb = await pixelAt(page, sampleX, sampleY);

    await selectViaTree(page, "Box A");
    const before = await geom(page, id, "box-a");
    await dragElement(page, "box-a", 80, 30);
    const dropped = await geom(page, id, "box-a");
    expect(dropped.left).not.toBe(before.left);

    await page.keyboard.press(UNDO);
    for (let i = 0; i < 6; i += 1) {
      const rgb = await pixelAt(page, sampleX, sampleY);
      expect(
        rgb,
        `undo must never repaint the canvas with the other theme's background; expected ${canvasRgb}, saw ${rgb} at t+${i * 150}ms after undo`,
      ).toBe(canvasRgb);
      await page.waitForTimeout(150);
    }
    const undone = await geom(page, id, "box-a");
    expect([undone.left, undone.top]).toEqual([before.left, before.top]);
  });
}

test("selection-only undo/redo: click A, click B, click C, then undo/undo/redo walks the selection history (ground-truth Round 4, Part A)", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);

  await selectViaTree(page, "Box A");
  await selectViaTree(page, "Box B");
  await selectViaTree(page, "Chip 1");
  await expect(layerRow(page, "Chip 1")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const documentBeforeUndo = await indexHtml(page, id);

  await page.keyboard.press(UNDO);
  await page.waitForTimeout(300);
  await expect(
    layerRow(page, "Box B"),
    "first undo re-selects Box B, the previous selection",
  ).toHaveAttribute("aria-selected", "true");
  expect(
    await indexHtml(page, id),
    "a selection-only undo must never touch the document",
  ).toBe(documentBeforeUndo);

  await page.keyboard.press(UNDO);
  await page.waitForTimeout(300);
  await expect(
    layerRow(page, "Box A"),
    "second undo re-selects Box A",
  ).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press(REDO);
  await page.waitForTimeout(300);
  await expect(
    layerRow(page, "Box B"),
    "redo replays the selection changes forward, one at a time",
  ).toHaveAttribute("aria-selected", "true");
});

test("undo walks back through a trailing selection change before reverting a sandwiched edit; redo does not replay the selection past the edit (ground-truth Round 4, Part B)", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);

  const boxALayer = layerRow(page, "Box A");
  await selectViaTree(page, "Box A");
  await expect(boxALayer).toHaveAttribute("aria-selected", "true");
  const before = await geom(page, id, "box-a");
  const source = await box(page, "box-a");
  const startX = source.x + source.width / 2;
  const startY = source.y + source.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 100, startY, { steps: 16 });
  await page.mouse.up();
  await expect
    .poll(
      async () => {
        const current = await geom(page, id, "box-a");
        return [current.left, current.top];
      },
      {
        timeout: 15_000,
        message: "the Box A drag must persist before testing undo history",
      },
    )
    .not.toEqual([before.left, before.top]);
  const dropped = await geom(page, id, "box-a");
  expect(
    [dropped.left, dropped.top],
    "precondition: the drag must actually move box-a",
  ).not.toEqual([before.left, before.top]);

  await selectViaTree(page, "Box B");
  await expect(layerRow(page, "Box B")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.keyboard.press(UNDO);
  await expect(
    layerRow(page, "Box A"),
    "first undo only reverts the trailing selection change (select Box B)",
  ).toHaveAttribute("aria-selected", "true");
  const afterUndo1 = await geom(page, id, "box-a");
  expect(
    [afterUndo1.left, afterUndo1.top],
    "the move must still be applied after only the selection is undone",
  ).toEqual([dropped.left, dropped.top]);

  await page.keyboard.press(UNDO);
  await expect
    .poll(
      async () => {
        const current = await geom(page, id, "box-a");
        return [current.left, current.top];
      },
      {
        timeout: 15_000,
        message: "undo must persist Box A's original position",
      },
    )
    .toEqual([before.left, before.top]);
  const afterUndo2 = await geom(page, id, "box-a");
  expect(
    [afterUndo2.left, afterUndo2.top],
    "second undo reverts the sandwiched drag",
  ).toEqual([before.left, before.top]);
  await expect(layerRow(page, "Box A")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.keyboard.press(REDO);
  await expect
    .poll(
      async () => {
        const current = await geom(page, id, "box-a");
        return [current.left, current.top];
      },
      {
        timeout: 15_000,
        message: "redo must persist Box A's dropped position",
      },
    )
    .toEqual([dropped.left, dropped.top]);
  const afterRedo1 = await geom(page, id, "box-a");
  expect(
    [afterRedo1.left, afterRedo1.top],
    "redo must reapply the exact dropped position",
  ).toEqual([dropped.left, dropped.top]);

  await page.keyboard.press(REDO);
  await page.waitForTimeout(500);
  await expect(
    layerRow(page, "Box A"),
    "a further redo must not resurrect the pre-edit-boundary selection",
  ).toHaveAttribute("aria-selected", "true");
});

test("Escape (deselect to nothing) is its own undo step (ground-truth Round 4, Part C)", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);

  await selectViaTree(page, "Box A");
  await expect(layerRow(page, "Box A")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await expect(
    page.locator('[role="treeitem"][aria-selected="true"]'),
    "Escape must deselect to nothing",
  ).toHaveCount(0);

  await page.keyboard.press(UNDO);
  await page.waitForTimeout(300);
  await expect(
    layerRow(page, "Box A"),
    "undoing a deselect-to-nothing re-selects what was selected before it",
  ).toHaveAttribute("aria-selected", "true");
});

test("a marquee drag selecting Box A + Box B is exactly one undo step, not one per mousemove tick", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);

  await selectViaTree(page, "Box A");
  await expect(layerRow(page, "Box A")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  const boxA = await box(page, "box-a");
  const boxB = await box(page, "box-b");
  const from = { x: boxA.x - 20, y: boxA.y - 20 };
  const to = {
    x: boxB.x + boxB.width + 20,
    y: boxB.y + boxB.height + 20,
  };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 24 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(500);

  await expect(
    layerRow(page, "Box A"),
    "marquee must keep Box A selected",
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    layerRow(page, "Box B"),
    "marquee must add Box B to the selection",
  ).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press(UNDO);
  await page.waitForTimeout(300);
  await page.keyboard.press(UNDO);
  await page.waitForTimeout(300);
  await expect(
    page.locator('[role="treeitem"][aria-selected="true"]'),
    "two undos (one per real step: the marquee, then the click) must reach an empty selection",
  ).toHaveCount(0);

  await page.keyboard.press(REDO);
  await page.waitForTimeout(300);
  await page.keyboard.press(REDO);
  await page.waitForTimeout(300);
  await expect(layerRow(page, "Box A")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(layerRow(page, "Box B")).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("a canceled marquee cannot capture an intervening selection in the next undo", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);

  await selectViaTree(page, "Box A");
  const boxA = await box(page, "box-a");
  const boxB = await box(page, "box-b");
  await page.mouse.move(boxA.x - 20, boxA.y - 20);
  await page.mouse.down();
  await page.mouse.move(boxB.x + boxB.width + 20, boxB.y + boxB.height + 20, {
    steps: 12,
  });
  await page.waitForTimeout(150);
  await page.keyboard.press("Escape");
  await expect(layerRow(page, "Box A")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await selectViaTree(page, "Box B");
  const nextBoxA = await box(page, "box-a");
  await page.mouse.move(nextBoxA.x - 20, nextBoxA.y - 20);
  await page.mouse.down();
  await page.mouse.move(
    nextBoxA.x + nextBoxA.width + 20,
    nextBoxA.y + nextBoxA.height + 20,
    { steps: 12 },
  );
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect(layerRow(page, "Box A")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(layerRow(page, "Box B")).not.toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.keyboard.press(UNDO);
  await expect(layerRow(page, "Box B")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(layerRow(page, "Box A")).not.toHaveAttribute(
    "aria-selected",
    "true",
  );
});
