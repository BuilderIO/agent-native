import { expect, test } from "@playwright/test";

import {
  appPath,
  cdpScreenshot,
  gotoEditor,
  readSeedDesignId,
} from "./helpers";

/**
 * A screen reads as one object, the way a Figma frame does: one row in the
 * tree, and one inspector carrying both its box and its paint. Older screens
 * stamped their title onto <body>, which listed the same screen twice and put
 * its fill on the second row.
 */
const STAMPED_BODY_HTML = `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Screen 1</title></head>
  <body data-agent-native-layer-name="Screen 1" style="margin:0;background:#0f1115">
    <div data-agent-native-node-id="rect-1" data-an-primitive="rectangle" data-agent-native-layer-name="Rectangle" style="position:absolute;left:40px;top:40px;width:120px;height:80px;background:#dadada"></div>
  </body>
</html>`;

const sectionTitle = (name: string) =>
  `h3.design-sidebar-section-title:text-is("${name}")`;

test("a screen and its document are one object", async ({ page }, testInfo) => {
  const designId = await readSeedDesignId();
  const design = await (
    await page.request.get(
      appPath(
        `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
      ),
    )
  ).json();
  const fileId = (design?.files ?? []).find(
    (file: { fileType?: string; id?: string }) => file.fileType === "html",
  )?.id as string;
  expect(fileId).toBeTruthy();
  await page.request.post(appPath("/_agent-native/actions/update-file"), {
    data: { id: fileId, content: STAMPED_BODY_HTML, filename: "screen-1.html" },
  });

  await gotoEditor(page, designId);

  const rows = page.locator('[role="treeitem"] [data-layer-row-button]');
  await expect(rows.first()).toBeVisible();
  await cdpScreenshot(page, testInfo.outputPath("merged-tree.png"));
  const names = await rows.allInnerTexts();
  const context = `layer rows were: ${JSON.stringify(names)}`;
  expect(
    names.filter((name) => name.includes("Screen 1")).length,
    context,
  ).toBe(1);
  expect(
    names.some((name) => /(^|\s)Body(\s|$)/.test(name)),
    context,
  ).toBe(false);

  // One inspector carries the box and the paint.
  await rows.first().click();
  await expect(page.locator(sectionTitle("Position"))).toBeVisible();
  await expect(page.locator(sectionTitle("Fill"))).toBeVisible();
  await expect(page.locator(sectionTitle("Stroke"))).toBeVisible();
  await expect(page.locator(sectionTitle("Effects"))).toBeVisible();
  await expect(page.getByText("0F1115").first()).toBeVisible();
  await cdpScreenshot(page, testInfo.outputPath("merged-inspector.png"));
});
