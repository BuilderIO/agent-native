import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  layerRow,
  newDesign,
  openEditor,
  postAction,
  setBaseURL,
} from "./drag-and-drop.shared";

/**
 * Figma parity (ground-truth Round 4): a plain selection change with no
 * document edit is its own undo-stack entry (`SelectionHistoryEntry`,
 * history.ts). Its snapshots name the screens selected at the time.
 *
 * Undoing a screen deletion recreates the screen under a brand-new database
 * id (`undoFileDeletion`, undo.ts) — before the fix under test, only the
 * file-deletion entry itself got remapped to the new id, leaving every
 * pure-selection entry recorded before the delete still naming the dead one.
 * A later selection-only undo/redo would then try to restore a selection
 * pointing at a screen that no longer exists.
 *
 * Repro: select Home -> select Second -> re-select Home -> delete Home ->
 * undo (recreates Home under a new id) -> walk selection history back with
 * undo, forward with redo. Every restored selection must reference only
 * live screen ids, and nothing may error along the way.
 */

const UNDO = process.platform === "darwin" ? "Meta+z" : "Control+z";
const REDO = process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z";

// Layer names deliberately avoid the substring "Home"/"Second" — layerRow
// filters by hasText, and an element row containing the screen's own name
// would otherwise collide with the screen's own row.
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

async function fileIdByFilename(
  page: Page,
  designId: string,
  filename: string,
): Promise<string> {
  const result = await page.request
    .get(`${baseURL}/_agent-native/actions/get-design?id=${designId}`)
    .then((r) => r.json());
  const file = (result.files ?? []).find((f: any) => f.filename === filename);
  if (!file?.id) {
    throw new Error(`file ${filename} not found in design ${designId}`);
  }
  return file.id as string;
}

/** The current `selectedLayerIdsState` snapshot, read off the same trace the
 * app itself stamps on every selection change (mirrors parity-undo-redo.spec's
 * lastSelectedLayers helper). */
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
  // The immutable E2E bundle runs the production trace branch, which is off unless opted in.
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

  // select A (Home)
  await layerRow(page, "Home").click();
  await expect
    .poll(() => lastSelectedLayers(page))
    .toEqual([homeIdBeforeDelete]);

  // select B (Second)
  await layerRow(page, "Second").click();
  await expect.poll(() => lastSelectedLayers(page)).toEqual([secondId]);

  // re-select A right before deleting it, so Home is the active selection
  await layerRow(page, "Home").click();
  await expect
    .poll(() => lastSelectedLayers(page))
    .toEqual([homeIdBeforeDelete]);

  // delete Home, confirm the dialog
  await page.keyboard.press("Delete");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(layerRow(page, "Home")).toHaveCount(0);

  // undo the deletion -> recreates Home under a NEW database id
  await page.keyboard.press(UNDO);
  await expect(layerRow(page, "Home")).toHaveCount(1, { timeout: 10_000 });
  const homeIdAfterUndo = await fileIdByFilename(page, id, "index.html");
  expect(
    homeIdAfterUndo,
    "sanity: undoing a screen deletion must recreate it under a NEW id",
  ).not.toBe(homeIdBeforeDelete);

  // walk selection history back: undo #2 undoes "re-select Home"
  // (its "before" is Second).
  await page.keyboard.press(UNDO);
  await expect.poll(() => lastSelectedLayers(page)).toEqual([secondId]);

  // undo #3 undoes "select Second" (its "before" is Home) — this is the
  // exact snapshot recorded while the dead id was still live. Without the
  // fix this restores the dead pre-deletion id instead of the recreated one.
  await page.keyboard.press(UNDO);
  await expect.poll(() => lastSelectedLayers(page)).toEqual([homeIdAfterUndo]);
  await expect(
    layerRow(page, "Home"),
    "the recreated Home screen's own layer row must show as selected",
  ).toHaveAttribute("aria-selected", "true");

  // walk forward again with redo, over the same two selection entries.
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
