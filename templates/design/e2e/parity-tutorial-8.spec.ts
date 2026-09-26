import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { expandAllLayers, gotoEditor } from "./helpers";


const MOD = process.platform === "darwin" ? "Meta" : "Control";
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
    title: `Tutorial 8 portfolio ${Date.now()}`,
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

async function emptyBoardPoint(page: Page, offset = { x: 0, y: 0 }) {
  const point = await page.evaluate((off) => {
    const world = document.querySelector("[data-multi-screen-canvas-world]");
    const surface = (world?.parentElement ?? world) as HTMLElement | null;
    if (!surface) return null;
    const r = surface.getBoundingClientRect();
    const cards = Array.from(
      document.querySelectorAll("[data-screen-iframe-id]"),
    ).map((el) => el.getBoundingClientRect());
    for (let y = r.top + 60 + off.y; y < r.bottom - 60; y += 40) {
      for (let x = r.left + 60 + off.x; x < r.right - 60; x += 40) {
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
  }, offset);
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
}

test.describe("tutorial 8 — assemble your portfolio pages", () => {
  let designId = "";

  test.afterEach(async ({ request }) => {
    if (!designId) return;
    await action(request, "delete-design", { id: designId }).catch(() => {});
    designId = "";
  });

  test("steps 1-2 [overview, outside any screen]: Section tool has no equivalent; Frame Selection is the closest wrap-and-rename primitive but is coded to code-layer nodes, not board objects", async ({
    page,
    request,
  }) => {
    ({ designId } = await newDesign(request, [
      { filename: "index.html", content: BLANK_SCREEN("Home") },
    ]));
    await gotoEditor(page, designId);

    await expect(
      page.locator('[data-design-bottom-toolbar] [aria-label*="Section" i]'),
    ).toHaveCount(0);
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
      "Shift+S (Figma's Section tool) should be a documented no-op, not silently switch tools",
    ).toBe(activeToolBefore);

    const p1 = await emptyBoardPoint(page);
    await drawBoardFrame(page, request, designId, p1, {
      x: p1.x + 120,
      y: p1.y + 80,
    });
    const p2 = await emptyBoardPoint(page, { x: 260, y: 0 });
    await drawBoardFrame(page, request, designId, p2, {
      x: p2.x + 120,
      y: p2.y + 80,
    });
    const boardBefore = await boardHtml(request, designId);
    const frameCountBefore = (
      boardBefore.match(/data-an-primitive="frame"/g) ?? []
    ).length;
    expect(frameCountBefore).toBe(2);

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
    await page.waitForTimeout(600);

    const boardAfter = await boardHtml(request, designId);
    const frameCountAfter = (
      boardAfter.match(/data-an-primitive="frame"/g) ?? []
    ).length;
    expect(
      frameCountAfter,
      `Frame Selection (⌥⌘G) over two free-floating board frames should add one wrapping frame like it does for code-layer siblings — trace: ${JSON.stringify(await dump(page))}. ` +
        `before=${frameCountBefore} after=${frameCountAfter}`,
    ).toBe(frameCountBefore + 1);
  });

  test("step 3 [overview, outside any screen]: stripping a board component's white fill via the inspector (peer-owned)", async ({
    page,
    request,
  }) => {
    ({ designId } = await newDesign(request, [
      { filename: "index.html", content: BLANK_SCREEN("Home") },
    ]));
    await gotoEditor(page, designId);
    const p1 = await emptyBoardPoint(page);
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

  test("step 5 [overview, screens as top-level frames]: Cmd+D duplicates the assembled page screen twice; each copy keeps the source content and one undo removes a copy", async ({
    page,
    request,
  }) => {
    ({ designId } = await newDesign(request, [
      { filename: "index.html", content: NAV_SCREEN },
    ]));
    const sourceId = await fileId(request, designId, "index.html");
    const sourceGeometry = { x: 200, y: 720, width: 320, height: 240, z: 4 };
    await action(request, "update-design", {
      id: designId,
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", sourceId],
          value: sourceGeometry,
        },
      ],
    });
    await page.goto(`${BASE_URL}/design/${designId}?view=overview&zoom=30`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-screen-shell]")).toHaveCount(1, {
      timeout: 40_000,
    });
    const card = page.locator("[data-screen-card]").first();
    await expect(card).toBeVisible();
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

    await card.click({ force: true });
    await page.waitForTimeout(400);
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
    const dup1Geometry = (await designData(request, designId)).canvasFrames?.[
      dup1Id
    ];
    expect(dup1Geometry).toMatchObject({
      x: sourceGeometry.x + sourceGeometry.width + 56,
      y: sourceGeometry.y,
      z: sourceGeometry.z + 1,
    });
    // Figma selects the new copy after Cmd+D.
    await expect
      .poll(async () => (await selectionContext(request)).selectedScreenIds, {
        timeout: 10_000,
        message:
          "Cmd+D should select the new copy (Figma parity) once its history entry lands",
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
    expect(dup2, "the second Cmd+D should duplicate dup1").toBe(
      "index-copy-copy.html",
    );
    const dup2Id = await fileId(request, designId, dup2!);
    const dup2Geometry = (await designData(request, designId)).canvasFrames?.[
      dup2Id
    ];
    expect(dup2Geometry).toMatchObject({
      x: dup1Geometry.x + dup1Geometry.width + 56,
      y: dup1Geometry.y,
      z: dup1Geometry.z + 1,
    });
    await expect
      .poll(async () => (await selectionContext(request)).selectedScreenIds, {
        timeout: 10_000,
        message:
          "the second Cmd+D should select its own copy too (Figma parity)",
      })
      .toEqual([dup2Id]);
    await expect(
      page.locator(`[data-frame-id="${dup2Id}"] [data-screen-card]`),
    ).toBeInViewport();
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

  test("step 7: 'Go to main component' exists but means something different — it jumps to real app source, not a Figma-style shared symbol; on a static prototype instance it degrades to an 'unavailable' toast instead of a crash", async ({
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
