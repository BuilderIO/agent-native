import { expect, test, type Page } from "@playwright/test";

import { appPath, designFrame, gotoEditor } from "./helpers";

const NODE_ID = "drag-out-card";
const SCREEN_HTML = `<!doctype html><html lang="en"><head><title>Hug</title></head><body style="margin:0;background:#0b0b0f;color:#111827;font-family:Inter"><div data-agent-native-node-id="${NODE_ID}" data-agent-native-layer-name="Card" style="position:absolute;left:80px;top:80px;width:160px;height:100px;background:#e44"></div></body></html>`;

async function action(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function filesContaining(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  const record = (await response.json()) as {
    files?: Array<{ filename: string; content?: string }>;
  };
  return (record.files ?? [])
    .filter((file) =>
      file.content?.includes(`data-agent-native-node-id="${NODE_ID}"`),
    )
    .map((file) => file.filename);
}

test("a layer dragged out of a hug-height screen onto empty canvas moves to the board", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const design = await action(page, "create-design", {
    title: `Drag out of screen ${Date.now()}`,
    projectType: "prototype",
    designSystemId: null,
  });
  const designId = design.id ?? design.data?.id;
  if (typeof designId !== "string") throw new Error("create-design no id");
  try {
    const screen = await action(page, "create-file", {
      designId,
      filename: "index.html",
      content: SCREEN_HTML,
      fileType: "html",
    });
    const screenId = screen.id ?? screen.data?.id;
    await gotoEditor(page, designId);

    const card = designFrame(page, screenId).locator(
      `[data-agent-native-node-id="${NODE_ID}"]`,
    );
    const cardBox = await card.boundingBox();
    const screenBox = await page
      .locator(`iframe[data-screen-iframe-id="${screenId}"]`)
      .boundingBox();
    if (!cardBox || !screenBox) throw new Error("no geometry");
    const start = {
      x: cardBox.x + cardBox.width / 2,
      y: cardBox.y + cardBox.height / 2,
    };
    await page.mouse.click(start.x, start.y);
    // Below the screen but short of its bottom edge plus the card height, so
    // a screen that grows under the dragged card would still contain it.
    const end = {
      x: start.x,
      y: screenBox.y + screenBox.height + cardBox.height * 0.25,
    };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    // Slow enough for the screen's content-size report to land mid-drag.
    for (let step = 1; step <= 30; step += 1) {
      await page.mouse.move(
        start.x + ((end.x - start.x) * step) / 30,
        start.y + ((end.y - start.y) * step) / 30,
      );
      await page.waitForTimeout(25);
    }
    await page.waitForTimeout(700);
    // A hand never holds perfectly still; the nudge re-reads the grown frame.
    await page.mouse.move(end.x + 1, end.y);
    await page.waitForTimeout(300);
    await page.mouse.up();

    await expect
      .poll(() => filesContaining(page, designId), { timeout: 20_000 })
      .toEqual(["__board__.html"]);
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});
