import { expect, test, type Page } from "@playwright/test";

import {
  FIXTURE,
  MOD,
  geom,
  newDesign,
  node,
  openEditor,
  postAction,
  selectViaTree,
  setBaseURL,
} from "./drag-and-drop.shared";
import { appPath } from "./helpers";

/**
 * Figma parity — §13 Undo/Redo (+ Part 3 resolutions).
 *
 * Undo granularity across gesture families: one drag/reparent/dup/resize/
 * group/paste/delete/rename/inspector-commit is exactly one undo step that
 * restores the FULL pre-state (parent, position, name, selection); redo
 * re-applies exactly; a fresh edit after undo clears the redo stack; undo
 * targets the file that was actually edited, not whichever screen currently
 * has focus; undo must never change the canvas background/theme.
 *
 * Drag-move / drag-reparent / alt-drag-duplicate / resize / group-ungroup /
 * layers-panel-move undo granularity already have dedicated coverage in
 * their own parity-*.spec.ts files — this file covers the remaining gesture
 * families (delete, rename, inspector commit, redo fidelity, redo-stack
 * invalidation, cross-screen undo targeting) plus the background/theme
 * regression Steve reported riding along with undo.
 */

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

  // A second, unrelated edit — this must invalidate the redo entry that
  // would have re-applied box-a's drag.
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
  expect([restored.left, restored.top, restored.width, restored.height]).toEqual([
    before.left,
    before.top,
    before.width,
    before.height,
  ]);
  // Figma restores selection to the undeleted element, not to nothing.
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
  await row.locator("[data-layer-row-button]").first().dblclick({ force: true });
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

  // Shift focus/selection to the OTHER screen before undoing — this is the
  // scenario the two merged undo systems (Yjs per-file UndoManager +
  // geometry ref stacks, ordered by historyOrderRef) are most likely to get
  // wrong if undo is scoped to "whichever file is currently active" instead
  // of "the file that was actually last edited".
  const page2Iframe = page.locator(
    'iframe[data-design-preview-iframe][data-screen-iframe-id]',
  );
  const target = page2Iframe
    .last()
    .contentFrame()
    .locator('[data-agent-native-node-id="page2-target"]');
  await target.click({ force: true });
  await page.waitForTimeout(300);

  await page.keyboard.press(UNDO);
  await page.waitForTimeout(500);

  const undone = await geom(page, id, "box-a");
  expect(
    [undone.left, undone.top],
    `undo must revert the box-a edit on screen one even though screen two currently has focus/selection; before=(${before.left},${before.top}) dropped=(${dropped.left},${dropped.top}) after-undo=(${undone.left},${undone.top}). Trace: ${(await dumpTrace(page)).slice(-500)}`,
  ).toEqual([before.left, before.top]);
});

for (const { theme, canvasRgb } of [
  { theme: "dark" as const, canvasRgb: "26,26,26" },
  { theme: "light" as const, canvasRgb: "235,235,235" },
]) {
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

    await page.goto(appPath(`/design/${id}`), { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-design-bottom-toolbar]")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));

    const canvasBox = await page
      .locator("[data-design-canvas-container]")
      .boundingBox();
    if (!canvasBox) throw new Error("no canvas container box");
    const sampleX = Math.round(canvasBox.x + canvasBox.width * 0.15);
    const sampleY = Math.round(canvasBox.y + canvasBox.height * 0.6);

    await expect.poll(() => pixelAt(page, sampleX, sampleY)).toBe(canvasRgb);

    await selectViaTree(page, "Box A");
    const before = await geom(page, id, "box-a");
    await dragElement(page, "box-a", 80, 30);
    const dropped = await geom(page, id, "box-a");
    expect(dropped.left).not.toBe(before.left);

    // Steve: "the white background comes back on undo". Sample the canvas
    // background immediately around and after the undo, not just once.
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
