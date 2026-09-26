import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  appPath,
  canvasZoom,
  childNodeIds,
  designFrame,
  expandAllLayers,
  gotoEditor,
  installBridge,
} from "./helpers";

const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${BASE_URL}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(
  request: APIRequestContext,
  html: string,
  fileCount = 1,
) {
  const created = await action(request, "create-design", {
    title: `Alt-drag duplicate parity ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const fileIds: string[] = [];
  for (let index = 0; index < fileCount; index += 1) {
    const file = await action(request, "create-file", {
      designId,
      filename: index === 0 ? "index.html" : `screen-${index + 1}.html`,
      content: html,
      fileType: "html",
    });
    const fileId = file.id ?? file.data?.id;
    if (!fileId) throw new Error("create-file returned no id");
    fileIds.push(fileId);
  }
  await action(request, "update-design", {
    id: designId,
    dataOperations: fileIds.flatMap((fileId, index) => [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: { sourceType: "inline", width: 1280, height: 900 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: index * 1600, y: 0, width: 1280, height: 900, z: index },
      },
    ]),
  });
  return { designId, fileIds };
}

const NAMED_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;min-height:900px">
<div data-agent-native-node-id="rect" data-agent-native-layer-name="Widget"
     style="position:absolute;left:100px;top:100px;width:200px;height:120px;background:#3a7">
</div>
</body></html>`;

const UNNAMED_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;min-height:900px">
<div data-agent-native-node-id="plain" style="position:absolute;left:100px;top:100px;width:200px;height:120px;background:#a37">
</div>
</body></html>`;

const SCREEN_WITH_TWO_ELEMENTS_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;min-height:900px">
<div data-agent-native-node-id="rect" data-agent-native-layer-name="Widget"
     style="position:absolute;left:80px;top:80px;width:180px;height:100px;background:#3a7">
</div>
<div data-agent-native-node-id="other" data-agent-native-layer-name="Other"
     style="position:absolute;left:80px;top:260px;width:180px;height:100px;background:#559">
</div>
</body></html>`;

const BOARD_AUTO_LAYOUT_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;width:3000px;height:1200px;overflow:visible;background:transparent">
<div data-agent-native-node-id="root-frame" data-agent-native-layer-name="Frame" data-an-primitive="frame"
     style="position:absolute;left:600px;top:940px;width:440px;height:300px;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:20px;background:#334155">
  <section data-agent-native-node-id="frame-2" data-agent-native-layer-name="Frame 2" data-an-primitive="frame"
           style="box-sizing:border-box;width:260px;height:160px;display:flex;flex-direction:column;gap:8px;padding:12px;background:#475569">
    <div data-agent-native-node-id="frame-2-child-a" data-agent-native-layer-name="Frame 2 child A"
         style="flex:0 0 auto;width:180px;height:48px;background:#2563eb"></div>
    <div data-agent-native-node-id="frame-2-child-b" data-agent-native-layer-name="Frame 2 child B"
         style="flex:0 0 auto;width:180px;height:48px;background:#7c3aed"></div>
  </section>
  <section data-agent-native-node-id="frame-3" data-agent-native-layer-name="Frame 3" data-an-primitive="frame"
           style="box-sizing:border-box;width:260px;height:80px;background:#0f766e"></section>
</div>
</body></html>`;

async function createDesignWithBoard(request: APIRequestContext) {
  const { designId } = await createDesign(request, NAMED_HTML);
  const board = await action(request, "create-file", {
    designId,
    filename: "__board__.html",
    content: BOARD_AUTO_LAYOUT_HTML,
    fileType: "html",
  });
  const boardFileId = board.id ?? board.data?.id;
  if (!boardFileId) throw new Error("create-file returned no board id");
  await action(request, "update-design", {
    id: designId,
    dataOperations: [
      { op: "set", path: ["boardFileId"], value: boardFileId },
      {
        op: "set",
        path: ["screenMetadata", boardFileId],
        value: { sourceType: "inline", width: 3000, height: 1200 },
      },
    ],
  });
  return designId;
}

async function fileContent(
  request: APIRequestContext,
  designId: string,
  filename: string,
): Promise<string> {
  const response = await request.get(
    `${BASE_URL}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
  );
  if (!response.ok()) {
    throw new Error(
      `get-design: ${response.status()} ${await response.text()}`,
    );
  }
  const record = await response.json();
  return (
    (record.files ?? []).find(
      (file: { filename?: string }) => file.filename === filename,
    )?.content ?? ""
  );
}

type LayerTree = {
  id: string;
  name: string;
  children: LayerTree[];
};

type LayerShape = {
  name: string;
  children: LayerShape[];
};

async function readLayerTree(layer: Locator): Promise<LayerTree> {
  return layer.evaluate((root) => {
    const read = (element: Element): LayerTree => ({
      id: element.getAttribute("data-agent-native-node-id") ?? "",
      name: element.getAttribute("data-agent-native-layer-name") ?? "",
      children: Array.from(element.children)
        .filter((child) => child.hasAttribute("data-agent-native-node-id"))
        .map(read),
    });
    return read(root);
  });
}

async function boardNodeHostBounds(page: Page, selector: string) {
  const bounds = await page.evaluate((selector) => {
    const iframe = document.querySelector(
      "[data-board-surface-layer] iframe",
    ) as HTMLIFrameElement | null;
    const node = iframe?.contentDocument?.querySelector(selector);
    if (!iframe || !node) return null;
    const frameRect = iframe.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const scaleX = frameRect.width / iframe.offsetWidth;
    const scaleY = frameRect.height / iframe.offsetHeight;
    return {
      x: frameRect.left + (iframe.clientLeft + nodeRect.left) * scaleX,
      y: frameRect.top + (iframe.clientTop + nodeRect.top) * scaleY,
      width: nodeRect.width * scaleX,
      height: nodeRect.height * scaleY,
    };
  }, selector);
  if (!bounds) throw new Error(`board node not found: ${selector}`);
  return bounds;
}

function withoutLayerIds(tree: LayerTree): LayerShape {
  return {
    name: tree.name,
    children: tree.children.map(withoutLayerIds),
  };
}

function layerTreeIds(tree: LayerTree): string[] {
  return [tree.id, ...tree.children.flatMap(layerTreeIds)];
}

async function openOverview(page: Page, designId: string, screens: number) {
  await page.goto(appPath(`/design/${designId}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("[data-screen-shell]")).toHaveCount(screens, {
    timeout: 30_000,
  });
  const firstCard = page.locator("[data-screen-card]").first();
  await expect(firstCard).toBeVisible();
  let lastBox: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        const box = await firstCard.boundingBox();
        const stable =
          box !== null &&
          lastBox !== null &&
          Math.abs(box.x - lastBox.x) < 1 &&
          Math.abs(box.y - lastBox.y) < 1;
        lastBox = box;
        return stable;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
}

async function zoomOutToBoardDropPoint(
  page: Page,
  excludedRects: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [],
) {
  const zoomControl = page.getByRole("button", { name: /^\d+%$/ }).first();
  await zoomControl.click();
  await page.getByRole("menuitem", { name: "Zoom to 50%" }).click();
  await expect(zoomControl).toHaveText("50%");
  return page.evaluate((excludedRects) => {
    const canvas = document.querySelector(
      "[data-multi-screen-canvas-world]",
    )?.parentElement;
    if (!canvas) return null;
    const canvasBounds = canvas.getBoundingClientRect();
    const iframeBounds = Array.from(
      document.querySelectorAll("iframe[data-screen-iframe-id]"),
    ).map((iframe) => iframe.getBoundingClientRect());
    const shellBounds = Array.from(
      document.querySelectorAll("[data-screen-shell]"),
    ).map((shell) => shell.getBoundingClientRect());
    const contains = (rect: DOMRect, x: number, y: number) =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    const excluded = (x: number, y: number) =>
      excludedRects.some(
        (rect) =>
          x >= rect.x &&
          x <= rect.x + rect.width &&
          y >= rect.y &&
          y <= rect.y + rect.height,
      );
    for (let y = canvasBounds.top + 48; y < canvasBounds.bottom - 48; y += 64) {
      for (
        let x = canvasBounds.left + 48;
        x < canvasBounds.right - 48;
        x += 64
      ) {
        if (excluded(x, y)) continue;
        if (
          iframeBounds.some((rect) => contains(rect, x, y)) ||
          shellBounds.some((rect) => contains(rect, x, y))
        ) {
          continue;
        }
        const hit = document.elementFromPoint(x, y);
        if (!hit || hit.closest("[data-design-chrome-region]")) {
          continue;
        }
        return {
          x,
          y,
          canvasBounds: {
            left: canvasBounds.left,
            top: canvasBounds.top,
            right: canvasBounds.right,
            bottom: canvasBounds.bottom,
          },
          iframeBounds: iframeBounds.map(({ left, top, right, bottom }) => ({
            left,
            top,
            right,
            bottom,
          })),
          shellBounds: shellBounds.map(({ left, top, right, bottom }) => ({
            left,
            top,
            right,
            bottom,
          })),
        };
      }
    }
    return null;
  }, excludedRects);
}

async function layerNames(page: Page): Promise<string[]> {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator(
      '[role="treeitem"]:not([aria-level="1"]) [data-layer-row-button] span[title]',
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("title") ?? ""),
    );
}

async function dumpTrace(page: Page) {
  return page
    .evaluate(() => (window as any).__designTrace?.dump?.() ?? null)
    .catch(() => null);
}

async function dragBoardLayerCopyToEmptyCanvas(
  page: Page,
  request: APIRequestContext,
  designId: string,
  sourceNodeId: string,
) {
  await openOverview(page, designId, 1);
  await expandAllLayers(page);
  const boardFrame = page
    .locator("[data-board-surface-layer] iframe")
    .first()
    .contentFrame();
  const boardRoots = boardFrame.locator("body > [data-agent-native-node-id]");
  const originalRoot = boardFrame.locator(
    '[data-agent-native-node-id="root-frame"]',
  );
  const source = boardFrame.locator(
    `[data-agent-native-node-id="${sourceNodeId}"]`,
  );
  await expect(boardRoots).toHaveCount(1);
  await expect(source).toBeVisible();
  const sourceName = await source.getAttribute("data-agent-native-layer-name");
  expect(sourceName).toBeTruthy();
  const sourceRow = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .filter({ has: page.locator(`span[title="${sourceName}"]`) })
    .first();
  await expect(sourceRow).toBeVisible();
  await sourceRow.click({ force: true });
  await expect(
    sourceRow.locator('xpath=ancestor::*[@role="treeitem"][1]'),
  ).toHaveAttribute("aria-selected", "true");
  const selectionBox = page.locator("[data-board-object-selection-box]");
  await expect(selectionBox).toBeVisible();
  const dragSurface = selectionBox.locator("[data-frame-drag-surface]");
  await expect(dragSurface).toBeVisible();
  await zoomOutToBoardDropPoint(page);
  const rootBox = await boardNodeHostBounds(
    page,
    '[data-agent-native-node-id="root-frame"]',
  );
  const originalTreeBefore = await readLayerTree(originalRoot);
  const sourceTreeBefore = await readLayerTree(source);
  const originalIdsBefore = layerTreeIds(originalTreeBefore);
  const originalChildrenBefore = childNodeIds(
    await fileContent(request, designId, "__board__.html"),
    "root-frame",
  );
  const emptyPoint = await zoomOutToBoardDropPoint(page, [rootBox]);
  if (!emptyPoint) throw new Error("no unobstructed board drop point");
  const dragBox = await dragSurface.boundingBox();
  if (!dragBox) throw new Error("selected board layer has no drag surface");
  const grabOffset = { x: dragBox.width / 2, y: dragBox.height / 2 };
  const grabPoint = {
    x: dragBox.x + grabOffset.x,
    y: dragBox.y + grabOffset.y,
  };
  const startsOnSelectedDragSurface = await page.evaluate(({ x, y }) => {
    const selectedDragSurface = document.querySelector(
      "[data-board-object-selection-box] [data-frame-drag-surface]",
    );
    return (
      !!selectedDragSurface &&
      document.elementFromPoint(x, y) === selectedDragSurface
    );
  }, grabPoint);
  expect(
    startsOnSelectedDragSurface,
    "Alt-drag must start on the selected board layer's canvas drag surface",
  ).toBe(true);

  await page.mouse.move(grabPoint.x, grabPoint.y);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  try {
    await page.mouse.move(grabPoint.x + 6, grabPoint.y + 4, { steps: 2 });
    const cloneRoot = boardFrame.locator(
      '[data-agent-native-clone-root="true"]',
    );
    await expect(cloneRoot).toHaveCount(1);
    await page.mouse.move(emptyPoint.x, emptyPoint.y, { steps: 20 });
    await expect(cloneRoot).toHaveCount(1);
    const heldCloneBox = await boardNodeHostBounds(
      page,
      '[data-agent-native-clone-root="true"]',
    );
    expect(heldCloneBox).not.toBeNull();
    expect(heldCloneBox!.x).toBeCloseTo(emptyPoint.x - grabOffset.x, -1);
    expect(heldCloneBox!.y).toBeCloseTo(emptyPoint.y - grabOffset.y, -1);
    const heldOriginalBox = await boardNodeHostBounds(
      page,
      '[data-agent-native-node-id="root-frame"]',
    );
    expect(heldOriginalBox.x).toBeCloseTo(rootBox.x, 0);
    expect(heldOriginalBox.y).toBeCloseTo(rootBox.y, 0);
    expect(await readLayerTree(source)).toEqual(sourceTreeBefore);
  } finally {
    await page.mouse.up().catch(() => {});
    await page.keyboard.up("Alt").catch(() => {});
  }

  await expect(boardRoots).toHaveCount(2, { timeout: 20_000 });
  const rootInfo = await boardRoots.evaluateAll((roots) =>
    roots.map((root) => ({
      id: root.getAttribute("data-agent-native-node-id") ?? "",
      name: root.getAttribute("data-agent-native-layer-name") ?? "",
    })),
  );
  const copyInfo = rootInfo.find((root) => root.id !== "root-frame");
  expect(copyInfo).toBeTruthy();
  expect(copyInfo!.name).toBe(sourceTreeBefore.name);
  const originalTreeAfter = await readLayerTree(originalRoot);
  const copy = boardFrame.locator(
    `[data-agent-native-node-id="${copyInfo!.id}"]`,
  );
  const copyTree = await readLayerTree(copy);
  expect(originalTreeAfter).toEqual(originalTreeBefore);
  expect(withoutLayerIds(copyTree)).toEqual(withoutLayerIds(sourceTreeBefore));
  expect(new Set([...originalIdsBefore, ...layerTreeIds(copyTree)]).size).toBe(
    originalIdsBefore.length + layerTreeIds(copyTree).length,
  );
  const copyBox = await boardNodeHostBounds(
    page,
    `[data-agent-native-node-id="${copyInfo!.id}"]`,
  );
  expect(copyBox.x).toBeCloseTo(emptyPoint.x - grabOffset.x, -1);
  expect(copyBox.y).toBeCloseTo(emptyPoint.y - grabOffset.y, -1);
  const originalRootBoxAfter = await boardNodeHostBounds(
    page,
    '[data-agent-native-node-id="root-frame"]',
  );
  expect(originalRootBoxAfter.x).toBeCloseTo(rootBox.x, 0);
  expect(originalRootBoxAfter.y).toBeCloseTo(rootBox.y, 0);
  expect(
    childNodeIds(
      await fileContent(request, designId, "__board__.html"),
      "root-frame",
    ),
  ).toEqual(originalChildrenBefore);

  const selectionEntries = await page.evaluate(
    () => (window as any).__designTrace?.entries?.() ?? [],
  );
  const selectedCopy = selectionEntries
    .filter(
      (entry: { event?: string; data?: { hasSelection?: boolean } }) =>
        entry.event === "selection-changed" && entry.data?.hasSelection,
    )
    .at(-1)?.data?.element;
  expect(selectedCopy).toContain(copyInfo!.id);

  await expect
    .poll(() => fileContent(request, designId, "__board__.html"), {
      timeout: 20_000,
    })
    .toContain(`data-agent-native-node-id="${copyInfo!.id}"`);
  return {
    copyId: copyInfo!.id,
    copyTree,
    originalTreeBefore,
    sourceTreeBefore,
  };
}

async function expectBoardCopyAfterReload(
  page: Page,
  request: APIRequestContext,
  designId: string,
  copyId: string,
) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-screen-shell]")).toHaveCount(1, {
    timeout: 30_000,
  });
  const boardFrame = page
    .locator("[data-board-surface-layer] iframe")
    .first()
    .contentFrame();
  const boardRoots = boardFrame.locator("body > [data-agent-native-node-id]");
  await expect(boardRoots).toHaveCount(2);
  const rootIds = await boardRoots.evaluateAll((roots) =>
    roots.map((root) => root.getAttribute("data-agent-native-node-id")),
  );
  expect(rootIds).toContain("root-frame");
  expect(rootIds).toContain(copyId);
  const html = await fileContent(request, designId, "__board__.html");
  expect(html).toContain(`data-agent-native-node-id="${copyId}"`);
  return {
    html,
    original: boardFrame.locator('[data-agent-native-node-id="root-frame"]'),
    copy: boardFrame.locator(`[data-agent-native-node-id="${copyId}"]`),
  };
}

test.describe("alt-drag duplicate (single-screen editor)", () => {
  test("alt-drag inside a screen: original stays, copy keeps the identical name, copy is selected", async ({
    page,
    request,
  }) => {
    const { designId } = await createDesign(request, NAMED_HTML);
    try {
      await gotoEditor(page, designId);
      const zoom = await canvasZoom(page);
      const frame = designFrame(page);
      const rect = frame.locator('[data-agent-native-node-id="rect"]');
      await expect(rect).toBeVisible();
      const before = (await rect.boundingBox())!;

      await page.mouse.click(
        before.x + before.width / 2,
        before.y + before.height / 2,
      );
      await page.waitForTimeout(200);

      const startX = before.x + before.width / 2;
      const startY = before.y + before.height / 2;
      const dx = 220 * zoom;
      const dy = 140 * zoom;
      await page.mouse.move(startX, startY);
      await page.keyboard.down("Alt");
      await page.mouse.down();
      await page.mouse.move(startX + dx, startY + dy, { steps: 16 });
      await page.mouse.up();
      await page.keyboard.up("Alt");

      const nodes = frame.locator("body > [data-agent-native-node-id]");
      await expect(nodes).toHaveCount(2, { timeout: 10_000 });

      const originalAfter = await frame
        .locator('[data-agent-native-node-id="rect"]')
        .boundingBox();
      expect(originalAfter).not.toBeNull();
      expect(Math.round(originalAfter!.x)).toBe(Math.round(before.x));
      expect(Math.round(originalAfter!.y)).toBe(Math.round(before.y));

      const allIds = await frame
        .locator("body > [data-agent-native-node-id]")
        .evaluateAll((els) =>
          els.map((el) => el.getAttribute("data-agent-native-node-id")),
        );
      const copyId = allIds.find((id) => id !== "rect");
      expect(copyId).toBeTruthy();
      const copyBox = await frame
        .locator(`[data-agent-native-node-id="${copyId}"]`)
        .boundingBox();
      expect(copyBox).not.toBeNull();
      expect(Math.abs(copyBox!.x - before.x)).toBeGreaterThan(10);
      expect(Math.abs(copyBox!.y - before.y)).toBeGreaterThan(10);

      const names = await layerNames(page);
      const widgetCount = names.filter((n) => n === "Widget").length;
      if (widgetCount !== 2) {
        const trace = await dumpTrace(page);
        test.info().annotations.push({
          type: "trace",
          description: JSON.stringify({ names, trace }),
        });
      }
      expect(names.filter((n) => n === "Widget")).toHaveLength(2);

      const selectionTrace = await dumpTrace(page);
      const selectionMatches = [
        ...(selectionTrace ?? "").matchAll(
          /\[select:selection-changed\] \{"layers":\[[^\]]*\],"element":"((?:[^"\\]|\\.)*)"/g,
        ),
      ];
      const lastSelection =
        selectionMatches[selectionMatches.length - 1]?.[1] ?? null;
      if (!lastSelection || !lastSelection.includes(copyId!)) {
        test.info().annotations.push({
          type: "trace",
          description: JSON.stringify({
            copyId,
            lastSelection,
            selectionTrace,
          }),
        });
      }
      expect(lastSelection).toContain(copyId);
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });

  test("alt-drag on an unnamed (tag-fallback-named) element: copy keeps the same computed name, not literal 'Copy'", async ({
    page,
    request,
  }) => {
    const { designId } = await createDesign(request, UNNAMED_HTML);
    try {
      await gotoEditor(page, designId);
      const frame = designFrame(page);
      const plain = frame.locator('[data-agent-native-node-id="plain"]');
      await expect(plain).toBeVisible();
      const before = (await plain.boundingBox())!;
      await page.mouse.click(
        before.x + before.width / 2,
        before.y + before.height / 2,
      );
      await page.waitForTimeout(200);

      const namesBefore = await layerNames(page);
      expect(namesBefore).toHaveLength(1);
      const originalName = namesBefore[0]!;

      await page.mouse.move(
        before.x + before.width / 2,
        before.y + before.height / 2,
      );
      await page.keyboard.down("Alt");
      await page.mouse.down();
      await page.mouse.move(
        before.x + before.width / 2 + 200,
        before.y + before.height / 2 + 150,
        {
          steps: 16,
        },
      );
      await page.mouse.up();
      await page.keyboard.up("Alt");
      await expect
        .poll(async () => (await layerNames(page)).length, {
          timeout: 10_000,
        })
        .toBe(2);

      const namesAfter = await layerNames(page);
      if (
        namesAfter.length !== 2 ||
        namesAfter.some((n) => n !== originalName)
      ) {
        const trace = await dumpTrace(page);
        test.info().annotations.push({
          type: "trace",
          description: JSON.stringify({ originalName, namesAfter, trace }),
        });
      }
      expect(namesAfter).toHaveLength(2);
      for (const name of namesAfter) {
        expect(name).toBe(originalName);
        expect(name.toLowerCase()).not.toContain("copy");
      }
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });

  test("alt-drag inserts the copy directly above the original in DOM order (z-order)", async ({
    page,
    request,
  }) => {
    const { designId } = await createDesign(
      request,
      SCREEN_WITH_TWO_ELEMENTS_HTML,
    );
    try {
      await gotoEditor(page, designId);
      const frame = designFrame(page);
      const rect = frame.locator('[data-agent-native-node-id="rect"]');
      await expect(rect).toBeVisible();
      const before = (await rect.boundingBox())!;
      await page.mouse.click(
        before.x + before.width / 2,
        before.y + before.height / 2,
      );
      await page.waitForTimeout(200);

      await page.mouse.move(
        before.x + before.width / 2,
        before.y + before.height / 2,
      );
      await page.keyboard.down("Alt");
      await page.mouse.down();
      await page.mouse.move(
        before.x + before.width / 2 + 250,
        before.y + before.height / 2,
        {
          steps: 16,
        },
      );
      await page.mouse.up();
      await page.keyboard.up("Alt");
      const bodyLocator = frame.locator("body > [data-agent-native-node-id]");
      await expect.poll(() => bodyLocator.count(), { timeout: 10_000 }).toBe(3);

      const bodyOrder = await bodyLocator.evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-agent-native-node-id")),
      );
      const rectIndex = bodyOrder.indexOf("rect");
      const otherIndex = bodyOrder.indexOf("other");
      expect(rectIndex).toBeGreaterThan(-1);
      expect(otherIndex).toBeGreaterThan(-1);
      const copyIndex = bodyOrder.findIndex(
        (id) => id !== "rect" && id !== "other",
      );
      if (copyIndex !== rectIndex + 1) {
        const trace = await dumpTrace(page);
        test.info().annotations.push({
          type: "trace",
          description: JSON.stringify({ bodyOrder, trace }),
        });
      }
      expect(copyIndex).toBe(rectIndex + 1);
      expect(copyIndex).toBeLessThan(otherIndex);
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });

  test("one undo after alt-drag removes the copy and restores selection to the original", async ({
    page,
    request,
  }) => {
    const { designId } = await createDesign(request, NAMED_HTML);
    try {
      await gotoEditor(page, designId);
      const frame = designFrame(page);
      const rect = frame.locator('[data-agent-native-node-id="rect"]');
      await expect(rect).toBeVisible();
      const before = (await rect.boundingBox())!;
      await page.mouse.click(
        before.x + before.width / 2,
        before.y + before.height / 2,
      );
      await page.waitForTimeout(200);

      const originalLayerNodeId = await page
        .getByRole("tree", { name: "Layers" })
        .locator('[aria-selected="true"] [data-layer-row-button]')
        .getAttribute("data-layer-node-id");
      expect(originalLayerNodeId).toBeTruthy();

      await page.mouse.move(
        before.x + before.width / 2,
        before.y + before.height / 2,
      );
      await page.keyboard.down("Alt");
      await page.mouse.down();
      await page.mouse.move(
        before.x + before.width / 2 + 200,
        before.y + before.height / 2 + 150,
        {
          steps: 16,
        },
      );
      await page.mouse.up();
      await page.keyboard.up("Alt");
      await expect(
        frame.locator("body > [data-agent-native-node-id]"),
      ).toHaveCount(2);

      await page.keyboard.press("ControlOrMeta+z");
      await page.waitForTimeout(800);

      const afterUndo = frame.locator("body > [data-agent-native-node-id]");
      if ((await afterUndo.count()) !== 1) {
        const trace = await dumpTrace(page);
        test.info().annotations.push({
          type: "trace",
          description: JSON.stringify({ trace }),
        });
      }
      await expect(afterUndo).toHaveCount(1);
      const restored = await afterUndo.first().boundingBox();
      expect(Math.round(restored!.x)).toBe(Math.round(before.x));
      expect(Math.round(restored!.y)).toBe(Math.round(before.y));

      const selectedRow = page
        .getByRole("tree", { name: "Layers" })
        .locator('[aria-selected="true"] [data-layer-row-button]');
      await expect(selectedRow).toHaveAttribute(
        "data-layer-node-id",
        originalLayerNodeId!,
      );
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });
});

test.describe("alt-drag duplicate (overview)", () => {
  test("alt-drag from inside a screen to outside it drops the copy on the board, does not duplicate in place", async ({
    page,
    request,
  }) => {
    const { designId, fileIds } = await createDesign(request, NAMED_HTML);
    try {
      await openOverview(page, designId, 1);
      const dropPoint = await zoomOutToBoardDropPoint(page);
      if (!dropPoint) throw new Error("no unobstructed board drop point");
      const contains = (rect: {
        left: number;
        top: number;
        right: number;
        bottom: number;
      }) =>
        dropPoint.x >= rect.left &&
        dropPoint.x <= rect.right &&
        dropPoint.y >= rect.top &&
        dropPoint.y <= rect.bottom;
      expect(dropPoint.x).toBeGreaterThan(dropPoint.canvasBounds.left);
      expect(dropPoint.x).toBeLessThan(dropPoint.canvasBounds.right);
      expect(dropPoint.y).toBeGreaterThan(dropPoint.canvasBounds.top);
      expect(dropPoint.y).toBeLessThan(dropPoint.canvasBounds.bottom);
      expect(dropPoint.iframeBounds.some(contains)).toBe(false);
      expect(dropPoint.shellBounds.some(contains)).toBe(false);
      const iframe = page.locator("iframe[data-screen-iframe-id]").first();
      await expect(iframe).toBeVisible();
      const source = iframe
        .contentFrame()
        .locator('[data-agent-native-node-id="rect"]');
      await expect(source).toBeVisible();
      const sourceBox = (await source.boundingBox())!;
      const sourceX = sourceBox.x + sourceBox.width / 2;
      const sourceY = sourceBox.y + sourceBox.height / 2;

      await page.mouse.dblclick(sourceX, sourceY);
      await page.waitForTimeout(500);
      await page.mouse.click(sourceX, sourceY);
      await page.waitForTimeout(500);

      await page.mouse.move(sourceX, sourceY);
      await page.keyboard.down("Alt");
      await page.mouse.down();
      await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 24 });
      await page.waitForTimeout(300);
      await page.mouse.up();
      await page.keyboard.up("Alt");

      const readInsideScreen = () =>
        page.evaluate(() => {
          const frame = document.querySelector<HTMLIFrameElement>(
            "iframe[data-screen-iframe-id]",
          );
          return Array.from(
            frame?.contentDocument?.querySelectorAll(
              "body > [data-agent-native-node-id]",
            ) ?? [],
          ).map((el) => ({
            id: el.getAttribute("data-agent-native-node-id"),
            left: (el as HTMLElement).style.left,
            top: (el as HTMLElement).style.top,
          }));
        });
      const readBoardCopyCount = () =>
        page.evaluate(() => {
          const boardIframe = document.querySelector<HTMLIFrameElement>(
            "[data-board-surface-layer] iframe",
          );
          return (
            boardIframe?.contentDocument?.querySelectorAll(
              "body > [data-agent-native-node-id]",
            ).length ?? -1
          );
        });

      let insideScreenCount = -1;
      let boardCopyCount = -1;
      await expect
        .poll(
          async () => {
            insideScreenCount = (await readInsideScreen()).length;
            boardCopyCount = await readBoardCopyCount();
            return insideScreenCount === 1 && boardCopyCount > 0;
          },
          { timeout: 10_000 },
        )
        .toBe(true);
      const warningVisible = await page
        .locator("text=/can.?t (reorder|duplicate|drop)/i")
        .first()
        .isVisible();

      if (insideScreenCount !== 1 || warningVisible) {
        const trace = await dumpTrace(page);
        test.info().annotations.push({
          type: "trace",
          description: JSON.stringify({
            insideScreenCount,
            warningVisible,
            trace,
          }),
        });
      }
      expect(insideScreenCount).toBe(1);
      expect(warningVisible).toBe(false);
      expect(boardCopyCount).toBeGreaterThan(0);

      const boardIframe = page
        .locator("[data-board-surface-layer] iframe")
        .first();
      await expect(boardIframe).toBeVisible();
      const boardFrame = boardIframe.contentFrame();
      const boardCopy = boardFrame.locator(
        "body > [data-agent-native-node-id]",
      );
      await expect(boardCopy).toHaveCount(1);
      const copyId = await boardCopy.getAttribute("data-agent-native-node-id");
      expect(copyId).toBeTruthy();
      const copyBox = await boardCopy.boundingBox();
      expect(copyBox).not.toBeNull();

      await page.keyboard.press("Escape");
      await expect
        .poll(
          async () => {
            const entries = await page.evaluate(
              () => (window as any).__designTrace?.entries?.() ?? [],
            );
            const selectionEntries = entries.filter(
              (entry: { event?: string; data?: { hasSelection?: boolean } }) =>
                entry.event === "selection-changed",
            );
            return selectionEntries.at(-1)?.data?.hasSelection ?? null;
          },
          { timeout: 10_000 },
        )
        .toBe(false);
      const clickPoint = {
        x: copyBox!.x + copyBox!.width / 2,
        y: copyBox!.y + copyBox!.height / 2,
      };
      await expect
        .poll(
          () =>
            page.evaluate(
              ({ x, y }) =>
                Boolean(
                  document
                    .elementFromPoint(x, y)
                    ?.closest("[data-board-surface-layer]"),
                ),
              clickPoint,
            ),
          { timeout: 10_000 },
        )
        .toBe(true);
      await page.mouse.click(clickPoint.x, clickPoint.y);
      const readSelectedSelector = async () => {
        const entries = await page.evaluate(
          () => (window as any).__designTrace?.entries?.() ?? [],
        );
        const selectionEntries = entries.filter(
          (entry: { event?: string; data?: { hasSelection?: boolean } }) =>
            entry.event === "selection-changed" &&
            entry.data?.hasSelection === true,
        );
        return selectionEntries.at(-1)?.data?.element ?? null;
      };
      await expect
        .poll(readSelectedSelector, { timeout: 10_000 })
        .toContain(copyId!);
      const selectedSelector = await readSelectedSelector();
      expect(selectedSelector).toContain(copyId!);
      await expect(
        page.locator("[data-board-object-selection-box]"),
      ).toHaveCount(1);
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });

  test("alt-drag a board object (frame) copies it and leaves the original untouched", async ({
    page,
    request,
  }) => {
    const { designId, fileIds } = await createDesign(request, NAMED_HTML, 1);
    try {
      await openOverview(page, designId, 1);
      await page.locator("[data-frame-label]").first().click({ force: true });
      const dragSurface = page.locator("[data-frame-drag-surface]");
      await expect(dragSurface).toBeVisible();
      const box = (await dragSurface.boundingBox())!;
      const view = page.viewportSize()!;
      const start = {
        x: (Math.max(box.x, 0) + Math.min(box.x + box.width, view.width)) / 2,
        y: (Math.max(box.y, 0) + Math.min(box.y + box.height, view.height)) / 2,
      };

      const before = await page.evaluate(() =>
        Object.fromEntries(
          Array.from(
            document.querySelectorAll<HTMLElement>("[data-frame-id]"),
          ).map((node) => [
            node.getAttribute("data-frame-id")!,
            {
              left: Number.parseFloat(node.style.left),
              top: Number.parseFloat(node.style.top),
            },
          ]),
        ),
      );

      await page.mouse.move(start.x, start.y);
      await page.keyboard.down("Alt");
      await page.mouse.down();
      await page.mouse.move(start.x + 220, start.y + 140, { steps: 12 });
      await expect(
        page.locator("[data-duplicate-preview-ghost]"),
      ).toBeVisible();
      await page.mouse.up();
      await page.keyboard.up("Alt");

      await expect(page.locator("[data-screen-shell]")).toHaveCount(2, {
        timeout: 20_000,
      });
      const readFramePositions = () =>
        page.evaluate(() =>
          Object.fromEntries(
            Array.from(
              document.querySelectorAll<HTMLElement>("[data-frame-id]"),
            ).map((node) => [
              node.getAttribute("data-frame-id")!,
              {
                left: Number.parseFloat(node.style.left),
                top: Number.parseFloat(node.style.top),
              },
            ]),
          ),
        );
      let after: Record<string, { left: number; top: number }> = {};
      let copyId = "";
      await expect
        .poll(
          async () => {
            after = await readFramePositions();
            copyId = Object.keys(after).find((id) => id !== fileIds[0]) ?? "";
            return (
              Boolean(copyId) && after[copyId]!.left > before[fileIds[0]!]!.left
            );
          },
          { timeout: 20_000 },
        )
        .toBe(true);
      expect(after[fileIds[0]!]).toEqual(before[fileIds[0]!]);
      expect(copyId).toBeTruthy();
      expect(after[copyId!]!.left).toBeGreaterThan(before[fileIds[0]!]!.left);

      const copyTitle = page.locator(
        `[data-frame-id="${copyId}"] [data-frame-title]`,
      );
      await expect(copyTitle).toHaveAttribute("title", "index-copy.html");
      await expect(copyTitle).toHaveText("Index copy");
      await expect(
        page
          .getByRole("tree", { name: "Layers" })
          .locator('[role="treeitem"][aria-level="1"][aria-selected="true"]')
          .filter({ hasText: "Index copy" }),
      ).toHaveCount(1);
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });

  test("known-failing: alt-dragging a multi-frame selection via [data-frame-label] — is the left shell really intercepting?", async ({
    page,
    request,
  }) => {
    const { designId } = await createDesign(request, NAMED_HTML, 2);
    try {
      await openOverview(page, designId, 2);
      const label = page.locator("[data-frame-label]").first();
      await expect(label).toBeVisible();
      const labelBox = (await label.boundingBox())!;

      const shell = page.locator('[data-design-chrome-region="left-shell"]');
      const shellVisible = await shell.isVisible().catch(() => false);
      const shellBox = shellVisible ? await shell.boundingBox() : null;

      const overlapsShell =
        shellBox !== null &&
        labelBox.x < shellBox.x + shellBox.width &&
        labelBox.x + labelBox.width > shellBox.x;

      const elementAtPoint = await page.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          if (!el) return null;
          return {
            tag: el.tagName,
            attrs: Array.from(el.attributes).map((a) => `${a.name}=${a.value}`),
          };
        },
        {
          x: labelBox.x + labelBox.width / 2,
          y: labelBox.y + labelBox.height / 2,
        },
      );

      let clickThrew = false;
      try {
        await label.click({ timeout: 3000 });
      } catch {
        clickThrew = true;
      }

      if (clickThrew && !overlapsShell) {
        const trace = await dumpTrace(page);
        test.info().annotations.push({
          type: "trace",
          description: JSON.stringify({
            note: "click failed without geometric overlap",
            trace,
          }),
        });
      }

      expect(clickThrew).toBe(false);
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });
});

test.describe("alt-drag board auto-layout frames to empty board", () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test("copies a root auto-layout Frame as a selected board-root layer and preserves its original", async ({
    page,
    request,
  }) => {
    const designId = await createDesignWithBoard(request);
    try {
      const result = await dragBoardLayerCopyToEmptyCanvas(
        page,
        request,
        designId,
        "root-frame",
      );
      expect(result.sourceTreeBefore.name).toBe("Frame");
      expect(
        result.sourceTreeBefore.children.map((child) => child.name),
      ).toEqual(["Frame 2", "Frame 3"]);

      const reloaded = await expectBoardCopyAfterReload(
        page,
        request,
        designId,
        result.copyId,
      );
      await expect(reloaded.copy).toBeVisible();
      expect(await readLayerTree(reloaded.original)).toEqual(
        result.originalTreeBefore,
      );
      expect(await readLayerTree(reloaded.copy)).toEqual(result.copyTree);
      expect(childNodeIds(reloaded.html, result.copyId)).toEqual(
        result.copyTree.children.map((child) => child.id),
      );
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });

  test("copies nested Frame 2 to the board root with a fresh, unclipped subtree while its source stays nested", async ({
    page,
    request,
  }) => {
    const designId = await createDesignWithBoard(request);
    try {
      const result = await dragBoardLayerCopyToEmptyCanvas(
        page,
        request,
        designId,
        "frame-2",
      );
      expect(result.sourceTreeBefore.name).toBe("Frame 2");
      expect(
        result.sourceTreeBefore.children.map((child) => child.name),
      ).toEqual(["Frame 2 child A", "Frame 2 child B"]);

      const reloaded = await expectBoardCopyAfterReload(
        page,
        request,
        designId,
        result.copyId,
      );
      const nestedOriginal = reloaded.original.locator(
        '[data-agent-native-node-id="frame-2"]',
      );
      await expect(reloaded.copy).toBeVisible();
      for (const child of result.copyTree.children) {
        await expect(
          reloaded.copy.locator(`[data-agent-native-node-id="${child.id}"]`),
        ).toBeVisible();
      }
      expect(await readLayerTree(reloaded.original)).toEqual(
        result.originalTreeBefore,
      );
      expect(await readLayerTree(nestedOriginal)).toEqual(
        result.sourceTreeBefore,
      );
      expect(await readLayerTree(reloaded.copy)).toEqual(result.copyTree);
      expect(childNodeIds(reloaded.html, "root-frame")).toEqual([
        "frame-2",
        "frame-3",
      ]);
      expect(childNodeIds(reloaded.html, result.copyId)).toEqual(
        result.copyTree.children.map((child) => child.id),
      );
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });
});
