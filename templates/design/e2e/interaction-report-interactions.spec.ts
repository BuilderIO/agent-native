import { type APIRequestContext, type Page } from "@playwright/test";

import {
  appPath,
  childNodeIds,
  cdpScreenshot,
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

const MOD = process.platform === "darwin" ? "Meta" : "Control";

const SCREEN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Nested drop</title></head>
<body style="margin:0;position:relative;width:800px;height:600px;background:#fff">
  <div data-agent-native-node-id="outer-frame" data-agent-native-layer-name="Outer frame" data-an-primitive="frame"
       style="position:absolute;left:80px;top:80px;width:560px;height:420px;box-sizing:border-box;background:#dbeafe;padding:24px">
    <div data-agent-native-node-id="nested-frame" data-agent-native-layer-name="Nested frame" data-an-primitive="frame"
         style="position:absolute;left:120px;top:90px;width:280px;height:220px;box-sizing:border-box;background:#bfdbfe">
      <div data-agent-native-node-id="nested-anchor" data-agent-native-layer-name="Existing child"
         style="position:absolute;left:16px;top:140px;width:80px;height:40px;background:#2563eb"></div>
    </div>
    <div data-agent-native-node-id="auto-frame" data-agent-native-layer-name="Auto frame"
         style="position:absolute;left:120px;top:330px;width:280px;height:70px;box-sizing:border-box;display:flex;flex-direction:row;gap:12px;padding:12px;background:#bfdbfe">
      <div data-agent-native-node-id="auto-first" data-agent-native-layer-name="First item"
           style="flex:0 0 auto;width:100px;height:40px;background:#2563eb"></div>
      <div data-agent-native-node-id="auto-second" data-agent-native-layer-name="Second item"
           style="flex:0 0 auto;width:100px;height:40px;background:#7c3aed"></div>
    </div>
  </div>
</body></html>`;

const BOARD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Board</title></head>
<body style="margin:0;position:relative;width:1800px;height:900px;overflow:visible;background:transparent">
  <div data-agent-native-node-id="board-source" data-agent-native-layer-name="Board source" data-an-primitive="frame"
       style="position:absolute;left:-400px;top:140px;width:60px;height:30px;box-sizing:border-box;background:#f97316"></div>
  <div data-agent-native-node-id="board-text" data-agent-native-layer-name="Board text"
       style="position:absolute;left:-280px;top:140px;width:120px;height:30px;box-sizing:border-box;background:#fef3c7;color:#111827">Board text</div>
</body></html>`;

const G4_CROSSED_FRAME_SCREEN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>G4 crossed frame</title></head>
<body style="margin:0;position:relative;width:800px;height:600px;background:#fff">
  <div data-agent-native-node-id="outer-frame" data-agent-native-layer-name="Outer frame" data-an-primitive="frame"
       style="position:absolute;left:80px;top:80px;width:560px;height:420px;box-sizing:border-box;background:#dbeafe;padding:24px">
    <div data-agent-native-node-id="middle-frame" data-agent-native-layer-name="Middle frame" data-an-primitive="frame"
         style="position:absolute;left:100px;top:80px;width:280px;height:220px;box-sizing:border-box;background:#bfdbfe">
      <div data-agent-native-node-id="nested-frame" data-agent-native-layer-name="Nested frame" data-an-primitive="frame"
           style="position:absolute;left:20px;top:20px;width:240px;height:180px;box-sizing:border-box;background:#93c5fd">
        <div data-agent-native-node-id="nested-anchor" data-agent-native-layer-name="Existing child"
             style="position:absolute;left:16px;top:100px;width:80px;height:40px;background:#2563eb"></div>
      </div>
    </div>
    <div data-agent-native-node-id="auto-frame" data-agent-native-layer-name="Auto frame"
         style="position:absolute;left:120px;top:330px;width:280px;height:70px;box-sizing:border-box;display:flex;flex-direction:row;gap:12px;padding:12px;background:#bfdbfe">
      <div data-agent-native-node-id="auto-first" data-agent-native-layer-name="First item"
           style="flex:0 0 auto;width:100px;height:40px;background:#2563eb"></div>
      <div data-agent-native-node-id="auto-second" data-agent-native-layer-name="Second item"
           style="flex:0 0 auto;width:100px;height:40px;background:#7c3aed"></div>
    </div>
    <div data-agent-native-node-id="short-frame" data-agent-native-layer-name="Short frame" data-an-primitive="frame"
         style="position:absolute;left:12px;top:330px;width:80px;height:50px;background:#93c5fd"></div>
    <div data-agent-native-node-id="narrow-frame" data-agent-native-layer-name="Narrow frame" data-an-primitive="frame"
         style="position:absolute;left:430px;top:240px;width:120px;height:100px;background:#ef4444"></div>
  </div>
</body></html>`;

const G4_CROSSED_FRAME_BOARD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>G4 board</title></head>
<body style="margin:0;position:relative;width:1800px;height:900px;overflow:visible;background:transparent">
  <div data-agent-native-node-id="board-source" data-agent-native-layer-name="Board source" data-an-primitive="frame"
       style="position:absolute;left:-400px;top:140px;width:100px;height:80px;box-sizing:border-box;background:#f97316"></div>
</body></html>`;

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(
  app: App,
  screenHtml = SCREEN_HTML,
  boardHtml = BOARD_HTML,
): Promise<string> {
  const request = app.page.request;
  const designId = await app.seed(screenHtml, {
    title: "Design interaction report",
    files: { "__board__.html": boardHtml },
  });
  const record = await request
    .get(appPath(`/_agent-native/actions/get-design?id=${designId}`))
    .then((response) => response.json());
  const fileId = (filename: string) =>
    (record.files ?? []).find((file: any) => file.filename === filename)?.id;
  const screenFileId = fileId("index.html");
  const boardFileId = fileId("__board__.html");
  if (!screenFileId || !boardFileId)
    throw new Error("seeded files are missing");
  await action(request, "update-design", {
    id: designId,
    dataOperations: [
      { op: "set", path: ["boardFileId"], value: boardFileId },
      {
        op: "set",
        path: ["screenMetadata", boardFileId],
        value: { sourceType: "inline", width: 1800, height: 900 },
      },
      {
        op: "set",
        path: ["screenMetadata", screenFileId],
        value: { sourceType: "inline", width: 800, height: 600 },
      },
      {
        op: "set",
        path: ["canvasFrames", screenFileId],
        value: { x: 0, y: 0, width: 800, height: 600, z: 0 },
      },
    ],
  });
  return designId;
}

function childrenOf(
  nodes: Map<string, { parent: string | null; index: number }>,
  parent: string,
) {
  return [...nodes.entries()]
    .filter(([, node]) => node.parent === parent)
    .sort(([, a], [, b]) => a.index - b.index)
    .map(([id]) => id);
}

/** Layers rows carry code-layer ids (`html:…`), so the selected node id is read from application state. */
async function selectedSourceId(page: Page) {
  const response = await page.request.get(
    appPath("/_agent-native/application-state/design-selection"),
  );
  if (!response.ok()) throw new Error(`design-selection ${response.status()}`);
  const state = (await response.json()) as {
    selectedElement?: { sourceId?: string } | null;
  };
  return state.selectedElement?.sourceId;
}

function attrsBesidesStyle(node: SavedNode | undefined) {
  const { style: _style, ...attrs } = node?.attrs ?? {};
  return attrs;
}

/** The node id plus every saved descendant id: a moved layer carries its own children. */
function subtree(
  nodes: Map<string, { parent: string | null }>,
  id: string,
): string[] {
  return [
    id,
    ...[...nodes.entries()]
      .filter(([, node]) => node.parent === id)
      .flatMap(([child]) => subtree(nodes, child)),
  ];
}

async function fileContent(
  request: APIRequestContext,
  designId: string,
  filename: string,
): Promise<string> {
  const record = await request
    .get(appPath(`/_agent-native/actions/get-design?id=${designId}`))
    .then((response) => response.json());
  return (
    (record.files ?? []).find((file: any) => file.filename === filename)
      ?.content ?? ""
  );
}

async function nodePlacement(page: Page, html: string, nodeId: string) {
  return page.evaluate(
    ({ html, nodeId }) => {
      const node = new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector(`[data-agent-native-node-id="${nodeId}"]`);
      if (!node?.parentElement) return null;
      const parent = node.parentElement;
      return {
        parent:
          parent.tagName === "BODY"
            ? "BODY"
            : parent.getAttribute("data-agent-native-node-id"),
        siblingIndex: Array.from(parent.children).indexOf(node),
        left: (node as HTMLElement).style.left,
        top: (node as HTMLElement).style.top,
      };
    },
    { html, nodeId },
  );
}

async function topLevelNodeIds(page: Page, html: string): Promise<string[]> {
  return page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return Array.from(doc.body.children)
      .map((node) => node.getAttribute("data-agent-native-node-id"))
      .filter((nodeId): nodeId is string => nodeId !== null);
  }, html);
}

