import {
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const PAGE_H = 820;

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Selection</title></head>
  <body style="margin:0;font-family:system-ui,sans-serif;background:#fff;color:#111">
    <div data-agent-native-node-id="wrapper" data-agent-native-layer-name="Wrapper"
         style="position:relative;width:100%;min-height:${PAGE_H}px;background:#fff">
      <div data-agent-native-node-id="box-a" data-agent-native-layer-name="Box A"
           style="position:absolute;left:20px;top:120px;width:110px;height:80px;background:#3b82f6"></div>
      <div data-agent-native-node-id="box-b" data-agent-native-layer-name="Box B"
           style="position:absolute;left:170px;top:120px;width:110px;height:80px;background:#22c55e"></div>
      <svg data-agent-native-node-id="rule" data-agent-native-layer-name="Rule"
           width="260" height="12" viewBox="0 0 260 12"
           style="position:absolute;left:20px;top:260px;overflow:visible">
        <path d="M0 6 L260 6" stroke="#111" stroke-width="3" fill="none" />
      </svg>
      <div data-agent-native-layer-name="Unnamed"
           style="position:absolute;left:20px;top:320px;width:200px;height:70px;background:#f59e0b"></div>
      <div data-agent-native-node-id="ghosted" data-agent-native-layer-name="Ghosted"
           style="display:none;position:absolute;left:20px;top:200px;width:120px;height:40px;background:#000"></div>
      <div data-agent-native-node-id="flat" data-agent-native-layer-name="Flat row"
           style="position:absolute;left:20px;top:440px;width:200px;height:0;overflow:visible">
        <span style="display:block;width:200px;height:24px;background:#a855f7"></span>
      </div>
    </div>
  </body>
</html>`;

type Point = { x: number; y: number };

async function openFixture(app: App) {
  const id = await app.seed(FIXTURE);
  await app.open(id);
  await app.zoomToFit();
  await app.settled();
  return id;
}

/** A marquee from one design-px point to another, with no layer under the press. */
async function sweep(app: App, from: Point, to: Point) {
  const start = await app.pagePoint(from.x, from.y);
  const end = await app.pagePoint(to.x, to.y);
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move(end.x, end.y, { steps: 18 });
  await app.page.mouse.up();
}

async function clickDesign(app: App, x: number, y: number) {
  const point = await app.pagePoint(x, y);
  await app.page.mouse.click(point.x, point.y);
}

function sortedSelection(app: App) {
  return async () => (await app.selectedLayers()).sort();
}

async function selectionOutline(app: App) {
  return app.page
    .frameLocator(
      'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])',
    )
    .locator('[data-agent-native-edit-overlay="selection"]')
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

/** Waits until the screen stops moving, since selecting a board layer can pan the camera. */
async function cameraStill(app: App) {
  const screen = app.page.locator(
    'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])',
  );
  let previous = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await screen.boundingBox());
      const still = now === previous;
      previous = now;
      return still;
    })
    .toBe(true);
}

/** Empty board just below the screen, clear of the side panels and the bottom toolbar. */
async function boardPointOutsideScreen(app: App) {
  const card = (await app.page
    .locator("[data-screen-card]")
    .first()
    .boundingBox())!;
  const toolbar = (await app.page
    .locator("[data-design-bottom-toolbar]")
    .boundingBox())!;
  const point = { x: card.x + 120, y: card.y + card.height + 50 };
  expect(point.x + 60, "left of the bottom toolbar").toBeLessThan(toolbar.x);
  expect(point.y, "above the bottom of the viewport").toBeLessThan(
    app.page.viewportSize()!.height - 40,
  );
  return point;
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe("marquee reachability", () => {
  test("a drag from empty space inside a screen rubber-bands its children", async ({
    app,
  }) => {
    await openFixture(app);
    await sweep(app, { x: 16, y: 100 }, { x: 290, y: 210 });
    await expect
      .poll(
        sortedSelection(app),
        "the band selects the two boxes, not the Wrapper it was drawn inside",
      )
      .toEqual(["Box A", "Box B"]);
  });

  test("the band catches an element that has no id of its own", async ({
    app,
  }) => {
    await openFixture(app);
    await sweep(app, { x: 16, y: 306 }, { x: 230, y: 404 });
    await expect.poll(sortedSelection(app)).toEqual(["Unnamed"]);
  });

  test("the band catches a zero-height row", async ({ app }) => {
    await openFixture(app);
    await sweep(app, { x: 16, y: 422 }, { x: 230, y: 470 });
    await expect
      .poll(sortedSelection(app), "a zero-area box is still a layer")
      .toEqual(["Flat row"]);
  });
});

test.describe("hairline selection", () => {
  test("clicking a horizontal rule selects the rule with a grabbable outline", async ({
    app,
  }) => {
    await openFixture(app);
    await clickDesign(app, 150, 266);
    await expect
      .poll(
        () => app.selectedLayers(),
        "the <path> is geometry; the layer is the <svg>",
      )
      .toEqual(["Rule"]);
    await expect
      .poll(
        () => selectionOutline(app),
        "the outline is the rule's own 260x12 box, not its 3px stroke",
      )
      .toEqual({ x: 20, y: 260, width: 260, height: 12 });
  });
});

test.describe("clicking into a selected screen", () => {
  test("plain clicks progress through the screen's direct children", async ({
    app,
  }) => {
    await openFixture(app);
    await app.page.locator("[data-frame-label]").first().click();
    await expect.poll(() => app.selectedLayers()).toEqual(["Home"]);

    await clickDesign(app, 75, 160);
    await expect
      .poll(
        () => app.selectedLayers(),
        "the first content click selects the screen's direct child",
      )
      .toEqual(["Wrapper"]);
    await clickDesign(app, 75, 160);
    await expect
      .poll(
        () => app.selectedLayers(),
        "a repeated click descends to the clicked child",
      )
      .toEqual(["Box A"]);
    await clickDesign(app, 225, 160);
    await expect
      .poll(
        () => app.selectedLayers(),
        "a click on a sibling moves the selection to it",
      )
      .toEqual(["Box B"]);
  });
});

test.describe("drag preview", () => {
  test("dragging a layer out of its screen shows a proxy the size and colour of the layer", async ({
    app,
  }) => {
    await openFixture(app);
    await clickDesign(app, 75, 160);
    await clickDesign(app, 75, 160);
    await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
    const start = await app.pagePoint(75, 160);
    const scale = (await app.pagePoint(0, 0)).scale;
    const card = (await app.page
      .locator("[data-screen-card]")
      .first()
      .boundingBox())!;

    await app.page.mouse.move(start.x, start.y);
    await app.page.mouse.down();
    await app.page.mouse.move(card.x - 140, card.y + 80, { steps: 20 });
    const ghost = app.page.locator("[data-cross-screen-drag-ghost]");
    await expect(ghost).toBeVisible();
    await expect(ghost, "the proxy carries the layer's own fill").toHaveCSS(
      "background-color",
      "rgb(59, 130, 246)",
    );
    const proxy = (await ghost.boundingBox())!;
    await app.page.mouse.up();

    expect(
      Math.abs(proxy.width - 110 * scale),
      `proxy width ${proxy.width}`,
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(proxy.height - 80 * scale),
      `proxy height ${proxy.height}`,
    ).toBeLessThanOrEqual(2);
  });
});

test.describe("dragging back into a screen", () => {
  test("the layer lands where it was released, not in the corner", async ({
    app,
  }) => {
    const id = await openFixture(app);
    await clickDesign(app, 75, 160);
    await clickDesign(app, 75, 160);
    await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
    const before = await app.savedNodes(id);
    const start = await app.pagePoint(75, 160);
    const boardPoint = await boardPointOutsideScreen(app);

    await app.page.mouse.move(start.x, start.y);
    await app.page.mouse.down();
    await app.page.mouse.move(boardPoint.x, boardPoint.y, { steps: 20 });
    await app.page.mouse.up();
    await expect
      .poll(
        async () => (await app.savedNodes(id, "__board__.html")).has("box-a"),
        "first leg: onto the board",
      )
      .toBe(true);
    await app.settled();

    const boardBox = () =>
      app.page
        .locator(
          "[data-board-surface-layer] iframe[data-design-preview-iframe]",
        )
        .first()
        .contentFrame()
        .locator('[data-agent-native-node-id="box-a"]')
        .boundingBox();
    const onBoard = (await boardBox())!;
    await app.page.mouse.click(
      onBoard.x + onBoard.width / 2,
      onBoard.y + onBoard.height / 2,
    );
    await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
    await cameraStill(app);
    await app.zoomToFit();
    const settledOnBoard = (await boardBox())!;
    const grab = {
      x: settledOnBoard.x + settledOnBoard.width / 2,
      y: settledOnBoard.y + settledOnBoard.height / 2,
    };
    const release = await app.pagePoint(200, 520);
    await app.page.mouse.move(grab.x, grab.y);
    await app.page.mouse.down();
    await app.page.mouse.move(release.x, release.y, { steps: 22 });
    await app.page.mouse.up();

    await expect
      .poll(async () => (await app.savedNodes(id)).get("box-a")?.parent)
      .toBe("wrapper");
    await app.settled();
    const after = await app.savedNodes(id);
    const saved = styleOf(after.get("box-a"));
    expect({
      position: saved.position,
      width: saved.width,
      height: saved.height,
    }).toEqual({
      position: "absolute",
      width: "110px",
      height: "80px",
    });
    expect(
      Math.abs(parseFloat(saved.left) - 145),
      `left ${saved.left}: centred on the release point`,
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(parseFloat(saved.top) - 480),
      `top ${saved.top}: centred on the release point`,
    ).toBeLessThanOrEqual(2);
    expect((await app.savedNodes(id, "__board__.html")).has("box-a")).toBe(
      false,
    );
    expectOnlyChanged(before, after, ["box-a"]);
  });
});

test.describe("dragging out and back onto the same screen", () => {
  // fixme: product bug: Box B stays in the screen but lands at 110/315 instead of 105/380 (65px above the release point; inspector X 110 Y 315).
  test.fixme("the layer stays in the screen at the release point instead of landing on the board behind it", async ({
    app,
  }) => {
    const id = await openFixture(app);
    await clickDesign(app, 225, 160);
    await clickDesign(app, 225, 160);
    await expect.poll(() => app.selectedLayers()).toEqual(["Box B"]);
    const before = await app.savedNodes(id);
    const board = await app.savedNodes(id, "__board__.html");
    const start = await app.pagePoint(225, 160);
    const outside = await boardPointOutsideScreen(app);
    const release = await app.pagePoint(160, 420);

    await app.page.mouse.move(start.x, start.y);
    await app.page.mouse.down();
    await app.page.mouse.move(outside.x, outside.y, { steps: 14 });
    await app.page.mouse.move(release.x, release.y, { steps: 16 });
    await app.page.mouse.up();

    await expect
      .poll(async () => styleOf((await app.savedNodes(id)).get("box-b")).top)
      .not.toBe("120px");
    await app.settled();
    const after = await app.savedNodes(id);
    expect(after.get("box-b")?.parent, "still in the screen's Wrapper").toBe(
      "wrapper",
    );
    const saved = styleOf(after.get("box-b"));
    expect(
      Math.abs(parseFloat(saved.left) - 105),
      `left ${saved.left}`,
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(parseFloat(saved.top) - 380),
      `top ${saved.top}`,
    ).toBeLessThanOrEqual(2);
    expectOnlyChanged(before, after, ["box-b"]);
    expectOnlyChanged(board, await app.savedNodes(id, "__board__.html"), []);
  });
});

test.describe("hidden layers", () => {
  test("a band over the document origin selects only visible layers, never a display:none one", async ({
    app,
  }) => {
    await openFixture(app);
    await sweep(app, { x: 150, y: 210 }, { x: -20, y: -20 });
    await expect
      .poll(
        sortedSelection(app),
        "a display:none layer's 0x0 box at the origin must not be caught",
      )
      .toEqual(["Box A"]);
  });
});
