import { appPath, expandAllLayers, selectTool } from "./helpers";
import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const PAGE_H = 900;

const INTRO_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Playbook</title></head>
  <body data-agent-native-node-id="page" style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#f4f4f5;font-family:system-ui,sans-serif">
    <section data-agent-native-node-id="intro" data-agent-native-layer-name="Intro"
             style="position:absolute;left:20px;top:200px;width:280px;display:flex;flex-direction:column;gap:16px">
      <h1 data-agent-native-node-id="intro-title" data-agent-native-layer-name="Title"
          style="margin:0;font-size:24px;line-height:1.1">Title</h1>
      <p data-agent-native-node-id="intro-sub" data-agent-native-layer-name="Sub"
         style="margin:0;font-size:18px">Short, one line sub header</p>
      <p data-agent-native-node-id="intro-body" data-agent-native-layer-name="Body"
         style="margin:0;font-size:16px">A few sentences describing the purpose of the document.</p>
    </section>
    <div data-agent-native-node-id="plain-box" data-agent-native-layer-name="Plain Box"
         style="position:absolute;left:20px;top:560px;width:160px;height:100px;background:#27272a"></div>
  </body>
</html>`;

const FLOW_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Playbook</title></head>
  <body data-agent-native-node-id="page" style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#f4f4f5;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="page-wrap" data-agent-native-layer-name="A4 Playbook Page"
         style="position:absolute;left:16px;top:60px;width:288px;display:flex;flex-direction:column;gap:24px;padding:16px">
      <div data-agent-native-node-id="flow-header" data-agent-native-layer-name="Header"
           style="height:64px;background:#1f2937"></div>
      <section data-agent-native-node-id="flow-intro" data-agent-native-layer-name="Intro"
               style="display:flex;flex-direction:column;gap:16px">
        <h1 data-agent-native-node-id="flow-title" data-agent-native-layer-name="Title"
            style="margin:0;font-size:24px;line-height:1.1">Title</h1>
        <p data-agent-native-node-id="flow-sub" data-agent-native-layer-name="Sub"
           style="margin:0;font-size:18px">Short, one line sub header</p>
      </section>
    </div>
  </body>
</html>`;

const ABSOLUTE_CHILDREN_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Overlap</title></head>
  <body data-agent-native-node-id="page" style="margin:0;min-height:${PAGE_H}px;background:#0f1115;color:#f4f4f5;font-family:system-ui,sans-serif">
    <section data-agent-native-node-id="abs-intro" data-agent-native-layer-name="Intro"
             style="position:absolute;left:20px;top:200px;width:280px;height:200px">
      <h1 data-agent-native-node-id="abs-title" data-agent-native-layer-name="Title"
          style="position:absolute;left:0;top:0;margin:0;font-size:40px">Title</h1>
      <p data-agent-native-node-id="abs-sub" data-agent-native-layer-name="Sub"
         style="position:absolute;left:0;top:0;margin:0;font-size:18px">Short, one line sub header</p>
      <p data-agent-native-node-id="abs-body" data-agent-native-layer-name="Body"
         style="position:absolute;left:0;top:0;margin:0;font-size:16px">A few sentences describing the purpose.</p>
    </section>
  </body>
</html>`;

const BLANK_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Blank</title></head>
  <body data-agent-native-node-id="page" style="margin:0;min-height:${PAGE_H}px;background:#ffffff"></body>
</html>`;

const DRAW_FRAME_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Frame drawing</title></head>
  <body data-agent-native-node-id="page" style="margin:0;min-height:${PAGE_H}px;background:#ffffff">
    <div data-agent-native-node-id="draw-frame" data-agent-native-layer-name="Frame" data-an-primitive="frame"
         style="position:absolute;left:60px;top:80px;width:320px;height:260px;background:#e4e4e7"></div>
  </body>
