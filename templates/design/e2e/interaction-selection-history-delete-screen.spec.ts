import { type Page, type Route } from "@playwright/test";

import { OVERVIEW_FRAME_LABEL_HEIGHT } from "../shared/canvas-frames";
import { e2eBaseURL } from "./base-url";
import { layerRow, openEditor, setBaseURL } from "./drag-and-drop.shared";
import { expect, expectOnlyChanged, test, type App } from "./rails";

const UNDO = process.platform === "darwin" ? "Meta+z" : "Control+z";
const REDO = process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z";
const DEEP_SELECT_MODIFIER = process.platform === "darwin" ? "Meta" : "Control";

const SECOND_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Second</title></head>
  <body style="margin:0;min-height:600px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="second-target" data-agent-native-layer-name="Indigo Box"
         style="position:absolute;left:40px;top:40px;width:120px;height:80px;background:#312e81"></div>
  </body>
</html>`;

const HOME_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Home</title></head>
  <body style="margin:0;min-height:600px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="home-target" data-agent-native-layer-name="Blue Box"
         style="position:absolute;left:40px;top:40px;width:120px;height:80px;background:#3b82f6"></div>
  </body>
</html>`;

const HOME_SCREEN_WITH_ANCHOR = HOME_SCREEN.replace(
  "</body>",
  `    <div data-agent-native-node-id="home-anchor" data-agent-native-layer-name="Anchor Box"
         style="position:absolute;left:600px;top:400px;width:80px;height:60px;background:#ef4444"></div>
  </body>`,
);

const THIRD_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Third</title></head>
  <body style="margin:0;min-height:600px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="third-target" data-agent-native-layer-name="Green Box"
         style="position:absolute;left:40px;top:40px;width:120px;height:80px;background:#166534"></div>
  </body>
