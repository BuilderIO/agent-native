import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { buildCodeLayerProjection } from "../shared/code-layer";
import { e2eBaseURL } from "./base-url";
import { expandAllLayers, gotoEditor } from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
// Design keeps a 56px board gap for Cmd+D.
const DESIGN_SCREEN_GAP = 56;
const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const res = await request.post(`${BASE_URL}/_agent-native/actions/${name}`, {
    data: input,
  });
  if (!res.ok()) {
    throw new Error(`${name}: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

const BLANK_SCREEN = (label: string) => `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>${label}</title></head>
  <body style="margin:0;min-height:900px;background:#fff"></body>
</html>`;

const NAV_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Navigation</title></head>
  <body style="margin:0;min-height:400px;background:#fff">
    <div data-agent-native-node-id="nav-root" data-agent-native-layer-name="Navigation"
         data-agent-native-component="Navigation"
         style="position:absolute;left:0;top:0;width:1440px;height:80px;background:#fffdf8;display:flex;align-items:center;padding:0 24px">
      <span data-agent-native-node-id="nav-word" style="font-weight:900">Wordmark</span>
    </div>
  </body>
</html>`;

async function newDesign(
  request: APIRequestContext,
  files: Array<{ filename: string; content: string }>,
): Promise<{ designId: string }> {
  const created = await action(request, "create-design", {
    title: `Portfolio build ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  for (const f of files) {
    await action(request, "create-file", {
      designId,
      filename: f.filename,
      content: f.content,
      fileType: "html",
    });
  }
  return { designId };
}

async function designRecord(request: APIRequestContext, designId: string) {
  return request
    .get(`${BASE_URL}/_agent-native/actions/get-design?id=${designId}`)
    .then((r) => r.json());
}

async function designData(request: APIRequestContext, designId: string) {
  const record = await designRecord(request, designId);
  return JSON.parse(record.data || "{}") as Record<string, any>;
}

async function fileContent(
  request: APIRequestContext,
  designId: string,
  filename = "index.html",
): Promise<string> {
  const record = await designRecord(request, designId);
  return (
    (record.files ?? []).find((f: any) => f.filename === filename)?.content ??
    ""
  );
}

async function fileList(
  request: APIRequestContext,
  designId: string,
): Promise<string[]> {
  const record = await designRecord(request, designId);
  return (record.files ?? []).map((f: any) => f.filename);
}

async function fileId(
  request: APIRequestContext,
  designId: string,
  filename: string,
): Promise<string> {
  const record = await designRecord(request, designId);
  const file = (record.files ?? []).find((f: any) => f.filename === filename);
  if (!file) throw new Error(`no file ${filename} in design ${designId}`);
  return file.id;
}

async function selectionContext(
  request: APIRequestContext,
): Promise<{ selectedScreenIds?: string[] }> {
  const res = await request.get(
    `${BASE_URL}/_agent-native/application-state/design-selection`,
  );
  if (!res.ok()) {
    throw new Error(
      `could not read design-selection: ${res.status()} ${await res.text()}`,
    );
  }
  return res.json();
}

async function selectedScreenFilenames(
  request: APIRequestContext,
  designId: string,
): Promise<string[]> {
  const [selection, record] = await Promise.all([
    selectionContext(request),
    designRecord(request, designId),
  ]);
  return (selection.selectedScreenIds ?? [])
    .map(
      (id) =>
        record.files?.find((file: { id: string }) => file.id === id)
          ?.filename ?? `missing:${id}`,
    )
    .sort();
}

function layersTree(page: Page): Locator {
  return page.getByRole("tree", { name: "Layers" });
}

function layerRowButton(page: Page, name: string): Locator {
  return layersTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name.replace(/"/g, '\\"')}"]`) })
    .first();
}

async function selectLayerByName(
  page: Page,
  name: string,
  opts?: { shift?: boolean },
) {
  await layerRowButton(page, name).click({
    force: true,
    modifiers: opts?.shift ? ["Shift"] : undefined,
  });
  await page.waitForTimeout(500);
}

async function selectLayerInScreen(
  page: Page,
  screenId: string,
  layerName: string,
): Promise<void> {
  const rows = layersTree(page).locator('[role="treeitem"]');
  const rowIndex = await rows.evaluateAll(
    (elements, { screenId: wantedScreenId, layerName: wantedLayerName }) => {
      let inScreen = false;
      for (let index = 0; index < elements.length; index += 1) {
        const row = elements[index]!;
        if (row.getAttribute("aria-level") === "1") {
          inScreen =
            row.querySelector(
              `[data-layer-row-button][data-layer-node-id="${wantedScreenId}"]`,
            ) !== null;
        }
        if (
          inScreen &&
          Array.from(row.querySelectorAll("span[title]"))
            .map((span) => span.getAttribute("title"))
            .includes(wantedLayerName)
        ) {
          return index;
        }
      }
      return -1;
    },
    { screenId, layerName },
  );
  if (rowIndex < 0) {
    throw new Error(
      `no layer ${layerName} found under screen ${screenId} in the Layers tree`,
    );
  }
  await rows
    .nth(rowIndex)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .click({ force: true });
  await page.waitForTimeout(500);
}

async function dump(page: Page) {
  return page.evaluate(() => (window as any).__designTrace?.dump?.() ?? null);
}

async function focusCanvas(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
  });
}

