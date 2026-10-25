import type { Page } from "@playwright/test";

import {
  FIXTURE,
  MOD,
  geom,
  indexHtml,
  layerRow,
  layersTree,
  newDesign,
  node,
  openEditor,
  postAction,
  selectViaTree,
  setBaseURL,
} from "./drag-and-drop.shared";
import { appPath, expandAllLayers } from "./helpers";
import { expect, expectOnlyChanged, test } from "./rails";

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

for (const platform of ["MacIntel", "Linux x86_64"]) {
  test(`nudging a screen then undoing immediately restores persisted geometry (${platform})`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((platform) => {
      Object.defineProperty(navigator, "platform", { value: platform });
    }, platform);
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
    const renderedX = () =>
      screen.evaluate((element) =>
        Number.parseFloat((element as HTMLElement).style.left),
      );
    const beforeRenderedX = await renderedX();
    expect(Number.isFinite(beforeRenderedX)).toBe(true);

    await page.keyboard.down("ArrowRight");
    await page.keyboard.down("ArrowRight");
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up("ArrowRight");
    await expect.poll(renderedX).toBe(beforeRenderedX + 2);

    await page.keyboard.press(platform === "MacIntel" ? "Meta+Z" : "Control+Z");
    await expect.poll(renderedX).toBe(beforeRenderedX);
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
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(screen).toBeVisible();
    await expect.poll(renderedX).toBe(beforeRenderedX);
    const reloaded = await readIndexFrame(page, id);
    expect([reloaded.x, reloaded.y]).toEqual([before.x, before.y]);
    await testInfo.attach("nudge undo after reload", {
      body: await page.screenshot({
        path: testInfo.outputPath("nudge-undo-after-reload.png"),
      }),
      contentType: "image/png",
    });
  });
}

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
  app,
  page,
}) => {
  const id = await app.seed(FIXTURE);
  await app.open(id);
  await expandAllLayers(page);
  await selectViaTree(page, "Box A");
  const before = await app.savedNodes(id);

  await page.keyboard.press("Delete");
  await app.settled();
  expect(
    (await app.savedNodes(id)).has("box-a"),
    "precondition: the delete must be saved",
  ).toBe(false);

  await page.keyboard.press(UNDO);
  await app.settled();

  const after = await app.savedNodes(id);
  expect(after.get("box-a")).toEqual(before.get("box-a"));
  expectOnlyChanged(before, after, []);
  expect(await app.selectedLayers()).toEqual(["Box A"]);
  await expect(app.node("box-a")).toBeVisible();
});

test("renaming a layer then one undo restores its previous name", async ({
  app,
  page,
}) => {
  const id = await app.seed(FIXTURE);
  await app.open(id);
  await expandAllLayers(page);
  const before = await app.savedNodes(id);
  const layers = page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem");
  const layerName = async () =>
    (await app.savedNodes(id)).get("box-b")?.attrs[
      "data-agent-native-layer-name"
    ];

  await layers
    .filter({ hasText: "Box B" })
    .first()
    .locator("[data-layer-row-button]")
    .first()
    .dblclick();
  const input = page.locator('input[aria-label="Rename layer"]');
  await input.fill("Renamed Box");
  await input.press("Enter");
  await expect(input).toHaveCount(0);
  await app.settled();
  expect(await layerName(), "precondition: the rename must be saved").toBe(
    "Renamed Box",
  );
  const renamed = await app.savedNodes(id);

  await page.keyboard.press(UNDO);
  await app.settled();
  expect(await layerName()).toBe("Box B");
  expectOnlyChanged(before, await app.savedNodes(id), []);
  await expect(layers.filter({ hasText: "Box B" })).toHaveCount(1);
  await expect(layers.filter({ hasText: "Renamed Box" })).toHaveCount(0);

  await page.keyboard.press(REDO);
  await app.settled();
  expect(await layerName()).toBe("Renamed Box");
  expectOnlyChanged(renamed, await app.savedNodes(id), []);
  await expect(layers.filter({ hasText: "Renamed Box" })).toHaveCount(1);
});

