import { type Download } from "@playwright/test";

import { appPath } from "./helpers";
import {
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const BLANK_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Untitled Potion</title></head>
  <body style="margin:0;width:800px;height:600px;overflow:hidden;background:#ffffff">
    <main data-agent-native-node-id="potion-stage" data-agent-native-layer-name="Potion stage" data-an-primitive="frame" style="position:absolute;left:0px;top:0px;width:800px;height:600px"></main>
  </body>
</html>`;

const ELLIPSE_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Potion point edit</title></head>
  <body style="margin:0;width:800px;height:600px;overflow:hidden;background:#ffffff">
    <div data-agent-native-node-id="potion" data-agent-native-layer-name="Potion" data-an-primitive="ellipse" style="position:absolute;left:100px;top:80px;width:175px;height:175px;background:#e99bf4;border-radius:50%"></div>
  </body>
</html>`;

const EXPORT_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Potion export</title></head>
  <body style="margin:0;width:200px;height:271px;overflow:hidden;background:#ffffff">
    <div data-agent-native-node-id="cork" data-agent-native-layer-name="Cork" style="position:absolute;left:40px;top:50px;width:80px;height:80px;background:#ce856c"></div>
  </body>
</html>`;

test.use({ viewport: { width: 1440, height: 1000 } });

/** Seeds one screen and gives it a declared canvas size, as resizing it in the inspector would. */
async function seedSizedScreen(
  app: App,
  html: string,
  width: number,
  height: number,
) {
  const id = await app.seed(html);
  const { files } = await app.savedRecord(id);
  const screenId = files.find((file) => file.filename === "index.html")!.id;
  const response = await app.page.request.post(
    appPath("/_agent-native/actions/update-design"),
    {
      data: {
        id,
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", screenId],
            value: { sourceType: "inline", width, height },
          },
          {
            op: "set",
            path: ["canvasFrames", screenId],
            value: { x: 0, y: 0, width, height, z: 0 },
          },
        ],
      },
    },
  );
  expect(response.ok(), `update-design ${response.status()}`).toBe(true);
  return id;
}

async function draw(
  app: App,
  tool: { key: "o" | "r"; name: "Ellipse" | "Rectangle" },
  box: { x: number; y: number; width: number; height: number },
) {
  await app.page.keyboard.press(tool.key);
  await expect(
    app.page.getByRole("button", { name: tool.name, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const start = await app.pagePoint(box.x, box.y);
  const end = await app.pagePoint(box.x + box.width, box.y + box.height);
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move(end.x, end.y, { steps: 12 });
  await app.page.mouse.up();
  await app.settled();
}

function added(before: Map<string, SavedNode>, after: Map<string, SavedNode>) {
  return [...after.values()].filter((node) => !before.has(node.id));
}

function savedBox(node: SavedNode | undefined) {
  const style = styleOf(node);
  expect(style.position, `${node?.id} position`).toBe("absolute");
  return {
    x: Number.parseFloat(style.left),
    y: Number.parseFloat(style.top),
    width: Number.parseFloat(style.width),
    height: Number.parseFloat(style.height),
  };
}

/** Pointer input lands on whole page pixels, so at fit zoom a dragged edge can round one design px either way. */
function expectWithinAPixel(
  actual: Record<string, number>,
  expected: Record<string, number>,
  label: string,
) {
  const off = Object.keys(expected).filter(
    (key) => Math.abs(actual[key]! - expected[key]!) > 1,
  );
  expect(
    off,
    `${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
  ).toEqual([]);
}

/** Resolves a saved inline style the way the canvas renders it. */
async function computedFromSaved(
  app: App,
  node: SavedNode | undefined,
  properties: string[],
) {
  return app.page.evaluate(
    ({ style, properties }) => {
      const probe = document.createElement("div");
      probe.style.cssText = style;
      document.body.append(probe);
      const computed = getComputedStyle(probe);
      const values = Object.fromEntries(
        properties.map((name) => [name, computed.getPropertyValue(name)]),
      );
      probe.remove();
      return values;
    },
    { style: node?.attrs.style ?? "", properties },
  );
}

