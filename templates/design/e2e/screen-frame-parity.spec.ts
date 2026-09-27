import { expect, test, type Page } from "@playwright/test";

import {
  appPath,
  cdpScreenshot,
  gotoEditor,
  readSeedDesignId,
} from "./helpers";

const STAMPED_BODY_HTML = `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Screen 1</title></head>
  <body data-agent-native-layer-name="Screen 1" style="margin:0;background:#0f1115">
    <div data-agent-native-node-id="rect-1" data-an-primitive="rectangle" data-agent-native-layer-name="Rectangle" style="position:absolute;left:40px;top:40px;width:120px;height:80px;background:#dadada"></div>
  </body>
</html>`;

const sectionTitle = (page: Page, name: string) =>
  page.getByRole("heading", { name, exact: true, level: 3 });

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

  await rows.first().click();
  await expect(sectionTitle(page, "Position")).toBeVisible();
  await expect(sectionTitle(page, "Fill")).toBeVisible();
  await expect(sectionTitle(page, "Stroke")).toBeVisible();
  await expect(sectionTitle(page, "Effects")).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole("textbox", { name: "Color" })
        .evaluateAll((inputs) =>
          inputs.map((input) => (input as HTMLInputElement).value),
        ),
    )
    .toContain("0F1115");
  await cdpScreenshot(page, testInfo.outputPath("merged-inspector.png"));
});
