import {
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  appPath,
  canvasZoom,
  childNodeIds,
  designFrame,
  expandAllLayers,
  gotoEditor,
} from "./helpers";
import {
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

type CanvasFrameGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  z?: number;
};

async function readCanvasFrames(
  request: APIRequestContext,
  designId: string,
): Promise<Record<string, CanvasFrameGeometry>> {
  const response = await request.get(
    appPath("/_agent-native/actions/get-design"),
    { params: { id: designId, includeFileContent: "false" } },
  );
  if (!response.ok()) {
    throw new Error(
      `get-design: ${response.status()} ${await response.text()}`,
    );
  }
  const design = await response.json();
  const data =
    typeof design.data === "string" ? JSON.parse(design.data) : design.data;
  if (!data || typeof data !== "object" || !data.canvasFrames) {
    throw new Error("get-design returned no canvas frame geometry");
  }
  return data.canvasFrames as Record<string, CanvasFrameGeometry>;
}

async function createDesign(app: App, html: string, fileCount = 1) {
  const extraFiles = Object.fromEntries(
    Array.from({ length: fileCount - 1 }, (_, index) => [
      `screen-${index + 2}.html`,
      html,
    ]),
  );
  const designId = await app.seed(html, { files: extraFiles });
  const record = await (
    await app.page.request.get(
      appPath(`/_agent-native/actions/get-design?id=${designId}`),
    )
  ).json();
  const fileIds: string[] = ["index.html", ...Object.keys(extraFiles)].map(
    (filename) =>
      record.files.find(
        (file: { filename: string }) => file.filename === filename,
      ).id,
  );
  await action(app.page.request, "update-design", {
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

const PLAIN_FRAME_WITH_ABSOLUTE_CHILD_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;width:1280px;height:900px;overflow:visible">
<main data-agent-native-node-id="exit-frame" data-agent-native-layer-name="Exit frame" data-an-primitive="frame"
      style="position:absolute;left:100px;top:100px;width:220px;height:180px;overflow:visible;background:#334155">
  <div data-agent-native-node-id="absolute-child" data-agent-native-layer-name="Absolute child"
       style="position:absolute;left:20px;top:24px;width:72px;height:52px;background:#2563eb">Child</div>
</main>
<div data-agent-native-node-id="later-sibling" data-agent-native-layer-name="Later sibling"
     style="position:absolute;left:500px;top:100px;width:120px;height:100px;background:#475569"></div>
</body></html>`;

const PLAIN_OUTER_WITH_ABSOLUTE_CHILD_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;width:1280px;height:900px;overflow:visible">
<main data-agent-native-node-id="outer-frame" data-agent-native-layer-name="Outer frame" data-an-primitive="frame"
      style="position:absolute;left:100px;top:100px;width:620px;height:300px;overflow:visible;background:#1e293b">
  <section data-agent-native-node-id="exit-frame" data-agent-native-layer-name="Exit frame" data-an-primitive="frame"
           style="position:absolute;left:20px;top:30px;width:220px;height:180px;overflow:visible;background:#334155">
    <div data-agent-native-node-id="absolute-child" data-agent-native-layer-name="Absolute child"
         style="position:absolute;left:20px;top:20px;width:120px;height:52px;background:#2563eb">Child</div>
    <div data-agent-native-node-id="absolute-peer" data-agent-native-layer-name="Absolute peer"
         style="position:absolute;left:150px;top:20px;width:50px;height:52px;background:#7c3aed">Peer</div>
  </section>
  <div data-agent-native-node-id="later-sibling" data-agent-native-layer-name="Later sibling"
       style="position:absolute;left:400px;top:40px;width:160px;height:130px;background:#475569"></div>
</main>
</body></html>`;

function boardHtml(
  options: {
    rootOverflow?: "visible" | "hidden";
    rootLayout?: "auto" | "plain";
  } = {},
) {
  const rootOverflow = options.rootOverflow ?? "visible";
  const rootLayout = options.rootLayout ?? "auto";
  const autoLayoutStyles =
    rootLayout === "auto"
      ? "display:flex;flex-direction:column;gap:12px;padding:20px;"
      : "";
  const frame2Position =
    rootLayout === "plain" ? "position:absolute;left:20px;top:20px;" : "";
  const frame3Position =
    rootLayout === "plain" ? "position:absolute;left:20px;top:210px;" : "";

  return `<!doctype html>
<html><body style="margin:0;position:relative;width:3000px;height:1200px;overflow:visible;background:transparent">
<div data-agent-native-node-id="root-frame" data-agent-native-layer-name="Frame" data-an-primitive="frame"
     style="position:absolute;left:600px;top:940px;width:440px;height:300px;box-sizing:border-box;${autoLayoutStyles}overflow:${rootOverflow};background:#334155">
  <section data-agent-native-node-id="frame-2" data-agent-native-layer-name="Frame 2" data-an-primitive="frame"
           style="${frame2Position}box-sizing:border-box;width:260px;height:160px;display:flex;flex-direction:column;gap:8px;padding:12px;background:#475569">
    <div data-agent-native-node-id="frame-2-child-a" data-agent-native-layer-name="Frame 2 child A"
         style="flex:0 0 auto;width:180px;height:48px;background:#2563eb"></div>
    <div data-agent-native-node-id="frame-2-child-b" data-agent-native-layer-name="Frame 2 child B"
         style="flex:0 0 auto;width:180px;height:48px;background:#7c3aed"></div>
  </section>
  <section data-agent-native-node-id="frame-3" data-agent-native-layer-name="Frame 3" data-an-primitive="frame"
           style="${frame3Position}box-sizing:border-box;width:260px;height:80px;background:#0f766e"></section>
</div>
</body></html>`;
}

async function createDesignWithBoard(
  app: App,
  options: {
    rootOverflow?: "visible" | "hidden";
    rootLayout?: "auto" | "plain";
  } = {},
) {
  const { designId } = await createDesign(app, NAMED_HTML);
  const request = app.page.request;
  const board = await action(request, "create-file", {
    designId,
    filename: "__board__.html",
    content: boardHtml(options),
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
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
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
  options: { withinBoardSurface?: boolean } = {},
) {
  const zoomControl = page.getByRole("button", { name: /^\d+%$/ }).first();
  await zoomControl.click();
  await page.getByRole("menuitem", { name: "Zoom to 50%" }).click();
  await expect(zoomControl).toHaveText("50%");
  const evaluateInput = {
    excludedRects,
    withinBoardSurface: options.withinBoardSurface === true,
  };
  return page.evaluate((input) => {
    const { excludedRects, withinBoardSurface } = input;
    const canvas = document.querySelector(
      "[data-multi-screen-canvas-world]",
    )?.parentElement;
    if (!canvas) return null;
    const canvasBounds = canvas.getBoundingClientRect();
    const boardSurfaceIframe = withinBoardSurface
      ? document.querySelector<HTMLIFrameElement>(
          "[data-board-surface-layer] iframe",
        )
      : null;
    const boardSurfaceBounds =
      boardSurfaceIframe?.getBoundingClientRect() ?? null;
    const iframeBounds = Array.from(
      document.querySelectorAll("iframe[data-screen-iframe-id]"),
    )
      .filter((iframe) => iframe !== boardSurfaceIframe)
      .map((iframe) => iframe.getBoundingClientRect());
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
        if (boardSurfaceBounds && !contains(boardSurfaceBounds, x, y)) {
          continue;
        }
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
        if (boardSurfaceIframe && hit !== boardSurfaceIframe) continue;
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
  }, evaluateInput);
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

async function dragBoardLayerCopyToEmptyCanvas(
  page: Page,
  request: APIRequestContext,
  designId: string,
  sourceNodeId: string,
  expectedRootFrame?: { overflow: "visible" | "hidden"; display: string },
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
  if (expectedRootFrame) {
    await expect
      .poll(() =>
        originalRoot.evaluate((element) => ({
          overflow: getComputedStyle(element).overflow,
          display: getComputedStyle(element).display,
        })),
      )
      .toEqual(expectedRootFrame);
  }
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
  const traceCountBeforeDrag = await page.evaluate(
    () => (window as any).__designTrace?.entries?.().length ?? 0,
  );
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
  const emptyPoint = await zoomOutToBoardDropPoint(page, [rootBox], {
    withinBoardSurface: true,
  });
  if (!emptyPoint) throw new Error("no unobstructed board drop point");
  expect(
    await page.evaluate(({ x, y }) => {
      const boardSurfaceIframe = document.querySelector(
        "[data-board-surface-layer] iframe",
      );
      return (
        !!boardSurfaceIframe &&
        document.elementFromPoint(x, y) === boardSurfaceIframe
      );
    }, emptyPoint),
    "same-board duplicate must be released over the board surface",
  ).toBe(true);
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

  try {
    await expect(boardRoots).toHaveCount(2, { timeout: 20_000 });
  } catch (error) {
    console.log(
      "[board-copy-trace-after-timeout]",
      JSON.stringify(
        await page.evaluate(
          (offset) =>
            (window as any).__designTrace?.entries?.().slice(offset) ?? [],
          traceCountBeforeDrag,
        ),
      ),
    );
    throw error;
  }
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
  const copyPosition = await copy.evaluate((element) => ({
    left: (element as HTMLElement).style.left,
    top: (element as HTMLElement).style.top,
  }));
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
    .slice(traceCountBeforeDrag)
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
  expect(await fileContent(request, designId, "__board__.html")).not.toContain(
    'data-agent-native-transient-drag-clone="true"',
  );
  return {
    copyId: copyInfo!.id,
    copyBox,
    copyPosition,
    copyTree,
    dropPoint: emptyPoint,
    grabOffset,
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
  expect(html).not.toContain('data-agent-native-transient-drag-clone="true"');
  return {
    html,
    original: boardFrame.locator('[data-agent-native-node-id="root-frame"]'),
    copy: boardFrame.locator(`[data-agent-native-node-id="${copyId}"]`),
  };
}

function childrenOf(nodes: Map<string, SavedNode>, parent: string) {
  return [...nodes.values()]
    .filter((node) => node.parent === parent)
    .sort((a, b) => a.index - b.index)
    .map((node) => node.id);
}

function bodyId(nodes: Map<string, SavedNode>) {
  return [...nodes.values()].find((node) => node.tag === "body")!.id;
}

function idsNamed(nodes: Map<string, SavedNode>, layerName: string) {
  return [...nodes.values()]
    .filter((node) => node.attrs["data-agent-native-layer-name"] === layerName)
    .map((node) => node.id);
}

function expectNear(
  actual: string | number | undefined,
  expected: number,
  label: string,
  tolerance = 2,
) {
  expect(
    Math.abs(parseFloat(String(actual)) - expected),
    `${label} ${actual}`,
  ).toBeLessThanOrEqual(tolerance);
}

async function openSingleScreen(app: App, html: string) {
  const { designId } = await createDesign(app, html);
  await app.open(designId);
  await app.zoomToFit();
  await app.settled();
  return designId;
}

async function altDragDesign(
  app: App,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const start = await app.pagePoint(from.x, from.y);
  const end = await app.pagePoint(to.x, to.y);
  await app.page.mouse.move(start.x, start.y);
  await app.page.keyboard.down("Alt");
  await app.page.mouse.down();
  await app.page.mouse.move(end.x, end.y, { steps: 16 });
  await app.page.mouse.up();
  await app.page.keyboard.up("Alt");
}

/** Indexes of the selected rows among the Layers rows named `name`, top row (frontmost layer) first. */
async function selectedRowsNamed(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator('[role="treeitem"]')
    .filter({
      has: page.locator(`[data-layer-row-button] span[title="${name}"]`),
    })
    .evaluateAll((rows) =>
      rows.flatMap((row, index) =>
        row.getAttribute("aria-selected") === "true" ? [index] : [],
      ),
    );
}

test.describe("alt-drag duplicate (single-screen editor)", () => {
  test("alt-drag inside a screen copies the layer directly above the original at the grab offset, selects the copy, and one undo restores the document and selection", async ({
    app,
  }) => {
    const designId = await openSingleScreen(app, SCREEN_WITH_TWO_ELEMENTS_HTML);
    const start = await app.pagePoint(215, 105);
    await app.page.mouse.click(start.x, start.y);
    await expect.poll(() => app.selectedLayers()).toEqual(["Widget"]);
    const before = await app.savedNodes(designId);

    await altDragDesign(app, { x: 215, y: 105 }, { x: 435, y: 245 });

    await expect
      .poll(
        async () => idsNamed(await app.savedNodes(designId), "Widget").length,
      )
      .toBe(2);
    await app.settled();
    const after = await app.savedNodes(designId);
    const copy = idsNamed(after, "Widget").find((id) => id !== "rect")!;
    expect(
      childrenOf(after, bodyId(after)),
      "the copy sits directly above the original",
    ).toEqual(["rect", copy, "other"]);
    const {
      left,
      top,
      background: _copyBackground,
      ...copyRest
    } = styleOf(after.get(copy));
    const {
      left: _left,
      top: _top,
      background: _background,
      ...rectRest
    } = styleOf(before.get("rect"));
    expect(copyRest).toEqual(rectRest);
    expectNear(left, 300, "copy left");
    expectNear(top, 220, "copy top");
    await expect(app.node(copy)).toHaveCSS(
      "background-color",
      "rgb(51, 170, 119)",
    );
    expectOnlyChanged(before, after, [copy]);
    await expandAllLayers(app.page);
    await expect
      .poll(
        () => selectedRowsNamed(app.page, "Widget"),
        "the copy (top Widget row) is selected",
      )
      .toEqual([0]);

    await app.page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(async () => idsNamed(await app.savedNodes(designId), "Widget"))
      .toEqual(["rect"]);
    await app.settled();
    const undone = await app.savedNodes(designId);
    expectOnlyChanged(before, undone, []);
    expect(childrenOf(undone, bodyId(undone))).toEqual(["rect", "other"]);
    await expect.poll(() => app.selectedLayers()).toEqual(["Widget"]);
  });

  test("alt-drag on an unnamed (tag-fallback-named) element: copy keeps the same computed name, not literal 'Copy'", async ({
    app,
  }) => {
    const designId = await openSingleScreen(app, UNNAMED_HTML);
    const centre = await app.pagePoint(200, 160);
    await app.page.mouse.click(centre.x, centre.y);
    const namesBefore = await layerNames(app.page);
    expect(namesBefore).toHaveLength(1);
    const before = await app.savedNodes(designId);

    await altDragDesign(app, { x: 200, y: 160 }, { x: 400, y: 310 });

    await expect.poll(async () => (await layerNames(app.page)).length).toBe(2);
    await app.settled();
    const after = await app.savedNodes(designId);
    const copy = childrenOf(after, bodyId(after)).find((id) => id !== "plain")!;
    expect(
      after.get(copy)?.attrs,
      "no stored name, so the copy computes the same fallback",
    ).not.toHaveProperty("data-agent-native-layer-name");
    expectNear(styleOf(after.get(copy)).left, 300, "copy left");
    expectNear(styleOf(after.get(copy)).top, 250, "copy top");
    expectOnlyChanged(before, after, [copy]);
    expect(await layerNames(app.page)).toEqual([
      namesBefore[0],
      namesBefore[0],
    ]);
  });
});

test.describe("alt-drag duplicate (overview)", () => {
  // fixme: product bug: After the drop the original inside the screen keeps its selection handles and '200 × 120' badge while Layers and the inspector show only
  test.fixme("alt-drag from inside a screen to outside it drops the copy on the board, does not duplicate in place", async ({
    app,
  }) => {
    const page = app.page;
    const { designId } = await createDesign(app, NAMED_HTML);
    await openOverview(page, designId, 1);
    const dropPoint = await zoomOutToBoardDropPoint(page);
    if (!dropPoint) throw new Error("no unobstructed board drop point");
    await app.settled();
    const source = page
      .locator("iframe[data-screen-iframe-id]")
      .first()
      .contentFrame()
      .locator('[data-agent-native-node-id="rect"]');
    const sourceBox = (await source.boundingBox())!;
    const grab = {
      x: sourceBox.x + sourceBox.width / 2,
      y: sourceBox.y + sourceBox.height / 2,
    };
    await page.mouse.click(grab.x, grab.y);
    await expect.poll(() => app.selectedLayers()).toEqual(["Widget"]);
    const screenBefore = await app.savedNodes(designId);
    const boardBefore = await app.savedNodes(designId, "__board__.html");

    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 24 });
    await page.mouse.up();
    await page.keyboard.up("Alt");

    await expect
      .poll(
        async () =>
          idsNamed(await app.savedNodes(designId, "__board__.html"), "Widget")
            .length,
      )
      .toBe(1);
    await app.settled();
    const boardAfter = await app.savedNodes(designId, "__board__.html");
    const [copy] = idsNamed(boardAfter, "Widget");
    expect(boardAfter.get(copy)?.parent).toBe(bodyId(boardAfter));
    expect(styleOf(boardAfter.get(copy))).toMatchObject({
      position: "absolute",
      width: "200px",
      height: "120px",
    });
    expectOnlyChanged(boardBefore, boardAfter, [copy]);
    expectOnlyChanged(screenBefore, await app.savedNodes(designId), []);
    const copyBox = (await page
      .locator("[data-board-surface-layer] iframe")
      .first()
      .contentFrame()
      .locator(`[data-agent-native-node-id="${copy}"]`)
      .boundingBox())!;
    expectNear(copyBox.x + copyBox.width / 2, dropPoint.x, "copy centre x", 5);
    expectNear(copyBox.y + copyBox.height / 2, dropPoint.y, "copy centre y", 5);
    await expect(
      page.locator("text=/can.?t (reorder|duplicate|drop)/i"),
    ).toHaveCount(0);
    await expect(
      page.locator("[data-board-object-selection-box]"),
      "the board copy is selected",
    ).toHaveCount(1);
    await expect(
      page
        .locator("iframe[data-screen-iframe-id]")
        .first()
        .contentFrame()
        .getByText(/^\d+ × \d+$/),
      "the original in the screen no longer shows selection chrome",
    ).toBeHidden();
  });

  // fixme: product bug: The copy of the screen shown as 'Home' is titled 'Index copy' (derived from index.html), not 'Home copy'. Position and collateral checks
  test.fixme("alt-drag a screen by its label copies it by the drag offset, named after the screen, and leaves the original untouched", async ({
    app,
  }) => {
    const page = app.page;
    const { designId, fileIds } = await createDesign(app, NAMED_HTML, 1);
    await openOverview(page, designId, 1);
    await app.settled();
    await page.locator("[data-frame-label]").first().click();
    const dragSurface = page.locator("[data-frame-drag-surface]");
    await expect(dragSurface).toBeVisible();
    let previous = "";
    await expect
      .poll(
        async () => {
          const now = JSON.stringify(await dragSurface.boundingBox());
          const stable = now === previous;
          previous = now;
          return stable;
        },
        { message: "the camera never settled after selecting the screen" },
      )
      .toBe(true);
    const zoom = await canvasZoom(page);
    const box = (await dragSurface.boundingBox())!;
    const view = page.viewportSize()!;
    const start = {
      x: (Math.max(box.x, 0) + Math.min(box.x + box.width, view.width)) / 2,
      y: (Math.max(box.y, 0) + Math.min(box.y + box.height, view.height)) / 2,
    };
    const beforeFrames = await readCanvasFrames(app.page.request, designId);
    const sourceFrame = beforeFrames[fileIds[0]!]!;
    const sourceNodes = await app.savedNodes(designId);

    await page.mouse.move(start.x, start.y);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(start.x + 220, start.y + 140, { steps: 12 });
    await expect(page.locator("[data-duplicate-preview-ghost]")).toBeVisible();
    await page.mouse.up();
    await page.keyboard.up("Alt");

    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await expect
      .poll(
        async () =>
          Object.keys(await readCanvasFrames(app.page.request, designId))
            .length,
      )
      .toBe(2);
    await app.settled();
    const afterFrames = await readCanvasFrames(app.page.request, designId);
    const copyId = Object.keys(afterFrames).find((id) => id !== fileIds[0])!;
    expect(
      afterFrames[fileIds[0]!],
      "the original screen did not move",
    ).toEqual(sourceFrame);
    expect({
      width: afterFrames[copyId]!.width,
      height: afterFrames[copyId]!.height,
    }).toEqual({
      width: sourceFrame.width,
      height: sourceFrame.height,
    });
    expectNear(afterFrames[copyId]!.x, sourceFrame.x + 220 / zoom, "copy x");
    expectNear(afterFrames[copyId]!.y, sourceFrame.y + 140 / zoom, "copy y");
    expectOnlyChanged(sourceNodes, await app.savedNodes(designId), []);
    const copyTitle = page.locator(
      `[data-frame-id="${copyId}"] [data-frame-title]`,
    );
    await expect(
      page.locator(`[data-frame-id="${fileIds[0]}"] [data-frame-title]`),
    ).toHaveText("Home");
    await expect(
      copyTitle,
      "a copy of the screen shown as Home is named after Home",
    ).toHaveText("Home copy");
  });
});

test.describe("alt-drag board auto-layout frames to empty board", () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test("copies a root auto-layout Frame as a selected board-root layer and preserves its original", async ({
    app,
    page,
    request,
  }) => {
    const designId = await createDesignWithBoard(app);
    const result = await dragBoardLayerCopyToEmptyCanvas(
      page,
      request,
      designId,
      "root-frame",
    );
    expect(result.sourceTreeBefore.name).toBe("Frame");
    expect(result.sourceTreeBefore.children.map((child) => child.name)).toEqual(
      ["Frame 2", "Frame 3"],
    );

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
  });

  test("copies nested Frame 2 to the board root with a fresh, unclipped subtree while its source stays nested", async ({
    app,
    page,
    request,
  }) => {
    const designId = await createDesignWithBoard(app);
    const result = await dragBoardLayerCopyToEmptyCanvas(
      page,
      request,
      designId,
      "frame-2",
    );
    expect(result.sourceTreeBefore.name).toBe("Frame 2");
    expect(result.sourceTreeBefore.children.map((child) => child.name)).toEqual(
      ["Frame 2 child A", "Frame 2 child B"],
    );

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
  });

  test("copies a deeply nested flow child through a plain clipped board frame to the board root", async ({
    app,
    page,
    request,
  }) => {
    const designId = await createDesignWithBoard(app, {
      rootOverflow: "hidden",
      rootLayout: "plain",
    });
    const result = await dragBoardLayerCopyToEmptyCanvas(
      page,
      request,
      designId,
      "frame-2-child-a",
      { overflow: "hidden", display: "block" },
    );
    expect(result.sourceTreeBefore.name).toBe("Frame 2 child A");

    const reloaded = await expectBoardCopyAfterReload(
      page,
      request,
      designId,
      result.copyId,
    );
    await expect(reloaded.copy).toBeVisible();
    expect(
      await reloaded.original.evaluate((element) => ({
        overflow: getComputedStyle(element).overflow,
        display: getComputedStyle(element).display,
      })),
    ).toEqual({ overflow: "hidden", display: "block" });
    expect(
      await reloaded.copy.evaluate((element) => element.parentElement),
    ).toBeTruthy();
    expect(
      await reloaded.copy.evaluate(
        (element) => element.parentElement === element.ownerDocument.body,
      ),
    ).toBe(true);
    expect(
      await reloaded.original
        .locator('[data-agent-native-node-id="frame-2-child-a"]')
        .evaluate((element) =>
          element.parentElement?.getAttribute("data-agent-native-node-id"),
        ),
    ).toBe("frame-2");
    expect(
      await readLayerTree(
        reloaded.original.locator(
          '[data-agent-native-node-id="frame-2-child-a"]',
        ),
      ),
    ).toEqual(result.sourceTreeBefore);
    expect(await readLayerTree(reloaded.copy)).toEqual(result.copyTree);
    expect(
      await reloaded.copy.evaluate((element) => ({
        left: (element as HTMLElement).style.left,
        top: (element as HTMLElement).style.top,
      })),
    ).toEqual(result.copyPosition);
    expect(result.copyBox.x).toBeCloseTo(
      result.dropPoint.x - result.grabOffset.x,
      -1,
    );
    expect(result.copyBox.y).toBeCloseTo(
      result.dropPoint.y - result.grabOffset.y,
      -1,
    );
  });
});

test.describe("absolute child exit from a plain frame", () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test("moves an absolute child into empty parent space directly after its exited frame", async ({
    app,
    page,
    request,
  }) => {
    const { designId } = await createDesign(
      app,
      PLAIN_FRAME_WITH_ABSOLUTE_CHILD_HTML,
    );
    await gotoEditor(page, designId);
    const frame = designFrame(page);
    const child = frame.locator('[data-agent-native-node-id="absolute-child"]');
    const exitFrame = frame.locator('[data-agent-native-node-id="exit-frame"]');
    const laterSibling = frame.locator(
      '[data-agent-native-node-id="later-sibling"]',
    );
    await expect(child).toBeVisible();
    const [childBox, frameBox, laterBox] = await Promise.all([
      child.boundingBox(),
      exitFrame.boundingBox(),
      laterSibling.boundingBox(),
    ]);
    if (!childBox || !frameBox || !laterBox) {
      throw new Error("plain-frame exit fixture nodes need rendered bounds");
    }
    const zoom = await canvasZoom(page);
    const grabOffset = { x: childBox.width / 2, y: childBox.height / 2 };
    const start = {
      x: childBox.x + grabOffset.x,
      y: childBox.y + grabOffset.y,
    };
    const release = {
      x: frameBox.x + frameBox.width + 48 * zoom,
      y: frameBox.y + frameBox.height / 2,
    };
    expect(release.x).toBeLessThan(laterBox.x);
    const expectedPosition = {
      x: release.x - grabOffset.x,
      y: release.y - grabOffset.y,
    };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 8, start.y + 6, { steps: 2 });
    await page.mouse.move(release.x, release.y, { steps: 16 });
    await page.mouse.up();

    const bodyRoots = frame.locator("body > [data-agent-native-node-id]");
    await expect(bodyRoots).toHaveCount(3, { timeout: 15_000 });
    const order = await bodyRoots.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-agent-native-node-id")),
    );
    expect(order).toEqual(["exit-frame", "absolute-child", "later-sibling"]);
    await expect
      .poll(() => child.evaluate((element) => element.parentElement?.tagName))
      .toBe("BODY");
    const movedBox = await child.boundingBox();
    expect(movedBox).not.toBeNull();
    expect(movedBox!.x).toBeCloseTo(expectedPosition.x, -1);
    expect(movedBox!.y).toBeCloseTo(expectedPosition.y, -1);
    const savedInlinePosition = await child.evaluate((element) => ({
      left: (element as HTMLElement).style.left,
      top: (element as HTMLElement).style.top,
    }));

    await expect
      .poll(() => fileContent(request, designId, "index.html"))
      .toContain('data-agent-native-node-id="absolute-child"');
    await gotoEditor(page, designId);
    const reloadedFrame = designFrame(page);
    const reloadedChild = reloadedFrame.locator(
      '[data-agent-native-node-id="absolute-child"]',
    );
    await expect(
      reloadedFrame.locator("body > [data-agent-native-node-id]"),
    ).toHaveCount(3);
    await expect
      .poll(() =>
        reloadedChild.evaluate((element) => element.parentElement?.tagName),
      )
      .toBe("BODY");
    expect(
      await reloadedChild.evaluate((element) => ({
        left: (element as HTMLElement).style.left,
        top: (element as HTMLElement).style.top,
      })),
    ).toEqual(savedInlinePosition);
    const persisted = await fileContent(request, designId, "index.html");
    const persistedOrder = await page.evaluate((html) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      return Array.from(doc.body.children).map((node) =>
        node.getAttribute("data-agent-native-node-id"),
      );
    }, persisted);
    expect(persistedOrder).toEqual(order);
  });

  test("keeps an absolute child directly after its exited frame in a plain receiver", async ({
    app,
    page,
    request,
  }) => {
    const { designId } = await createDesign(
      app,
      PLAIN_OUTER_WITH_ABSOLUTE_CHILD_HTML,
    );
    await gotoEditor(page, designId);
    const frame = designFrame(page);
    const outer = frame.locator('[data-agent-native-node-id="outer-frame"]');
    const exitFrame = frame.locator('[data-agent-native-node-id="exit-frame"]');
    const child = frame.locator('[data-agent-native-node-id="absolute-child"]');
    const laterSibling = frame.locator(
      '[data-agent-native-node-id="later-sibling"]',
    );
    await expect(child).toBeVisible();
    await expandAllLayers(page);
    const childRow = page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button]")
      .filter({ has: page.locator('span[title="Absolute child"]') })
      .first();
    await childRow.click({ force: true });
    await expect(
      childRow.locator('xpath=ancestor::*[@role="treeitem"][1]'),
    ).toHaveAttribute("aria-selected", "true");
    const [outerBox, childBox, laterBox] = await Promise.all([
      outer.boundingBox(),
      child.boundingBox(),
      laterSibling.boundingBox(),
    ]);
    if (!outerBox || !childBox || !laterBox) {
      throw new Error("absolute-child exit fixture nodes need rendered bounds");
    }
    const zoom = await canvasZoom(page);
    const grabOffset = { x: childBox.width / 2, y: childBox.height / 2 };
    const start = {
      x: childBox.x + grabOffset.x,
      y: childBox.y + grabOffset.y,
    };
    const release = {
      x: outerBox.x + 380 * zoom,
      y: outerBox.y + 100 * zoom,
    };
    expect(release.x).toBeLessThan(laterBox.x);
    const beforeDrop = await fileContent(request, designId, "index.html");

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 8, start.y + 6, { steps: 2 });
    await page.mouse.move(release.x, release.y, { steps: 16 });
    expect(await fileContent(request, designId, "index.html")).toBe(beforeDrop);
    await page.mouse.up();

    const directChildren = () =>
      outer.evaluate((element) =>
        Array.from(element.children).map((child) =>
          child.getAttribute("data-agent-native-node-id"),
        ),
      );
    await expect
      .poll(directChildren)
      .toEqual(["exit-frame", "absolute-child", "later-sibling"]);
    await expect
      .poll(() =>
        child.evaluate((element) =>
          element.parentElement?.getAttribute("data-agent-native-node-id"),
        ),
      )
      .toBe("outer-frame");
    const movedBox = await child.boundingBox();
    expect(movedBox).not.toBeNull();
    expect(movedBox!.x).toBeCloseTo(release.x - grabOffset.x, -1);
    expect(movedBox!.y).toBeCloseTo(release.y - grabOffset.y, -1);
    const overlapProof = await child.evaluate((element) => {
      const childBox = element.getBoundingClientRect();
      const later = element.ownerDocument.querySelector<HTMLElement>(
        '[data-agent-native-node-id="later-sibling"]',
      );
      if (!later) return { hitNodeId: null, laterFound: false };
      const laterBox = later.getBoundingClientRect();
      const x =
        (Math.max(childBox.left, laterBox.left) +
          Math.min(childBox.right, laterBox.right)) /
        2;
      const y =
        (Math.max(childBox.top, laterBox.top) +
          Math.min(childBox.bottom, laterBox.bottom)) /
        2;
      const shields = Array.from(
        element.ownerDocument.querySelectorAll<HTMLElement>(
          '[data-agent-native-edit-overlay="shield"]',
        ),
      );
      const pointerEvents = shields.map((shield) => shield.style.pointerEvents);
      shields.forEach((shield) => {
        shield.style.pointerEvents = "none";
      });
      let hit: Element | null = null;
      try {
        hit = element.ownerDocument.elementFromPoint(x, y);
      } finally {
        shields.forEach((shield, index) => {
          shield.style.pointerEvents = pointerEvents[index] ?? "";
        });
      }
      return {
        hitNodeId: hit?.getAttribute("data-agent-native-node-id") ?? null,
        hitTag: hit?.tagName ?? null,
        hitClass: hit?.getAttribute("class") ?? null,
        hitHtml: hit?.outerHTML ?? null,
        point: { x, y },
        childBox: {
          left: childBox.left,
          right: childBox.right,
          top: childBox.top,
          bottom: childBox.bottom,
        },
        laterBox: {
          left: laterBox.left,
          right: laterBox.right,
          top: laterBox.top,
          bottom: laterBox.bottom,
        },
        viewport: {
          width: element.ownerDocument.documentElement.clientWidth,
          height: element.ownerDocument.documentElement.clientHeight,
        },
      };
    });
    expect(overlapProof.hitNodeId, JSON.stringify(overlapProof)).toBe(
      "later-sibling",
    );

    const persistedChildren = async () => {
      const html = await fileContent(request, designId, "index.html");
      return page.evaluate((source) => {
        const document = new DOMParser().parseFromString(source, "text/html");
        const persistedOuter = document.querySelector<HTMLElement>(
          '[data-agent-native-node-id="outer-frame"]',
        );
        return Array.from(persistedOuter?.children ?? []).map((child) =>
          child.getAttribute("data-agent-native-node-id"),
        );
      }, html);
    };
    await expect
      .poll(persistedChildren)
      .toEqual(["exit-frame", "absolute-child", "later-sibling"]);
    const savedHtml = await fileContent(request, designId, "index.html");

    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(() => fileContent(request, designId, "index.html"))
      .toBe(beforeDrop);
    await expect
      .poll(() =>
        child.evaluate((element) =>
          element.parentElement?.getAttribute("data-agent-native-node-id"),
        ),
      )
      .toBe("exit-frame");

    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(() => fileContent(request, designId, "index.html"))
      .toBe(savedHtml);
    await expect
      .poll(directChildren)
      .toEqual(["exit-frame", "absolute-child", "later-sibling"]);

    await gotoEditor(page, designId);
    const reloadedFrame = designFrame(page);
    const reloadedOuter = reloadedFrame.locator(
      '[data-agent-native-node-id="outer-frame"]',
    );
    await expect
      .poll(() =>
        reloadedOuter.evaluate((element) =>
          Array.from(element.children).map((child) =>
            child.getAttribute("data-agent-native-node-id"),
          ),
        ),
      )
      .toEqual(["exit-frame", "absolute-child", "later-sibling"]);
    await expect
      .poll(() =>
        reloadedFrame
          .locator('[data-agent-native-node-id="absolute-child"]')
          .evaluate((element) =>
            element.parentElement?.getAttribute("data-agent-native-node-id"),
          ),
      )
      .toBe("outer-frame");
    expect(await fileContent(request, designId, "index.html")).toBe(savedHtml);
  });

  test("preserves selected sibling order when dragging absolute layers out together", async ({
    app,
  }) => {
    const designId = await openSingleScreen(
      app,
      PLAIN_OUTER_WITH_ABSOLUTE_CHILD_HTML,
    );
    const childCentre = await app.pagePoint(200, 176);
    const grab = await app.pagePoint(295, 176);
    await app.page.mouse.click(childCentre.x, childCentre.y);
    await app.page.keyboard.down("Shift");
    await app.page.mouse.click(grab.x, grab.y);
    await app.page.keyboard.up("Shift");
    await expect
      .poll(() => app.selectedLayers())
      .toEqual(["Absolute peer", "Absolute child"]);
    const before = await app.savedNodes(designId);
    expect(childrenOf(before, "exit-frame")).toEqual([
      "absolute-child",
      "absolute-peer",
    ]);
    const beforeDrop = await app.savedHtml(designId);

    // The release keeps every edge of the pair clear of the snap lines of the frames around it.
    const release = await app.pagePoint(585, 355);
    await app.page.mouse.move(grab.x, grab.y);
    await app.page.mouse.down();
    await app.page.mouse.move(grab.x + 8, grab.y + 6, { steps: 2 });
    await app.page.mouse.move(release.x, release.y, { steps: 16 });
    expect(await app.savedHtml(designId)).toBe(beforeDrop);
    await app.page.mouse.up();

    await expect
      .poll(async () =>
        childrenOf(await app.savedNodes(designId), "outer-frame"),
      )
      .toEqual([
        "exit-frame",
        "absolute-child",
        "absolute-peer",
        "later-sibling",
      ]);
    await app.settled();
    const after = await app.savedNodes(designId);
    expect(childrenOf(after, "exit-frame")).toEqual([]);
    for (const [id, left, top, color] of [
      ["absolute-child", 330, 229, "rgb(37, 99, 235)"],
      ["absolute-peer", 460, 229, "rgb(124, 58, 237)"],
    ] as const) {
      const {
        left: savedLeft,
        top: savedTop,
        background: _background,
        ...rest
      } = styleOf(after.get(id));
      const {
        left: _left,
        top: _top,
        background: _backgroundBefore,
        ...restBefore
      } = styleOf(before.get(id));
      expect(rest, `${id} keeps its other styles`).toEqual(restBefore);
      expectNear(savedLeft, left, `${id} saved left`);
      expectNear(savedTop, top, `${id} saved top`);
      await expect(app.node(id)).toHaveCSS("background-color", color);
    }
    expectOnlyChanged(before, after, ["absolute-child", "absolute-peer"]);
    const child = await app.designRect("absolute-child");
    const peer = await app.designRect("absolute-peer");
    expectNear(child.x, 430, "child rendered x");
    expectNear(child.y, 329, "child rendered y");
    expectNear(peer.x, 560, "peer rendered x");
    expectNear(peer.y, 329, "peer rendered y");
    expect([child.width, child.height, peer.width, peer.height]).toEqual([
      120, 52, 50, 52,
    ]);
  });
});
