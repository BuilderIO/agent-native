import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { appPath } from "./helpers";

const BASE_URL =
  process.env.E2E_BASE_URL ??
  `http://127.0.0.1:${process.env.E2E_PORT ?? "9333"}`;
const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Screen</title></head>
<body style="margin:0;position:relative;min-height:1400px">
<div data-agent-native-node-id="rect-a" style="position:absolute;left:120px;top:140px;width:300px;height:200px;background:#c9c9c9"></div>
</body></html>`;

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${BASE_URL}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(request: APIRequestContext) {
  const created = await action(request, "create-design", {
    title: `Alt-drag element QA ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const file = await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: SCREEN_HTML,
    fileType: "html",
  });
  const fileId = file.id ?? file.data?.id;
  if (!fileId) throw new Error("create-file returned no id");
  await action(request, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: { sourceType: "inline", width: 1280, height: 1400 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 0, y: 0, width: 1280, height: 1400, z: 0 },
      },
    ],
  });
  return { designId };
}

/** Shapes actually painted in the screen's live preview document. */
async function paintedShapes(page: Page) {
  return page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>(
      "iframe[data-screen-iframe-id]",
    );
    const doc = frame?.contentDocument;
    if (!doc) return -1;
    return doc.querySelectorAll("body > div[data-agent-native-node-id]").length;
  });
}

test("alt-dragging an element keeps every copy on the canvas, not just in state", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  try {
    await page.goto(appPath(`/design/${designId}?view=overview&zoom=30`), {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(async () => page.locator("[data-screen-shell]").count(), {
        timeout: 40_000,
      })
      .toBeGreaterThan(0);
    await page.waitForTimeout(3500);

    const card = (await page
      .locator("[data-screen-card]")
      .first()
      .boundingBox())!;
    const scale = card.width / 1280;
    const at = (x: number, y: number) => ({
      x: card.x + x * scale,
      y: card.y + y * scale,
    });

    // Drill into the frame so the rectangle itself is the drag target.
    const source = at(270, 240);
    await page.mouse.dblclick(source.x, source.y);
    await page.waitForTimeout(1500);
    expect(await paintedShapes(page)).toBe(1);

    for (let copy = 0; copy < 2; copy += 1) {
      await page.mouse.click(source.x, source.y);
      await page.waitForTimeout(700);
      const drop = at(400 + copy * 330, 500 + copy * 260);
      await page.mouse.move(source.x, source.y);
      await page.keyboard.down("Alt");
      await page.mouse.down();
      await page.mouse.move(drop.x, drop.y, { steps: 14 });
      await page.mouse.up();
      await page.keyboard.up("Alt");

      // Settle past the host's follow-up source push, which is what can
      // delete a clone it fails to match by selector.
      await page.waitForTimeout(3500);
      expect(await paintedShapes(page)).toBe(copy + 2);
    }
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
