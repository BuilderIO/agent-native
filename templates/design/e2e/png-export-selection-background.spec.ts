import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { expandAllLayers, gotoEditor } from "./helpers";

const EXPORT_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Export background fixture</title></head>
  <body style="margin:0;width:300px;height:200px;background:#123456">
    <main data-agent-native-node-id="export-host" data-agent-native-layer-name="Colored host"
      style="position:absolute;left:10px;top:10px;width:280px;height:180px;background:#00ff00">
      <div data-agent-native-node-id="transparent-export-frame" data-agent-native-layer-name="Transparent frame" data-an-primitive="frame"
        style="position:absolute;left:20px;top:20px;width:100px;height:80px;border-radius:12px">
        <div data-agent-native-node-id="transparent-export-child" data-agent-native-layer-name="Red child"
          style="position:absolute;left:30px;top:20px;width:30px;height:30px;background:#ff3366"></div>
      </div>
      <div data-agent-native-node-id="overlapping-unselected-frame" data-agent-native-layer-name="Overlapping frame"
        style="position:absolute;left:20px;top:20px;width:100px;height:80px;background:#3366ff">
        <div data-agent-native-node-id="overlapping-unselected-child" data-agent-native-layer-name="Yellow overlap"
          style="position:absolute;left:30px;top:20px;width:30px;height:30px;background:#ffff00;visibility:visible"></div>
      </div>
      <div data-agent-native-node-id="white-export-frame" data-agent-native-layer-name="White frame" data-an-primitive="frame"
        style="position:absolute;left:160px;top:20px;width:100px;height:80px;border-radius:12px;background:#ffffff">
        <div data-agent-native-node-id="white-export-child" data-agent-native-layer-name="Blue child"
          style="position:absolute;left:30px;top:20px;width:30px;height:30px;background:#3366cc"></div>
      </div>
    </main>
  </body>
</html>`;

async function postAction(
  request: APIRequestContext,
  baseURL: string,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    {
      data: input,
      headers: { "Content-Type": "application/json" },
    },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createExportDesign(
  request: APIRequestContext,
  baseURL: string,
): Promise<string> {
  const created = await postAction(request, baseURL, "create-design", {
    title: `PNG selection background ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const file = await postAction(request, baseURL, "create-file", {
    designId,
    filename: "index.html",
    content: EXPORT_HTML,
    fileType: "html",
  });
  const fileId = file.id ?? file.data?.id;
  if (!fileId) throw new Error("create-file returned no id");
  await postAction(request, baseURL, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: { sourceType: "inline", width: 300, height: 200 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 0, y: 0, width: 300, height: 200, z: 0 },
      },
    ],
  });
  return designId;
}

function layerRow(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first()
    .locator('xpath=ancestor::*[@role="treeitem"][1]');
}

async function enterFocusedEditMode(page: Page) {
  const sidebar = page.locator("aside").first();
  const home = sidebar.locator('button[title="index.html"]');
  await home.click();
  await expect(home).toHaveAttribute("aria-current", "page");
  await expect(page.locator("[data-screen-shell]")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit", exact: true }).press("Enter");
  await expect(
    page
      .locator("iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator('[data-agent-native-edit-overlay="shield"]')
      .first(),
  ).toBeAttached();
}

async function exportPngPixels(page: Page) {
  const button = page
    .getByRole("button", { name: "Export", exact: true })
    .and(page.locator("button:not([aria-expanded])"));
  await button.scrollIntoViewIfNeeded();
  return readPngDownloadPixels(page, () => button.click());
}

async function exportPngPixelsFromFileMenu(page: Page) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  const exportMenu = page.getByRole("menuitem", { name: "Export" });
  await expect(exportMenu).toBeVisible();
  await exportMenu.press("ArrowRight");
  const downloadPng = page.getByRole("menuitem", { name: "Download PNG" });
  await expect(downloadPng).toBeVisible();
  return readPngDownloadPixels(page, () => downloadPng.click());
}

async function readPngDownloadPixels(
  page: Page,
  click: () => Promise<unknown>,
) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    click(),
  ]);
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Export returned no PNG data");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const base64 = Buffer.concat(chunks).toString("base64");
  return page.evaluate(async (pngBase64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${pngBase64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not read exported PNG pixels");
    context.drawImage(image, 0, 0);
    const pixel = (x: number, y: number) => [
      ...context.getImageData(x, y, 1, 1).data,
    ];
    return {
      width: image.width,
      height: image.height,
      corner: pixel(0, 0),
      center: pixel(Math.floor(image.width / 2), Math.floor(image.height / 2)),
      interior: pixel(image.width - 20, image.height - 20),
    };
  }, base64);
}