</html>`;

test.use({ viewport: { width: 1600, height: 1000 } });

let baseURL = "";

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ??
    process.env.E2E_BASE_URL ??
    e2eBaseURL();
});

async function newTwoScreenDesign(
  app: App,
  homeContent = HOME_SCREEN,
): Promise<string> {
  return app.seed(homeContent, {
    title: "drag and drop",
    files: { "second.html": SECOND_SCREEN },
  });
}

async function newThreeScreenDesign(
  app: App,
  homeContent = HOME_SCREEN,
): Promise<string> {
  return app.seed(homeContent, {
    title: "drag and drop",
    files: { "second.html": SECOND_SCREEN, "third.html": THIRD_SCREEN },
  });
}

async function fileIdByFilename(
  page: Page,
  designId: string,
  filename: string,
): Promise<string> {
  let filenames: string[] = [];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await page.request.get(
      `${baseURL}/_agent-native/actions/get-design?id=${designId}`,
    );
    if (!response.ok()) throw new Error(await response.text());
    const result = await response.json();
    filenames = (result.files ?? []).flatMap((file: any) =>
      typeof file.filename === "string" ? [file.filename] : [],
    );
    const file = (result.files ?? []).find(
      (candidate: any) => candidate.filename === filename,
    );
    if (typeof file?.id === "string") return file.id;
    await page.waitForTimeout(250);
  }
  throw new Error(
    `file ${filename} not found in design ${designId}; available: ${filenames.join(", ")}`,
  );
}

/** Screen names in Layers order, top to bottom. */
async function screenOrder(page: Page, names: string[]): Promise<string[]> {
  const rows = await Promise.all(
    names.map(async (name) => ({
      name,
      y: (await layerRow(page, name).boundingBox())!.y,
    })),
  );
  return rows.sort((a, b) => a.y - b.y).map((row) => row.name);
}

/** Saved canvas frames keyed by filename instead of file id, since undo recreates files under new ids. */
async function framesByFilename(page: Page, designId: string) {
  const response = await page.request.get(
    `${baseURL}/_agent-native/actions/get-design?id=${designId}`,
  );
  expect(response.ok()).toBe(true);
  const record = (await response.json()) as {
    files: { id: string; filename: string }[];
    data: string;
  };
  const frames =
    (
      JSON.parse(record.data) as {
        canvasFrames?: Record<string, { x: number; y: number }>;
      }
    ).canvasFrames ?? {};
  return Object.fromEntries(
    record.files
      .filter((file) => file.filename !== "__board__.html")
      .map((file) => [
        file.filename,
        frames[file.id]
          ? { x: frames[file.id]!.x, y: frames[file.id]!.y }
          : null,
      ]),
  );
}

async function lastSelectedLayers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const trace = (window as any).__designTrace;
    if (!trace || typeof trace.entries !== "function") {
      throw new Error(
        "Design selection trace was not initialized; set __DESIGN_TRACE before app navigation",
      );
    }
    const entries = trace.entries();
    const selects = entries.filter(
      (entry: { area: string }) => entry.area === "select",
    );
    return (
      (selects[selects.length - 1]?.data as { layers?: string[] })?.layers ?? []
    );
  });
}

async function selectedScreenIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.isArray((window as any).__designSelection?.selectedScreenIds)
      ? [...(window as any).__designSelection.selectedScreenIds]
      : [],
  );
}

// fixme: product bug: All selection-history steps pass; the restored Home comes back at the top of Layers ([Home, Second] instead of [Second, Home]).
test.fixme("undo of a screen deletion remaps stale selection-history entries instead of restoring a dead screen id", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const id = await newTwoScreenDesign(app);
  await openEditor(page, id);

  const homeIdBeforeDelete = await fileIdByFilename(page, id, "index.html");
  const secondId = await fileIdByFilename(page, id, "second.html");

  await layerRow(page, "Home").click();
  await expect
    .poll(() => lastSelectedLayers(page))
    .toEqual([homeIdBeforeDelete]);

  await layerRow(page, "Second").click();
  await expect.poll(() => lastSelectedLayers(page)).toEqual([secondId]);

  await layerRow(page, "Home").click();
  await expect
    .poll(() => lastSelectedLayers(page))
    .toEqual([homeIdBeforeDelete]);

  await page.keyboard.press("Delete");
  await expect(layerRow(page, "Home")).toHaveCount(0);

  await page.keyboard.press(UNDO);
  await expect(layerRow(page, "Home")).toHaveCount(1, { timeout: 10_000 });
  const homeIdAfterUndo = await fileIdByFilename(page, id, "index.html");
  expect(
    homeIdAfterUndo,
    "sanity: undoing a screen deletion must recreate it under a NEW id",
  ).not.toBe(homeIdBeforeDelete);

  await page.keyboard.press(UNDO);
  await expect.poll(() => lastSelectedLayers(page)).toEqual([secondId]);

  await page.keyboard.press(UNDO);
  await expect.poll(() => lastSelectedLayers(page)).toEqual([homeIdAfterUndo]);
  await expect(
    layerRow(page, "Home"),
    "the recreated Home screen's own layer row must show as selected",
  ).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press(REDO);
  await expect.poll(() => lastSelectedLayers(page)).toEqual([secondId]);

  await page.keyboard.press(REDO);
  await expect.poll(() => lastSelectedLayers(page)).toEqual([homeIdAfterUndo]);
  await expect(layerRow(page, "Home")).toHaveAttribute("aria-selected", "true");
  expect(
    await screenOrder(page, ["Home", "Second"]),
    "the undone deletion puts Home back where it was in Layers",
  ).toEqual(["Second", "Home"]);

  expect(
    consoleErrors,
    `no console errors expected across the undo/redo walk; got: ${consoleErrors.join("; ")}`,
  ).toEqual([]);
});

test("deleting a selected child layer keeps its owning Screen", async ({
  app,
  page,
}) => {
  const id = await newThreeScreenDesign(app);
  await openEditor(page, id);

  const blueBoxButton = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .filter({ hasText: "Blue Box" });
  await expect(blueBoxButton).toHaveCount(1);
  const blueBoxRow = blueBoxButton.locator(
    "xpath=ancestor::*[@role='treeitem'][1]",
  );
  await blueBoxButton.click();
  await expect(blueBoxRow).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Delete");
  await expect(layerRow(page, "Blue Box")).toHaveCount(0);
  await expect(layerRow(page, "Home")).toHaveCount(1);
  await expect(layerRow(page, "Second")).toHaveCount(1);
  await expect(layerRow(page, "Third")).toHaveCount(1);

  await page.keyboard.press(UNDO);
  await expect(layerRow(page, "Blue Box")).toHaveCount(1);
  await expect(layerRow(page, "Home")).toHaveCount(1);
});

test("undo restores a child layer with its additive Screen selection", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });
  const id = await newThreeScreenDesign(app);
  await openEditor(page, id);
  const cards = page.locator("[data-screen-card]");
  await expect(cards).toHaveCount(3);

  const blueBoxButton = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .filter({ hasText: "Blue Box" });
  await expect(blueBoxButton).toHaveCount(1);
  const blueBoxId = await blueBoxButton.getAttribute("data-layer-node-id");
  expect(blueBoxId).toBeTruthy();
  await blueBoxButton.click();
  await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

  const secondId = await fileIdByFilename(page, id, "second.html");
  const secondFrameTitle = page.locator(
    `[data-frame-id="${secondId}"] [data-frame-title]`,
  );
  await expect(secondFrameTitle).toHaveText("Second");
  await secondFrameTitle.click({ modifiers: ["Shift"] });
  await expect.poll(() => selectedScreenIds(page)).toContain(secondId);
  await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

  const indigoBoxButton = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .filter({ hasText: "Indigo Box" });
  await expect(indigoBoxButton).toHaveCount(1);
  const indigoBoxId = await indigoBoxButton.getAttribute("data-layer-node-id");
  expect(indigoBoxId).toBeTruthy();
  await indigoBoxButton.click();
  await expect.poll(() => lastSelectedLayers(page)).toEqual([indigoBoxId]);

  await page.keyboard.press(UNDO);
  await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);
  await expect.poll(() => selectedScreenIds(page)).toContain(secondId);
  await page.keyboard.press("Delete");
  await expect(layerRow(page, "Second")).toHaveCount(0, { timeout: 10_000 });
  await expect(layerRow(page, "Home")).toHaveCount(1);
  await expect(layerRow(page, "Third")).toHaveCount(1);
});

test("marquee-selecting child elements after a Screen pick deletes only the elements", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });

  const id = await newThreeScreenDesign(app, HOME_SCREEN_WITH_ANCHOR);
  await openEditor(page, id);
  const homeId = await fileIdByFilename(page, id, "index.html");
  await layerRow(page, "Home").click();
  await expect.poll(() => lastSelectedLayers(page)).toEqual([homeId]);

  const anchor = page
    .locator(`iframe[data-screen-iframe-id="${homeId}"]`)
    .contentFrame()
    .locator('[data-agent-native-node-id="home-anchor"]');
  const anchorBox = await anchor.boundingBox();
  expect(anchorBox).not.toBeNull();
  await page.mouse.click(
    anchorBox!.x + anchorBox!.width / 2,
    anchorBox!.y + anchorBox!.height / 2,
  );
  await expect(
    page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button]")
      .filter({ hasText: "Anchor Box" })
      .locator("xpath=ancestor::*[@role='treeitem'][1]"),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-frame-drag-surface]")).toHaveCount(0);

  const screenIframe = page.locator(
    `iframe[data-screen-iframe-id="${homeId}"]`,
  );
  const iframeBox = await screenIframe.boundingBox();
  const target = screenIframe
    .contentFrame()
    .locator('[data-agent-native-node-id="home-target"]');
  const targetBox = await target.boundingBox();
  expect(iframeBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  const margin = Math.min(5, Math.max(2, iframeBox!.width * 0.01));
  const from = {
    x: targetBox!.x + targetBox!.width + margin,
    y: targetBox!.y + targetBox!.height + margin,
  };
  const to = {
    x: targetBox!.x - margin,
    y: targetBox!.y - margin,
  };
  expect(from.x).toBeLessThan(iframeBox!.x + iframeBox!.width);
  expect(from.y).toBeLessThan(iframeBox!.y + iframeBox!.height);
  expect(to.x).toBeGreaterThan(iframeBox!.x);
  expect(to.y).toBeGreaterThan(iframeBox!.y);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();

  const blueBoxButton = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .filter({ hasText: "Blue Box" });
  const blueBoxRow = blueBoxButton.locator(
    "xpath=ancestor::*[@role='treeitem'][1]",
  );
  await expect(blueBoxRow).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => lastSelectedLayers(page)).toHaveLength(1);

  await page.keyboard.press("Delete");
  await expect(blueBoxButton).toHaveCount(0);
  await expect(layerRow(page, "Home")).toHaveCount(1);
  await expect(layerRow(page, "Second")).toHaveCount(1);
  await expect(layerRow(page, "Third")).toHaveCount(1);
});

test("Shift-marquee child selection after a Screen pick deletes only the child", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });
  const id = await newThreeScreenDesign(app);
  await openEditor(page, id);
  const homeId = await fileIdByFilename(page, id, "index.html");
  await page.locator(`[data-frame-id="${homeId}"] [data-frame-title]`).click();
  await expect.poll(() => lastSelectedLayers(page)).toEqual([homeId]);

  const frame = page.locator(`[data-frame-id="${homeId}"]`);
  const frameBox = await frame.boundingBox();
  const screenIframe = page.locator(
    `iframe[data-screen-iframe-id="${homeId}"]`,
  );
  const iframeBox = await screenIframe.boundingBox();
  const target = screenIframe
    .contentFrame()
    .locator('[data-agent-native-node-id="home-target"]');
  const targetBox = await target.boundingBox();
  expect(frameBox).not.toBeNull();
  expect(iframeBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  const from = {
    x: frameBox!.x - 32,
    y: targetBox!.y - 4,
  };
  const to = {
    x: targetBox!.x + targetBox!.width + 4,
    y: targetBox!.y + targetBox!.height + 4,
  };
  expect(from.x).toBeLessThan(frameBox!.x);
  expect(from.y).toBeGreaterThanOrEqual(iframeBox!.y);
  expect(to.x).toBeLessThan(iframeBox!.x + iframeBox!.width);

  await page.keyboard.down("Shift");
  try {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  } finally {
    await page.keyboard.up("Shift");
  }

  const blueBoxButton = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .filter({ hasText: "Blue Box" });
  await expect(
    blueBoxButton.locator("xpath=ancestor::*[@role='treeitem'][1]"),
  ).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => lastSelectedLayers(page)).toContain(homeId);

  await page.keyboard.press("Delete");
  await expect(blueBoxButton).toHaveCount(0);
  await expect(layerRow(page, "Home")).toHaveCount(1);
  await expect(layerRow(page, "Second")).toHaveCount(1);
  await expect(layerRow(page, "Third")).toHaveCount(1);
});

test("ordinary marquee child selection after a Screen pick deletes only the child", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });

  const id = await newThreeScreenDesign(app);
  await openEditor(page, id);
  const homeId = await fileIdByFilename(page, id, "index.html");
  await page.locator(`[data-frame-id="${homeId}"] [data-frame-title]`).click();
  await expect.poll(() => lastSelectedLayers(page)).toEqual([homeId]);

  const frame = page.locator(`[data-frame-id="${homeId}"]`);
  const frameBox = await frame.boundingBox();
  const screenIframe = page.locator(
    `iframe[data-screen-iframe-id="${homeId}"]`,
  );
  const iframeBox = await screenIframe.boundingBox();
  const target = screenIframe
    .contentFrame()
    .locator('[data-agent-native-node-id="home-target"]');
  const targetBox = await target.boundingBox();
  expect(frameBox).not.toBeNull();
  expect(iframeBox).not.toBeNull();
  expect(targetBox).not.toBeNull();

  const from = { x: frameBox!.x - 32, y: targetBox!.y - 4 };
  const to = {
    x: targetBox!.x + targetBox!.width + 4,
    y: targetBox!.y + targetBox!.height + 4,
  };
  expect(from.x).toBeLessThan(frameBox!.x);
  expect(from.y).toBeGreaterThanOrEqual(iframeBox!.y);
  expect(to.x).toBeLessThan(iframeBox!.x + iframeBox!.width);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();

  const blueBoxButton = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .filter({ hasText: "Blue Box" });
  const blueBoxId = await blueBoxButton.getAttribute("data-layer-node-id");
  expect(blueBoxId).toBeTruthy();
  await expect(
    blueBoxButton.locator("xpath=ancestor::*[@role='treeitem'][1]"),
  ).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

  await page.keyboard.press("Delete");
  await expect(blueBoxButton).toHaveCount(0);
  await expect(layerRow(page, "Home")).toHaveCount(1);
  await expect(layerRow(page, "Second")).toHaveCount(1);
  await expect(layerRow(page, "Third")).toHaveCount(1);
});

test("deep-select marquee over a Screen deletes only the child", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
    (window as any).__designPerformanceProbe = Object.create(null);
  });

  const id = await newThreeScreenDesign(app);
  await openEditor(page, id);
  const homeId = await fileIdByFilename(page, id, "index.html");
  await page.locator(`[data-frame-id="${homeId}"] [data-frame-title]`).click();
  await expect.poll(() => lastSelectedLayers(page)).toEqual([homeId]);

  const frame = page.locator(`[data-frame-id="${homeId}"]`);
  const frameBox = await frame.boundingBox();
  const screenIframe = page.locator(
    `iframe[data-screen-iframe-id="${homeId}"]`,
  );
  const iframeBox = await screenIframe.boundingBox();
  expect(frameBox).not.toBeNull();
  expect(iframeBox).not.toBeNull();

  const from = { x: frameBox!.x - 16, y: frameBox!.y - 16 };
  const to = {
    x: frameBox!.x + frameBox!.width + 16,
    y: frameBox!.y + frameBox!.height + 16,
  };
  expect(from.x).toBeGreaterThan(0);
  expect(from.y).toBeGreaterThan(0);
  expect(to.x).toBeLessThan(1600);
  expect(to.y).toBeLessThan(1000);
  expect(from.x).toBeLessThan(iframeBox!.x);
  expect(from.y).toBeLessThan(iframeBox!.y);
  expect(to.x).toBeGreaterThan(iframeBox!.x + iframeBox!.width);
  expect(to.y).toBeGreaterThan(iframeBox!.y + iframeBox!.height);

  const finalSelectionChangeCount = await page.evaluate(
    () =>
      (window as any).__designPerformanceProbe?.marqueeFinalSelectionChange ??
      0,
  );

  await page.keyboard.down(DEEP_SELECT_MODIFIER);
  try {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  } finally {
    await page.keyboard.up(DEEP_SELECT_MODIFIER);
  }
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as any).__designPerformanceProbe
              ?.marqueeFinalSelectionChange ?? 0,
        ),
      { timeout: 30_000 },
    )
    .toBe(finalSelectionChangeCount + 1);

  const blueBoxButton = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .filter({ hasText: "Blue Box" });
  const blueBoxId = await blueBoxButton.getAttribute("data-layer-node-id");
  expect(blueBoxId).toBeTruthy();
  await expect(
    blueBoxButton.locator("xpath=ancestor::*[@role='treeitem'][1]"),
  ).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

  await page.keyboard.press("Delete");
  await expect(blueBoxButton).toHaveCount(0);
  await expect(layerRow(page, "Home")).toHaveCount(1);
  await expect(layerRow(page, "Second")).toHaveCount(1);
  await expect(layerRow(page, "Third")).toHaveCount(1);
});

test("Shift-reselecting an owner Screen makes Delete target the Screen", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });
  const id = await newThreeScreenDesign(app);
  await openEditor(page, id);
  const homeId = await fileIdByFilename(page, id, "index.html");
  const blueBoxButton = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .filter({ hasText: "Blue Box" });
  const blueBoxId = await blueBoxButton.getAttribute("data-layer-node-id");
  expect(blueBoxId).toBeTruthy();
  await blueBoxButton.click();
  await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

  const homeTitle = page.locator(
    `[data-frame-id="${homeId}"] [data-frame-title]`,
  );
  await homeTitle.click({ modifiers: ["Shift"] });
  await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);
  await page.waitForTimeout(550);
  await homeTitle.click({ modifiers: ["Shift"] });
  await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

  await page.keyboard.press("Delete");
  await expect(layerRow(page, "Home")).toHaveCount(0);
  await expect(layerRow(page, "Second")).toHaveCount(1);
  await expect(layerRow(page, "Third")).toHaveCount(1);
});

test("Shift-marqueeing child layers preserves an explicit Screen elsewhere for Delete", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
    (window as any).__designPerformanceProbe = Object.create(null);
  });

  const id = await newThreeScreenDesign(app);
  await openEditor(page, id);
  const blueBoxButton = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .filter({ hasText: "Blue Box" });
  const blueBoxId = await blueBoxButton.getAttribute("data-layer-node-id");
  expect(blueBoxId).toBeTruthy();
  await blueBoxButton.click();
  await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

  const secondId = await fileIdByFilename(page, id, "second.html");
  await page
    .locator(`[data-frame-id="${secondId}"] [data-frame-title]`)
    .click({ modifiers: ["Shift"] });
  await expect.poll(() => selectedScreenIds(page)).toContain(secondId);
  await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

  const thirdId = await fileIdByFilename(page, id, "third.html");
  const thirdFrame = page.locator(`[data-frame-id="${thirdId}"]`);
  const screenIframe = page.locator(
    `iframe[data-screen-iframe-id="${thirdId}"]`,
  );
  const frameBox = await thirdFrame.boundingBox();
  const iframeBox = await screenIframe.boundingBox();
  const greenBox = screenIframe
    .contentFrame()
    .locator('[data-agent-native-node-id="third-target"]');
  const greenBoxBox = await greenBox.boundingBox();
  expect(iframeBox).not.toBeNull();
  expect(greenBoxBox).not.toBeNull();
  const margin = Math.min(5, Math.max(2, iframeBox!.width * 0.01));
  const from = {
    x: frameBox!.x - 32,
    y: greenBoxBox!.y + greenBoxBox!.height + margin,
  };
  const to = {
    x: greenBoxBox!.x + greenBoxBox!.width + margin,
    y: greenBoxBox!.y - margin,
  };
  expect(frameBox).not.toBeNull();
  expect(from.x).toBeLessThan(frameBox!.x);
  expect(from.y).toBeLessThan(iframeBox!.y + iframeBox!.height);
  expect(to.x).toBeLessThan(iframeBox!.x + iframeBox!.width);
  expect(to.y).toBeGreaterThan(iframeBox!.y);

  const finalSelectionChangeCount = await page.evaluate(
    () =>
      (window as any).__designPerformanceProbe?.marqueeFinalSelectionChange ??
      0,
  );
  await page.keyboard.down("Shift");
  try {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  } finally {
    await page.keyboard.up("Shift");
  }
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as any).__designPerformanceProbe
              ?.marqueeFinalSelectionChange ?? 0,
        ),
      { timeout: 30_000 },
    )
    .toBe(finalSelectionChangeCount + 1);

  const greenBoxButton = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .filter({ hasText: "Green Box" });
  const greenBoxId = await greenBoxButton.getAttribute("data-layer-node-id");
  expect(greenBoxId).toBeTruthy();
  await expect
    .poll(() => lastSelectedLayers(page))
    .toEqual(expect.arrayContaining([blueBoxId, greenBoxId]));
  await expect.poll(() => selectedScreenIds(page)).toContain(secondId);
  await page.keyboard.press("Delete");
  await expect(layerRow(page, "Second")).toHaveCount(0);
  await expect(layerRow(page, "Home")).toHaveCount(1);
  await expect(layerRow(page, "Third")).toHaveCount(1);
  await expect(layerRow(page, "Blue Box")).toHaveCount(1);
  await expect(layerRow(page, "Green Box")).toHaveCount(1);
});

test("Shift-marquee reselecting an owner Screen makes Delete target the Screen", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });
  const id = await newThreeScreenDesign(app);
  await openEditor(page, id);
  const homeId = await fileIdByFilename(page, id, "index.html");
  const blueBoxButton = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .filter({ hasText: "Blue Box" });
  const blueBoxId = await blueBoxButton.getAttribute("data-layer-node-id");
  expect(blueBoxId).toBeTruthy();
  await blueBoxButton.click();
  await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

  const homeTitle = page.locator(
    `[data-frame-id="${homeId}"] [data-frame-title]`,
  );
  await homeTitle.click({ modifiers: ["Shift"] });
  await page.waitForTimeout(550);
  await homeTitle.click({ modifiers: ["Shift"] });

  const frame = page.locator(`[data-frame-id="${homeId}"]`);
  const frameBox = await frame.boundingBox();
  const canvas = await page
    .locator("[data-multi-screen-canvas-surface]")
    .boundingBox();
  expect(frameBox).not.toBeNull();
  expect(canvas).not.toBeNull();

  const from = { x: frameBox!.x - 16, y: frameBox!.y - 16 };
  const to = {
    x: frameBox!.x + frameBox!.width + 16,
    y: frameBox!.y + frameBox!.height + 16,
  };
  expect(from.x).toBeGreaterThanOrEqual(canvas!.x);
  expect(from.y).toBeGreaterThanOrEqual(canvas!.y);
  expect(to.x).toBeLessThanOrEqual(canvas!.x + canvas!.width);
  expect(to.y).toBeLessThanOrEqual(canvas!.y + canvas!.height);

  const shiftMarqueeHome = async () => {
    await page.keyboard.down("Shift");
    try {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await page.mouse.up();
    } finally {
      await page.keyboard.up("Shift");
    }
    await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);
  };

  await shiftMarqueeHome();
  await page.waitForTimeout(550);
  await shiftMarqueeHome();

  await page.keyboard.press("Delete");
  await expect(layerRow(page, "Home")).toHaveCount(0);
  await expect(layerRow(page, "Blue Box")).toHaveCount(0);
  await expect(layerRow(page, "Second")).toHaveCount(1);
  await expect(layerRow(page, "Third")).toHaveCount(1);
});

// fixme: fails on current main after the merge: Error: The app reported failures during this test
test.fixme("Shift-picking a Screen extends the Delete selection in All screens", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });
  const id = await newThreeScreenDesign(app);
  await openEditor(page, id);
  const homeId = await fileIdByFilename(page, id, "index.html");
  const secondId = await fileIdByFilename(page, id, "second.html");
  const homeTitle = page.locator(
    `[data-frame-id="${homeId}"] [data-frame-title]`,
  );
  await homeTitle.click();
  await expect.poll(() => selectedScreenIds(page)).toContain(homeId);

  await expect(
    page.getByRole("button", { name: "Design", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const secondTitle = page.locator(
    `[data-frame-id="${secondId}"] [data-frame-title]`,
  );
  await secondTitle.click({ modifiers: ["Shift"] });
  await expect.poll(() => selectedScreenIds(page)).toHaveLength(2);
  await expect
    .poll(() => selectedScreenIds(page))
    .toEqual(expect.arrayContaining([homeId, secondId]));
  await expect(
    page.getByRole("button", { name: "Design", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Delete");
  await expect(layerRow(page, "Home")).toHaveCount(0);
  await expect(layerRow(page, "Second")).toHaveCount(0);
  await expect(layerRow(page, "Third")).toHaveCount(1);
});

test("Shift-marquee adds a hit Screen to the existing Delete selection", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });
  await page.setViewportSize({ width: 1600, height: 4400 });
  const id = await newThreeScreenDesign(app);
  await openEditor(page, id);
  const homeId = await fileIdByFilename(page, id, "index.html");
  const secondId = await fileIdByFilename(page, id, "second.html");
  const secondFrame = page.locator(`[data-frame-id="${secondId}"]`);
  const secondTitle = page.locator(
    `[data-frame-id="${secondId}"] [data-frame-title]`,
  );
  const homeTitle = page.locator(
    `[data-frame-id="${homeId}"] [data-frame-title]`,
  );
  await homeTitle.click();
  await expect.poll(() => selectedScreenIds(page)).toContain(homeId);
  await expect
    .poll(async () => {
      const frameBox = await secondFrame.boundingBox();
      const titleBox = await secondTitle.boundingBox();
      const canvasBox = await page
        .locator("[data-multi-screen-canvas-surface]")
        .boundingBox();
      return Boolean(
        frameBox &&
        titleBox &&
        canvasBox &&
        Math.min(frameBox.x, titleBox.x) >= canvasBox.x &&
        Math.min(frameBox.y, titleBox.y) >= canvasBox.y &&
        Math.max(frameBox.x + frameBox.width, titleBox.x + titleBox.width) <=
          canvasBox.x + canvasBox.width &&
        Math.max(frameBox.y + frameBox.height, titleBox.y + titleBox.height) <=
          canvasBox.y + canvasBox.height,
      );
    })
    .toBe(true);

  const frameBox = await secondFrame.boundingBox();
  const titleBox = await secondTitle.boundingBox();
  const canvas = await page
    .locator("[data-multi-screen-canvas-surface]")
    .boundingBox();
  expect(frameBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(canvas).not.toBeNull();
  const zoom =
    Number.parseFloat(
      await page
        .getByRole("button", { name: /^\d+%$/ })
        .first()
        .innerText(),
    ) / 100;
  expect(zoom).toBeGreaterThan(0);
  const horizontalMargin = 24;
  const verticalMargin =
    Math.ceil(OVERVIEW_FRAME_LABEL_HEIGHT / zoom) + horizontalMargin;
  const from = {
    x: Math.max(
      canvas!.x,
      Math.min(frameBox!.x, titleBox!.x) - horizontalMargin,
    ),
    y: Math.max(canvas!.y, Math.min(frameBox!.y, titleBox!.y) - verticalMargin),
  };
  const to = {
    x: Math.min(
      canvas!.x + canvas!.width,
      Math.max(frameBox!.x + frameBox!.width, titleBox!.x + titleBox!.width) +
        horizontalMargin,
    ),
    y: Math.min(
      canvas!.y + canvas!.height,
      Math.max(frameBox!.y + frameBox!.height, titleBox!.y + titleBox!.height) +
        verticalMargin,
    ),
  };
  expect(from.x).toBeGreaterThanOrEqual(canvas!.x);
  expect(from.y).toBeGreaterThanOrEqual(canvas!.y);
  expect(to.x).toBeLessThanOrEqual(canvas!.x + canvas!.width);
  expect(to.y).toBeLessThanOrEqual(canvas!.y + canvas!.height);

  await page.keyboard.down("Shift");
  try {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  } finally {
    await page.keyboard.up("Shift");
  }
  await expect
    .poll(() => selectedScreenIds(page))
    .toEqual(expect.arrayContaining([homeId, secondId]));

  await page.keyboard.press("Delete");
  await expect(layerRow(page, "Home")).toHaveCount(0);
  await expect(layerRow(page, "Second")).toHaveCount(0);
  await expect(layerRow(page, "Third")).toHaveCount(1);
});

test("undoing a canvas element click restores its explicit Screen target for Delete", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });

  const id = await newThreeScreenDesign(app);
  await openEditor(page, id);
  const homeId = await fileIdByFilename(page, id, "index.html");
  await layerRow(page, "Home").click();
  await expect.poll(() => lastSelectedLayers(page)).toEqual([homeId]);

  const target = page
    .locator(`iframe[data-screen-iframe-id="${homeId}"]`)
    .contentFrame()
    .locator('[data-agent-native-node-id="home-target"]');
  const targetBox = await target.boundingBox();
  expect(targetBox).not.toBeNull();
  await page.mouse.click(
    targetBox!.x + targetBox!.width / 2,
    targetBox!.y + targetBox!.height / 2,
  );

  const blueBoxButton = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .filter({ hasText: "Blue Box" });
  await expect(blueBoxButton).toHaveCount(1);
  await expect(
    blueBoxButton.locator("xpath=ancestor::*[@role='treeitem'][1]"),
  ).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => lastSelectedLayers(page)).toHaveLength(1);

  await page.keyboard.press(UNDO);
  await expect.poll(() => lastSelectedLayers(page)).toEqual([homeId]);
  await expect(layerRow(page, "Home")).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Delete");
  await expect(layerRow(page, "Home")).toHaveCount(0, { timeout: 10_000 });
  await expect(layerRow(page, "Blue Box")).toHaveCount(0);
  await expect(layerRow(page, "Second")).toHaveCount(1);
  await expect(layerRow(page, "Third")).toHaveCount(1);
});

test("failed Screen deletion keeps the explicit Screen target for retry", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });

  const id = await newThreeScreenDesign(app);
  const deleteTargets: string[][] = [];
  const failFirstDelete = async (route: Route) => {
    const body = route.request().postDataJSON() as {
      id?: string;
      fileIds?: string[];
    };
    deleteTargets.push(body.fileIds ?? (body.id ? [body.id] : []));
    if (deleteTargets.length === 1) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "intentional E2E route failure" }),
      });
      return;
    }
    await route.continue();
  };

  await openEditor(page, id);
  const secondId = await fileIdByFilename(page, id, "second.html");

  const blueBoxButton = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .filter({ hasText: "Blue Box" });
  const blueBoxId = await blueBoxButton.getAttribute("data-layer-node-id");
  expect(blueBoxId).toBeTruthy();
  const blueBoxRow = blueBoxButton.locator(
    "xpath=ancestor::*[@role='treeitem'][1]",
  );
  await blueBoxButton.click();
  await expect(blueBoxRow).toHaveAttribute("aria-selected", "true");

  const secondFrameTitle = page.locator(
    `[data-frame-id="${secondId}"] [data-frame-title]`,
  );
  await expect(secondFrameTitle).toHaveText("Second");
  await secondFrameTitle.click({ modifiers: ["Shift"] });
  await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

  app.allowFailure(
    /delete-file|intentional E2E route failure|status of 500/,
    "the scenario injects a 500 on the first delete-file",
  );
  await page.route("**/_agent-native/actions/delete-file", failFirstDelete);
  await page.keyboard.press("Delete");
  await expect.poll(() => deleteTargets.length).toBe(1);
  expect(deleteTargets[0]).toEqual([secondId]);
  await expect(layerRow(page, "Second")).toHaveCount(1);
  await expect(blueBoxRow).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Delete");
  await expect.poll(() => deleteTargets.length).toBe(2);
  expect(deleteTargets[1]).toEqual([secondId]);
  await expect(layerRow(page, "Second")).toHaveCount(0, { timeout: 10_000 });
  await expect(blueBoxButton).toHaveCount(1);
  await expect(layerRow(page, "Home")).toHaveCount(1);
  await expect(layerRow(page, "Third")).toHaveCount(1);
});

test("a newer layer selection survives failed Screen deletion settlement", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });

  const id = await newThreeScreenDesign(app);
  const deleteTargets: string[][] = [];
  let releaseFirstDelete: () => void = () => {};
  const firstDeleteGate = new Promise<void>((resolve) => {
    releaseFirstDelete = resolve;
  });
  let signalFirstDelete: () => void = () => {};
  const firstDeleteSeen = new Promise<void>((resolve) => {
    signalFirstDelete = resolve;
  });

  try {
    await openEditor(page, id);
    const secondId = await fileIdByFilename(page, id, "second.html");
    const blueBoxButton = page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button]")
      .filter({ hasText: "Blue Box" });
    const blueBoxId = await blueBoxButton.getAttribute("data-layer-node-id");
    expect(blueBoxId).toBeTruthy();
    await blueBoxButton.click();
    await expect(
      blueBoxButton.locator("xpath=ancestor::*[@role='treeitem'][1]"),
    ).toHaveAttribute("aria-selected", "true");

    const greenBoxButton = page
      .getByRole("tree", { name: "Layers" })
      .locator("[data-layer-row-button]")
      .filter({ hasText: "Green Box" });
    const greenBoxId = await greenBoxButton.getAttribute("data-layer-node-id");
    expect(greenBoxId).toBeTruthy();
    const greenBoxRow = greenBoxButton.locator(
      "xpath=ancestor::*[@role='treeitem'][1]",
    );
    app.allowFailure(
      /delete-file|intentional E2E route failure|status of 500/,
      "the scenario injects a 500 on the first delete-file",
    );
    await page.route("**/_agent-native/actions/delete-file", async (route) => {
      const body = route.request().postDataJSON() as {
        id?: string;
        fileIds?: string[];
      };
      deleteTargets.push(body.fileIds ?? (body.id ? [body.id] : []));
      if (deleteTargets.length === 1) {
        signalFirstDelete();
        await firstDeleteGate;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "intentional E2E route failure" }),
        });
        return;
      }
      await route.continue();
    });

    const secondFrameTitle = page.locator(
      `[data-frame-id="${secondId}"] [data-frame-title]`,
    );
    await secondFrameTitle.click({ modifiers: ["Shift"] });
    await page.keyboard.press("Delete");
    await firstDeleteSeen;

    await greenBoxButton.click();
    await expect(greenBoxRow).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => lastSelectedLayers(page)).toEqual([greenBoxId]);
    releaseFirstDelete();
    await expect(layerRow(page, "Second")).toHaveCount(1);
    await expect(greenBoxRow).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => lastSelectedLayers(page)).toEqual([greenBoxId]);
    expect(deleteTargets).toEqual([[secondId]]);
  } finally {
    releaseFirstDelete();
  }
});

test("a newer Screen pick survives failed Screen deletion settlement", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });
  const id = await newThreeScreenDesign(app);
  const deleteTargets: string[][] = [];
  let releaseFirstDelete: () => void = () => {};
  const firstDeleteGate = new Promise<void>((resolve) => {
    releaseFirstDelete = resolve;
  });
  let signalFirstDelete: () => void = () => {};
  const firstDeleteSeen = new Promise<void>((resolve) => {
    signalFirstDelete = resolve;
  });

  try {
    await openEditor(page, id);
    const secondId = await fileIdByFilename(page, id, "second.html");
    const homeId = await fileIdByFilename(page, id, "index.html");
    await layerRow(page, "Second").click();
    await expect.poll(() => lastSelectedLayers(page)).toEqual([secondId]);

    app.allowFailure(
      /delete-file|intentional E2E route failure|status of 500/,
      "the scenario injects a 500 on the first delete-file",
    );
    await page.route("**/_agent-native/actions/delete-file", async (route) => {
      const body = route.request().postDataJSON() as {
        id?: string;
        fileIds?: string[];
      };
      deleteTargets.push(body.fileIds ?? (body.id ? [body.id] : []));
      if (deleteTargets.length === 1) {
        signalFirstDelete();
        await firstDeleteGate;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "intentional E2E route failure" }),
        });
        return;
      }
      await route.continue();
    });

    await page.keyboard.press("Delete");
    await firstDeleteSeen;
    const homeTitle = page.locator(
      `[data-frame-id="${homeId}"] [data-frame-title]`,
    );
    await homeTitle.click();
    await expect.poll(() => selectedScreenIds(page)).toEqual([homeId]);
    releaseFirstDelete();

    await expect(layerRow(page, "Second")).toHaveCount(1);
    await expect.poll(() => selectedScreenIds(page)).toEqual([homeId]);
    await page.keyboard.press("Delete");
    await expect.poll(() => deleteTargets.length).toBe(2);
    expect(deleteTargets).toEqual([[secondId], [homeId]]);
    await expect(layerRow(page, "Home")).toHaveCount(0, { timeout: 10_000 });
    await expect(layerRow(page, "Second")).toHaveCount(1);
  } finally {
    releaseFirstDelete();
  }
});

test("a newer sidebar Screen selection survives failed Screen deletion settlement", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });
  const id = await newThreeScreenDesign(app);
  let releaseFirstDelete: () => void = () => {};
  const firstDeleteGate = new Promise<void>((resolve) => {
    releaseFirstDelete = resolve;
  });
  let signalFirstDelete: () => void = () => {};
  const firstDeleteSeen = new Promise<void>((resolve) => {
    signalFirstDelete = resolve;
  });

  try {
    await openEditor(page, id);
    const homeId = await fileIdByFilename(page, id, "index.html");
    const secondId = await fileIdByFilename(page, id, "second.html");
    await layerRow(page, "Second").click();
    await expect.poll(() => lastSelectedLayers(page)).toEqual([secondId]);

    app.allowFailure(
      /delete-file|intentional E2E route failure|status of 500/,
      "the scenario injects a 500 on the first delete-file",
    );
    await page.route("**/_agent-native/actions/delete-file", async (route) => {
      signalFirstDelete();
      await firstDeleteGate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "intentional E2E route failure" }),
      });
    });

    await page.keyboard.press("Delete");
    await firstDeleteSeen;
    const homeSidebarRow = page
      .locator("[data-screen-row]")
      .filter({ hasText: "Home" });
    const allScreensRow = page.locator('button[title="All screens"]');
    await homeSidebarRow.click();
    await expect.poll(() => selectedScreenIds(page)).toEqual([homeId]);
    await expect(allScreensRow).toHaveAttribute("aria-current", "page");
    releaseFirstDelete();

    await expect.poll(() => selectedScreenIds(page)).toEqual([homeId]);
    await expect(allScreensRow).toHaveAttribute("aria-current", "page");
    await expect(
      page.locator("[data-screen-row]").filter({ hasText: "Second" }),
    ).toHaveCount(1);
    await expect.poll(() => selectedScreenIds(page)).toEqual([homeId]);
  } finally {
    releaseFirstDelete();
  }
});

// fixme: product bug: The multi-screen GroupSelectionBox is rendered `filled` (background var(--design-editor-selection-color)) over the union rect of the
test.fixme("Select All Screens survives failed Screen deletion settlement", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });
  const id = await newThreeScreenDesign(app);
  let releaseFirstDelete: () => void = () => {};
  const firstDeleteGate = new Promise<void>((resolve) => {
    releaseFirstDelete = resolve;
  });
  let signalFirstDelete: () => void = () => {};
  const firstDeleteSeen = new Promise<void>((resolve) => {
    signalFirstDelete = resolve;
  });

  try {
    await openEditor(page, id);
    const homeId = await fileIdByFilename(page, id, "index.html");
    const secondId = await fileIdByFilename(page, id, "second.html");
    const thirdId = await fileIdByFilename(page, id, "third.html");
    const framesBefore = await framesByFilename(page, id);
    const secondNodesBefore = await app.savedNodes(id, "second.html");
    await expect(app.node("second-target", "second.html")).toBeVisible();
    const secondBackground = await app.pagePoint(300, 300, "second.html");
    const secondPixels = {
      x: secondBackground.x,
      y: secondBackground.y,
      width: 6,
      height: 6,
    };
    const unselectedSecond = await page.screenshot({ clip: secondPixels });
    await layerRow(page, "Second").click();
    await expect.poll(() => lastSelectedLayers(page)).toEqual([secondId]);

    app.allowFailure(
      /delete-file|intentional E2E route failure|status of 500/,
      "the scenario injects a 500 on the first delete-file",
    );
    await page.route("**/_agent-native/actions/delete-file", async (route) => {
      signalFirstDelete();
      await firstDeleteGate;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "intentional E2E route failure" }),
      });
    });

    await page.keyboard.press("Delete");
    await firstDeleteSeen;
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+A" : "Control+A",
    );
    const visibleScreenIds = [homeId, thirdId].sort();
    await expect
      .poll(async () => (await selectedScreenIds(page)).sort())
      .toEqual(visibleScreenIds);
    releaseFirstDelete();

    await expect(layerRow(page, "Second")).toHaveCount(1);
    await expect(app.node("second-target", "second.html")).toBeVisible();
    await expect
      .poll(async () => (await selectedScreenIds(page)).sort())
      .toEqual(visibleScreenIds);
    await expect.poll(() => app.selectedLayers()).toEqual(["Third", "Home"]);
    await app.settled();
    expect(await framesByFilename(page, id)).toEqual(framesBefore);
    expectOnlyChanged(
      secondNodesBefore,
      await app.savedNodes(id, "second.html"),
      [],
    );
    expect(
      await page.screenshot({ clip: secondPixels }),
      "the unselected Second screen is painted the same as before anything was selected",
    ).toEqual(unselectedSecond);
  } finally {
    releaseFirstDelete();
  }
});

// fixme: product bug: Undo of a Screen deletion recreates the Screens (new ids) appended at the end: Layers becomes [Second, Home, Third] and the Screens list
test.fixme("marquee selection persists and deletes Screens after a prior layer selection", async ({
  app,
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).__DESIGN_TRACE = true;
  });
  const id = await newThreeScreenDesign(app);
  await openEditor(page, id);
  const cards = page.locator("[data-screen-card]");
  await expect(cards).toHaveCount(3);

  const blueBoxButton = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .filter({ hasText: "Blue Box" });
  await expect(blueBoxButton).toHaveCount(1);
  const blueBoxId = await blueBoxButton.getAttribute("data-layer-node-id");
  expect(blueBoxId).toBeTruthy();
  const blueBoxRow = blueBoxButton.locator(
    "xpath=ancestor::*[@role='treeitem'][1]",
  );
  await blueBoxButton.click();
  await expect(blueBoxRow).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => lastSelectedLayers(page)).toEqual([blueBoxId]);

  const canvas = await page
    .locator("[data-multi-screen-canvas-surface]")
    .boundingBox();
  expect(canvas).not.toBeNull();
  const boxes = await Promise.all(
    [0, 1, 2].map((index) => cards.nth(index).boundingBox()),
  );
  const marqueeBoxes = boxes.slice(0, 2).filter((box) => box !== null);
  expect(marqueeBoxes).toHaveLength(2);
  const thirdBox = boxes[2];
  expect(thirdBox).not.toBeNull();
  const margin = 32;
  const left = Math.min(...marqueeBoxes.map((box) => box!.x)) - margin;
  const top = Math.min(...marqueeBoxes.map((box) => box!.y)) - margin;
  const right =
    Math.max(...marqueeBoxes.map((box) => box!.x + box!.width)) + margin;
  const bottom =
    Math.max(...marqueeBoxes.map((box) => box!.y + box!.height)) + margin;
  expect(left).toBeGreaterThanOrEqual(canvas!.x);
  expect(top).toBeGreaterThanOrEqual(canvas!.y);
  expect(right).toBeLessThanOrEqual(canvas!.x + canvas!.width);
  expect(bottom).toBeLessThanOrEqual(canvas!.y + canvas!.height);
  for (const box of marqueeBoxes) {
    expect(left).toBeLessThan(box!.x);
    expect(top).toBeLessThan(box!.y);
    expect(right).toBeGreaterThan(box!.x + box!.width);
    expect(bottom).toBeGreaterThan(box!.y + box!.height);
  }
  expect(bottom).toBeLessThan(thirdBox!.y + thirdBox!.height);

  const passiveScreenSelections = page.locator(
    "[data-passive-frame-selection-box]",
  );
  const groupScreenSelection = page.locator("[data-frame-selection-box]");

  const hitTargets = await page.evaluate(
    ({ left, top, right, bottom }) => {
      const describe = (x: number, y: number) => {
        const target = document.elementFromPoint(x, y);
        const element = target instanceof Element ? target : null;
        return {
          tag: element?.tagName ?? null,
          className: element?.getAttribute("class") ?? null,
          canvas: Boolean(
            element?.closest("[data-multi-screen-canvas-surface]"),
          ),
          frame:
            element
              ?.closest("[data-frame-shell]")
              ?.getAttribute("data-frame-id") ?? null,
          screenCard: Boolean(element?.closest("[data-screen-card]")),
          control:
            element?.closest("button,[role=button]")?.textContent?.trim() ??
            null,
        };
      };
      return {
        start: describe(right, bottom),
        end: describe(left, top),
      };
    },
    { left, top, right, bottom },
  );
  expect(hitTargets.start.canvas).toBe(true);
  expect(hitTargets.end.canvas).toBe(true);
  expect(hitTargets.start.frame).toBeNull();
  expect(hitTargets.end.frame).toBeNull();
  expect(hitTargets.start.control).toBeNull();
  expect(hitTargets.end.control).toBeNull();

  await page.mouse.move(right, bottom);
  await page.mouse.down();
  await page.mouse.move(left, top, { steps: 16 });
  await expect(passiveScreenSelections).toHaveCount(2);
  await expect(groupScreenSelection).toHaveCount(1);
  await page.mouse.up();

  await expect(passiveScreenSelections).toHaveCount(2);
  await expect(groupScreenSelection).toHaveCount(1);
  await expect(blueBoxRow).toHaveAttribute("aria-selected", "false");

  await page.keyboard.press("Delete");
  await expect(layerRow(page, "Home")).toHaveCount(0);
  await expect(layerRow(page, "Second")).toHaveCount(0);
  await expect(layerRow(page, "Third")).toHaveCount(1);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await page.keyboard.press(UNDO);
  await expect(layerRow(page, "Home")).toHaveCount(1, { timeout: 10_000 });
  await expect(layerRow(page, "Second")).toHaveCount(1);
  await expect(layerRow(page, "Third")).toHaveCount(1);
  expect(
    await screenOrder(page, ["Home", "Second", "Third"]),
    "undo puts the Screens back in their original Layers order",
  ).toEqual(["Third", "Second", "Home"]);
});

// fixme: product bug: Undo of a Screen deletion recreates the Screens (new ids) appended at the end: Layers becomes [Second, Home, Third] and the Screens list
test.fixme("deleting two selected Screens is one undo step that restores both with their content, position and order", async ({
  app,
  page,
}) => {
  const id = await newThreeScreenDesign(app);
  await openEditor(page, id);
  await app.settled();
  const names = ["Home", "Second", "Third"];
  const orderBefore = await screenOrder(page, names);
  expect(orderBefore).toEqual(["Third", "Second", "Home"]);
  const framesBefore = await framesByFilename(page, id);
  const homeBefore = await app.savedNodes(id);
  const secondBefore = await app.savedNodes(id, "second.html");

  await layerRow(page, "Home").click();
  await layerRow(page, "Second").click({ modifiers: ["Shift"] });
  await expect(
    page
      .getByRole("tree", { name: "Layers" })
      .locator('[role="treeitem"][aria-level="1"][aria-selected="true"]'),
  ).toHaveCount(2);

  await page.keyboard.press("Delete");
  await expect(layerRow(page, "Home")).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await app.settled();
  expect(Object.keys(await framesByFilename(page, id))).toEqual(["third.html"]);

  await page.keyboard.press(UNDO);
  await expect(layerRow(page, "Home")).toHaveCount(1);
  await app.settled();
  expect(await framesByFilename(page, id)).toEqual(framesBefore);
  expectOnlyChanged(homeBefore, await app.savedNodes(id), []);
  expectOnlyChanged(secondBefore, await app.savedNodes(id, "second.html"), []);
  expect(
    await screenOrder(page, names),
    "undo puts the Screens back in their original order",
  ).toEqual(orderBefore);

  await page.keyboard.press(REDO);
  await expect(layerRow(page, "Home")).toHaveCount(0);
  await app.settled();
  expect(Object.keys(await framesByFilename(page, id))).toEqual(["third.html"]);
});
