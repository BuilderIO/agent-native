import { expect, expectOnlyChanged, test, type App } from "./rails";

const HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body data-agent-native-node-id="page" style="margin:0;width:800px;height:600px"><main data-agent-native-node-id="main" style="position:relative;width:640px;height:480px"><div data-agent-native-node-id="mouse-rectangle" data-agent-native-layer-name="Mouse rectangle" style="position:absolute;left:60px;top:60px;width:180px;height:120px;background:#fff"></div><div data-agent-native-node-id="keyboard-rectangle" data-agent-native-layer-name="Keyboard rectangle" style="position:absolute;left:300px;top:60px;width:180px;height:120px;background:#fff"></div></main></body></html>`;

const BOXES = {
  "mouse-rectangle": { x: 60, y: 60, width: 180, height: 120 },
  "keyboard-rectangle": { x: 300, y: 60, width: 180, height: 120 },
};
const NAMES = {
  "mouse-rectangle": "Mouse rectangle",
  "keyboard-rectangle": "Keyboard rectangle",
};
type Rectangle = keyof typeof BOXES;

const ONE_PX_BLACK = {
  "border-top-width": "1px",
  "border-top-style": "solid",
  "border-top-color": "rgb(0, 0, 0)",
};

async function openSeeded(app: App) {
  const id = await app.seed(HTML);
  await app.open(id);
  await app.zoomToFit();
  return id;
}

async function select(app: App, nodeId: Rectangle) {
  const box = BOXES[nodeId];
  const point = await app.pagePoint(
    box.x + box.width / 2,
    box.y + box.height / 2,
  );
  await app.page.mouse.click(point.x, point.y);
  await expect.poll(() => app.selectedLayers()).toEqual([NAMES[nodeId]]);
}

function strokeSection(app: App) {
  return app.page
    .locator("[data-design-inspector-section]")
    .filter({
      has: app.page.getByRole("heading", { name: "Stroke", exact: true }),
    })
    .first();
}

/** Resolves a node's saved inline style the way the canvas renders it, so saved values compare literally. */
async function savedBorder(app: App, id: string, nodeId: Rectangle) {
  const style = (await app.savedNodes(id)).get(nodeId)?.attrs.style ?? "";
  return app.page.evaluate((cssText) => {
    const probe = document.createElement("div");
    probe.style.cssText = cssText;
    document.body.append(probe);
    const computed = getComputedStyle(probe);
    const border = {
      "border-top-width": computed.borderTopWidth,
      "border-top-style": computed.borderTopStyle,
      "border-top-color": computed.borderTopColor,
    };
    probe.remove();
    return border;
  }, style);
}

async function expectOneStrokeRow(app: App) {
  await expect(
    strokeSection(app).locator('[data-inspector-layout="paint-row"]'),
  ).toHaveCount(1);
}

// fixme: product bug: Inside-stroke growth (same family as fill-add-solid.spec.ts:177): the 1px 'Inside' stroke saves as a plain content-box border, so the
test.fixme("clicking the empty Stroke heading adds and persists a stroke", async ({
  app,
}) => {
  const page = app.page;
  const id = await openSeeded(app);
  await select(app, "mouse-rectangle");
  const before = await app.savedNodes(id);
  const heading = strokeSection(app).locator("h3 button");
  const plus = strokeSection(app)
    .getByRole("button", { name: "Add stroke", exact: true })
    .last();
  const headingBox = (await heading.boundingBox())!;
  const plusBox = (await plus.boundingBox())!;
  expect(
    headingBox.x + 12,
    "the click lands on the heading label, left of the + button",
  ).toBeLessThan(plusBox.x);

  await heading.click({ position: { x: 12, y: headingBox.height / 2 } });

  await expectOneStrokeRow(app);
  await app.settled();
  expect(await savedBorder(app, id, "mouse-rectangle")).toEqual(ONE_PX_BLACK);
  expectOnlyChanged(before, await app.savedNodes(id), ["mouse-rectangle"]);

  await page.reload();
  await app.zoomToFit();
  await select(app, "mouse-rectangle");
  await expectOneStrokeRow(app);
  await expect(app.node("mouse-rectangle")).toHaveCSS(
    "border-top-width",
    "1px",
  );
  expect(
    await app.designRect("mouse-rectangle"),
    "an Inside stroke must not grow the box",
  ).toEqual(BOXES["mouse-rectangle"]);
});

// fixme: product bug: Inside-stroke growth (same family as fill-add-solid.spec.ts:177): the 1px 'Inside' stroke saves as a plain content-box border, so the
test.fixme("the empty Stroke heading activates with Enter and with Space", async ({
  app,
}) => {
  const page = app.page;
  const id = await openSeeded(app);
  const before = await app.savedNodes(id);
  const heading = strokeSection(app).locator("h3 button");

  await select(app, "mouse-rectangle");
  await expect(heading).toHaveAccessibleName("Add stroke");
  await heading.focus();
  await page.keyboard.press("Enter");
  await expectOneStrokeRow(app);

  await select(app, "keyboard-rectangle");
  await expect(heading).toHaveAccessibleName("Add stroke");
  await heading.focus();
  await page.keyboard.press("Space");
  await expectOneStrokeRow(app);

  await app.settled();
  expect(await savedBorder(app, id, "mouse-rectangle")).toEqual(ONE_PX_BLACK);
  expect(await savedBorder(app, id, "keyboard-rectangle")).toEqual(
    ONE_PX_BLACK,
  );
  expectOnlyChanged(before, await app.savedNodes(id), [
    "mouse-rectangle",
    "keyboard-rectangle",
  ]);
  for (const nodeId of ["mouse-rectangle", "keyboard-rectangle"] as const) {
    expect(
      await app.designRect(nodeId),
      `an Inside stroke must not grow ${nodeId}`,
    ).toEqual(BOXES[nodeId]);
  }
});