function inspectorSection(app: App, heading: "Fill" | "Appearance" | "Export") {
  return app.page
    .getByRole("heading", { name: heading, exact: true })
    .locator("xpath=ancestor::section[1]");
}

async function pngPixels(
  app: App,
  download: Download,
  points: [number, number][],
) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return app.page.evaluate(
    async ({ base64, points }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return {
        width: image.naturalWidth,
        height: image.naturalHeight,
        pixels: points.map(([x, y]) => [
          ...context.getImageData(x, y, 1, 1).data,
        ]),
      };
    },
    { base64: Buffer.concat(chunks).toString("base64"), points },
  );
}

test("O and R draw an ellipse and a rectangle exactly where dragged inside the frame, and the fill and corner radius set on them save", async ({
  app,
}) => {
  const id = await seedSizedScreen(app, BLANK_SCREEN, 800, 600);
  await app.open(id);
  await app.zoomToFit();
  const seeded = await app.savedNodes(id);

  await draw(
    app,
    { key: "o", name: "Ellipse" },
    { x: 100, y: 100, width: 200, height: 200 },
  );
  const withEllipse = await app.savedNodes(id);
  const [ellipse] = added(seeded, withEllipse);
  expect(
    added(seeded, withEllipse).map((node) => node.attrs["data-an-primitive"]),
  ).toEqual(["ellipse"]);
  expect(ellipse.parent).toBe("potion-stage");
  expectWithinAPixel(
    savedBox(ellipse),
    { x: 100, y: 100, width: 200, height: 200 },
    "drawn ellipse",
  );
  await expect
    .poll(() => app.selectedLayers())
    .toStrictEqual([ellipse.attrs["data-agent-native-layer-name"]]);

  const fill = inspectorSection(app, "Fill");
  await fill.getByRole("button", { name: "Open color picker" }).click();
  const hex = app.page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Hex", exact: true });
  await hex.fill("DEDCF9");
  await hex.press("Enter");
  await app.page.keyboard.press("Escape");
  await expect(app.page.getByRole("dialog")).toBeHidden();
  await expect(app.node(ellipse.id)).toHaveCSS(
    "background-color",
    "rgb(222, 220, 249)",
  );
  await app.settled();
  const filled = await app.savedNodes(id);
  expect(
    await computedFromSaved(app, filled.get(ellipse.id), [
      "background-color",
      "border-radius",
    ]),
  ).toEqual({
    "background-color": "rgb(222, 220, 249)",
    "border-radius": "50%",
  });

  await draw(
    app,
    { key: "r", name: "Rectangle" },
    { x: 150, y: 30, width: 100, height: 100 },
  );
  const withRect = await app.savedNodes(id);
  const [rect] = added(filled, withRect);
  expect(
    added(filled, withRect).map((node) => node.attrs["data-an-primitive"]),
  ).toEqual(["rectangle"]);
  expect(rect.parent).toBe("potion-stage");
  expectWithinAPixel(
    savedBox(rect),
    { x: 150, y: 30, width: 100, height: 100 },
    "drawn rectangle",
  );
  await expect
    .poll(() => app.selectedLayers())
    .toStrictEqual([rect.attrs["data-agent-native-layer-name"]]);

  const radius = inspectorSection(app, "Appearance").getByRole("textbox", {
    name: "Corner radius",
  });
  await radius.fill("10");
  await radius.press("Enter");
  await expect(app.node(rect.id)).toHaveCSS("border-radius", "10px");
  await app.settled();
  const after = await app.savedNodes(id);
  expect(
    await computedFromSaved(app, after.get(rect.id), ["border-radius"]),
  ).toEqual({ "border-radius": "10px" });
  expect(styleOf(after.get(ellipse.id)).top).toBe(styleOf(ellipse).top);
  expect(styleOf(after.get(ellipse.id)).left).toBe(styleOf(ellipse).left);
  expectOnlyChanged(seeded, after, [ellipse.id, rect.id]);
  expectWithinAPixel(
    await app.designRect(ellipse.id),
    { x: 100, y: 100, width: 200, height: 200 },
    "rendered ellipse",
  );
  expectWithinAPixel(
    await app.designRect(rect.id),
    { x: 150, y: 30, width: 100, height: 100 },
    "rendered rectangle",
  );
});