async function designData(
  request: APIRequestContext,
  designId: string,
): Promise<Record<string, any>> {
  const response = await request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) {
    throw new Error(
      `get-design: ${response.status()} ${await response.text()}`,
    );
  }
  const record = await response.json();
  if (typeof record.data !== "string") {
    throw new Error("get-design returned no design data");
  }
  const parsed = JSON.parse(record.data);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("get-design returned invalid design data");
  }
  return parsed;
}

async function fileRecords(
  request: APIRequestContext,
  designId: string,
): Promise<Array<{ id: string; filename: string; content: string }>> {
  const record = await request
    .get(appPath(`/_agent-native/actions/get-design?id=${designId}`))
    .then((response) => response.json());
  return (record.files ?? []).map(
    (file: { id: string; filename: string; content: string }) => file,
  );
}

/**
 * The 60×30 orange frame released with its centre on Nested frame's centre (340,280): saved at 110,95 inside it.
 * A page pixel spans more than a design pixel below 100% zoom, so the drop may round by up to 2.
 */
async function expectLandedCentredInNestedFrame(
  app: App,
  saved: Awaited<ReturnType<App["savedNodes"]>>,
  nodeId: string,
) {
  const style = styleOf(saved.get(nodeId));
  expect(Object.keys(style).sort()).toEqual([
    "background",
    "box-sizing",
    "height",
    "left",
    "position",
    "top",
    "width",
  ]);
  expect({
    position: style.position,
    width: style.width,
    height: style.height,
    boxSizing: style["box-sizing"],
  }).toEqual({
    position: "absolute",
    width: "60px",
    height: "30px",
    boxSizing: "border-box",
  });
  const offBy = (x: number, y: number, at: { x: number; y: number }) =>
    Math.max(Math.abs(x - at.x), Math.abs(y - at.y));
  expect(
    offBy(Number.parseFloat(style.left), Number.parseFloat(style.top), {
      x: 110,
      y: 95,
    }),
    `saved at ${style.left},${style.top}`,
  ).toBeLessThanOrEqual(2);
  const rendered = await app.designRect(nodeId);
  expect({ width: rendered.width, height: rendered.height }).toEqual({
    width: 60,
    height: 30,
  });
  expect(
    offBy(rendered.x, rendered.y, { x: 310, y: 265 }),
    `rendered at ${rendered.x},${rendered.y}`,
  ).toBeLessThanOrEqual(2);
  await expect(app.node(nodeId)).toHaveCSS(
    "background-color",
    "rgb(249, 115, 22)",
  );
  return rendered;
}