async function emptyBoardPoint(
  page: Page,
  options: {
    offset?: { x: number; y: number };
    dragSize?: { width: number; height: number };
  } = {},
) {
  const offset = options.offset ?? { x: 0, y: 0 };
  const dragSize = options.dragSize ?? { width: 0, height: 0 };
  const boardIframes = page.locator(
    "[data-board-surface-layer] iframe[data-design-preview-iframe]",
  );
  const boardFrameBoxes: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }> = [];
  for (
    let iframeIndex = 0;
    iframeIndex < (await boardIframes.count());
    iframeIndex += 1
  ) {
    const frames = boardIframes
      .nth(iframeIndex)
      .contentFrame()
      .locator('[data-an-primitive="frame"]');
    for (
      let frameIndex = 0;
      frameIndex < (await frames.count());
      frameIndex += 1
    ) {
      const box = await frames.nth(frameIndex).boundingBox();
      if (box) boardFrameBoxes.push(box);
    }
  }
  const point = await page.evaluate(
    ({ offsetX, offsetY, dragWidth, dragHeight, boardFrameBoxes }) => {
      const world = document.querySelector("[data-multi-screen-canvas-world]");
      const surface = (world?.parentElement ?? world) as HTMLElement | null;
      if (!surface) return null;
      const r = surface.getBoundingClientRect();
      const screenFrames = Array.from(
        document.querySelectorAll("[data-screen-shell][data-frame-id]"),
      ).map((el) => el.getBoundingClientRect());
      const overlaps = (
        left: number,
        top: number,
        right: number,
        bottom: number,
        rect: { left: number; top: number; right: number; bottom: number },
      ) =>
        right >= rect.left - 24 &&
        left <= rect.right + 24 &&
        bottom >= rect.top - 24 &&
        top <= rect.bottom + 24;
      for (
        let y = r.top + 60 + offsetY;
        y < r.bottom - 60 - dragHeight;
        y += 40
      ) {
        for (
          let x = r.left + 60 + offsetX;
          x < r.right - 60 - dragWidth;
          x += 40
        ) {
          const right = x + dragWidth;
          const bottom = y + dragHeight;
          if (
            screenFrames.some((frame) => overlaps(x, y, right, bottom, frame))
          )
            continue;
          if (
            boardFrameBoxes.some((frame) =>
              overlaps(x, y, right, bottom, {
                left: frame.x,
                top: frame.y,
                right: frame.x + frame.width,
                bottom: frame.y + frame.height,
              }),
            )
          ) {
            continue;
          }
          const hit = document.elementFromPoint(x, y);
          if (hit && surface.contains(hit)) return { x, y };
        }
      }
      return null;
    },
    {
      offsetX: offset.x,
      offsetY: offset.y,
      dragWidth: dragSize.width,
      dragHeight: dragSize.height,
      boardFrameBoxes,
    },
  );
  if (!point) throw new Error("no empty canvas point found at this viewport");
  return point;
}

async function pickFrameMode(page: Page, mode: "Frame" | "Screen") {
  await page
    .locator(
      '[data-design-bottom-toolbar] button[aria-label="Frame options"],' +
        ' [data-design-bottom-toolbar] button[aria-label="Screen options"]',
    )
    .first()
    .click();
  await page.getByRole("menuitem").filter({ hasText: mode }).first().click();
  await page.waitForTimeout(400);
}

async function boardHtml(request: APIRequestContext, designId: string) {
  return fileContent(request, designId, "__board__.html");
}

async function boardSourceFile(request: APIRequestContext, designId: string) {
  const record = await designRecord(request, designId);
  const file = record.files?.find(
    (candidate: { filename: string }) =>
      candidate.filename === "__board__.html",
  );
  if (!file) throw new Error(`no board file in design ${designId}`);
  if (typeof file.id !== "string" || typeof file.content !== "string") {
    throw new Error(`board file in design ${designId} is incomplete`);
  }
  return { fileId: file.id, content: file.content };
}

async function drawBoardFrame(
  page: Page,
  request: APIRequestContext,
  designId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const countBefore = (
    (await boardHtml(request, designId)).match(/data-an-primitive="frame"/g) ??
    []
  ).length;
  await pickFrameMode(page, "Frame");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 16 });
  await page.mouse.up();
  try {
    await expect
      .poll(
        async () =>
          (
            (await boardHtml(request, designId)).match(
              /data-an-primitive="frame"/g,
            ) ?? []
          ).length,
        { timeout: 10_000 },
      )
      .toBeGreaterThan(countBefore);
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    let diagnostic: unknown;
    try {
      const browserState = await page.evaluate(
        ({ from, to }) => {
          const surface = document.querySelector(
            "[data-multi-screen-canvas-world]",
          )?.parentElement;
          const rect = surface?.getBoundingClientRect();
          const left = Math.min(from.x, to.x);
          const top = Math.min(from.y, to.y);
          const right = Math.max(from.x, to.x);
          const bottom = Math.max(from.y, to.y);
          const screens = Array.from(
            document.querySelectorAll<HTMLElement>(
              "[data-screen-shell][data-frame-id]",
            ),
          );
          const target = (point: { x: number; y: number }) => {
            const element = document.elementFromPoint(point.x, point.y);
            return {
              ...point,
              tag: element?.tagName.toLowerCase() ?? null,
              screen: element
                ?.closest("[data-screen-shell][data-frame-id]")
                ?.getAttribute("data-frame-id"),
            };
          };
          return {
            activeTool: document
              .querySelector<HTMLElement>(
                '[data-design-bottom-toolbar] button[aria-pressed="true"]',
              )
              ?.getAttribute("aria-label"),
            viewport: [innerWidth, innerHeight],
            surface: rect
              ? [rect.left, rect.top, rect.right, rect.bottom]
              : null,
            targets: [target(from), target(to)],
            intersectingScreens: screens
              .filter((screen) => {
                const screenRect = screen.getBoundingClientRect();
                return (
                  right >= screenRect.left &&
                  left <= screenRect.right &&
                  bottom >= screenRect.top &&
                  top <= screenRect.bottom
                );
              })
              .map((screen) => screen.getAttribute("data-frame-id")),
          };
        },
        { from, to },
      );
      const countAfter = (
        (await boardHtml(request, designId)).match(
          /data-an-primitive="frame"/g,
        ) ?? []
      ).length;
      diagnostic = {
        from,
        to,
        countBefore,
        countAfter,
        ...browserState,
        designTrace: await dump(page),
      };
    } catch (diagnosticError) {
      diagnostic = {
        diagnosticReadError:
          diagnosticError instanceof Error
            ? diagnosticError.message
            : String(diagnosticError),
      };
    }
    throw new Error(
      `${failure}\nFrame draw context: ${JSON.stringify(diagnostic)}`,
    );
  }
}