test("dragging an ellipse's top anchor down 29px in point edit turns it into a path whose top moves 29px and whose other edges stay put", async ({
  app,
}) => {
  const id = await seedSizedScreen(app, ELLIPSE_SCREEN, 800, 600);
  await app.open(id);
  await app.zoomToFit();
  const centre = await app.pagePoint(187.5, 167.5);
  await app.page.mouse.click(centre.x, centre.y);
  await expect.poll(() => app.selectedLayers()).toEqual(["Potion"]);
  const before = await app.savedNodes(id);

  await app.page.keyboard.press("Enter");
  const anchors = app.page.locator("[data-vector-anchor]");
  await expect(anchors).toHaveCount(4);
  const top = await app.pagePoint(187.5, 80);
  const anchorCentres = await anchors.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }),
  );
  expect(
    anchorCentres.some(
      (anchor) => Math.hypot(anchor.x - top.x, anchor.y - top.y) <= 2,
    ),
    `an anchor sits at the ellipse's top (${top.x}, ${top.y}); anchors: ${JSON.stringify(anchorCentres)}`,
  ).toBe(true);
  const target = await app.pagePoint(187.5, 109);
  await app.page.mouse.move(top.x, top.y);
  await app.page.mouse.down();
  await app.page.mouse.move(target.x, target.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.keyboard.press("Escape");
  await expect(app.page.locator("[data-vector-edit-overlay]")).toHaveCount(0);

  await app.settled();
  const after = await app.savedNodes(id);
  expect(after.get("potion")?.tag).toBe("svg");
  expect(after.get("potion")?.attrs["data-an-primitive"]).toBe("path");
  expectWithinAPixel(
    savedBox(after.get("potion")),
    { x: 100, y: 109, width: 175, height: 146 },
    "saved path",
  );
  expectOnlyChanged(before, after, ["potion"]);
  expectWithinAPixel(
    await app.designRect("potion"),
    { x: 100, y: 109, width: 175, height: 146 },
    "rendered path",
  );
});

// fixme: product bug: The PNG is 200x271 but its content is squashed vertically. The 80x80 box at (40,50) comes out about 80x26 at y≈16, consistent with
test.fixme("exporting a 200×271 screen downloads a 200×271 PNG of its content and changes nothing", async ({
  app,
}) => {
  const id = await seedSizedScreen(app, EXPORT_SCREEN, 200, 271);
  await app.open(id);
  await app.zoomToFit();
  await app.page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await expect.poll(() => app.selectedLayers()).toEqual(["Home"]);
  const before = await app.savedNodes(id);

  const [download] = await Promise.all([
    app.page.waitForEvent("download"),
    inspectorSection(app, "Export")
      .getByRole("button", { name: "Export", exact: true })
      .click(),
  ]);

  expect(
    await pngPixels(app, download, [
      [80, 90],
      [160, 220],
    ]),
  ).toEqual({
    width: 200,
    height: 271,
    pixels: [
      [206, 133, 108, 255],
      [255, 255, 255, 255],
    ],
  });
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), []);
  const corner = await app.pagePoint(0, 0);
  const card = await app.page
    .locator(
      'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])',
    )
    .boundingBox();
  expect(
    {
      width: Math.round(card!.width / corner.scale),
      height: Math.round(card!.height / corner.scale),
    },
    "the canvas shows the screen at its declared size",
  ).toEqual({ width: 200, height: 271 });
});