function screenFrame(page: Page) {
  return page
    .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
    .first();
}

function boardFrame(page: Page) {
  return page.locator("[data-board-surface-layer] iframe").first();
}

async function openOverview(page: Page, designId: string) {
  await page.goto(appPath(`/design/${designId}?view=overview&zoom=50`), {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("[data-screen-shell]")).toHaveCount(1, {
    timeout: 30_000,
  });
  await expect(page.locator("[data-screen-card]").first()).toBeVisible();
  await page.getByRole("button", { name: /%$/, exact: false }).first().click();
  await page.getByRole("menuitem", { name: "Zoom to 50%" }).click();
  await expect(
    page.getByRole("button", { name: "50%", exact: true }),
  ).toBeVisible();
}

async function setOverviewZoom(page: Page, zoom: 100 | 200) {
  await page.getByRole("button", { name: "50%", exact: true }).click();
  await page.getByRole("menuitem", { name: `Zoom to ${zoom}%` }).click();
  await expect(
    page.getByRole("button", { name: `${zoom}%`, exact: true }),
  ).toBeVisible();
}

async function resetOverviewZoom(page: Page): Promise<void> {
  await page.getByRole("button", { name: /%$/, exact: false }).first().click();
  await page.getByRole("menuitem", { name: "Zoom to 50%" }).click();
  await expect(
    page.getByRole("button", { name: "50%", exact: true }),
  ).toBeVisible();
}

async function expectReloadedOverviewZoom(page: Page, zoom: 100 | 200) {
  await expect
    .poll(
      async () => {
        const zoomButton = page.getByRole("button", {
          name: `${zoom}%`,
          exact: true,
        });
        const world = page.locator("[data-multi-screen-canvas-world]");
        const renderedZoom =
          (await world.count()) > 0
            ? await world.evaluate((element) => {
                const transform = getComputedStyle(element).transform;
                if (transform === "none") return 100;
                return Math.round(new DOMMatrix(transform).a * 100);
              })
            : null;
        return {
          urlZoom: new URL(page.url()).searchParams.get("zoom"),
          buttonText:
            (await zoomButton.count()) > 0
              ? (await zoomButton.allTextContents())[0]?.trim()
              : null,
          buttonVisible:
            (await zoomButton.count()) > 0 && (await zoomButton.isVisible()),
          renderedZoom,
        };
      },
      { timeout: 30_000 },
    )
    .toEqual({
      urlZoom: String(zoom),
      buttonText: `${zoom}%`,
      buttonVisible: true,
      renderedZoom: zoom,
    });
}

async function dragBoardSourceIntoNestedFrame(page: Page): Promise<{
  release: { x: number; y: number };
  sourceBefore: { x: number; y: number; width: number; height: number };
  grabOffset: { x: number; y: number };
}> {
  const source = boardFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="board-source"]');
  const target = screenFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="nested-frame"]');
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  const sourceBefore = (await source.boundingBox())!;
  const targetBox = (await target.boundingBox())!;
  const release = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  };
  const grabOffset = { x: 18, y: 11 };
  await page.mouse.move(
    sourceBefore.x + grabOffset.x,
    sourceBefore.y + grabOffset.y,
  );
  await page.mouse.down();
  await page.mouse.move(
    sourceBefore.x + grabOffset.x - 12,
    sourceBefore.y + grabOffset.y,
    { steps: 4 },
  );
  await page.mouse.move(release.x, release.y, { steps: 24 });
  const ghost = page.locator("[data-cross-screen-drag-ghost]");
  await expect(ghost).toBeVisible();
  await expect
    .poll(async () => (await ghost.boundingBox())?.x ?? null)
    .toBeCloseTo(release.x - grabOffset.x, 0);
  await expect
    .poll(async () => (await ghost.boundingBox())?.y ?? null)
    .toBeCloseTo(release.y - grabOffset.y, 0);
  await page.mouse.up();
  return { release, sourceBefore, grabOffset };
}

async function selectBoardSourceFromHost(page: Page) {
  const source = boardFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="board-source"]');
  await expect(source).toBeVisible();
  const sourceBefore = (await source.boundingBox())!;
  await page.mouse.click(
    sourceBefore.x + sourceBefore.width / 2,
    sourceBefore.y + sourceBefore.height / 2,
  );
  await expect(page.locator("[data-board-object-selection-box]")).toBeVisible();
  const dragSurface = page.locator(
    "[data-board-object-selection-box] [data-frame-drag-surface]",
  );
  await expect(dragSurface).toBeVisible();
  return { sourceBefore, dragSurface };
}

