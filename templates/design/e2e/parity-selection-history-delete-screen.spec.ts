import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  layerRow,
  newDesign,
  openEditor,
  postAction,
  setBaseURL,
} from "./drag-and-drop.shared";

const UNDO = process.platform === "darwin" ? "Meta+z" : "Control+z";
const REDO = process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z";

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

async function newTwoScreenDesign(page: Page): Promise<string> {
  const id = await newDesign(page, HOME_SCREEN);
  await postAction(page, "create-file", {
    designId: id,
    filename: "second.html",
    content: SECOND_SCREEN,
    fileType: "html",
  });
  return id;
}

async function newThreeScreenDesign(page: Page): Promise<string> {
  const id = await newTwoScreenDesign(page);
  await postAction(page, "create-file", {
    designId: id,
    filename: "third.html",
    content: THIRD_SCREEN,
    fileType: "html",
  });
  return id;
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

test("undo of a screen deletion remaps stale selection-history entries instead of restoring a dead screen id", async ({
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

  const id = await newTwoScreenDesign(page);
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
    consoleErrors,
    `no console errors expected across the undo/redo walk; got: ${consoleErrors.join("; ")}`,
  ).toEqual([]);
});

test("deletes multiple selected Screens as one undoable operation", async ({
  page,
}) => {
  const id = await newThreeScreenDesign(page);
  try {
    await openEditor(page, id);

    await layerRow(page, "Home").click();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+A" : "Control+A",
    );
    await expect(
      page
        .getByRole("tree", { name: "Layers" })
        .locator('[role="treeitem"][aria-level="1"][aria-selected="true"]'),
    ).toHaveCount(3);

    await page.keyboard.press("Delete");
    await expect(layerRow(page, "Home")).toHaveCount(0);
    await expect(layerRow(page, "Second")).toHaveCount(0);
    await expect(layerRow(page, "Third")).toHaveCount(1);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);

    await page.keyboard.press(UNDO);
    await expect(layerRow(page, "Home")).toHaveCount(1, {
      timeout: 10_000,
    });
    await expect(layerRow(page, "Second")).toHaveCount(1);
    await expect(layerRow(page, "Third")).toHaveCount(1);

    await page.keyboard.press(REDO);
    await expect(layerRow(page, "Home")).toHaveCount(0, { timeout: 10_000 });
    await expect(layerRow(page, "Second")).toHaveCount(0);
    await expect(layerRow(page, "Third")).toHaveCount(1);
  } finally {
    await postAction(page, "delete-design", { id }).catch(() => {});
  }
});