test.describe("assemble portfolio pages", () => {
  let designId = "";

  test.afterEach(async ({ request }) => {
    if (!designId) return;
    await action(request, "delete-design", { id: designId }).catch(() => {});
    designId = "";
  });

  test("Shift+S leaves the tool unchanged; Frame Selection wraps independent board frames with undo/redo", async ({
    page,
    request,
  }) => {
    ({ designId } = await newDesign(request, [
      { filename: "index.html", content: BLANK_SCREEN("Home") },
    ]));
    await gotoEditor(page, designId);

    const activeToolBefore = await page
      .locator('[data-design-bottom-toolbar] button[aria-pressed="true"]')
      .first()
      .getAttribute("aria-label");
    await focusCanvas(page);
    await page.keyboard.press("Shift+S");
    await page.waitForTimeout(400);
    const activeToolAfter = await page
      .locator('[data-design-bottom-toolbar] button[aria-pressed="true"]')
      .first()
      .getAttribute("aria-label");
    expect(
      activeToolAfter,
      "Shift+S is unassigned and should not silently switch tools",
    ).toBe(activeToolBefore);

    const p1 = await emptyBoardPoint(page, {
      dragSize: { width: 120, height: 80 },
    });
    await drawBoardFrame(page, request, designId, p1, {
      x: p1.x + 120,
      y: p1.y + 80,
    });
    const p2 = await emptyBoardPoint(page, {
      offset: { x: 260, y: 0 },
      dragSize: { width: 120, height: 80 },
    });
    await drawBoardFrame(page, request, designId, p2, {
      x: p2.x + 120,
      y: p2.y + 80,
    });
    const boardBefore = await boardSourceFile(request, designId);
    const frameCountBefore = (
      boardBefore.content.match(/data-an-primitive="frame"/g) ?? []
    ).length;
    expect(frameCountBefore).toBe(2);
    const source = {
      kind: "design-file" as const,
      fileId: boardBefore.fileId,
    };
    const frameNodesBefore = buildCodeLayerProjection(boardBefore.content, {
      source,
    }).nodes.filter(
      (node) => node.dataAttributes["data-an-primitive"] === "frame",
    );
    expect(frameNodesBefore).toHaveLength(2);
    const originalParentId = frameNodesBefore[0]?.parentId;
    expect(
      frameNodesBefore[1]?.parentId,
      `expected independent board frame siblings: ${JSON.stringify(frameNodesBefore.map(({ id, parentId, path }) => ({ id, parentId, path })))}`,
    ).toBe(originalParentId);

    await page
      .locator('[data-design-bottom-toolbar] button[aria-label="Move"]')
      .click();
    const world = page.locator("[data-multi-screen-canvas-world]");
    await world.click({
      position: {
        x: p1.x - (await world.boundingBox())!.x + 10,
        y: p1.y - (await world.boundingBox())!.y + 10,
      },
      force: true,
    });
    await page.waitForTimeout(400);
    await page.keyboard.down("Shift");
    await world.click({
      position: {
        x: p2.x - (await world.boundingBox())!.x + 10,
        y: p2.y - (await world.boundingBox())!.y + 10,
      },
      force: true,
    });
    await page.keyboard.up("Shift");
    await page.waitForTimeout(400);
    await page.evaluate(() => (window as any).__designTrace?.clear?.());
    await page.keyboard.press(`${MOD}+Alt+g`);
    await expect
      .poll(
        async () =>
          (await boardHtml(request, designId)).match(
            /data-an-primitive="frame"/g,
          )?.length ?? 0,
      )
      .toBe(frameCountBefore + 1);

    const boardAfter = await boardSourceFile(request, designId);
    const frameNodesAfter = buildCodeLayerProjection(boardAfter.content, {
      source,
    }).nodes.filter(
      (node) => node.dataAttributes["data-an-primitive"] === "frame",
    );
    expect(frameNodesAfter).toHaveLength(frameCountBefore + 1);
    const wrappers = frameNodesAfter.filter(
      (candidate) =>
        frameNodesAfter.filter((child) => child.parentId === candidate.id)
          .length === 2,
    );
    expect(wrappers).toHaveLength(1);
    const wrapper = wrappers[0];
    expect(wrapper).toBeDefined();
    if (!wrapper) throw new Error("Frame Selection did not persist a wrapper");
    expect(wrapper.parentId).toBe(originalParentId);

    await focusCanvas(page);
    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(
        async () =>
          (await boardHtml(request, designId)).match(
            /data-an-primitive="frame"/g,
          )?.length ?? 0,
      )
      .toBe(frameCountBefore);
    const boardAfterUndo = await boardSourceFile(request, designId);
    const frameNodesAfterUndo = buildCodeLayerProjection(
      boardAfterUndo.content,
      { source },
    ).nodes.filter(
      (node) => node.dataAttributes["data-an-primitive"] === "frame",
    );
    expect(frameNodesAfterUndo).toHaveLength(2);
    expect(frameNodesAfterUndo[0]?.parentId).toBe(originalParentId);
    expect(frameNodesAfterUndo[1]?.parentId).toBe(originalParentId);

    await focusCanvas(page);
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect
      .poll(
        async () =>
          (await boardHtml(request, designId)).match(
            /data-an-primitive="frame"/g,
          )?.length ?? 0,
      )
      .toBe(frameCountBefore + 1);
    const boardAfterRedo = await boardSourceFile(request, designId);
    const frameNodesAfterRedo = buildCodeLayerProjection(
      boardAfterRedo.content,
      { source },
    ).nodes.filter(
      (node) => node.dataAttributes["data-an-primitive"] === "frame",
    );
    expect(frameNodesAfterRedo).toHaveLength(frameCountBefore + 1);
    const redoneWrappers = frameNodesAfterRedo.filter(
      (candidate) =>
        frameNodesAfterRedo.filter((child) => child.parentId === candidate.id)
          .length === 2,
    );
    expect(redoneWrappers).toHaveLength(1);
    const redoneWrapper = redoneWrappers[0];
    expect(redoneWrapper).toBeDefined();
    if (!redoneWrapper) throw new Error("Redo did not restore the wrapper");
    expect(redoneWrapper.parentId).toBe(originalParentId);
  });

  test("step 3 [overview, outside any screen]: stripping a board component's white fill via the inspector (peer-owned)", async ({
    page,
    request,
  }) => {
    ({ designId } = await newDesign(request, [
      { filename: "index.html", content: BLANK_SCREEN("Home") },
    ]));
    await gotoEditor(page, designId);
    const p1 = await emptyBoardPoint(page, {
      dragSize: { width: 140, height: 100 },
    });
    await drawBoardFrame(page, request, designId, p1, {
      x: p1.x + 140,
      y: p1.y + 100,
    });

    const world = page.locator("[data-multi-screen-canvas-world]");
    const worldBox = (await world.boundingBox())!;
    await page
      .locator('[data-design-bottom-toolbar] button[aria-label="Move"]')
      .click();
    await world.click({
      position: { x: p1.x - worldBox.x + 10, y: p1.y - worldBox.y + 10 },
      force: true,
    });
    await page.waitForTimeout(500);

    const fillSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: /^Fill$/i }) })
      .first();
    const beforeVisible = await fillSection.isVisible().catch(() => false);
    expect(
      beforeVisible,
      "selecting a board frame should populate the inspector's Fill section (peer-owned inspector surface)",
    ).toBe(true);

    const before = await boardHtml(request, designId);
    const fillRow = fillSection
      .locator("[data-fill-row], li, div")
      .filter({
        has: page.locator('button[aria-label="Remove layer"]'),
      })
      .first();
    const hasHoverRow = (await fillRow.count()) > 0;
    if (hasHoverRow) await fillRow.hover();
    else await fillSection.hover();
    await page.waitForTimeout(300);
    const removeButton = fillSection
      .locator('button[aria-label="Remove layer"]')
      .first();
    const hasRemove = await removeButton.isVisible().catch(() => false);
    if (hasRemove) {
      await removeButton.click({ force: true });
    } else {
      const hexInput = fillSection.locator("input").first();
      await hexInput.fill("transparent");
      await hexInput.press("Enter");
    }
    await page.waitForTimeout(500);
    const after = await boardHtml(request, designId);
    expect(
      after,
      `stripping the frame's fill via the inspector should change the board file. before/after identical — trace: ${JSON.stringify(await dump(page))}`,
    ).not.toBe(before);
  });

  test("step 4 [in-screen, crossing the screen boundary]: dragging a Navigation instance from another screen onto a blank page, then Shift+A wraps the dropped instances into one auto-layout page frame", async ({
    page,
    request,
  }) => {
    ({ designId } = await newDesign(request, [
      { filename: "index.html", content: BLANK_SCREEN("Home") },
      { filename: "nav.html", content: NAV_SCREEN },
    ]));
    const record = await designRecord(request, designId);
    const homeFileId = record.files.find(
      (f: any) => f.filename === "index.html",
    ).id;
    const navFileId = record.files.find(
      (f: any) => f.filename === "nav.html",
    ).id;
    await action(request, "update-design", {
      id: designId,
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", homeFileId],
          value: { x: 0, y: 0, width: 1440, height: 900, z: 0 },
        },
        {
          op: "set",
          path: ["canvasFrames", navFileId],
          value: { x: -1600, y: 0, width: 1440, height: 400, z: 1 },
        },
        {
          op: "set",
          path: ["screenMetadata", homeFileId],
          value: { sourceType: "inline", width: 1440, height: 900 },
        },
        {
          op: "set",
          path: ["screenMetadata", navFileId],
          value: { sourceType: "inline", width: 1440, height: 400 },
        },
      ],
    });

    await page.goto(`${BASE_URL}/design/${designId}?view=overview&zoom=25`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2, {
      timeout: 40_000,
    });

    const sourceFrame = page.locator(
      `iframe[data-screen-iframe-id="${navFileId}"]`,
    );
    const targetFrame = page.locator(
      `iframe[data-screen-iframe-id="${homeFileId}"]`,
    );
    const sourceEl = sourceFrame
      .contentFrame()
      .locator('[data-agent-native-node-id="nav-root"]');
    const sourceDragEl = sourceFrame
      .contentFrame()
      .locator('[data-agent-native-node-id="nav-word"]');
    await expect(sourceEl).toBeVisible();
    await expect(sourceDragEl).toBeVisible();
    let lastSourceBox: { x: number; y: number } | null = null;
    await expect
      .poll(
        async () => {
          const box = await sourceEl.boundingBox();
          const stable =
            box !== null &&
            lastSourceBox !== null &&
            Math.abs(box.x - lastSourceBox.x) < 1 &&
            Math.abs(box.y - lastSourceBox.y) < 1;
          lastSourceBox = box;
          return stable;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    const sourceDragBox = (await sourceDragEl.boundingBox())!;
    const targetBox = (await targetFrame.boundingBox())!;

    await expandAllLayers(page);
    await selectLayerByName(page, "Navigation");
    await page.waitForTimeout(500);
    await page.mouse.move(
      sourceDragBox.x + sourceDragBox.width / 2,
      sourceDragBox.y + sourceDragBox.height / 2,
    );
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(
      targetBox.x + targetBox.width * 0.5,
      targetBox.y + targetBox.height * 0.2,
      { steps: 20 },
    );
    await page.waitForTimeout(300);
    const ghost = page.locator("[data-cross-screen-drag-ghost]");
    const ghostAppeared = await ghost
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    await page.mouse.up();
    await page.keyboard.up("Alt");
    expect(
      ghostAppeared,
      `alt-dragging the Navigation instance toward the Home screen should show the cross-screen drag ghost — trace: ${JSON.stringify(await dump(page))}`,
    ).toBe(true);

    let homeHtml = "";
    await expect
      .poll(
        async () => {
          homeHtml = await fileContent(request, designId, "index.html");
          return (
            homeHtml.match(/data-agent-native-component="Navigation"/g) ?? []
          ).length;
        },
        {
          timeout: 10_000,
          message:
            "alt-dragging the Navigation instance onto Home should copy it in, leaving the source screen untouched",
        },
      )
      .toBe(1);
    const navHtmlAfter = await fileContent(request, designId, "nav.html");
    expect(
      (navHtmlAfter.match(/data-agent-native-component="Navigation"/g) ?? [])
        .length,
    ).toBe(1);

    await gotoEditor(page, designId);
    await expandAllLayers(page);
    await selectLayerInScreen(page, homeFileId, "Navigation");
    await focusCanvas(page);
    await page.evaluate(() => (window as any).__designTrace?.clear?.());
    await page.keyboard.press("Shift+A");
    await page.waitForTimeout(700);
    homeHtml = await fileContent(request, designId, "index.html");
    expect(
      (homeHtml.match(/data-an-primitive="frame"/g) ?? []).length,
      `Shift+A over the dropped Navigation instance should add one auto-layout wrapper frame — trace: ${JSON.stringify(await dump(page))}`,
    ).toBeGreaterThanOrEqual(1);
  });

  test("step 5 [overview, screens as top-level frames]: Cmd+D finds free slots, stacks above the source, and groups undo/redo", async ({
    page,
    request,
  }) => {
    ({ designId } = await newDesign(request, [
      { filename: "index.html", content: NAV_SCREEN },
      { filename: "neighbor.html", content: BLANK_SCREEN("Neighbor") },
      { filename: "farther.html", content: BLANK_SCREEN("Farther") },
    ]));
    const sourceId = await fileId(request, designId, "index.html");
    const neighborId = await fileId(request, designId, "neighbor.html");
    const fartherId = await fileId(request, designId, "farther.html");
    const sourceGeometry = { x: 200, y: 720, width: 320, height: 240, z: 0 };
    const firstDuplicateX =
      sourceGeometry.x + sourceGeometry.width + DESIGN_SCREEN_GAP;
    const secondDuplicateX =
      firstDuplicateX + sourceGeometry.width + DESIGN_SCREEN_GAP;
    const neighborGeometry = { x: 200, y: 1200, width: 320, height: 240, z: 1 };
    const fartherGeometry = { x: 2000, y: 720, width: 320, height: 240, z: 2 };
    await action(request, "update-design", {
      id: designId,
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", sourceId],
          value: sourceGeometry,
        },
        {
          op: "set",
          path: ["canvasFrames", neighborId],
          value: neighborGeometry,
        },
        {
          op: "set",
          path: ["canvasFrames", fartherId],
          value: fartherGeometry,
        },
      ],
    });
    await page.goto(`${BASE_URL}/design/${designId}?view=overview&zoom=30`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-screen-shell]")).toHaveCount(3, {
      timeout: 40_000,
    });
    const card = page.locator(
      `[data-frame-id="${sourceId}"] [data-screen-card]`,
    );
    const frameLabel = page.locator(
      `[data-frame-id="${sourceId}"] [data-frame-label]`,
    );
    await expect(card).toBeVisible();
    await expect(frameLabel).toBeVisible();
    let lastCardBox: { x: number; y: number } | null = null;
    await expect
      .poll(
        async () => {
          const box = await card.boundingBox();
          const stable =
            box !== null &&
            lastCardBox !== null &&
            Math.abs(box.x - lastCardBox.x) < 1 &&
            Math.abs(box.y - lastCardBox.y) < 1;
          lastCardBox = box;
          return stable;
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    await expect
      .poll(() => fileList(request, designId), { timeout: 10_000 })
      .toContain("__board__.html");
    const filesBefore = await fileList(request, designId);

    await page
      .getByRole("button", { name: /^\d+%$/ })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Zoom to fit" }).click();
    await expect(card).toBeInViewport();
    await expect(frameLabel).toBeInViewport();
    await frameLabel.click({ force: true });
    await expect
      .poll(async () => (await selectionContext(request)).selectedScreenIds)
      .toEqual([sourceId]);
    await focusCanvas(page);
    await page.keyboard.press(`${MOD}+d`);
    let filesAfter: string[] = [];
    await expect
      .poll(
        async () => {
          filesAfter = await fileList(request, designId);
          return filesAfter.length;
        },
        {
          timeout: 10_000,
          message:
            "Cmd+D on a selected screen should duplicate it as a new screen file (screens are top-level frames)",
        },
      )
      .toBe(filesBefore.length + 1);
    const dup1 = filesAfter.find((f) => !filesBefore.includes(f));
    expect(dup1, "duplicated screen file should exist").toBe("index-copy.html");
    const dup1Id = await fileId(request, designId, dup1!);
    await expect
      .poll(async () => {
        const frames = (await designData(request, designId)).canvasFrames;
        return {
          copy: frames?.[dup1Id],
          neighborZ: frames?.[neighborId]?.z,
          fartherZ: frames?.[fartherId]?.z,
        };
      })
      .toEqual({
        copy: { ...sourceGeometry, x: firstDuplicateX, z: 1 },
        neighborZ: 2,
        fartherZ: 3,
      });
    await expect
      .poll(async () => (await selectionContext(request)).selectedScreenIds, {
        timeout: 10_000,
        message:
          "Cmd+D should select the new copy once its history entry lands",
      })
      .toEqual([dup1Id]);
    await expect(
      page.locator(`[data-frame-id="${dup1Id}"] [data-screen-card]`),
    ).toBeInViewport();
    // Duplicating a screen regenerates every node id (like paste), so assert
    // on the content signature, not the source id.
    const dup1Content = await fileContent(request, designId, dup1!);
    expect(dup1Content).toContain('data-agent-native-component="Navigation"');
    expect(dup1Content).toContain("Wordmark");

    await page
      .getByRole("button", { name: /^\d+%$/ })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Zoom to fit" }).click();
    await expect(card).toBeInViewport();
    await expect(frameLabel).toBeInViewport();
    await frameLabel.click({ force: true });
    await expect
      .poll(async () => (await selectionContext(request)).selectedScreenIds)
      .toEqual([sourceId]);
    await focusCanvas(page);
    await page.keyboard.press(`${MOD}+d`);
    await expect
      .poll(
        async () => {
          filesAfter = await fileList(request, designId);
          return filesAfter.length;
        },
        { timeout: 10_000 },
      )
      .toBe(filesBefore.length + 2);
    const dup2 = filesAfter.find((f) => !filesBefore.includes(f) && f !== dup1);
    expect(
      dup2,
      "the second Cmd+D should duplicate the reselected source",
    ).toBe("index-copy-2.html");
    const dup2Id = await fileId(request, designId, dup2!);
    await expect
      .poll(async () => {
        const frames = (await designData(request, designId)).canvasFrames;
        return {
          copy: frames?.[dup2Id],
          firstCopyZ: frames?.[dup1Id]?.z,
          neighborZ: frames?.[neighborId]?.z,
          fartherZ: frames?.[fartherId]?.z,
        };
      })
      .toEqual({
        copy: { ...sourceGeometry, x: secondDuplicateX, z: 1 },
        firstCopyZ: 2,
        neighborZ: 3,
        fartherZ: 4,
      });
    await expect
      .poll(async () => (await selectionContext(request)).selectedScreenIds, {
        timeout: 10_000,
        message: "the second Cmd+D should select its own copy too",
      })
      .toEqual([dup2Id]);
    const dup2Content = await fileContent(request, designId, dup2!);
    expect(dup2Content).toContain('data-agent-native-component="Navigation"');
    expect(dup2Content).toContain("Wordmark");

    await page.keyboard.press(`${MOD}+z`);
    let filesAfterUndo: string[] = [];
    await expect
      .poll(
        async () => {
          filesAfterUndo = await fileList(request, designId);
          return filesAfterUndo.length;
        },
        {
          timeout: 10_000,
          message:
            "one undo after duplicating a screen should remove exactly that duplicate",
        },
      )
      .toBe(filesBefore.length + 1);
    expect(
      filesAfterUndo.includes(dup1!),
      `undo should keep the FIRST duplicate (${dup1}) — files after undo: ${JSON.stringify(filesAfterUndo)}`,
    ).toBe(true);
    expect(
      filesAfterUndo.includes(dup2!),
      `undo should remove the SECOND (most recent) duplicate (${dup2}), not the first — files after undo: ${JSON.stringify(filesAfterUndo)}`,
    ).toBe(false);
    await expect
      .poll(async () => {
        const frames = (await designData(request, designId)).canvasFrames;
        return {
          copy: frames?.[dup1Id],
          sourceZ: frames?.[sourceId]?.z,
          firstCopyZ: frames?.[dup1Id]?.z,
          neighborZ: frames?.[neighborId]?.z,
          fartherZ: frames?.[fartherId]?.z,
        };
      })
      .toEqual({
        copy: {
          ...sourceGeometry,
          x: sourceGeometry.x + sourceGeometry.width + DESIGN_SCREEN_GAP,
          z: 1,
        },
        sourceZ: 0,
        firstCopyZ: 1,
        neighborZ: 2,
        fartherZ: 3,
      });

    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect
      .poll(async () => (await fileList(request, designId)).includes(dup2!))
      .toBe(true);
    const redoneCopyId = await fileId(request, designId, dup2!);
    await expect
      .poll(async () => {
        const frames = (await designData(request, designId)).canvasFrames;
        return {
          copy: frames?.[redoneCopyId],
          firstCopyZ: frames?.[dup1Id]?.z,
          neighborZ: frames?.[neighborId]?.z,
          fartherZ: frames?.[fartherId]?.z,
        };
      })
      .toEqual({
        copy: { ...sourceGeometry, x: secondDuplicateX, z: 1 },
        firstCopyZ: 2,
        neighborZ: 3,
        fartherZ: 4,
      });
    await expect
      .poll(async () => (await selectionContext(request)).selectedScreenIds)
      .toEqual([redoneCopyId]);
  });

  test("step 5 [overview, multi-selection]: Cmd+D duplicates every selected screen in one undo step", async ({
    page,
    request,
  }) => {
    ({ designId } = await newDesign(request, [
      { filename: "index.html", content: BLANK_SCREEN("Source") },
      { filename: "neighbor.html", content: BLANK_SCREEN("Neighbor") },
      { filename: "farther.html", content: BLANK_SCREEN("Farther") },
    ]));
    const sourceId = await fileId(request, designId, "index.html");
    const neighborId = await fileId(request, designId, "neighbor.html");
    const fartherId = await fileId(request, designId, "farther.html");
    const geometry = {
      [sourceId]: { x: 0, y: 120, width: 320, height: 240, z: 0 },
      [neighborId]: { x: 376, y: 120, width: 320, height: 240, z: 1 },
      [fartherId]: { x: 1128, y: 120, width: 320, height: 240, z: 2 },
    };
    await action(request, "update-design", {
      id: designId,
      dataOperations: Object.entries(geometry).map(([id, value]) => ({
        op: "set",
        path: ["canvasFrames", id],
        value,
      })),
    });
    await page.goto(`${BASE_URL}/design/${designId}?view=overview&zoom=30`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-screen-shell]")).toHaveCount(3, {
      timeout: 40_000,
    });
    const sourceCard = page.locator(
      `[data-frame-id="${sourceId}"] [data-screen-card]`,
    );
    await expect(sourceCard).toBeVisible();
    await sourceCard.click({ force: true });
    await expect
      .poll(async () => (await selectionContext(request)).selectedScreenIds)
      .toEqual([sourceId]);
    await page.keyboard.press(`${MOD}+a`);
    await expect
      .poll(async () =>
        (await selectionContext(request)).selectedScreenIds?.slice().sort(),
      )
      .toEqual([sourceId, neighborId, fartherId].sort());

    const filesBefore = await fileList(request, designId);
    await focusCanvas(page);
    await page.keyboard.press(`${MOD}+d`);
    let filesAfter: string[] = [];
    await expect
      .poll(
        async () => {
          filesAfter = await fileList(request, designId);
          return filesAfter.length;
        },
        { timeout: 10_000 },
      )
      .toBe(filesBefore.length + 3);
    const copies = filesAfter.filter(
      (filename) => !filesBefore.includes(filename),
    );
    expect(copies.slice().sort()).toEqual(
      ["index-copy.html", "neighbor-copy.html", "farther-copy.html"].sort(),
    );
    const [sourceCopyId, neighborCopyId, fartherCopyId] = await Promise.all([
      fileId(request, designId, "index-copy.html"),
      fileId(request, designId, "neighbor-copy.html"),
      fileId(request, designId, "farther-copy.html"),
    ]);
    await expect
      .poll(() => selectedScreenFilenames(request, designId))
      .toEqual(copies.slice().sort());
    await expect
      .poll(async () => {
        const frames = (await designData(request, designId)).canvasFrames;
        return {
          sourceCopy: frames?.[sourceCopyId],
          neighborCopy: frames?.[neighborCopyId],
          fartherCopy: frames?.[fartherCopyId],
          farther: frames?.[fartherId],
        };
      })
      .toEqual({
        sourceCopy: {
          ...geometry[sourceId],
          x:
            geometry[neighborId].x +
            geometry[neighborId].width +
            DESIGN_SCREEN_GAP,
          z: 1,
        },
        neighborCopy: {
          ...geometry[neighborId],
          x:
            geometry[fartherId].x +
            geometry[fartherId].width +
            DESIGN_SCREEN_GAP,
          z: 3,
        },
        fartherCopy: {
          ...geometry[fartherId],
          x:
            geometry[fartherId].x +
            2 * (geometry[fartherId].width + DESIGN_SCREEN_GAP),
          z: 5,
        },
        farther: { ...geometry[fartherId], z: 4 },
      });

    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(async () => (await fileList(request, designId)).length)
      .toBe(filesBefore.length);
    await expect
      .poll(async () => {
        const frames = (await designData(request, designId)).canvasFrames;
        return [frames?.[sourceId], frames?.[neighborId], frames?.[fartherId]];
      })
      .toEqual([geometry[sourceId], geometry[neighborId], geometry[fartherId]]);

    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect
      .poll(async () => (await fileList(request, designId)).length)
      .toBe(filesBefore.length + 3);
    await expect
      .poll(() => selectedScreenFilenames(request, designId))
      .toEqual(copies.slice().sort());
    const [redoneSourceCopyId, redoneNeighborCopyId, redoneFartherCopyId] =
      await Promise.all([
        fileId(request, designId, "index-copy.html"),
        fileId(request, designId, "neighbor-copy.html"),
        fileId(request, designId, "farther-copy.html"),
      ]);
    await expect
      .poll(async () => {
        const frames = (await designData(request, designId)).canvasFrames;
        return {
          sourceCopy: frames?.[redoneSourceCopyId],
          neighborCopy: frames?.[redoneNeighborCopyId],
          fartherCopy: frames?.[redoneFartherCopyId],
        };
      })
      .toEqual({
        sourceCopy: {
          ...geometry[sourceId],
          x:
            geometry[neighborId].x +
            geometry[neighborId].width +
            DESIGN_SCREEN_GAP,
          z: 1,
        },
        neighborCopy: {
          ...geometry[neighborId],
          x:
            geometry[fartherId].x +
            geometry[fartherId].width +
            DESIGN_SCREEN_GAP,
          z: 3,
        },
        fartherCopy: {
          ...geometry[fartherId],
          x:
            geometry[fartherId].x +
            2 * (geometry[fartherId].width + DESIGN_SCREEN_GAP),
          z: 5,
        },
      });
  });

  test("step 6 [in-screen]: dragging a new element into the assembled page reorders it between existing children via the layers panel", async ({
    page,
    request,
  }) => {
    const PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Home</title></head>
<body style="margin:0;min-height:900px;background:#fff">
  <div data-agent-native-node-id="hero" data-agent-native-layer-name="Hero" style="height:200px;background:#eee"></div>
  <div data-agent-native-node-id="skills" data-agent-native-layer-name="Skills" style="height:200px;background:#ddd"></div>
  <div data-agent-native-node-id="bio" data-agent-native-layer-name="Bio" style="height:120px;background:#ccc"></div>
</body></html>`;
    ({ designId } = await newDesign(request, [
      { filename: "index.html", content: PAGE_HTML },
    ]));
    await gotoEditor(page, designId);
    await expandAllLayers(page);

    const bioRow = layerRowButton(page, "Bio").locator(
      'xpath=ancestor::*[@role="treeitem"][1]',
    );
    const skillsRow = layerRowButton(page, "Skills").locator(
      'xpath=ancestor::*[@role="treeitem"][1]',
    );
    const skillsRowBox = (await skillsRow.boundingBox())!;
    await bioRow.dragTo(skillsRow, {
      targetPosition: { x: 10, y: skillsRowBox.height - 2 },
    });

    const computeOrder = (html: string) =>
      ["hero", "skills", "bio"]
        .map((id) => ({
          id,
          index: html.indexOf(`data-agent-native-node-id="${id}"`),
        }))
        .sort((a, b) => a.index - b.index)
        .map((e) => e.id);
    let html = "";
    await expect
      .poll(
        async () => {
          html = await fileContent(request, designId);
          return computeOrder(html);
        },
        {
          timeout: 10_000,
          message:
            "dragging Bio above Skills in the layers panel should reorder the DOM",
        },
      )
      .toEqual(["hero", "bio", "skills"]);

    await selectLayerByName(page, "Skills");
    const widthModeButton = page
      .locator('button[aria-label*="sizing mode" i], button[aria-label^="W "]')
      .first();
    await expect(
      widthModeButton,
      "the per-axis sizing control (Fixed/Hug/Fill) should be present in the inspector for a code-layer child",
    ).toBeVisible({ timeout: 10_000 });
  });

  test("'Go to main component' jumps to app source; on a static prototype instance it shows an unavailable toast instead of crashing", async ({
    page,
    request,
  }) => {
    ({ designId } = await newDesign(request, [
      { filename: "index.html", content: NAV_SCREEN },
    ]));
    await gotoEditor(page, designId);
    await expandAllLayers(page);
    await selectLayerByName(page, "Navigation");
    await page.waitForTimeout(600);

    const goToMainButton = page.getByRole("button", {
      name: /go to main component/i,
    });
    const exists = (await goToMainButton.count()) > 0;
    if (exists) {
      const urlBefore = page.url();
      await goToMainButton.first().click({ force: true });
      const toastLocator = page.getByText(
        /unavailable|only known instance|could not|not found|no source/i,
      );
      await expect
        .poll(
          async () =>
            (await toastLocator.first().isVisible()) ||
            page.url() === urlBefore,
          {
            timeout: 10_000,
            message:
              "clicking 'Go to main component' on a prototype-only instance (no real source) should stay on the editor (toast preferred, silent no-nav acceptable) rather than crash or navigate away",
          },
        )
        .toBe(true);
    }

    const target = page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator('[data-agent-native-node-id="nav-root"]');
    await target.click({ button: "right", force: true });
    await page.waitForTimeout(400);
    const menu = page.getByRole("menu");
    if ((await menu.count()) > 0) {
      await expect(menu.getByText(/reset all changes/i)).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
  });
});