test("selected Frame exports isolate ancestor backgrounds while Screen export preserves them", async ({
  page,
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("test baseURL is unavailable");
  const designId = await createExportDesign(request, baseURL);
  await gotoEditor(page, designId);
  await enterFocusedEditMode(page);
  await expandAllLayers(page);

  const transparentFrame = layerRow(page, "Transparent frame");
  await transparentFrame.locator("[data-layer-row-button]").click();
  await expect(
    page.getByRole("textbox", { name: "W size in pixels" }),
  ).toHaveValue("100px");
  const transparentFrameExport = await exportPngPixels(page);
  expect(transparentFrameExport).toMatchObject({
    width: 100,
    height: 80,
    corner: [0, 0, 0, 0],
    interior: [0, 0, 0, 0],
  });
  expect(transparentFrameExport.center).toEqual([255, 51, 102, 255]);

  const whiteFrame = layerRow(page, "White frame");
  await whiteFrame.locator("[data-layer-row-button]").click();
  const whiteFrameExport = await exportPngPixels(page);
  expect(whiteFrameExport).toMatchObject({
    width: 100,
    height: 80,
    corner: [0, 0, 0, 0],
    interior: [255, 255, 255, 255],
  });
  expect(whiteFrameExport.center).toEqual([51, 102, 204, 255]);

  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("textbox", { name: "W size in pixels" }),
  ).toHaveCount(0);
  const focusedMenuExport = await exportPngPixelsFromFileMenu(page);
  expect(focusedMenuExport.width).toBeGreaterThan(100);
  expect(focusedMenuExport.height).toBeGreaterThan(80);
  expect(focusedMenuExport.corner).toEqual([18, 52, 86, 255]);

  await page
    .locator("aside")
    .first()
    .getByRole("button", { name: "All screens" })
    .click();
  await expect(page.locator("[data-screen-shell]")).toHaveCount(1);
  await expandAllLayers(page);
  const screen = layerRow(page, "Home");
  await screen.locator("[data-layer-row-button]").click();
  const screenExport = await exportPngPixels(page);
  expect(screenExport).toMatchObject({
    width: 300,
    height: 200,
    corner: [18, 52, 86, 255],
  });

  const home = page
    .locator("aside")
    .first()
    .locator('button[title="index.html"]');
  await home.click();
  await expect(page.locator("[data-screen-shell]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Exit responsive preview" }),
  ).toBeVisible();
  const responsiveMenuExport = await exportPngPixelsFromFileMenu(page);
  expect(responsiveMenuExport.width).toBeGreaterThan(100);
  expect(responsiveMenuExport.height).toBeGreaterThan(80);
  expect(responsiveMenuExport.corner).toEqual([18, 52, 86, 255]);

  const frame = page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame();
  await expect
    .poll(() =>
      frame
        .locator("body")
        .evaluate((body) => getComputedStyle(body).backgroundColor),
    )
    .toBe("rgb(18, 52, 86)");
  await expect
    .poll(() =>
      frame
        .locator("main")
        .evaluate((main) => getComputedStyle(main).backgroundColor),
    )
    .toBe("rgb(0, 255, 0)");
});
