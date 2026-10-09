import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath, designFrame, enterDirectMode, gotoEditor } from "./helpers";

const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();
const PRIMARY = process.platform === "darwin" ? "Meta" : "Control";
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

async function createDesign(
  request: APIRequestContext,
  fileCount = 1,
  content = SCREEN_HTML,
) {
  const created = await action(request, "create-design", {
    title: `Alt-drag element QA ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const fileIds: string[] = [];
  for (let index = 0; index < fileCount; index += 1) {
    const file = await action(request, "create-file", {
      designId,
      filename: index === 0 ? "index.html" : `screen-${index + 1}.html`,
      content,
      fileType: "html",
    });
    const fileId = file.id ?? file.data?.id;
    if (!fileId) throw new Error("create-file returned no id");
    fileIds.push(fileId);
  }
  await action(request, "update-design", {
    id: designId,
    dataOperations: fileIds.flatMap((fileId, index) => [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: { sourceType: "inline", width: 1280, height: 1400 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: {
          x: index * 1600,
          y: 0,
          width: 1280,
          height: 1400,
          z: index,
        },
      },
    ]),
  });
  return { designId, fileIds };
}

async function paintedShapes(page: Page) {
  return paintedShapesInFrame(page);
}

async function paintedShapesInFrame(page: Page, screenId?: string) {
  return page.evaluate((id) => {
    const frame = document.querySelector<HTMLIFrameElement>(
      id
        ? `iframe[data-screen-iframe-id="${id}"]`
        : "iframe[data-screen-iframe-id]",
    );
    const doc = frame?.contentDocument;
    if (!doc) return -1;
    return doc.querySelectorAll("body > div[data-agent-native-node-id]").length;
  }, screenId);
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

      await page.waitForTimeout(3500);
      expect(await paintedShapes(page)).toBe(copy + 2);
    }
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("alt-dragging an element onto another screen copies it without moving the source", async ({
  page,
  request,
}) => {
  const { designId, fileIds } = await createDesign(
    request,
    2,
    SCREEN_HTML.replace("left:120px", "left:700px"),
  );
  try {
    await gotoEditor(page, designId);
    await enterDirectMode(page, {
      screenId: fileIds[0],
      waitForBridgeReady: true,
    });
    await page.keyboard.press("Shift+1");

    const sourceFrame = page.locator(
      `iframe[data-screen-iframe-id="${fileIds[0]}"]`,
    );
    const targetFrame = page.locator(
      `iframe[data-screen-iframe-id="${fileIds[1]}"]`,
    );
    await expect(sourceFrame).toBeVisible();
    await expect(targetFrame).toBeVisible();
    let previousFramePositions = "";
    await expect
      .poll(async () => {
        const [source, target] = await Promise.all([
          sourceFrame.boundingBox(),
          targetFrame.boundingBox(),
        ]);
        if (!source || !target) return false;
        const current = JSON.stringify({ source, target });
        const settled = current === previousFramePositions;
        previousFramePositions = current;
        return settled;
      })
      .toBe(true);

    const sourceElement = designFrame(page, fileIds[0]).locator(
      '[data-agent-native-node-id="rect-a"]',
    );
    await expect(sourceElement).toBeVisible();
    const sourceBox = (await sourceElement.boundingBox())!;
    const targetBox = (await targetFrame.boundingBox())!;
    const sourceX = sourceBox.x + sourceBox.width / 2;
    const sourceY = sourceBox.y + sourceBox.height / 2;

    await page.keyboard.down(PRIMARY);
    await page.mouse.click(sourceX, sourceY);
    await page.keyboard.up(PRIMARY);

    const selectionOverlay = designFrame(page, fileIds[0]).locator(
      '[data-agent-native-edit-overlay="selection"]',
    );
    await expect(selectionOverlay).toBeVisible();
    await expect
      .poll(async () => {
        const [overlay, node] = await Promise.all([
          selectionOverlay.boundingBox(),
          sourceElement.boundingBox(),
        ]);
        if (!overlay || !node) return false;
        return ["x", "y", "width", "height"].every(
          (key) =>
            Math.abs(
              overlay[key as keyof typeof overlay] -
                node[key as keyof typeof node],
            ) <= 4,
        );
      })
      .toBe(true);

    await page.mouse.move(sourceX, sourceY);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(sourceX + 12, sourceY + 8, { steps: 4 });
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 20 },
    );
    await expect(page.locator("[data-cross-screen-drag-ghost]")).toBeVisible();
    await page.mouse.up();
    await page.keyboard.up("Alt");

    await expect.poll(() => paintedShapesInFrame(page, fileIds[0])).toBe(1);
    await expect.poll(() => paintedShapesInFrame(page, fileIds[1])).toBe(2);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