</html>`;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

test.use({ viewport: { width: 1600, height: 1000 } });

async function openPage(app: App, html = INTRO_PAGE) {
  const id = await app.seed(html);
  await app.open(id);
  await app.zoomToFit();
  await expandAllLayers(app.page);
  await app.settled();
  return id;
}

async function clickAt(app: App, x: number, y: number) {
  const point = await app.pagePoint(x, y);
  await app.page.mouse.click(point.x, point.y);
}

async function clickNode(app: App, nodeId: string) {
  const rect = await app.designRect(nodeId);
  await clickAt(app, rect.x + rect.width / 2, rect.y + rect.height / 2);
}

function layerButton(app: App, name: string) {
  return app.page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name, exact: true });
}

function positionInput(app: App, axis: "X" | "Y") {
  return app.page.locator(`input[aria-label="${axis}-position"]`);
}

function fixedSizeInput(app: App, axis: "W" | "H") {
  return app.page.locator(`input[aria-label="${axis} size in pixels"]`);
}

async function commitField(app: App, axis: "X" | "Y" | "W", value: string) {
  const input =
    axis === "W" ? fixedSizeInput(app, "W") : positionInput(app, axis);
  await input.fill(value);
  await input.press("Enter");
  await app.settled();
}

/** The browser's own layout size, rounded the way the inspector rounds (one decimal). */
async function laidOutSize(app: App, nodeId: string) {
  return app.node(nodeId).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
    };
  });
}

async function draw(app: App, tool: "Rectangle" | "Frame", box: Box) {
  await selectTool(app.page, tool);
  const button = app.page.locator(
    `[data-design-bottom-toolbar] button[aria-label="${tool}"]`,
  );
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const start = await app.pagePoint(box.left, box.top);
  const end = await app.pagePoint(box.left + box.width, box.top + box.height);
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move(end.x, end.y, { steps: 14 });
  await app.page.mouse.up();
  await app.settled();
}

async function dragBy(
  app: App,
  from: { x: number; y: number },
  dx: number,
  dy: number,
) {
  const start = await app.pagePoint(from.x, from.y);
  const end = await app.pagePoint(from.x + dx, from.y + dy);
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move(end.x, end.y, { steps: 16 });
  await app.page.mouse.up();
  await app.settled();
}

function added(before: Map<string, SavedNode>, after: Map<string, SavedNode>) {
  return [...after.values()].filter((node) => !before.has(node.id));
}

function savedBox(node: SavedNode) {
  const style = styleOf(node);
  return ["left", "top", "width", "height"].map((key) =>
    Number.parseFloat(style[key]!),
  );
}

/** Pointer input lands on whole page pixels, so a pointed-at edge can be off by one page pixel in design px. */
async function expectBox(
  app: App,
  label: string,
  actual: number[],
  expected: Box,
) {
  const want = [expected.left, expected.top, expected.width, expected.height];
  const tolerance = Math.max(
    1,
    Math.ceil(1 / (await app.pagePoint(0, 0)).scale),
  );
  const off = actual.filter(
    (value, index) => Math.abs(value - want[index]!) > tolerance,
  );
  expect(
    off,
    `${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(want)} ±${tolerance}`,
  ).toEqual([]);
}

async function zoomOutOnce(app: App) {
  const frame = app.page
    .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
    .first();
  const before = JSON.stringify(await frame.boundingBox());
  await app.page.keyboard.press("ControlOrMeta+-");
  let previous = "";
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await frame.boundingBox());
        const stable = now === previous && now !== before;
        previous = now;
        return stable;
      },
      {
        intervals: [100],
        message: "the canvas never settled after zooming out",
      },
    )
    .toBe(true);
}

async function layoutGrid(app: App, designId: string, size: number) {
  const screenId = (await app.savedRecord(designId)).files.find(
    (file) => file.filename === "index.html",
  )!.id;
  const response = await app.page.request.post(
    appPath("/_agent-native/actions/set-layout-grid"),
    {
      data: { designId, screenId, size },
    },
  );
  expect(response.ok(), `set-layout-grid ${response.status()}`).toBe(true);
  return screenId;
}

test.describe("inspector reports the truth", () => {
  // fixme: product bug: Known family, clipped inspector fields: the H control's accessible name is 'H 115.4 Hug' but it displays 'H 11... Hug'. X/Y/W pass.
  test.fixme("selecting Intro shows its authored X, Y and W and its measured hug height", async ({
    app,
  }) => {
    await openPage(app);
    await layerButton(app, "Intro").click();
    await expect.poll(() => app.selectedLayers()).toEqual(["Intro"]);
    const { height } = await laidOutSize(app, "intro");

    await expect(positionInput(app, "X")).toHaveValue("20px");
    await expect(positionInput(app, "Y")).toHaveValue("200px");
    await expect(fixedSizeInput(app, "W")).toHaveValue("280px");
    const hug = app.page.getByRole("button", {
      name: `H ${height} Hug`,
      exact: true,
    });
    await expect(hug).toBeVisible();
    expect(
      await hug.evaluate((button) =>
        [button, ...button.querySelectorAll("*")].every(
          (part) => part.scrollWidth <= part.clientWidth,
        ),
      ),
      `the H control shows all of "${height}"`,
    ).toBe(true);
  });

  test("a canvas click on Plain Box selects it and shows X 20, Y 560, W 160, H 100", async ({
    app,
  }) => {
    await openPage(app);

    await clickNode(app, "plain-box");

    await expect.poll(() => app.selectedLayers()).toEqual(["Plain Box"]);
    await expect(positionInput(app, "X")).toHaveValue("20px");
    await expect(positionInput(app, "Y")).toHaveValue("560px");
    await expect(fixedSizeInput(app, "W")).toHaveValue("160px");
    await expect(fixedSizeInput(app, "H")).toHaveValue("100px");
  });

  test("a stretched child of an auto-layout column shows its laid-out width and height", async ({
    app,
  }) => {
    await openPage(app);
    await layerButton(app, "Title").click();
    await expect.poll(() => app.selectedLayers()).toEqual(["Title"]);
    const size = await laidOutSize(app, "intro-title");
    expect(
      size,
      "fixture: Title stretches to Intro's 280px and is one 26.4px line",
    ).toEqual({ width: 280, height: 26.4 });

    await expect(
      app.page.getByRole("button", { name: /^W 280 / }),
    ).toBeVisible();
    await expect(
      app.page.getByRole("button", { name: /^H 26\.4 / }),
    ).toBeVisible();
  });

  test("an in-flow element inside nested auto layout with no frame ancestor shows its screen position, not 0,0", async ({
    app,
  }) => {
    await openPage(app, FLOW_PAGE);
    await layerButton(app, "Intro").click();
    await expect.poll(() => app.selectedLayers()).toEqual(["Intro"]);

    await expect(positionInput(app, "X")).toHaveValue("32px");
    await expect(positionInput(app, "Y")).toHaveValue("164px");
  });

  test("typing X then Y moves Plain Box to exactly that position and changes nothing else", async ({
    app,
  }) => {
    const id = await openPage(app);
    await clickNode(app, "plain-box");
    await expect.poll(() => app.selectedLayers()).toEqual(["Plain Box"]);
    const before = await app.savedNodes(id);

    await commitField(app, "X", "300");
    const movedX = await app.savedNodes(id);
    expect(
      styleOf(movedX.get("plain-box")),
      "the X edit must save first",
    ).toEqual({
      ...styleOf(before.get("plain-box")),
      left: "300px",
    });
    await commitField(app, "Y", "400");

    const after = await app.savedNodes(id);
    expect(styleOf(after.get("plain-box"))).toEqual({
      ...styleOf(before.get("plain-box")),
      left: "300px",
      top: "400px",
    });
    expectOnlyChanged(before, after, ["plain-box"]);
    expect(await app.designRect("plain-box")).toEqual({
      x: 300,
      y: 400,
      width: 160,
      height: 100,
    });
  });

  test("re-entering the X shown for a nested child does not move it", async ({
    app,
  }) => {
    const id = await openPage(app);
    await layerButton(app, "Title").click();
    await expect.poll(() => app.selectedLayers()).toEqual(["Title"]);
    const before = await app.savedNodes(id);
    const shown = await positionInput(app, "X").inputValue();

    await commitField(app, "X", shown.replace("px", ""));

    expectOnlyChanged(before, await app.savedNodes(id), []);
    expect(await app.designRect("intro-title")).toEqual(
      expect.objectContaining({ x: 20, y: 200, width: 280 }),
    );
  });

  test("changing width keeps the element's position and changes nothing else", async ({
    app,
  }) => {
    const id = await openPage(app);
    await clickNode(app, "plain-box");
    await expect.poll(() => app.selectedLayers()).toEqual(["Plain Box"]);
    const before = await app.savedNodes(id);

    await commitField(app, "W", "500");

    const after = await app.savedNodes(id);
    expect(styleOf(after.get("plain-box"))).toEqual({
      ...styleOf(before.get("plain-box")),
      width: "500px",
    });
    expectOnlyChanged(before, after, ["plain-box"]);
    expect(await app.designRect("plain-box")).toEqual({
      x: 20,
      y: 560,
      width: 500,
      height: 100,
    });
  });
});

test.describe("auto layout", () => {
  test("Shift+A on a frame of stacked absolute children reflows them in order without overlap", async ({
    app,
  }) => {
    const id = await openPage(app, ABSOLUTE_CHILDREN_PAGE);
    await clickAt(app, 270, 380);
    await expect.poll(() => app.selectedLayers()).toEqual(["Intro"]);
    const before = await app.savedNodes(id);

    await app.page.keyboard.press("Shift+A");
    await app.settled();

    const after = await app.savedNodes(id);
    expect(styleOf(after.get("abs-intro"))).toEqual({
      ...styleOf(before.get("abs-intro")),
      display: "flex",
      "flex-direction": "row",
      gap: "10px",
    });
    expect(childrenOf(after, "abs-intro")).toStrictEqual([
      "abs-title",
      "abs-sub",
      "abs-body",
    ]);
    expect(
      ["abs-title", "abs-sub", "abs-body"].map(
        (child) => styleOf(after.get(child)).position,
      ),
      "children become flow items",
    ).toEqual(["static", "static", "static"]);
    expectOnlyChanged(before, after, [
      "abs-intro",
      "abs-title",
      "abs-sub",
      "abs-body",
    ]);
    const boxes = await Promise.all(
      ["abs-title", "abs-sub", "abs-body"].map((child) =>
        app.designRect(child),
      ),
    );
    const overlapping = boxes.filter((box, index) =>
      boxes.some(
        (other, earlier) =>
          earlier < index &&
          box.x < other.x + other.width &&
          box.x + box.width > other.x &&
          box.y < other.y + other.height &&
          box.y + box.height > other.y,
      ),
    );
    expect(overlapping, `rendered boxes ${JSON.stringify(boxes)}`).toEqual([]);
  });
});

test.describe("drawing fidelity", () => {
  test("a rectangle drawn from the page origin saves at 0,0 with the dragged size", async ({
    app,
  }) => {
    const id = await openPage(app, BLANK_PAGE);
    const before = await app.savedNodes(id);

    await draw(app, "Rectangle", { left: 0, top: 0, width: 200, height: 120 });

    const after = await app.savedNodes(id);
    const drawn = added(before, after);
    expect(
      drawn.map((node) => [node.parent, node.attrs["data-an-primitive"]]),
    ).toEqual([["page", "rectangle"]]);
    await expectBox(app, "saved rectangle", savedBox(drawn[0]!), {
      left: 0,
      top: 0,
      width: 200,
      height: 120,
    });
    expectOnlyChanged(before, after, [drawn[0]!.id]);
  });

  test("a rectangle drawn after zooming out saves whole pixels at the dragged box", async ({
    app,
  }) => {
    const id = await openPage(app, BLANK_PAGE);
    await zoomOutOnce(app);
    const before = await app.savedNodes(id);
    const box = { left: 37, top: 113, width: 151, height: 97 };

    await draw(app, "Rectangle", box);

    const after = await app.savedNodes(id);
    const drawn = added(before, after);
    expect(drawn.map((node) => node.attrs["data-an-primitive"])).toEqual([
      "rectangle",
    ]);
    const saved = savedBox(drawn[0]!);
    expect(
      saved.filter((value) => !Number.isInteger(value)),
      `saved ${JSON.stringify(saved)}`,
    ).toEqual([]);
    await expectBox(app, "saved rectangle", saved, box);
    expectOnlyChanged(before, after, [drawn[0]!.id]);
  });

  test("dragging inside a screen with an 8px layout grid lands on the nearest grid point", async ({
    app,
  }) => {
    const id = await app.seed(INTRO_PAGE);
    await layoutGrid(app, id, 8);
    await app.open(id);
    await app.zoomToFit();
    await expandAllLayers(app.page);
    await app.settled();
    await clickNode(app, "plain-box");
    await expect.poll(() => app.selectedLayers()).toEqual(["Plain Box"]);
    const before = await app.savedNodes(id);

    await dragBy(app, { x: 100, y: 610 }, 37, 21);

    const after = await app.savedNodes(id);
    expect(styleOf(after.get("plain-box"))).toEqual({
      ...styleOf(before.get("plain-box")),
      left: "56px",
      top: "584px",
    });
    expectOnlyChanged(before, after, ["plain-box"]);
  });

  test("a visible layout grid paints over the screen's own opaque background", async ({
    app,
  }) => {
    const id = await openPage(
      app,
      `<!doctype html><html><head><meta charset="utf-8" /></head>
       <body data-agent-native-node-id="page" style="margin:0;width:900px;height:600px;background:#ffffff"></body></html>`,
    );
    const screenId = await layoutGrid(app, id, 48);

    const overlay = app.page.locator(`[data-layout-grid="${screenId}"]`);
    await expect(overlay).toHaveCount(1);
    const grid = await overlay.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const previous = (element as HTMLElement).style.pointerEvents;
      (element as HTMLElement).style.pointerEvents = "auto";
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      (element as HTMLElement).style.pointerEvents = previous;
      return {
        insideCard: Boolean(element.closest("[data-screen-card]")),
        onTop: element === hit || element.contains(hit),
        backgroundSize: getComputedStyle(element).backgroundSize,
      };
    });
    expect(grid).toEqual({
      insideCard: true,
      onTop: true,
      backgroundSize: "48px 48px, 48px 48px",
    });
  });

  test("a drawn frame is selected and the selection outline matches it exactly", async ({
    app,
  }) => {
    const id = await openPage(app, BLANK_PAGE);
    const before = await app.savedNodes(id);
    const box = { left: 40, top: 100, width: 200, height: 200 };

    await draw(app, "Frame", box);

    await expect.poll(() => app.selectedLayers()).toEqual(["Frame"]);
    const frame = added(before, await app.savedNodes(id));
    expect(frame.map((node) => node.attrs["data-an-primitive"])).toEqual([
      "frame",
    ]);
    await expectBox(app, "saved frame", savedBox(frame[0]!), box);
    const outline = await app.node("page").evaluate((body) => {
      const selection = body.ownerDocument.querySelector(
        '[data-agent-native-edit-overlay="selection"]',
      );
      if (!selection) return null;
      const rect = selection.getBoundingClientRect();
      return [
        Math.round(rect.left),
        Math.round(rect.top),
        Math.round(rect.width),
        Math.round(rect.height),
      ];
    });
    const rendered = await app.designRect(frame[0]!.id);
    expect(outline).toEqual([
      rendered.x,
      rendered.y,
      rendered.width,
      rendered.height,
    ]);
  });
});

test.describe("moving", () => {
  test("a canvas drag moves Plain Box by exactly the drag delta and nothing else", async ({
    app,
  }) => {
    const id = await openPage(app);
    await clickNode(app, "plain-box");
    await expect.poll(() => app.selectedLayers()).toEqual(["Plain Box"]);
    const before = await app.savedNodes(id);

    await dragBy(app, { x: 100, y: 610 }, 100, 0);

    const after = await app.savedNodes(id);
    expect(styleOf(after.get("plain-box"))).toEqual({
      ...styleOf(before.get("plain-box")),
      left: "120px",
    });
    expectOnlyChanged(before, after, ["plain-box"]);
    expect(await app.designRect("plain-box")).toEqual({
      x: 120,
      y: 560,
      width: 160,
      height: 100,
    });
  });

  test("an arrow-key nudge moves exactly one pixel and nothing else", async ({
    app,
  }) => {
    const id = await openPage(app);
    await clickNode(app, "plain-box");
    await expect.poll(() => app.selectedLayers()).toEqual(["Plain Box"]);
    const before = await app.savedNodes(id);

    await app.page.keyboard.press("ArrowRight");
    await app.settled();

    const after = await app.savedNodes(id);
    expect(styleOf(after.get("plain-box"))).toEqual({
      ...styleOf(before.get("plain-box")),
      left: "21px",
    });
    expectOnlyChanged(before, after, ["plain-box"]);
  });
});

test.describe("selection", () => {
  test("a click replaces the selection with the deepest node, Backslash walks up, and Escape clears", async ({
    app,
  }) => {
    const id = await openPage(app);
    const before = await app.savedNodes(id);
    await clickNode(app, "plain-box");
    await expect.poll(() => app.selectedLayers()).toEqual(["Plain Box"]);

    await clickNode(app, "intro-title");
    await expect.poll(() => app.selectedLayers()).toEqual(["Title"]);
    await app.page.keyboard.press("\\");
    await expect.poll(() => app.selectedLayers()).toEqual(["Intro"]);
    await app.page.keyboard.press("Escape");
    await expect.poll(() => app.selectedLayers()).toEqual([]);

    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });

  // fixme: product bug: Escape right after drawing clears the canvas selection chrome, but the Layers panel and inspector keep Rectangle selected (selection
  test.fixme("Escape on a rectangle just drawn inside a frame clears the selection without selecting the screen", async ({
    app,
  }) => {
    const id = await openPage(app, DRAW_FRAME_PAGE);
    const before = await app.savedNodes(id);
    await draw(app, "Rectangle", {
      left: 110,
      top: 130,
      width: 140,
      height: 110,
    });
    const drawn = added(before, await app.savedNodes(id));
    expect(
      drawn.map((node) => [node.parent, node.attrs["data-an-primitive"]]),
    ).toEqual([["draw-frame", "rectangle"]]);
    await expect.poll(() => app.selectedLayers()).toEqual(["Rectangle"]);

    await app.page.keyboard.press("Escape");

    await expect.poll(() => app.selectedLayers()).toEqual([]);
    await expect(app.page.locator("[data-frame-selection-box]")).toHaveCount(0);
  });
});

test.describe("persistence and history", () => {
  test("a reload changes nothing", async ({ app }) => {
    const id = await openPage(app);
    const before = await app.savedHtml(id);

    await app.open(id);
    await app.settled();

    expect(await app.savedHtml(id)).toBe(before);
  });

  test("idling in the editor changes nothing", async ({ app, page }) => {
    const id = await openPage(app);
    const before = await app.savedHtml(id);
    await page.waitForTimeout(6000);
    expect(await app.savedHtml(id)).toBe(before);
  });

  test("a nudge, its undo and its redo each save exactly the expected document", async ({
    app,
  }) => {
    const id = await openPage(app);
    await clickNode(app, "plain-box");
    await expect.poll(() => app.selectedLayers()).toEqual(["Plain Box"]);
    const before = await app.savedNodes(id);
    await app.page.keyboard.press("ArrowRight");
    await app.settled();
    const edited = await app.savedNodes(id);
    expect(
      styleOf(edited.get("plain-box")).left,
      "the nudge must save first",
    ).toBe("21px");

    await app.page.keyboard.press("ControlOrMeta+z");
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);

    await app.page.keyboard.press("ControlOrMeta+Shift+z");
    await app.settled();
    expectOnlyChanged(edited, await app.savedNodes(id), []);
  });

  // fixme: product bug: After redo the selection is Rectangle, not the re-created Frame. The saved undo/redo states are exact.
  test.fixme("drawing two shapes then undo removes only the frame, and redo restores it selected", async ({
    app,
  }) => {
    const id = await openPage(app, BLANK_PAGE);
    const seeded = await app.savedNodes(id);
    await draw(app, "Rectangle", {
      left: 100,
      top: 100,
      width: 200,
      height: 120,
    });
    const withRectangle = await app.savedNodes(id);
    await draw(app, "Frame", { left: 400, top: 100, width: 300, height: 200 });
    const withBoth = await app.savedNodes(id);
    expect(
      added(seeded, withBoth).map((node) => node.attrs["data-an-primitive"]),
      "both draws must save",
    ).toEqual(["rectangle", "frame"]);

    await app.page.keyboard.press("ControlOrMeta+z");
    await app.settled();
    expectOnlyChanged(withRectangle, await app.savedNodes(id), []);

    await app.page.keyboard.press("ControlOrMeta+Shift+z");
    await app.settled();
    expectOnlyChanged(withBoth, await app.savedNodes(id), []);
    await expect.poll(() => app.selectedLayers()).toEqual(["Frame"]);
  });
});

test.describe("layers panel", () => {
  // fixme: fails on current main after the merge: Error: expect(received).toEqual(expected) // deep equality
  test.fixme("the tree mirrors DOM nesting with the last child on top", async ({
    app,
  }) => {
    await openPage(app);
    const rows = await app.page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem")
      .evaluateAll((items) =>
        items.map((item) => [
          (item as HTMLElement).innerText.trim(),
          item.getAttribute("aria-level"),
        ]),
      );
    expect(rows).toEqual([
      ["Home", "1"],
      ["Plain Box", "2"],
      ["Intro", "2"],
      ["Body", "3"],
      ["Sub", "3"],
      ["Title", "3"],
    ]);
  });

  test("Delete on a canvas-selected layer removes exactly that node from the saved document", async ({
    app,
  }) => {
    const id = await openPage(app);
    await clickNode(app, "plain-box");
    await expect.poll(() => app.selectedLayers()).toEqual(["Plain Box"]);
    const before = await app.savedNodes(id);

    await app.page.keyboard.press("Delete");
    await app.settled();

    const after = await app.savedNodes(id);
    expect(after.has("plain-box")).toBe(false);
    expectOnlyChanged(before, after, ["plain-box"]);
    await expect(app.node("plain-box")).toHaveCount(0);
    await expect(layerButton(app, "Plain Box")).toHaveCount(0);
  });

  test("hiding a layer from its Layers row hides it in the preview and saves the hidden flag", async ({
    app,
  }) => {
    const id = await openPage(app);
    const before = await app.savedNodes(id);
    const row = app.page
      .getByRole("tree", { name: "Layers" })
      .getByRole("treeitem")
      .filter({ hasText: "Plain Box" });

    await row.hover();
    await row.getByRole("button", { name: "Hide layer" }).click();
    await app.settled();

    await expect(app.node("plain-box")).toHaveCSS("display", "none");
    const after = await app.savedNodes(id);
    expect(after.get("plain-box")?.attrs).toEqual({
      ...before.get("plain-box")?.attrs,
      "data-agent-native-hidden": "true",
    });
    expectOnlyChanged(before, after, ["plain-box"]);
  });
});

test("editor readiness stays stable across ordinary overlay mutations", async ({
  app,
  page,
}) => {
  await openPage(app, BLANK_PAGE);
  const preview = page
    .frameLocator("iframe[data-design-preview-iframe]")
    .first();
  const chromeHost = preview.locator("[data-agent-native-editor-chrome-host]");
  const shield = preview.locator('[data-agent-native-edit-overlay="shield"]');
  await expect(shield).toBeVisible();

  await page.evaluate(() => {
    const state = window as Window & { __editorChromeReadyCount?: number };
    state.__editorChromeReadyCount = 0;
    window.addEventListener("message", (event) => {
      if (event.data?.type === "agent-native:editor-chrome-ready") {
        state.__editorChromeReadyCount =
          (state.__editorChromeReadyCount ?? 0) + 1;
      }
    });
  });

  await chromeHost.evaluate((host) => {
    const transient = document.createElement("div");
    transient.setAttribute("data-agent-native-edit-overlay", "test-overlay");
    host.appendChild(transient);
    transient.remove();
  });
  await page.waitForTimeout(100);
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __editorChromeReadyCount?: number })
          .__editorChromeReadyCount ?? 0,
    ),
  ).toBe(0);

  await shield.evaluate((element) => element.remove());
  await expect(shield).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __editorChromeReadyCount?: number })
            .__editorChromeReadyCount ?? 0,
      ),
    )
    .toBe(1);
});