test("committing an inspector width value then one undo restores the exact previous width", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  await selectViaTree(page, "Box A");

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
    app,
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

    await selectViaTree(page, "Box A");
    const before = await geom(page, id, "box-a");
    await dragElement(page, "box-a", 80, 30);
    const dropped = await geom(page, id, "box-a");
    expect(dropped.left).not.toBe(before.left);

    await page.evaluate(
      ({ px, py, frames }) => {
        const samples: { theme: string; background: string }[] = [];
        (window as unknown as { __undoFrames: typeof samples }).__undoFrames =
          samples;
        const backgroundAt = () => {
          for (
            let el = document.elementFromPoint(px, py) as HTMLElement | null;
            el;
            el = el.parentElement
          ) {
            const color = getComputedStyle(el).backgroundColor;
            if (
              color &&
              color !== "rgba(0, 0, 0, 0)" &&
              color !== "transparent"
            )
              return color;
          }
          return "none";
        };
        const tick = () => {
          const root = document.documentElement.classList;
          samples.push({
            theme: root.contains("dark")
              ? "dark"
              : root.contains("light")
                ? "light"
                : "none",
            background: backgroundAt(),
          });
          if (samples.length < frames) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { px: sampleX, py: sampleY, frames: 90 },
    );
    await page.keyboard.press(UNDO);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __undoFrames: unknown[] }).__undoFrames
              .length,
        ),
      )
      .toBe(90);
    const frames = await page.evaluate(
      () =>
        (
          window as unknown as {
            __undoFrames: { theme: string; background: string }[];
          }
        ).__undoFrames,
    );
    const distinct = [
      ...new Set(frames.map((frame) => `${frame.theme} ${frame.background}`)),
    ];
    expect(
      distinct,
      "every animation frame across the undo must keep this theme and canvas colour",
    ).toEqual([`${theme} ${frames[0].background}`]);
    await app.settled();
    const undone = await geom(page, id, "box-a");
    expect([undone.left, undone.top]).toEqual([before.left, before.top]);
  });
}

const selectedRows = (page: Page) =>
  page.locator('[role="treeitem"][aria-selected="true"]');
const selectedLayerNames = (page: Page) => () =>
  selectedRows(page).allInnerTexts();

async function commitBoxAWidth(page: Page, designId: string, width: number) {
  await selectViaTree(page, "Box A");
  const wField = page.getByLabel("W size in pixels");
  await expect(wField).toBeVisible({ timeout: 10_000 });
  const before = await geom(page, designId, "box-a");
  await wField.fill(String(width));
  await wField.press("Enter");
  await expect
    .poll(async () => (await geom(page, designId, "box-a")).width, {
      timeout: 15_000,
      message: "the inspector width commit must persist",
    })
    .toBe(width);
  return before.width;
}

test("selection changes after an edit are not undo steps: one undo reverts the edit and reselects the edited layer", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  const widthBefore = await commitBoxAWidth(page, id, 240);

  await selectViaTree(page, "Box B");
  await selectViaTree(page, "Chip 1");
  await page.keyboard.press("Escape");
  await expect(selectedRows(page)).toHaveCount(0);

  await page.keyboard.press(UNDO);
  await expect
    .poll(async () => (await geom(page, id, "box-a")).width, {
      timeout: 15_000,
      message: "the first undo must revert the width, not walk the selection",
    })
    .toBe(widthBefore);
  await expect
    .poll(selectedLayerNames(page), {
      message: "undo restores the selection the edit was made with",
    })
    .toEqual(["Box A"]);

  await page.keyboard.press(REDO);
  await expect
    .poll(async () => (await geom(page, id, "box-a")).width, {
      timeout: 15_000,
    })
    .toBe(240);
  await expect.poll(selectedLayerNames(page)).toEqual(["Box A"]);
});