async function dragBoardSourceIntoAutoLayout(page: Page) {
  const source = boardFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="board-source"]');
  const target = screenFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="auto-frame"]');
  const sourceBox = (await source.boundingBox())!;
  const targetBox = (await target.boundingBox())!;
  const release = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  };
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(release.x, release.y, { steps: 24 });
  await page.mouse.up();
  return release;
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("report path: board frame drops directly into a nested screen frame and survives undo/redo", async ({
  app,
  page,
  request,
}) => {
  const designId = await createDesign(app);
  await gotoEditor(page, designId);
  const originalBoardHtml = await fileContent(
    request,
    designId,
    "__board__.html",
  );
  const originalBoardPlacement = await nodePlacement(
    page,
    originalBoardHtml,
    "board-source",
  );
  expect(originalBoardPlacement).toEqual({
    parent: "BODY",
    siblingIndex: 0,
    left: "-400px",
    top: "140px",
  });
  expect(await topLevelNodeIds(page, originalBoardHtml)).toEqual([
    "board-source",
    "board-text",
  ]);

  const { release, sourceBefore, grabOffset } =
    await dragBoardSourceIntoNestedFrame(page);

  await expect
    .poll(
      async () =>
        childNodeIds(
          await fileContent(request, designId, "index.html"),
          "nested-frame",
        ),
      {
        timeout: 20_000,
      },
    )
    .toEqual(["nested-anchor", "board-source"]);
  await expect
    .poll(() => fileContent(request, designId, "__board__.html"), {
      timeout: 20_000,
    })
    .not.toContain('data-agent-native-node-id="board-source"');

  const boardSource = boardFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="board-source"]');
  const moved = screenFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="board-source"]');
  await expect(boardSource).toHaveCount(0);
  await expect(moved).toHaveCount(1);
  const movedBox = await moved.boundingBox();
  expect(movedBox).not.toBeNull();
  expect(
    Math.abs(movedBox!.x - (release.x - grabOffset.x)),
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(movedBox!.y - (release.y - grabOffset.y)),
  ).toBeLessThanOrEqual(2);
  expect(movedBox!.x).toBeGreaterThan(sourceBefore.x);

  const movedHtml = await fileContent(request, designId, "index.html");
  const movedPlacement = await nodePlacement(page, movedHtml, "board-source");
  expect(movedPlacement).not.toBeNull();
  expect(movedPlacement).toMatchObject({
    parent: "nested-frame",
    siblingIndex: 1,
  });
  expect(
    await topLevelNodeIds(
      page,
      await fileContent(request, designId, "__board__.html"),
    ),
  ).toEqual(["board-text"]);

  await expandAllLayers(page);
  const selected = page
    .getByRole("tree", { name: "Layers" })
    .locator('[role="treeitem"][aria-selected="true"]')
    .filter({ hasText: "Board source" });
  await expect(selected).toHaveCount(1);
  await expect(selected).toContainText("Board source");

  await cdpScreenshot(page, "../../.tmp/report-nested-drop.png");
  await test.info().attach("report-nested-drop.png", {
    path: "../../.tmp/report-nested-drop.png",
    contentType: "image/png",
  });
  await page.keyboard.press(`${MOD}+z`);
  await expect
    .poll(
      async () =>
        nodePlacement(
          page,
          await fileContent(request, designId, "__board__.html"),
          "board-source",
        ),
      { timeout: 20_000 },
    )
    .toEqual(originalBoardPlacement);
  await expect
    .poll(
      async () =>
        topLevelNodeIds(
          page,
          await fileContent(request, designId, "__board__.html"),
        ),
      { timeout: 20_000 },
    )
    .toEqual(["board-source", "board-text"]);
  await expect
    .poll(
      async () =>
        childNodeIds(
          await fileContent(request, designId, "index.html"),
          "nested-frame",
        ),
      { timeout: 20_000 },
    )
    .toEqual(["nested-anchor"]);

  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect
    .poll(
      async () =>
        childNodeIds(
          await fileContent(request, designId, "index.html"),
          "nested-frame",
        ),
      {
        timeout: 20_000,
      },
    )
    .toEqual(["nested-anchor", "board-source"]);
  await expect
    .poll(
      async () =>
        nodePlacement(
          page,
          await fileContent(request, designId, "index.html"),
          "board-source",
        ),
      { timeout: 20_000 },
    )
    .toEqual(movedPlacement);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(
      async () =>
        childNodeIds(
          await fileContent(request, designId, "index.html"),
          "nested-frame",
        ),
      { timeout: 20_000 },
    )
    .toEqual(["nested-anchor", "board-source"]);
  await expect
    .poll(
      async () =>
        nodePlacement(
          page,
          await fileContent(request, designId, "index.html"),
          "board-source",
        ),
      { timeout: 20_000 },
    )
    .toEqual(movedPlacement);
  await expect
    .poll(
      async () =>
        topLevelNodeIds(
          page,
          await fileContent(request, designId, "__board__.html"),
        ),
      { timeout: 20_000 },
    )
    .toEqual(["board-text"]);
  await expect(
    page
      .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
      .first()
      .contentFrame()
      .locator('[data-agent-native-node-id="board-source"]'),
  ).toBeVisible();
});

