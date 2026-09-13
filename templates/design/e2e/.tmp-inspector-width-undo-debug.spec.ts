import { expect, test } from "@playwright/test";

import { geom, newDesign, openEditor, selectViaTree, setBaseURL } from "./drag-and-drop.shared";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const UNDO = `${MOD}+Z`;

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

test("debug: trace dump around inspector width commit + undo", async ({ page }) => {
  const id = await newDesign(page);
  await openEditor(page, id);
  await selectViaTree(page, "Box A");
  await page.getByRole("tab", { name: "Design", exact: true }).click();

  await page.evaluate(() => (window as any).__designTrace?.clear());

  const wField = page.getByLabel("W size in pixels");
  await expect(wField).toBeVisible({ timeout: 10_000 });
  const before = await geom(page, id, "box-a");
  console.log("BEFORE", before);

  await wField.fill("240");
  await wField.press("Enter");
  await page.waitForTimeout(500);
  const committed = await geom(page, id, "box-a");
  console.log("COMMITTED", committed);

  const dumpAfterCommit = await page.evaluate(() => (window as any).__designTrace?.dump());
  console.log("---- TRACE AFTER COMMIT ----\n" + dumpAfterCommit);

  const activeInfo = await page.evaluate(() => {
    const el = document.activeElement;
    return {
      tag: el?.tagName,
      attrs: el ? Array.from(el.attributes).map((a) => `${a.name}=${a.value}`) : null,
      closestHotkeysScope: el?.closest?.("[data-hotkeys-scope]")?.getAttribute("data-hotkeys-scope") ?? null,
      closestHistoryHotkeys: el?.closest?.("[data-design-history-hotkeys]") ? true : false,
    };
  });
  console.log("ACTIVE ELEMENT AFTER COMMIT", activeInfo);

  await page.evaluate(() => (window as any).__designTrace?.clear());
  await page.keyboard.press(UNDO);
  await page.waitForTimeout(500);
  const undone = await geom(page, id, "box-a");
  console.log("UNDONE", undone);

  const dumpAfterUndo = await page.evaluate(() => (window as any).__designTrace?.dump());
  console.log("---- TRACE AFTER UNDO ----\n" + dumpAfterUndo);
});
