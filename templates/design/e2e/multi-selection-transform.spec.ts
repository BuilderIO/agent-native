import { appPath } from "./helpers";
import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Screen</title></head>
<body style="margin:0;min-height:900px">
<main data-agent-native-node-id="main" style="position:relative;min-height:900px">
  <p data-agent-native-node-id="text" style="position:absolute;left:96px;top:253px;margin:0;font-size:16px">hello bud</p>
  <div data-agent-native-node-id="rect" style="position:absolute;left:260px;top:240px;width:100px;height:34px;background:#dadada;border:1px solid #ababab"><p data-agent-native-node-id="label" style="margin:0;font-size:12px">label</p></div>
</main></body></html>`;

async function seedScreen(app: App) {
  const designId = await app.seed(SCREEN_HTML, {
    title: "Multi-selection transform QA",
  });
  const record = await app.page.request
    .get(appPath(`/_agent-native/actions/get-design?id=${designId}`))
    .then((response) => response.json());
  const fileId = record.files.find(
    (file: { filename: string }) => file.filename === "index.html",
  ).id;
  const response = await app.page.request.post(
    appPath("/_agent-native/actions/update-design"),
    {
      data: {
        id: designId,
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", fileId],
            value: { sourceType: "inline", width: 600, height: 400 },
          },
          {
            op: "set",
            path: ["canvasFrames", fileId],
            value: { x: 0, y: 0, width: 600, height: 400, z: 0 },
          },
        ],
      },
    },
  );
  expect(response.ok()).toBe(true);
  await app.open(designId);
  await app.zoomToFit();
  return designId;
}

async function clickCentre(
  app: App,
  nodeId: string,
  modifiers: "Shift"[] = [],
) {
  const rect = await app.designRect(nodeId);
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  for (const key of modifiers) await app.page.keyboard.down(key);
  await app.page.mouse.click(point.x, point.y);
  for (const key of modifiers) await app.page.keyboard.up(key);
}

async function selectTextAndRectOnCanvas(app: App) {
  await clickCentre(app, "text");
  await clickCentre(app, "rect", ["Shift"]);
  await expect(app.page.getByText("2 selected")).toBeVisible();
}

test("dragging one member of a multi-selection moves both by the same delta, saves both, and keeps them selected", async ({
  app,
  page,
}) => {
  const designId = await seedScreen(app);
  await selectTextAndRectOnCanvas(app);
  const before = await app.savedNodes(designId);
  const text = await app.designRect("text");
  const grab = await app.pagePoint(
    text.x + text.width / 2,
    text.y + text.height / 2,
  );
  const drop = await app.pagePoint(
    text.x + text.width / 2 + 60,
    text.y + text.height / 2 + 40,
  );

  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, {
    steps: Math.ceil(Math.hypot(drop.x - grab.x, drop.y - grab.y) / 3),
  });
  await page.mouse.up();
  await app.settled();

  const after = await app.savedNodes(designId);
  expect({
    left: styleOf(after.get("text")).left,
    top: styleOf(after.get("text")).top,
  }).toEqual({
    left: "156px",
    top: "293px",
  });
  expect({
    left: styleOf(after.get("rect")).left,
    top: styleOf(after.get("rect")).top,
  }).toEqual({
    left: "320px",
    top: "280px",
  });
  expectOnlyChanged(before, after, ["text", "rect"]);
  await expect(page.getByText("2 selected")).toBeVisible();

  await clickCentre(app, "rect");
  await expect(page.getByText("2 selected")).toHaveCount(0);
  expect(await app.selectedLayers()).toHaveLength(1);
});

// fixme: product bug: K-scale of a multi-selection writes junk into the saved source: text and label gain 'outline-width: 1.50px; border-width: 1.50px x4' (the
test.fixme("the scale tool scales a whole multi-selection and keeps it selected", async ({
  app,
  page,
}) => {
  const designId = await seedScreen(app);
  await selectTextAndRectOnCanvas(app);
  await expect.poll(() => app.selectedLayers()).toEqual(["Frame", "hello bud"]);
  const before = await app.savedNodes(designId);
  const text = await app.designRect("text");
  const rect = await app.designRect("rect");
  expect({
    left: text.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
  }).toEqual({ left: 96, top: 240, right: 362, bottom: 276 });

  await page.keyboard.press("k");
  await expect(
    page.getByRole("button", { name: "Scale", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const corner = await app.pagePoint(362, 276);
  const halfSize = await app.pagePoint(229, 258);
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(halfSize.x, halfSize.y, { steps: 12 });
  await page.mouse.up();
  await app.settled();

  const after = await app.savedNodes(designId);
  expect(styleOf(after.get("text"))).toEqual({
    position: "absolute",
    left: "96px",
    top: "246.5px",
    margin: "0",
    "font-size": "8px",
  });
  expect(styleOf(after.get("rect"))).toEqual({
    position: "absolute",
    left: "178px",
    top: "240px",
    width: "50px",
    height: "17px",
    background: "#dadada",
    border: "1px solid #ababab",
    "border-width": "0.50px 0.50px 0.50px 0.50px",
    "font-size": "8px",
  });
  expect(styleOf(after.get("label"))).toEqual({
    margin: "0",
    "font-size": "6px",
  });
  expectOnlyChanged(before, after, ["text", "rect", "label"]);
  expect(await app.designRect("rect")).toEqual({
    x: 178,
    y: 240,
    width: 52,
    height: 19,
  });
  await expect.poll(() => app.selectedLayers()).toEqual(["Frame", "hello bud"]);
  await expect(page.getByText("2 selected")).toBeVisible();
});