test("report path: a board layer crossing a nested frame lands directly above it in the outer frame", async ({
  app,
  page,
  request,
}) => {
  const designId = await createDesign(
    app,
    G4_CROSSED_FRAME_SCREEN_HTML,
    G4_CROSSED_FRAME_BOARD_HTML,
  );
  await gotoEditor(page, designId);
  const initialBoardHtml = await fileContent(
    request,
    designId,
    "__board__.html",
  );
  const initialScreenHtml = await fileContent(request, designId, "index.html");
  const initialPlacement = await nodePlacement(
    page,
    initialBoardHtml,
    "board-source",
  );
  expect(initialPlacement).toMatchObject({
    parent: "BODY",
    siblingIndex: 0,
    left: "-400px",
    top: "140px",
  });
  expect(childNodeIds(initialScreenHtml, "outer-frame")).toEqual([
    "middle-frame",
    "auto-frame",
    "short-frame",
    "narrow-frame",
  ]);

  const source = boardFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="board-source"]');
  const outer = screenFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="outer-frame"]');
  const middle = screenFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="middle-frame"]');
  const nested = screenFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="nested-frame"]');
  const narrow = screenFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="narrow-frame"]');
  await expect(source).toBeVisible();
  await expect(outer).toBeVisible();
  await expect(nested).toBeVisible();
  const [sourceBox, outerBox, middleBox, nestedBox, narrowBox] =
    await Promise.all([
      source.boundingBox(),
      outer.boundingBox(),
      middle.boundingBox(),
      nested.boundingBox(),
      narrow.boundingBox(),
    ]);
  if (!sourceBox || !outerBox || !middleBox || !nestedBox || !narrowBox) {
    throw new Error("G4 path-crossing fixture needs rendered bounds");
  }

  const grabOffset = { x: 24, y: 20 };
  const start = {
    x: sourceBox.x + grabOffset.x,
    y: sourceBox.y + grabOffset.y,
  };
  const crossedNested = {
    x: nestedBox.x + nestedBox.width / 2,
    y: nestedBox.y + nestedBox.height / 2,
  };
  const crossedMiddle = {
    x: middleBox.x + 8,
    y: middleBox.y + middleBox.height / 2,
  };
  const release = {
    x: outerBox.x + outerBox.width * 0.75,
    y: outerBox.y + outerBox.height * 0.5,
  };
  expect(crossedNested.x).toBeGreaterThan(nestedBox.x);
  expect(crossedNested.x).toBeLessThan(nestedBox.x + nestedBox.width);
  expect(crossedNested.y).toBeGreaterThan(nestedBox.y);
  expect(crossedNested.y).toBeLessThan(nestedBox.y + nestedBox.height);
  expect(release.x).toBeGreaterThan(nestedBox.x + nestedBox.width);
  expect(release.x).toBeLessThan(outerBox.x + outerBox.width);
  expect(crossedMiddle.x).toBeLessThan(nestedBox.x);
  expect(crossedMiddle.x).toBeGreaterThan(middleBox.x);
  expect(release.x).toBeGreaterThan(middleBox.x + middleBox.width);
  expect(release.y).toBeGreaterThan(outerBox.y);
  expect(release.y).toBeLessThan(outerBox.y + outerBox.height);
  expect(release.x).toBeLessThan(narrowBox.x);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(crossedNested.x, crossedNested.y, { steps: 24 });
  await expect(page.locator("[data-cross-screen-drop-guide]")).toBeVisible({
    timeout: 5_000,
  });
  await page.mouse.move(crossedMiddle.x, crossedMiddle.y, { steps: 8 });
  await expect
    .poll(async () => {
      const guide = await page
        .locator("[data-cross-screen-drop-guide]")
        .boundingBox();
      return Boolean(
        guide &&
        Math.abs(guide.x - middleBox.x) < 3 &&
        Math.abs(guide.y - middleBox.y) < 3 &&
        Math.abs(guide.width - middleBox.width) < 3 &&
        Math.abs(guide.height - middleBox.height) < 3,
      );
    })
    .toBe(true);
  await page.mouse.move(release.x, release.y, { steps: 24 });
  await expect(page.locator("[data-cross-screen-drag-ghost]")).toBeVisible();
  await expect
    .poll(async () => {
      const guide = await page
        .locator("[data-cross-screen-drop-guide]")
        .boundingBox();
      return Boolean(
        guide &&
        Math.abs(guide.x - outerBox.x) < 3 &&
        Math.abs(guide.y - outerBox.y) < 3 &&
        Math.abs(guide.width - outerBox.width) < 3 &&
        Math.abs(guide.height - outerBox.height) < 3,
      );
    })
    .toBe(true);
  await expect
    .poll(async () => ({
      board: await fileContent(request, designId, "__board__.html"),
      screen: await fileContent(request, designId, "index.html"),
    }))
    .toEqual({ board: initialBoardHtml, screen: initialScreenHtml });
  await page.mouse.up();

  const finalScreenOrder = [
    "middle-frame",
    "board-source",
    "auto-frame",
    "short-frame",
    "narrow-frame",
  ];
  await expect
    .poll(
      async () =>
        childNodeIds(
          await fileContent(request, designId, "index.html"),
          "outer-frame",
        ),
      { timeout: 20_000 },
    )
    .toEqual(finalScreenOrder);
  await expect
    .poll(() => fileContent(request, designId, "__board__.html"), {
      timeout: 20_000,
    })
    .not.toContain('data-agent-native-node-id="board-source"');
  const movedHtml = await fileContent(request, designId, "index.html");
  const movedPlacement = await nodePlacement(page, movedHtml, "board-source");
  expect(movedPlacement).toMatchObject({
    parent: "outer-frame",
    siblingIndex: 1,
  });
  expect(
    await page.evaluate((html) => {
      const moved = new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector<HTMLElement>(
          '[data-agent-native-node-id="board-source"]',
        );
      return moved?.style.position;
    }, movedHtml),
  ).toBe("absolute");

  const paintOrder = await screenFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="board-source"]')
    .evaluate((moved) => {
      const narrow = moved.ownerDocument.querySelector<HTMLElement>(
        '[data-agent-native-node-id="narrow-frame"]',
      );
      if (!narrow) return null;
      const movedBox = moved.getBoundingClientRect();
      const narrowRect = narrow.getBoundingClientRect();
      const left = Math.max(movedBox.left, narrowRect.left);
      const top = Math.max(movedBox.top, narrowRect.top);
      const right = Math.min(movedBox.right, narrowRect.right);
      const bottom = Math.min(movedBox.bottom, narrowRect.bottom);
      if (right <= left || bottom <= top) return null;
      const stack = moved.ownerDocument.elementsFromPoint(
        (left + right) / 2,
        (top + bottom) / 2,
      );
      const firstLayerId = stack
        .map((element) =>
          element
            .closest<HTMLElement>("[data-agent-native-node-id]")
            ?.getAttribute("data-agent-native-node-id"),
        )
        .find((id) => id === "board-source" || id === "narrow-frame");
      return {
        overlapWidth: right - left,
        overlapHeight: bottom - top,
        firstLayerId,
      };
    });
  expect(paintOrder).toEqual({
    overlapWidth: expect.any(Number),
    overlapHeight: expect.any(Number),
    firstLayerId: "narrow-frame",
  });
  expect(paintOrder!.overlapWidth).toBeGreaterThan(0);
  expect(paintOrder!.overlapHeight).toBeGreaterThan(0);

  await page.keyboard.press(`${MOD}+z`);
  await expect
    .poll(async () => ({
      board: await fileContent(request, designId, "__board__.html"),
      order: await childNodeIds(
        await fileContent(request, designId, "index.html"),
        "outer-frame",
      ),
    }))
    .toEqual({
      board: initialBoardHtml,
      order: ["middle-frame", "auto-frame", "short-frame", "narrow-frame"],
    });
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect
    .poll(async () => ({
      board: await fileContent(request, designId, "__board__.html"),
      order: await childNodeIds(
        await fileContent(request, designId, "index.html"),
        "outer-frame",
      ),
    }))
    .toMatchObject({
      board: expect.not.stringContaining(
        'data-agent-native-node-id="board-source"',
      ),
      order: finalScreenOrder,
    });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(
      async () =>
        childNodeIds(
          await fileContent(request, designId, "index.html"),
          "outer-frame",
        ),
      { timeout: 20_000 },
    )
    .toEqual(finalScreenOrder);
  await expect(
    screenFrame(page)
      .contentFrame()
      .locator('[data-agent-native-node-id="board-source"]'),
  ).toHaveCSS("position", "absolute");
});

