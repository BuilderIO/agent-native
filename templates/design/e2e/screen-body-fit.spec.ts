import { expect, test, type App } from "./rails";

const SHORT_CONTENT_HTML = `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Short</title></head>
  <body style="margin:0;background:#fde68a">
    <div data-agent-native-node-id="rect-1" data-an-primitive="rectangle" data-agent-native-layer-name="Rectangle" style="position:absolute;left:40px;top:40px;width:120px;height:80px;background:#3b82f6"></div>
  </body>
</html>`;

/** The painted colour at each design point of the screen, read from a screenshot of the editor. */
async function paintedAt(app: App, points: { x: number; y: number }[]) {
  const pagePoints = [];
  for (const point of points)
    pagePoints.push(await app.pagePoint(point.x, point.y));
  const screenshot = (await app.page.screenshot()).toString("base64");
  return app.page.evaluate(
    async ({ screenshot, pagePoints }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${screenshot}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const ratio = image.naturalWidth / window.innerWidth;
      return pagePoints.map(({ x, y }) => {
        const [r, g, b] = context.getImageData(
          Math.round(x * ratio),
          Math.round(y * ratio),
          1,
          1,
        ).data;
        return `rgb(${r}, ${g}, ${b})`;
      });
    },
    { screenshot, pagePoints },
  );
}

test("a screen with content shorter than its frame paints its fill down to the frame's bottom edge and behind its layers", async ({
  app,
}) => {
  const id = await app.seed(SHORT_CONTENT_HTML);
  await app.open(id);
  await app.zoomToFit();
  const screen = await app.page
    .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
    .evaluate((iframe: HTMLIFrameElement) => {
      const document = iframe.contentDocument!;
      return {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
        body: document.body.getBoundingClientRect().height,
      };
    });

  expect(screen.body, "the body is exactly as tall as the frame").toBe(
    screen.height,
  );
  expect(
    await paintedAt(app, [
      { x: 100, y: 80 },
      { x: 200, y: 80 },
      { x: 20, y: screen.height - 20 },
      { x: screen.width - 20, y: screen.height - 20 },
    ]),
    "the rectangle over the fill, then the fill beside it and at both bottom corners",
  ).toEqual([
    "rgb(59, 130, 246)",
    "rgb(253, 230, 138)",
    "rgb(253, 230, 138)",
    "rgb(253, 230, 138)",
  ]);
});