test("a selection change between undo and redo keeps the redo", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  const widthBefore = await commitBoxAWidth(page, id, 240);

  await page.keyboard.press(UNDO);
  await expect
    .poll(async () => (await geom(page, id, "box-a")).width, {
      timeout: 15_000,
    })
    .toBe(widthBefore);

  await selectViaTree(page, "Box B");
  await expect.poll(selectedLayerNames(page)).toEqual(["Box B"]);

  await page.keyboard.press(REDO);
  await expect
    .poll(async () => (await geom(page, id, "box-a")).width, {
      timeout: 15_000,
      message: "selecting a layer must not clear the redo stack",
    })
    .toBe(240);
  await expect
    .poll(selectedLayerNames(page), {
      message: "redo restores the selection the edit left behind",
    })
    .toEqual(["Box A"]);
});

test("Escape after drawing a line is not an undo step: one undo removes the line", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  const lineRows = layersTree(page)
    .getByRole("treeitem")
    .filter({ hasText: /^Line$/ });
  await expect(lineRows).toHaveCount(0);

  const boxB = await box(page, "box-b");
  const start = { x: boxB.x + boxB.width + 80, y: boxB.y + 10 };
  await page.keyboard.press("l");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 140, start.y + 30, { steps: 16 });
  await page.mouse.up();
  await expect(lineRows).toHaveCount(1, { timeout: 15_000 });
  await expect.poll(selectedLayerNames(page)).toEqual(["Line"]);

  await page.keyboard.press("Escape");
  await expect(selectedRows(page)).toHaveCount(0);

  await page.keyboard.press(UNDO);
  await expect(
    lineRows,
    "the first undo after Escape must remove the line, not reselect it",
  ).toHaveCount(0, { timeout: 15_000 });
});

test("one text edit session is one undo step", async ({ page }) => {
  const id = await newDesign(
    page,
    FIXTURE.replace(
      "</body>",
      `<p data-agent-native-node-id="label" data-agent-native-layer-name="Label"
         style="position:absolute;left:400px;top:280px;margin:0;font-size:32px;color:#fff">Hello world</p>
  </body>`,
    ),
  );
  await openEditor(page, id);
  const labelText = async () =>
    (await indexHtml(page, id)).match(
      /data-agent-native-node-id="label"[^>]*>([^<]*)</,
    )?.[1];
  const editing = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll("iframe")).some((iframe) =>
        (iframe as HTMLIFrameElement).contentDocument?.querySelector(
          '[contenteditable="true"]',
        ),
      ),
    );

  const label = await box(page, "label");
  await page.mouse.dblclick(
    label.x + label.width - 4,
    label.y + label.height / 2,
  );
  await expect.poll(editing).toBe(true);
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await page.keyboard.press("Escape");
  await expect.poll(editing).toBe(false);
  await expect.poll(labelText, { timeout: 15_000 }).toBe("Hello world!");
  await page.keyboard.press("Escape");
  await expect(selectedRows(page)).toHaveCount(0);

  await page.keyboard.press(UNDO);
  await expect
    .poll(labelText, {
      timeout: 15_000,
      message: "one undo must revert the whole text edit session",
    })
    .toBe("Hello world");
  await expect.poll(selectedLayerNames(page)).toEqual(["Label"]);

  await page.keyboard.press(REDO);
  await expect.poll(labelText, { timeout: 15_000 }).toBe("Hello world!");
});

test("a marquee selection after an edit is not an undo step", async ({
  page,
}) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  const widthBefore = await commitBoxAWidth(page, id, 240);

  const boxA = await box(page, "box-a");
  const boxB = await box(page, "box-b");
  await page.mouse.move(boxA.x - 20, boxA.y - 20);
  await page.mouse.down();
  await page.mouse.move(boxB.x + boxB.width + 20, boxB.y + boxB.height + 20, {
    steps: 24,
  });
  await page.mouse.up();
  await expect(layerRow(page, "Box B")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.keyboard.press(UNDO);
  await expect
    .poll(async () => (await geom(page, id, "box-a")).width, {
      timeout: 15_000,
      message: "the first undo must revert the width, not the marquee",
    })
    .toBe(widthBefore);
  await expect.poll(selectedLayerNames(page)).toEqual(["Box A"]);
});