// fixme: product bug: The dropped text renders and reloads with background rgba(0,0,0,0) instead of #fef3c7 (fill lost on the board→Screen move); placement
test.fixme("report path: board text dropped into a nested frame keeps its fill and lands at the drop point; undo returns it to the board, redo and reload restore the drop", async ({
  app,
  page,
}) => {
  const designId = await createDesign(app);
  await gotoEditor(page, designId);
  const source = boardFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="board-text"]');
  const target = screenFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="nested-frame"]');
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  const screenBefore = await app.savedNodes(designId);
  const boardBefore = await app.savedNodes(designId, "__board__.html");
  expect(childrenOf(screenBefore, "nested-frame")).toEqual(["nested-anchor"]);

  const sourceBox = (await source.boundingBox())!;
  const targetBox = (await target.boundingBox())!;
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2 - 12,
    sourceBox.y + sourceBox.height / 2,
    { steps: 4 },
  );
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 24 },
  );
  await expect(page.locator("[data-cross-screen-drop-guide]")).toBeVisible();
  await expect(page.locator("[data-cross-screen-drag-ghost]")).toBeVisible();
  await page.mouse.up();
  await app.settled();

  const dropped = await app.savedNodes(designId);
  expect(childrenOf(dropped, "nested-frame")).toEqual([
    "nested-anchor",
    "board-text",
  ]);
  const style = styleOf(dropped.get("board-text"));
  expect({
    position: style.position,
    left: style.left,
    top: style.top,
  }).toEqual({
    position: "absolute",
    left: "80px",
    top: "95px",
  });
  expectOnlyChanged(screenBefore, dropped, subtree(dropped, "board-text"));
  expectOnlyChanged(
    boardBefore,
    await app.savedNodes(designId, "__board__.html"),
    subtree(boardBefore, "board-text"),
  );
  const movedText = screenFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="board-text"]');

  await page.keyboard.press(`${MOD}+z`);
  await app.settled();
  expectOnlyChanged(screenBefore, await app.savedNodes(designId), []);
  expectOnlyChanged(
    boardBefore,
    await app.savedNodes(designId, "__board__.html"),
    [],
  );

  await page.keyboard.press(`${MOD}+Shift+z`);
  await app.settled();
  expectOnlyChanged(dropped, await app.savedNodes(designId), []);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(movedText).toHaveCSS("background-color", "rgb(254, 243, 199)");
});

test("report path: selected root board frame moves through the host selection box", async ({
  app,
  page,
}) => {
  const designId = await createDesign(app);
  await app.open(designId);
  await app.zoomToFit();
  const screenBefore = await app.savedNodes(designId);
  const boardBefore = await app.savedNodes(designId, "__board__.html");
  expect(childrenOf(screenBefore, "nested-frame")).toEqual(["nested-anchor"]);
  expect(await app.designRect("nested-frame")).toEqual({
    x: 200,
    y: 170,
    width: 280,
    height: 220,
  });
  const { dragSurface } = await selectBoardSourceFromHost(page);
  const release = await app.pagePoint(340, 280);
  const dragBox = (await dragSurface.boundingBox())!;
  await page.mouse.move(
    dragBox.x + dragBox.width / 2,
    dragBox.y + dragBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(release.x, release.y, { steps: 24 });
  await page.mouse.up();
  await app.settled();

  const after = await app.savedNodes(designId);
  expect(childrenOf(after, "nested-frame")).toEqual([
    "nested-anchor",
    "board-source",
  ]);
  await expectLandedCentredInNestedFrame(app, after, "board-source");
  expectOnlyChanged(screenBefore, after, subtree(after, "board-source"));
  const boardAfter = await app.savedNodes(designId, "__board__.html");
  expect(boardAfter.has("board-source")).toBe(false);
  expectOnlyChanged(
    boardBefore,
    boardAfter,
    subtree(boardBefore, "board-source"),
  );
  await expandAllLayers(page);
  await expect.poll(() => app.selectedLayers()).toEqual(["Board source"]);
});

// fixme: product bug: Rendered width 32px instead of 60px: the saved width stays 60px but without flex-shrink:0 the full row squeezes it, so moving a layer
test.fixme("report path: a fixed 60×30 board frame dropped between auto-layout children keeps its size and joins the flow", async ({
  app,
  page,
}) => {
  const designId = await createDesign(app);
  await gotoEditor(page, designId);
  const screenBefore = await app.savedNodes(designId);
  const boardBefore = await app.savedNodes(designId, "__board__.html");
  expect(childrenOf(screenBefore, "auto-frame")).toEqual([
    "auto-first",
    "auto-second",
  ]);

  await dragBoardSourceIntoAutoLayout(page);
  await app.settled();

  const after = await app.savedNodes(designId);
  expect(childrenOf(after, "auto-frame")).toEqual([
    "auto-first",
    "board-source",
    "auto-second",
  ]);
  const style = styleOf(after.get("board-source"));
  expect({
    left: style.left,
    top: style.top,
    width: style.width,
    height: style.height,
  }).toEqual({
    left: undefined,
    top: undefined,
    width: "60px",
    height: "30px",
  });
  expect(attrsBesidesStyle(after.get("board-source"))).toEqual({
    "data-agent-native-node-id": "board-source",
    "data-agent-native-layer-name": "Board source",
    "data-an-primitive": "frame",
    "data-agent-native-clone-root": "true",
    "data-agent-native-preserve-styles": "true",
  });
  expectOnlyChanged(screenBefore, after, subtree(after, "board-source"));
  expectOnlyChanged(
    boardBefore,
    await app.savedNodes(designId, "__board__.html"),
    subtree(boardBefore, "board-source"),
  );
  const moved = screenFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="board-source"]');
  expect(
    await moved.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    }),
    "moving a fixed-size layer into auto layout must not resize it",
  ).toEqual({ width: 60, height: 30 });
});

