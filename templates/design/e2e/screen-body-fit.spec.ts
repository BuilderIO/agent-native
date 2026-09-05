import { expect, test } from "@playwright/test";

import {
  appPath,
  cdpScreenshot,
  gotoEditor,
  readSeedDesignId,
} from "./helpers";

/**
 * A screen whose document sets no height ended where its content ended, so its
 * fill and any border stopped short of the frame's edge while the frame kept
 * the board's size.
 */
const SHORT_CONTENT_HTML = `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Short</title></head>
  <body style="margin:0;background:#ffffff">
    <div data-agent-native-node-id="rect-1" data-an-primitive="rectangle" data-agent-native-layer-name="Rectangle" style="position:absolute;left:40px;top:40px;width:120px;height:80px;background:#dadada"></div>
  </body>
</html>`;

test("a screen's document fills its frame", async ({ page }, testInfo) => {
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
    data: { id: fileId, content: SHORT_CONTENT_HTML },
  });

  await gotoEditor(page, designId);
  await cdpScreenshot(page, testInfo.outputPath("body-fit.png"));

  const measured = await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    );
    const body = iframe?.contentDocument?.body;
    if (!iframe || !body) return null;
    return {
      frame: Math.round(iframe.getBoundingClientRect().height),
      body: Math.round(body.getBoundingClientRect().height),
    };
  });

  expect(measured, "could not reach the screen iframe").not.toBeNull();
  // Content here is 120px tall; pre-fix the body box matched the content and
  // left the rest of the frame unpainted.
  expect(measured!.body).toBeGreaterThanOrEqual(measured!.frame - 1);
});
