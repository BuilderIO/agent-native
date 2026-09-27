import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath, designFrame, expandAllLayers, gotoEditor } from "./helpers";

/**
 * YouTube tutorial parity — #1 (CodeWithChris: "Designing an App in Figma —
 * A Step-by-Step Guide for Beginners") and #2 (Steven Steward: "Figma
 * Tutorial For Beginners 2024 | Web Design of Landing Page").
 *
 * Scope per the finder preamble: canvas pointer gestures, layers panel,
 * context menu, clipboard/duplicate, group/frame/ungroup structure,
 * undo/redo, mouse pan/zoom, board objects, screens as frames. Frame
 * presets, auto layout (Shift+A), constraints, typography, fill/stroke
 * pickers, and corner-radius scrubbing are peer-owned (codex) — noted as
 * findings, not asserted here as pass/fail.
 *
 * Both tutorials build ROOT-LEVEL frames as agent-native screens. Per
 * "Screens are frames" (Steve, 2026-09-12) a root screen must behave like an
 * ordinary Figma top-level frame: the Screen tool draws it with white fill
 * and clipsContent=true, it can sit as a sibling of another screen on the
 * board, and duplicate/undo/drag work on it the same way they do on any
 * other frame.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
const MOD = process.platform === "darwin" ? "Meta" : "Control";

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

async function getDesign(page: Page, id: string) {
  return page.request
    .get(`${BASE_URL}/_agent-native/actions/get-design?id=${id}`)
    .then((r) => r.json());
}

async function fileContent(page: Page, id: string, filename: string) {
  const record = await getDesign(page, id);
  const content = (record.files ?? []).find(
    (f: any) => f.filename === filename,
  )?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error(`${filename} is missing or empty`);
  }
  return content;
}

async function dumpTrace(page: Page) {
  return page
    .evaluate(() => (window as any).__designTrace?.dump?.() ?? "(no trace)")
    .catch(() => "(trace unavailable)");
}

function layerTree(page: Page): Locator {
  return page.getByRole("tree", { name: "Layers" });
}

function layerRowButton(page: Page, name: string): Locator {
  return layerTree(page)
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first();
}

function layerRow(page: Page, name: string): Locator {
  return layerRowButton(page, name).locator(
    'xpath=ancestor::*[@role="treeitem"][1]',
  );
}

async function clickLayerRow(page: Page, name: string): Promise<void> {
  const button = layerRowButton(page, name);
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click({ force: true });
}

async function selectByNodeId(page: Page, nodeId: string) {
  const el = designFrame(page).locator(
    `[data-agent-native-node-id="${nodeId}"]`,
  );
  const box = (await el.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(200);
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(200);
  return box;
}

async function rightClickCanvasNode(page: Page, nodeId: string): Promise<void> {
  const frame = designFrame(page);
  const node = frame.locator(`[data-agent-native-node-id="${nodeId}"]`);
  const point = await node.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await node.evaluate((_element, pt) => {
    document.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        buttons: 2,
        clientX: pt.x,
        clientY: pt.y,
      }),
    );
  }, point);
}

const MOBILE_HOME_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Home</title></head>
  <body style="margin:0;position:relative;min-height:900px;background:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="header" data-agent-native-layer-name="Header"
         style="position:absolute;left:0;top:0;width:390px;height:80px">
      <div data-agent-native-node-id="greeting" data-agent-native-layer-name="Good Morning"
           style="position:absolute;left:16px;top:16px;font-size:24px;font-weight:700">Good Morning</div>
    </div>
    <div data-agent-native-node-id="card" data-agent-native-layer-name="Card"
         style="position:absolute;left:16px;top:100px;width:358px;height:100px;background:#f2f2f2">
      <div data-agent-native-node-id="cardtitle" data-agent-native-layer-name="Sunrise Cafe"
           style="position:absolute;left:12px;top:12px;font-size:16px;font-weight:600">Sunrise Cafe</div>
    </div>
  </body>
</html>`;

const LANDING_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Landing Page</title></head>
  <body style="margin:0;position:relative;min-height:2400px;background:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="navbar" data-agent-native-layer-name="Navbar"
         style="position:absolute;left:0;top:0;width:1440px;height:80px;background:#fff">
      <div data-agent-native-node-id="brand" data-agent-native-layer-name="Brand"
           style="position:absolute;left:32px;top:28px;font-size:20px;font-weight:700">Brand</div>
    </div>
    <div data-agent-native-node-id="hero" data-agent-native-layer-name="Hero"
         style="position:absolute;left:0;top:80px;width:1440px;height:640px;background:#fff">
      <div data-agent-native-node-id="heroimage" data-agent-native-layer-name="HeroImage"
           style="position:absolute;left:800px;top:80px;width:560px;height:480px;background:#e5e7eb"></div>
    </div>
  </body>
</html>`;

const BLANK_SCREEN_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Home</title></head>
  <body style="margin:0;min-height:900px;background:#fff"></body>
</html>`;

async function createDesignWithHtml(request: APIRequestContext, html: string) {
  const created = await action(request, "create-design", {
    title: `YT mobile/landing parity ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: html,
    fileType: "html",
  });
  return designId as string;
}

async function deleteDesign(request: APIRequestContext, designId: string) {
  await action(request, "delete-design", { id: designId }).catch(() => {});
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

async function drawFrameTool(
  page: Page,
  mode: "Frame" | "Screen",
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await pickFrameMode(page, mode);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 16 });
  await page.mouse.up();
}

async function emptyBoardPoint(page: Page) {
  const point = await page.evaluate(() => {
    const world = document.querySelector("[data-multi-screen-canvas-world]");
    const surface = (world?.parentElement ?? world) as HTMLElement | null;
    if (!surface) return null;
    const r = surface.getBoundingClientRect();
    const cards = Array.from(
      document.querySelectorAll("[data-screen-iframe-id]"),
    ).map((el) => el.getBoundingClientRect());
    for (let y = r.top + 60; y < r.bottom - 60; y += 40) {
      for (let x = r.left + 60; x < r.right - 60; x += 40) {
        if (
          cards.some(
            (c) =>
              x >= c.left - 24 &&
              x <= c.right + 24 &&
              y >= c.top - 24 &&
              y <= c.bottom + 24,
          )
        )
          continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && surface.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("no empty canvas point found at this viewport");
  return point;
}

async function openOverview(page: Page, designId: string) {
  await page.goto(appPath(`/design/${designId}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  await page
    .locator('[data-design-bottom-toolbar] button[aria-label="Move"]')
    .waitFor({ timeout: 45_000 });
  await expect(page.locator("[data-screen-shell]")).toHaveCount(1, {
    timeout: 30_000,
  });
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe("YT #1 (mobile app beginner tutorial)", () => {
  test("step 2/25: Screen tool draws a root screen with Figma's default top-level-frame fill/clip, and a second screen sits beside the first as a sibling, not nested", async ({
    page,
    request,
  }) => {
    const designId = await createDesignWithHtml(request, BLANK_SCREEN_HTML);
    try {
      await openOverview(page, designId);
      const filesBefore: string[] = (await getDesign(page, designId)).files.map(
        (f: any) => f.filename,
      );

      const empty = await emptyBoardPoint(page);
      await drawFrameTool(page, "Screen", empty, {
        x: empty.x + 390,
        y: empty.y + 700,
      });

      let record: any;
      await expect
        .poll(
          async () => {
            record = await getDesign(page, designId);
            return record.files.length;
          },
          { timeout: 10_000 },
        )
        .toBe(filesBefore.length + 1);
      const filesAfter: string[] = record.files.map((f: any) => f.filename);
      expect(
        filesAfter.length,
        `expected exactly one new screen file; trace: ${await dumpTrace(page)}`,
      ).toBe(filesBefore.length + 1);
      const newFile = record.files.find(
        (f: any) => !filesBefore.includes(f.filename),
      );
      expect(
        newFile,
        "Screen tool must create a new screen file, not draw into the existing one",
      ).toBeTruthy();
      expect(newFile.content.toLowerCase()).toContain("#ffffff");
      expect(newFile.content.toLowerCase()).toMatch(/overflow\s*:\s*hidden/);

      await expect(page.locator("[data-screen-shell]")).toHaveCount(2, {
        timeout: 10_000,
      });
      await expect(page.locator("[data-screen-card]")).toHaveCount(2);
    } finally {
      await deleteDesign(request, designId);
    }
  });

  test("clicking the Screen tool creates the first Desktop preset size", async ({
    page,
    request,
  }) => {
    const designId = await createDesignWithHtml(request, BLANK_SCREEN_HTML);
    try {
      await openOverview(page, designId);
      const before = new Set(
        (await getDesign(page, designId)).files.map((file: any) => file.id),
      );
      const empty = await emptyBoardPoint(page);
      await pickFrameMode(page, "Screen");
      await page.mouse.click(empty.x, empty.y);

      let result: { width: number; height: number } | null = null;
      await expect
        .poll(async () => {
          const record = await getDesign(page, designId);
          const created = record.files.find(
            (file: any) => !before.has(file.id),
          );
          const data =
            typeof record.data === "string"
              ? JSON.parse(record.data)
              : record.data;
          const frame = created && data?.canvasFrames?.[created.id];
          result = frame ? { width: frame.width, height: frame.height } : null;
          return result;
        })
        .toEqual({ width: 1440, height: 1024 });
    } finally {
      await deleteDesign(request, designId);
    }
  });

  test("step 18: Cmd+D three times on Card produces 4 identically-named copies, each directly above the previous, ending selection on the newest copy", async ({
    page,
    request,
  }) => {
    const designId = await createDesignWithHtml(request, MOBILE_HOME_HTML);
    try {
      await gotoEditor(page, designId);
      await expandAllLayers(page);
      await clickLayerRow(page, "Card");

      for (let i = 0; i < 3; i += 1) {
        await page.keyboard.press(`${MOD}+d`);
        await expect
          .poll(
            () =>
              layerTree(page)
                .locator('[data-layer-row-button] span[title="Card"]')
                .count(),
            { timeout: 10_000, message: `after duplicate #${i + 1}` },
          )
          .toBe(i + 2);
      }

      let html = "";
      let cardIds: string[] = [];
      await expect
        .poll(
          async () => {
            html = await fileContent(page, designId, "index.html");
            cardIds = [
              ...html.matchAll(
                /data-agent-native-node-id="([^"]+)"[^>]*data-agent-native-layer-name="Card"/g,
              ),
            ].map((m) => m[1]);
            return cardIds.length;
          },
          { timeout: 10_000, message: "Card count in persisted index.html" },
        )
        .toBe(4);
      expect(cardIds, `trace: ${await dumpTrace(page)}`).toHaveLength(4);
      const bodyOrder = [
        ...html.matchAll(/data-agent-native-node-id="([^"]+)"/g),
      ].map((m) => m[1]);
      const cardPositions = cardIds.map((id) => bodyOrder.indexOf(id));
      const sorted = [...cardPositions].sort((a, b) => a - b);
      expect(
        cardPositions,
        "newest copy must sit directly above the one it duplicated",
      ).toEqual(sorted);

      const cardRows = layerTree(page)
        .locator("[data-layer-row-button][data-layer-node-id]")
        .filter({ has: page.locator('span[title="Card"]') });
      await expect(cardRows).toHaveCount(4);
      await expect(
        cardRows.first().locator('xpath=ancestor::*[@role="treeitem"][1]'),
      ).toHaveAttribute("aria-selected", "true");
    } finally {
      await deleteDesign(request, designId);
    }
  });

  test("step 20: renaming one duplicate's title in the Layers panel only changes that layer, leaving Header's greeting and the original Card untouched", async ({
    page,
    request,
  }) => {
    const designId = await createDesignWithHtml(request, MOBILE_HOME_HTML);
    try {
      await gotoEditor(page, designId);
      await expandAllLayers(page);
      await clickLayerRow(page, "Card");
      await page.keyboard.press(`${MOD}+d`);
      await expect
        .poll(
          () =>
            layerTree(page)
              .locator('[data-layer-row-button] span[title="Card"]')
              .count(),
          { timeout: 10_000 },
        )
        .toBe(2);
      await expandAllLayers(page);

      const titleRows = layerTree(page).locator(
        '[data-layer-row-button] span[title="Sunrise Cafe"]',
      );
      await expect(titleRows).toHaveCount(2, { timeout: 10_000 });
      const duplicateTitleButton = titleRows
        .nth(0)
        .locator("xpath=ancestor::button[@data-layer-row-button][1]");
      await duplicateTitleButton.dblclick({ force: true });
      const renameInput = layerTree(page).locator("input").first();
      await expect(renameInput).toBeVisible();
      await renameInput.fill("Green Bowl");
      await renameInput.press("Enter");

      await expect(
        layerTree(page).locator(
          '[data-layer-row-button] span[title="Green Bowl"]',
        ),
      ).toHaveCount(1, { timeout: 10_000 });
      await expect(
        layerTree(page).locator(
          '[data-layer-row-button] span[title="Sunrise Cafe"]',
        ),
      ).toHaveCount(1);
      await expect(
        layerTree(page).locator(
          '[data-layer-row-button] span[title="Good Morning"]',
        ),
      ).toHaveCount(1);

      let html = "";
      await expect
        .poll(
          async () => {
            html = await fileContent(page, designId, "index.html");
            return html.includes('data-agent-native-layer-name="Green Bowl"');
          },
          { timeout: 10_000 },
        )
        .toBe(true);
      expect(html).toContain('data-agent-native-layer-name="Sunrise Cafe"');
    } finally {
      await deleteDesign(request, designId);
    }
  });

  test("dragging Card out of the Home screen onto the board reparents it to the board, and one undo restores it inside Home at the exact original position", async ({
    page,
    request,
  }) => {
    const designId = await createDesignWithHtml(request, MOBILE_HOME_HTML);
    try {
      await gotoEditor(page, designId);
      const screenId: string = (await getDesign(page, designId)).files.find(
        (f: any) => f.filename === "index.html",
      ).id;
      const before = (await designFrame(page, screenId)
        .locator('[data-agent-native-node-id="card"]')
        .boundingBox())!;
      const boardPoint = await emptyBoardPoint(page);

      await page.mouse.move(
        before.x + before.width / 2,
        before.y + before.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        before.x + before.width / 2 + 20,
        before.y + before.height / 2,
        { steps: 5 },
      );
      await page.mouse.move(boardPoint.x, boardPoint.y, { steps: 30 });
      await page.waitForTimeout(400);
      const trace = await dumpTrace(page);
      await page.mouse.up();
      await page.waitForTimeout(400);

      const htmlAfterDrag = await fileContent(page, designId, "index.html");
      expect(
        htmlAfterDrag,
        `Card must leave the Home screen's document; trace: ${JSON.stringify(trace)}`,
      ).not.toContain('data-agent-native-node-id="card"');

      await page.keyboard.press(`${MOD}+z`);

      let htmlAfterUndo = "";
      await expect
        .poll(
          async () => {
            htmlAfterUndo = await fileContent(page, designId, "index.html");
            return htmlAfterUndo.includes('data-agent-native-node-id="card"');
          },
          {
            timeout: 10_000,
            message: "one undo must restore Card back inside Home",
          },
        )
        .toBe(true);

      const afterUndoBox = (await designFrame(page, screenId)
        .locator('[data-agent-native-node-id="card"]')
        .boundingBox())!;
      expect(Math.round(afterUndoBox.x)).toBe(Math.round(before.x));
      expect(Math.round(afterUndoBox.y)).toBe(Math.round(before.y));
    } finally {
      await deleteDesign(request, designId);
    }
  });
});

test.describe("YT #2 (landing page tutorial)", () => {
  test('step 18: alt-dragging HeroImage duplicates it (original stays put, copy moves, copy is selected); one undo ("undo the nudge") removes the copy and restores the original selection', async ({
    page,
    request,
  }) => {
    const designId = await createDesignWithHtml(request, LANDING_HTML);
    try {
      await gotoEditor(page, designId);
      const frame = designFrame(page);
      const heroImage = frame.locator(
        '[data-agent-native-node-id="heroimage"]',
      );
      await expect(heroImage).toBeVisible();
      const before = (await heroImage.boundingBox())!;

      await expandAllLayers(page);
      await clickLayerRow(page, "HeroImage");
      await page.waitForTimeout(200);
      const heroRows = layerTree(page)
        .locator("[data-layer-row-content]")
        .filter({ has: page.locator('span[title="HeroImage"]') });
      await expect(heroRows).toHaveCount(1);
      await expect(heroRows.first()).toHaveAttribute(
        "data-layer-selection",
        "primary",
      );

      const startX = before.x + before.width / 2;
      const startY = before.y + before.height / 2;
      await page.mouse.move(startX, startY);
      await page.keyboard.down("Alt");
      await page.mouse.down();
      await page.mouse.move(startX + 60, startY + 40, { steps: 12 });
      await page.mouse.up();
      await page.keyboard.up("Alt");
      await page.waitForTimeout(300);

      const heroImages = frame.locator(
        '[data-agent-native-layer-name="HeroImage"]',
      );
      await expect(heroImages).toHaveCount(2, { timeout: 10_000 });
      const persisted = await fileContent(page, designId, "index.html");
      const copyId = [
        ...persisted.matchAll(
          /data-agent-native-node-id="([^"]+)"[^>]*data-agent-native-layer-name="HeroImage"/g,
        ),
      ]
        .map((match) => match[1])
        .find((id) => id !== "heroimage");
      expect(
        copyId,
        "alt-drag must persist a generated copy node",
      ).toBeTruthy();

      const originalAfter = await frame
        .locator('[data-agent-native-node-id="heroimage"]')
        .boundingBox();
      expect(Math.round(originalAfter!.x)).toBe(Math.round(before.x));
      expect(Math.round(originalAfter!.y)).toBe(Math.round(before.y));
      const copyAfter = await frame
        .locator(`[data-agent-native-node-id="${copyId}"]`)
        .boundingBox();
      expect(copyAfter).not.toBeNull();
      expect(Math.round(copyAfter!.x - before.x)).toBe(60);
      expect(Math.round(copyAfter!.y - before.y)).toBe(40);
      await expect(heroRows).toHaveCount(2);
      await expect(heroRows.first()).toHaveAttribute(
        "data-layer-selection",
        "primary",
      );

      await page.keyboard.press(`${MOD}+z`);
      await page.waitForTimeout(400);

      await expect(heroImages).toHaveCount(1, { timeout: 10_000 });
      await expect(heroRows).toHaveCount(1);
      await expect(heroRows.first()).toHaveAttribute(
        "data-layer-selection",
        "primary",
      );
      const afterUndo = await frame
        .locator('[data-agent-native-node-id="heroimage"]')
        .boundingBox();
      expect(Math.round(afterUndo!.x)).toBe(Math.round(before.x));
      expect(Math.round(afterUndo!.y)).toBe(Math.round(before.y));
    } finally {
      await deleteDesign(request, designId);
    }
  });

  test("step 20/26: Shift+1 zooms to fit the whole Landing Page, Shift+2 zooms tighter to just the selected Navbar", async ({
    page,
    request,
  }) => {
    const designId = await createDesignWithHtml(request, LANDING_HTML);
    try {
      await gotoEditor(page, designId);
      const navbar = designFrame(page).locator(
        '[data-agent-native-node-id="navbar"]',
      );
      await page.mouse.click(
        (await navbar.boundingBox())!.x + 10,
        (await navbar.boundingBox())!.y + 10,
      );
      await page.waitForTimeout(200);

      await page.keyboard.press("Shift+1");
      await page.waitForTimeout(600);
      const fitIframeBox = (await page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .boundingBox())!;

      await page.mouse.click(
        (await navbar.boundingBox())!.x + 10,
        (await navbar.boundingBox())!.y + 10,
      );
      await page.waitForTimeout(200);
      await page.keyboard.press("Shift+2");
      await page.waitForTimeout(600);
      const selectionIframeBox = (await page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .boundingBox())!;

      const fitContentWidth = await page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()!
        .locator("body")
        .evaluate(() => document.documentElement.clientWidth);
      const selectionContentWidth = await page
        .locator("iframe[data-design-preview-iframe]")
        .first()
        .contentFrame()!
        .locator("body")
        .evaluate(() => document.documentElement.clientWidth);
      const fitScale = fitIframeBox.width / fitContentWidth;
      const selectionScale = selectionIframeBox.width / selectionContentWidth;
      expect(
        selectionScale,
        `Shift+2 (zoom to selection) must zoom in tighter than Shift+1 (zoom to fit): fit=${fitScale} selection=${selectionScale}`,
      ).toBeGreaterThan(fitScale * 1.2);
    } finally {
      await deleteDesign(request, designId);
    }
  });

  test("right-click context menu on Navbar (canvas) offers no Duplicate item (Figma parity); Cmd+D duplicates with the same name, inserted above, and becomes the selection", async ({
    page,
    request,
  }) => {
    const designId = await createDesignWithHtml(request, LANDING_HTML);
    try {
      await gotoEditor(page, designId);
      await selectByNodeId(page, "navbar");
      await rightClickCanvasNode(page, "navbar");
      const menu = page.getByRole("menu").last();
      await expect(menu).toBeVisible({ timeout: 5_000 });
      await expect(
        menu.getByRole("menuitem", { name: /Duplicate/i }),
        `canvas context menu must not offer Duplicate; trace: ${await dumpTrace(page)}`,
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await selectByNodeId(page, "navbar");
      await page.keyboard.press(`${MOD}+d`);
      await page.waitForTimeout(300);

      await expect(
        layerTree(page).locator('[data-layer-row-button] span[title="Navbar"]'),
      ).toHaveCount(2, { timeout: 10_000 });
      const navbarIdsIn = (html: string) =>
        [
          ...html.matchAll(
            /data-agent-native-node-id="([^"]+)"[^>]*data-agent-native-layer-name="Navbar"/g,
          ),
        ].map((m) => m[1]);
      let navbarIds: string[] = [];
      await expect
        .poll(async () => {
          navbarIds = navbarIdsIn(
            await fileContent(page, designId, "index.html"),
          );
          return navbarIds.length;
        })
        .toBe(2);
      const copyId = navbarIds.find((id) => id !== "navbar")!;
      const siblingIds = await designFrame(page)
        .locator("body")
        .evaluate((body) =>
          Array.from(body.children).map((child) =>
            child.getAttribute("data-agent-native-node-id"),
          ),
        );
      expect(siblingIds[siblingIds.indexOf("navbar") + 1]).toBe(copyId);

      await expandAllLayers(page);
      const navbarRows = layerTree(page)
        .locator("[data-layer-row-content]")
        .filter({ has: page.locator('span[title="Navbar"]') });
      await expect(navbarRows).toHaveCount(2);
      await expect(navbarRows.first()).toHaveAttribute(
        "data-layer-selection",
        "primary",
      );
      await expect(navbarRows.nth(1)).not.toHaveAttribute(
        "data-layer-selection",
        "primary",
      );
    } finally {
      await deleteDesign(request, designId);
    }
  });
});