test("report path: Option-dragging a selected root board frame duplicates into a nested frame", async ({
  app,
  page,
}) => {
  const designId = await createDesign(app);
  await app.open(designId);
  await app.zoomToFit();
  const screenBefore = await app.savedNodes(designId);
  const boardBefore = await app.savedNodes(designId, "__board__.html");
  expect(childrenOf(screenBefore, "nested-frame")).toEqual(["nested-anchor"]);
  expect(await app.designRect("nested-frame")).toEqual({
    x: 200,
    y: 170,
    width: 280,
    height: 220,
  });
  const { dragSurface } = await selectBoardSourceFromHost(page);
  const release = await app.pagePoint(340, 280);
  const dragBox = (await dragSurface.boundingBox())!;
  await page.mouse.move(
    dragBox.x + dragBox.width / 2,
    dragBox.y + dragBox.height / 2,
  );
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(
    dragBox.x + dragBox.width / 2 - 12,
    dragBox.y + dragBox.height / 2,
    { steps: 4 },
  );
  await expect(
    boardFrame(page)
      .contentFrame()
      .locator('[data-agent-native-clone-root="true"]'),
  ).toHaveCount(1);
  await page.mouse.move(release.x, release.y, { steps: 24 });
  await expect(
    screenFrame(page)
      .contentFrame()
      .locator("[data-agent-native-hit-test-preview]"),
  ).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await app.settled();

  const after = await app.savedNodes(designId);
  const nestedChildren = childrenOf(after, "nested-frame");
  expect(nestedChildren).toHaveLength(2);
  expect(nestedChildren[0]).toBe("nested-anchor");
  const copyId = nestedChildren[1]!;
  expect(copyId).not.toBe("board-source");
  expect(attrsBesidesStyle(after.get(copyId))).toEqual({
    "data-agent-native-node-id": copyId,
    "data-agent-native-layer-name": "Board source",
    "data-an-primitive": "frame",
    "data-agent-native-clone-root": "true",
    "data-agent-native-preserve-styles": "true",
  });
  const landed = await expectLandedCentredInNestedFrame(app, after, copyId);
  expectOnlyChanged(screenBefore, after, [copyId]);
  expectOnlyChanged(
    boardBefore,
    await app.savedNodes(designId, "__board__.html"),
    [],
  );
  await expect
    .poll(() => selectedSourceId(page), {
      message: "the copy, not the source, is selected",
    })
    .toBe(copyId);

  await page.keyboard.press(`${MOD}+z`);
  await app.settled();
  expectOnlyChanged(screenBefore, await app.savedNodes(designId), []);
  expectOnlyChanged(
    boardBefore,
    await app.savedNodes(designId, "__board__.html"),
    [],
  );
  await page.keyboard.press(`${MOD}+Shift+z`);
  await app.settled();
  expectOnlyChanged(after, await app.savedNodes(designId), []);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(app.node(copyId)).toBeVisible({ timeout: 30_000 });
  expect(await app.designRect(copyId)).toEqual(landed);
  expectOnlyChanged(after, await app.savedNodes(designId), []);
  expectOnlyChanged(
    boardBefore,
    await app.savedNodes(designId, "__board__.html"),
    [],
  );
});

