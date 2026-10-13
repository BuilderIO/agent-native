import { expect, test } from "@playwright/test";

import {
  appPath,
  cdpScreenshot,
  gotoEditor,
  readSeedDesignId,
} from "./helpers";

const SHORT_CONTENT_HTML = `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Short</title></head>
  <body style="margin:0;background:#ffffff">
    <div data-agent-native-node-id="rect-1" data-an-primitive="rectangle" data-agent-native-layer-name="Rectangle" style="position:absolute;left:40px;top:40px;width:120px;height:80px;background:#dadada"></div>
  </body>
</html>`;

test("a screen's fill stays behind its child layers", async ({
  page,
}, testInfo) => {
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
  const bodyScreenshot = await page
    .frameLocator("iframe[data-design-preview-iframe]")
    .locator("body")
    .screenshot();

  const measured = await page.evaluate(
    async ({ screenshotBase64 }) => {
      const iframe = document.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      const screenDocument = iframe?.contentDocument;
      const body = screenDocument?.body;
      const child = screenDocument?.querySelector<HTMLElement>(
        '[data-agent-native-node-id="rect-1"]',
      );
      if (!iframe || !screenDocument || !body || !child) return null;
      const screenshot = new Image();
      screenshot.src = `data:image/png;base64,${screenshotBase64}`;
      await screenshot.decode();
      const canvas = document.createElement("canvas");
      canvas.width = screenshot.naturalWidth;
      canvas.height = screenshot.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(screenshot, 0, 0);

      const bodyBounds = body.getBoundingClientRect();
      const childBounds = child.getBoundingClientRect();
      const scaleX = canvas.width / bodyBounds.width;
      const scaleY = canvas.height / bodyBounds.height;
      const pixelAt = (x: number, y: number) => {
        const pixel = context.getImageData(
          Math.floor((x - bodyBounds.left) * scaleX),
          Math.floor((y - bodyBounds.top) * scaleY),
          1,
          1,
        ).data;
        return `rgb(${pixel[0]}, ${pixel[1]}, ${pixel[2]})`;
      };
      return {
        frame: Math.round(iframe.getBoundingClientRect().height),
        body: Math.round(body.getBoundingClientRect().height),
        frameFill: getComputedStyle(body).backgroundColor,
        childPixel: pixelAt(
          childBounds.left + childBounds.width / 2,
          childBounds.top + childBounds.height / 2,
        ),
        uncoveredFramePixel: pixelAt(200, 80),
      };
    },
    { screenshotBase64: bodyScreenshot.toString("base64") },
  );

  expect(measured, "could not reach the screen iframe").not.toBeNull();
  expect(measured!.body).toBeGreaterThanOrEqual(measured!.frame - 1);
  expect(measured!.frameFill).toBe("rgb(255, 255, 255)");
  expect(
    measured!.childPixel,
    "the child layer should paint over the screen's frame fill",
  ).toBe("rgb(218, 218, 218)");
  expect(measured!.uncoveredFramePixel).toBe("rgb(255, 255, 255)");
});
