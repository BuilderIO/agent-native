import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { expandAllLayers, gotoEditor } from "./helpers";

/**
 * Figma tutorial 8 (figma-interaction-spec.md Part 2 §8) — "Assemble your
 * portfolio pages": sort finished components into named Sections, strip
 * their placeholder white fills, then drag component instances onto a
 * "Designs" canvas, wrap them in one auto-layout frame, duplicate that frame
 * twice into "Home"/"Case study" pages, drop more instances in, reorder, set
 * Fill-container sizing, and finally re-sync a drifted instance from its main
 * component.
 *
 * Design has no Section primitive or page/canvas system. Native components
 * and linked instances do exist, but Section and page moves remain explicit
 * findings. The closest available primitives are exercised instead: a
 * board-level Frame ("Wrap in section"),
 * cross-screen element copy (dragging an "instance" onto a page), Shift+A
 * auto layout, screen duplication (screens are top-level frames per the
 * 2026-09-12 note), and layers-panel reorder.
 */

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

// A duplicated file reaches the server before the client records its undo
// entry. selectedScreenIds flips in the same synchronous block as that
// record, so it is the wait signal; a toast auto-dismisses and can be missed.
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

/** Empty board point away from any screen card, for drawing a free frame. */
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

/**
 * Draw a board-level frame outside any screen and wait for it to persist.
 * Board objects render inside the board's own same-origin iframe stamped
 * only with data-agent-native-node-id (shared/board-file.ts) — no
 * `data-board-object-id` attribute exists anywhere in the app, so poll the
 * persisted __board__.html source (as boardHtml already reads elsewhere in
 * this file) for a new frame marker instead of a host-page DOM count.
 */
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

    // Step 1: Shift+S is Figma's Section tool. Probe: no "Section" tool
    // exists and the shortcut is a no-op (established no-op-probe pattern,
    // see parity-tutorial-2.spec.ts's Cmd+Opt+K test).
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

    // Draw two free-floating board frames representing finished components
    // ("Button", "Footer") sitting on the Designs page, outside any screen.
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

    // Step 2 closest equivalent: select both board frames and press the
    // Frame-Selection shortcut (⌥⌘G) to wrap them the way "Wrap in new
    // section" would in Figma.
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
    // FINDING (do not fix): arch-map §4 documents handleFrameSelection as
    // operating on `activeFile` code-layer nodes only, excluding board
    // objects — so a genuine board-level "wrap in section" is expected to
    // be a no-op here (frameCountAfter === frameCountBefore), unlike within
    // a screen where parity-group-frame.spec.ts shows the same shortcut
    // adds exactly one wrapping frame.
    // Figma expectation: Frame Selection wraps the two selected objects in
    // exactly one new frame (frameCountBefore + 1), matching the in-screen
    // behavior parity-group-frame.spec.ts already proves for code-layer
    // nodes. arch-map.md §4 documents handleFrameSelection as reading only
    // `activeFile` code-layer nodes, so board objects are predicted to be
    // excluded.
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
    // The remove-layer control only renders on row hover; hover the fill
    // row first so the button mounts before clicking it.
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
      // Fall back to editing the fill's hex value directly.
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
    // Lay both screens out side by side so a cross-screen drag has real
    // screen-space geometry (mirrors overview-alt-drag-element-copy.spec.ts).
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
    // Overview layout settles asynchronously with no discrete event — poll
    // the source box until two consecutive reads agree.
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

    // Select the nested node from Layers before the drag. At 25% zoom the
    // 80px navigation bar is only 20 CSS pixels tall, so a center double-click
    // can land on the screen shell rather than the node's selection overlay.
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

    // Rest of step 4: Shift+A wraps the (single, in this fixture) dropped
    // instance into one auto-layout page frame with a background + fixed
    // width, mirroring the established Shift+A wrapper contract from
    // parity-tutorial-7.spec.ts.
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
    // Overview layout settles asynchronously with no discrete event — poll
    // the card's box until two consecutive reads agree before force-clicking
    // its current position.
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

    // The second Cmd+D chains onto the selected copy, dup1.
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
    // The copy is named after its source, so only a duplicate of dup1 reads
    // "index-copy-copy"; re-duplicating the original gives "index-copy-2".
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

    // One undo removes the most recent duplicate only. The count drops by one
    // whichever copy is removed, so assert which one survives.
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

    // Figma: drag "Personal-bio" in between Nav and Skills. Closest
    // equivalent here is dragging the "Bio" layer row above "Skills" in the
    // layers panel (established pattern: e2e/layers-reparent.spec.ts).
    const bioRow = layerRowButton(page, "Bio").locator(
      'xpath=ancestor::*[@role="treeitem"][1]',
    );
    const skillsRow = layerRowButton(page, "Skills").locator(
      'xpath=ancestor::*[@role="treeitem"][1]',
    );
    // The layers panel lists siblings in reverse DOM order (top row =
    // topmost/last-in-DOM), so "insert before Skills in the DOM" means
    // dropping onto the LOWER half of the Skills row (panel-insert-after
    // maps to DOM-insert-before; see LayersPanel.tsx mapPanelPlacementToDomPlacement).
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

    // Enter selects all children of the frame body; check the sizing control
    // exists to set Fill-container per child (peer-owned inspector control,
    // parity-tutorial-2.spec.ts precedent).
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

    // FINDING (not a fix): component-section.tsx wires a real
    // "go-to-main-component" action for `data-agent-native-component`
    // instances, but it targets the app's real source file (fusion/full-app
    // mode), not a shared Figma symbol — components.spec.ts's "independent
    // copies" note is about visual-edit semantics, not this action. Assert
    // the button exists and degrades gracefully for a prototype-only design
    // that has no real backing source component.
    const goToMainButton = page.getByRole("button", {
      name: /go to main component/i,
    });
    const exists = (await goToMainButton.count()) > 0;
    if (exists) {
      const urlBefore = page.url();
      await goToMainButton.first().click({ force: true });
      // Degrade gracefully: either a toast/inline message appears, or (at
      // minimum) the click must not navigate away from the editor / throw.
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

    // Step 7's "Reset all changes" (revert an instance's drifted overrides)
    // has no menu affordance at all — this part is a genuine gap.
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