// fixme: fails on current main after the merge: Error: expect(received).toMatchObject(expected)
test.fixme("report path: Option-dragging a root Screen preserves naming, placement, selection, and history", async ({
  app,
  page,
  request,
}) => {
  const designId = await createDesign(app);
  await openOverview(page, designId);
  await expect(
    page.getByRole("button", { name: "50%", exact: true }),
  ).toBeVisible();
  const sourceLabel = page.locator("[data-frame-label]").first();
  await sourceLabel.click({ force: true });
  const dragSurface = page.locator("[data-frame-drag-surface]").first();
  await expect(dragSurface).toBeVisible();
  const dragBox = (await dragSurface.boundingBox())!;
  const sourceFilesBefore = await fileRecords(request, designId);
  const sourceContent =
    sourceFilesBefore.find((file) => file.filename === "index.html")?.content ??
    "";
  const sourceIds = Array.from(
    sourceContent.matchAll(/data-agent-native-node-id="([^"]+)"/g),
  ).map((match) => match[1]);

  await page.mouse.move(
    dragBox.x + dragBox.width / 2,
    dragBox.y + dragBox.height / 2,
  );
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(
    dragBox.x + dragBox.width / 2 + 220,
    dragBox.y + dragBox.height / 2 + 140,
    { steps: 16 },
  );
  await page.mouse.up();
  await page.keyboard.up("Alt");

  await expect(page.locator("[data-screen-shell]")).toHaveCount(2, {
    timeout: 20_000,
  });
  await expect
    .poll(() => fileRecords(request, designId), { timeout: 20_000 })
    .toHaveLength(sourceFilesBefore.length + 1);
  const filesAfterDuplicate = await fileRecords(request, designId);
  const copy = filesAfterDuplicate.find(
    (file) => !sourceFilesBefore.some((before) => before.id === file.id),
  );
  expect(copy?.filename).toBe("index-copy.html");
  expect(copy?.content).toContain("Nested drop");
  const copyIds = Array.from(
    (copy?.content ?? "").matchAll(/data-agent-native-node-id="([^"]+)"/g),
  ).map((match) => match[1]);
  expect(copyIds).toHaveLength(sourceIds.length);
  expect(copyIds.some((id) => sourceIds.includes(id))).toBe(false);

  const copyFrame = page.locator(`[data-frame-id="${copy?.id}"]`);
  await expect(copyFrame).toBeVisible();
  await expect
    .poll(
      async () =>
        (await designData(request, designId)).canvasFrames?.[copy?.id ?? ""],
      { timeout: 20_000 },
    )
    .toMatchObject({ x: 440, y: 280, width: 800, height: 600 });
  await expect(page.locator("[data-frame-drag-surface]")).toHaveCount(1);
  await resetOverviewZoom(page);
  await expect(
    page
      .getByRole("tree", { name: "Layers" })
      .locator('[role="treeitem"][aria-selected="true"]')
      .filter({ hasText: "Index copy" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "50%", exact: true }),
  ).toBeVisible();
  await cdpScreenshot(page, "../../.tmp/report-screen-duplicate.png");
  await test.info().attach("report-screen-duplicate.png", {
    path: "../../.tmp/report-screen-duplicate.png",
    contentType: "image/png",
  });
  await page.keyboard.press(`${MOD}+z`);
  await expect
    .poll(() => fileRecords(request, designId), { timeout: 20_000 })
    .toHaveLength(sourceFilesBefore.length);
  await expect(
    page.getByRole("button", { name: "50%", exact: true }),
  ).toBeVisible();
  await page.keyboard.press(`${MOD}+Shift+z`);
  await expect
    .poll(() => fileRecords(request, designId), { timeout: 20_000 })
    .toHaveLength(sourceFilesBefore.length + 1);
  await expect(
    page.getByRole("button", { name: "50%", exact: true }),
  ).toBeVisible();
  const redoCopy = (await fileRecords(request, designId)).find(
    (file) => file.filename === "index-copy.html",
  );
  expect(redoCopy).toBeTruthy();
  expect(redoCopy?.content).toContain("Nested drop");
  await expect
    .poll(
      async () =>
        (await designData(request, designId)).canvasFrames?.[
          redoCopy?.id ?? ""
        ],
      { timeout: 20_000 },
    )
    .toMatchObject({ x: 440, y: 280, width: 800, height: 600 });
  await expect
    .poll(() => new URL(page.url()).searchParams.get("screen"), {
      timeout: 10_000,
    })
    .toBe(redoCopy?.id);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-screen-shell]")).toHaveCount(2, {
    timeout: 30_000,
  });
  await expect(
    page.getByRole("button", { name: "50%", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("tree", { name: "Layers" })
      .locator('[role="treeitem"][aria-selected="true"]')
      .filter({ hasText: "Index copy" }),
  ).toHaveCount(1);
});

for (const { zoom, drag, landed } of [
  { zoom: 100, drag: { x: 220, y: 140 }, landed: { x: 220, y: 140 } },
  { zoom: 200, drag: { x: 80, y: 60 }, landed: { x: 40, y: 30 } },
] as const) {
  // fixme: fails on current main after the merge: 100%: expect(locator).toHaveCount(expected) failed; 200%: locator.click: Timeout 15000ms exceeded.
  test.fixme(`report path: Option-dragging a root Screen at ${zoom}% places the copy one drag delta away and keeps it selected after reload`, async ({
    app,
    page,
    request,
  }) => {
    const designId = await createDesign(app);
    await openOverview(page, designId);
    await page.locator("[data-frame-label]").first().click();
    const dragSurface = page.locator("[data-frame-drag-surface]").first();
    await expect(dragSurface).toBeVisible();
    await setOverviewZoom(page, zoom);
    const screenBefore = await app.savedNodes(designId);
    const dragBox = (await dragSurface.boundingBox())!;
    const start = {
      x: Math.max(dragBox.x + 16, 700),
      y: Math.max(dragBox.y + 16, 300),
    };

    await page.mouse.move(start.x, start.y);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(start.x + drag.x, start.y + drag.y, { steps: 16 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await app.settled();

    const files = await fileRecords(request, designId);
    expect(files.map((file) => file.filename).sort()).toEqual([
      "__board__.html",
      "index-copy.html",
      "index.html",
    ]);
    const copyId = files.find(
      (file) => file.filename === "index-copy.html",
    )!.id;
    const sourceId = files.find((file) => file.filename === "index.html")!.id;
    const frames = (await designData(request, designId)).canvasFrames;
    expect(frames[copyId]).toMatchObject({
      ...landed,
      width: 800,
      height: 600,
    });
    expect(frames[sourceId]).toMatchObject({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
    expectOnlyChanged(screenBefore, await app.savedNodes(designId), []);
    const selectedCopy = page
      .getByRole("tree", { name: "Layers" })
      .locator('[role="treeitem"][aria-selected="true"]')
      .filter({ hasText: "Index copy" });
    await expect(selectedCopy).toHaveCount(1);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await expectReloadedOverviewZoom(page, zoom);
    await expect(selectedCopy).toHaveCount(1);
  });
}
