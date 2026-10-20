import { expect, test } from "./rails";

const VIEWPORT_RELATIVE_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Stable frame height</title></head>
  <body style="box-sizing:content-box;margin:0;min-height:100vh;padding:24px">
    <main>Viewport-relative content must not chase its own iframe height.</main>
  </body>
</html>`;

test("viewport-relative content does not grow its overview frame forever", async ({
  app,
}) => {
  const id = await app.seed(VIEWPORT_RELATIVE_HTML);
  await app.open(id);
  const screen = app.page.locator(
    "iframe[data-design-preview-iframe][data-screen-iframe-id]",
  );
  const heights = () =>
    screen.evaluate((iframe: HTMLIFrameElement) => ({
      frame: iframe.clientHeight,
      body: Math.round(
        iframe.contentDocument!.body.getBoundingClientRect().height,
      ),
    }));

  // 100vh resolves to the 900px desktop device height, not the 1024px frame, so the body is 900 + 2 * 24.
  await expect.poll(heights).toEqual({ frame: 1024, body: 948 });
  for (let sample = 0; sample < 3; sample++) {
    await app.page.waitForTimeout(700);
    expect(await heights(), `sample ${sample + 1}`).toEqual({
      frame: 1024,
      body: 948,
    });
  }

  await app.settled();
  const record = await app.savedRecord(id);
  const screenFile = record.files.find(
    (file) => file.filename === "index.html",
  );
  const { canvasFrames } = record.data as {
    canvasFrames: Record<string, unknown>;
  };
  expect(canvasFrames).toStrictEqual({
    [screenFile!.id]: { x: 0, y: 736, width: 1440, height: 1024 },
  });
});
