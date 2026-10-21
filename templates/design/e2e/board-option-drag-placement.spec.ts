import { appPath, expandAllLayers } from "./helpers";
import { expect, styleOf, test, type App } from "./rails";

async function action(app: App, name: string, input: Record<string, unknown>) {
  const response = await app.page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

const BOARD_HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;position:relative;overflow:visible">
<div data-agent-native-node-id="near" data-agent-native-layer-name="Near" data-an-primitive="rectangle" style="position:absolute;left:200px;top:200px;width:160px;height:100px;background:#2563eb"></div>
<div data-agent-native-node-id="far" data-agent-native-layer-name="Far" data-an-primitive="rectangle" style="position:absolute;left:1400px;top:900px;width:160px;height:100px;background:#16a34a"></div>
</body></html>`;

async function createBoardOnlyDesign(app: App) {
  const designId = await app.seed("<!doctype html><html><body></body></html>");
  const record = await (
    await app.page.request.get(
      appPath(`/_agent-native/actions/get-design?id=${designId}`),
    )
  ).json();
  await action(app, "delete-file", { id: record.files[0].id });
  const board = await action(app, "create-file", {
    designId,
    filename: "__board__.html",
    content: BOARD_HTML,
    fileType: "html",
  });
  await action(app, "update-design", {
    id: designId,
    dataOperations: [
      { op: "set", path: ["boardFileId"], value: board.id ?? board.data?.id },
    ],
  });
  return designId;
}

function px(style: Record<string, string>, property: string): number {
  return Number.parseFloat(style[property] ?? "NaN");
}

test("an Option-drag copy dropped on empty board space between layers lands at the release point", async ({
  app,
  page,
}) => {
  const designId = await createBoardOnlyDesign(app);
  await page.goto(appPath(`/design/${designId}`));
  await expect(page.locator("[data-design-bottom-toolbar]")).toBeVisible({
    timeout: 30_000,
  });
  const board = page
    .locator("[data-board-surface-layer] iframe")
    .first()
    .contentFrame();
  const near = board.locator('[data-agent-native-node-id="near"]');
  const far = board.locator('[data-agent-native-node-id="far"]');
  await expect(near).toBeVisible({ timeout: 20_000 });
  await expect(far).toBeVisible();
  // Fit the board so neither layer sits under the side panels.
  await page.keyboard.press("Shift+1");
  let previousBox = "";
  await expect
    .poll(async () => {
      const box = JSON.stringify(await near.boundingBox());
      const settled = box === previousBox;
      previousBox = box;
      return settled;
    })
    .toBe(true);

  const nearBox = (await near.boundingBox())!;
  const farBox = (await far.boundingBox())!;
  const zoom = nearBox.width / 160;
  const grab = {
    x: nearBox.x + nearBox.width / 2,
    y: nearBox.y + nearBox.height / 2,
  };
  // Empty board between the two layers, so inside the board's content bounds;
  // off-centre, so no equal-spacing guide snaps the copy.
  const release = {
    x:
      nearBox.x + nearBox.width + (farBox.x - nearBox.x - nearBox.width) * 0.37,
    y:
      nearBox.y +
      nearBox.height +
      (farBox.y - nearBox.y - nearBox.height) * 0.61,
  };
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y) ===
        document.querySelector("[data-board-surface-layer] iframe"),
      release,
    ),
  ).toBe(true);

  await expandAllLayers(page);
  const nearRow = page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .filter({ has: page.locator('span[title="Near"]') })
    .first();
  await nearRow.click({ force: true });
  const dragSurface = page.locator(
    "[data-board-object-selection-box] [data-frame-drag-surface]",
  );
  await expect(dragSurface).toBeVisible();
  const surfaceBox = (await dragSurface.boundingBox())!;
  grab.x = surfaceBox.x + surfaceBox.width / 2;
  grab.y = surfaceBox.y + surfaceBox.height / 2;
  await page.mouse.move(grab.x, grab.y);
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(grab.x + 20, grab.y + 10, { steps: 4 });
  await page.mouse.move(release.x, release.y, { steps: 25 });
  await page.mouse.up();
  await page.keyboard.up("Alt");

  let copyId = "";
  await expect
    .poll(async () => {
      const html = await app.savedHtml(designId, "__board__.html");
      copyId = /data-agent-native-node-id="(copy-[^"]+)"/.exec(html)?.[1] ?? "";
      return copyId;
    })
    .not.toBe("");
  const nodes = await app.savedNodes(designId, "__board__.html");
  const copyStyle = styleOf(nodes.get(copyId));
  const expectedLeft = 200 + (release.x - grab.x) / zoom;
  const expectedTop = 200 + (release.y - grab.y) / zoom;
  const tolerance = 2 / zoom;
  expect(Math.abs(px(copyStyle, "left") - expectedLeft)).toBeLessThanOrEqual(
    tolerance,
  );
  expect(Math.abs(px(copyStyle, "top") - expectedTop)).toBeLessThanOrEqual(
    tolerance,
  );
  expect(styleOf(nodes.get("near"))).toMatchObject({
    left: "200px",
    top: "200px",
  });
});
