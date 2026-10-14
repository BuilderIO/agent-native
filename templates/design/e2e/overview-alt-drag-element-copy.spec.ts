import { type Page } from "@playwright/test";

import { appPath, designFrame, enterDirectMode, gotoEditor } from "./helpers";
import {
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Screen</title></head>
<body style="margin:0;position:relative;min-height:1400px">
<div data-agent-native-node-id="rect-a" style="position:absolute;left:120px;top:140px;width:300px;height:200px;background:#c9c9c9"></div>
</body></html>`;

async function seedScreens(app: App, count: number, content: string) {
  const extra = Object.fromEntries(
    Array.from({ length: count - 1 }, (_, i) => [
      `screen-${i + 2}.html`,
      content,
    ]),
  );
  const designId = await app.seed(content, { files: extra });
  const record = await (
    await app.page.request.get(
      appPath(`/_agent-native/actions/get-design?id=${designId}`),
    )
  ).json();
  const filenames = ["index.html", ...Object.keys(extra)];
  const fileIds: string[] = filenames.map(
    (name) =>
      record.files.find((file: { filename: string }) => file.filename === name)
        .id,
  );
  const response = await app.page.request.post(
    appPath("/_agent-native/actions/update-design"),
    {
      data: {
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
      },
    },
  );
  expect(response.ok()).toBe(true);
  return { designId, fileIds, filenames };
}

function bodyChildren(nodes: Map<string, SavedNode>) {
  const body = [...nodes.values()].find((node) => node.tag === "body")!.id;
  return [...nodes.values()]
    .filter((node) => node.parent === body)
    .sort((a, b) => a.index - b.index)
    .map((node) => node.id);
}

function expectNear(
  actual: string | number | undefined,
  expected: number,
  label: string,
  tolerance = 2,
) {
  expect(
    Math.abs(parseFloat(String(actual)) - expected),
    `${label} ${actual}`,
  ).toBeLessThanOrEqual(tolerance);
}

/** Page point of design px in a given screen. */
async function screenPoint(page: Page, screenId: string, x: number, y: number) {
  const iframe = page.locator(`iframe[data-screen-iframe-id="${screenId}"]`);
  const box = (await iframe.boundingBox())!;
  const width = await iframe.evaluate(
    (element: HTMLIFrameElement) =>
      element.contentDocument!.documentElement.clientWidth,
  );
  const scale = box.width / width;
  return { x: box.x + x * scale, y: box.y + y * scale };
}

async function renderedRect(page: Page, screenId: string, nodeId: string) {
  return designFrame(page, screenId)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .evaluate((element) => {
      const r = element.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    });
}

async function altDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 8, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 20 });
}

test("alt-dragging an element keeps every copy on the canvas, not just in state", async ({
  app,
}) => {
  const page = app.page;
  const { designId, fileIds } = await seedScreens(app, 1, SCREEN_HTML);
  await page.goto(appPath(`/design/${designId}?view=overview&zoom=30`), {
    waitUntil: "domcontentloaded",
  });
  await expect(
    designFrame(page, fileIds[0]).locator(
      '[data-agent-native-node-id="rect-a"]',
    ),
  ).toBeVisible();
  await app.settled();
  const source = await screenPoint(page, fileIds[0], 270, 240);
  const before = await app.savedNodes(designId);

  const copies: string[] = [];
  const expectedTopLeft = [
    { x: 250, y: 400 },
    { x: 580, y: 660 },
  ];
  for (const [index, topLeft] of expectedTopLeft.entries()) {
    await page.mouse.click(source.x, source.y);
    await expect.poll(() => app.selectedLayers()).toHaveLength(1);
    await altDrag(
      page,
      source,
      await screenPoint(page, fileIds[0], topLeft.x + 150, topLeft.y + 100),
    );
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect
      .poll(async () => bodyChildren(await app.savedNodes(designId)).length)
      .toBe(index + 2);
    await app.settled();
    copies.push(
      bodyChildren(await app.savedNodes(designId)).find(
        (id) => id !== "rect-a" && !copies.includes(id),
      )!,
    );
  }

  const after = await app.savedNodes(designId);
  expectOnlyChanged(before, after, copies);
  for (const [index, copy] of copies.entries()) {
    const style = styleOf(after.get(copy));
    expectNear(
      style.left,
      expectedTopLeft[index].x,
      `copy ${index + 1} saved left`,
    );
    expectNear(
      style.top,
      expectedTopLeft[index].y,
      `copy ${index + 1} saved top`,
    );
    const painted = await renderedRect(page, fileIds[0], copy);
    expectNear(
      painted.x,
      expectedTopLeft[index].x,
      `copy ${index + 1} painted x`,
    );
    expectNear(
      painted.y,
      expectedTopLeft[index].y,
      `copy ${index + 1} painted y`,
    );
    expect({ width: painted.width, height: painted.height }).toEqual({
      width: 300,
      height: 200,
    });
  }
  expect(await renderedRect(page, fileIds[0], "rect-a")).toEqual({
    x: 120,
    y: 140,
    width: 300,
    height: 200,
  });
});

// fixme: product bug: The copy is saved at Screen 2's top-left (inspector X 0 Y 0, no position:absolute) instead of at the drop point near the screen centre
test.fixme("alt-dragging an element onto another screen copies it to the drop point without moving the source", async ({
  app,
}) => {
  const page = app.page;
  const { designId, fileIds } = await seedScreens(
    app,
    2,
    SCREEN_HTML.replace("left:120px", "left:700px"),
  );
  await gotoEditor(page, designId);
  await enterDirectMode(page, {
    screenId: fileIds[0],
    waitForBridgeReady: true,
  });
  await page.keyboard.press("Shift+1");
  let previous = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(
        await Promise.all(
          fileIds.map((id) =>
            page.locator(`iframe[data-screen-iframe-id="${id}"]`).boundingBox(),
          ),
        ),
      );
      const stable = now === previous;
      previous = now;
      return stable;
    })
    .toBe(true);
  await app.settled();
  const source = await screenPoint(page, fileIds[0], 850, 240);
  await page.mouse.click(source.x, source.y);
  const sourceSelection = designFrame(page, fileIds[0]).locator(
    '[data-agent-native-edit-overlay="selection"]',
  );
  await expect(sourceSelection).toBeVisible();
  const sourceBefore = await app.savedNodes(designId);
  const targetBefore = await app.savedNodes(designId, "screen-2.html");

  await altDrag(page, source, await screenPoint(page, fileIds[1], 640, 700));
  await expect(page.locator("[data-cross-screen-drag-ghost]")).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up("Alt");

  await expect
    .poll(
      async () =>
        bodyChildren(await app.savedNodes(designId, "screen-2.html")).length,
    )
    .toBe(2);
  await app.settled();
  const targetAfter = await app.savedNodes(designId, "screen-2.html");
  const [copy] = bodyChildren(targetAfter).filter((id) => id !== "rect-a");
  expectOnlyChanged(sourceBefore, await app.savedNodes(designId), []);
  expectOnlyChanged(targetBefore, targetAfter, [copy]);
  const saved = styleOf(targetAfter.get(copy));
  expect({
    position: saved.position,
    width: saved.width,
    height: saved.height,
  }).toEqual({
    position: "absolute",
    width: "300px",
    height: "200px",
  });
  expectNear(saved.left, 490, "copy saved left (drop point minus grab offset)");
  expectNear(saved.top, 600, "copy saved top (drop point minus grab offset)");
  expect(await renderedRect(page, fileIds[0], "rect-a")).toEqual({
    x: 700,
    y: 140,
    width: 300,
    height: 200,
  });
  await expect(
    sourceSelection,
    "only the copy is shown as selected",
  ).toBeHidden();
});
