import { selectTool, type ToolbarTool } from "./helpers";
import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const BLANK_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Landing</title></head>
  <body data-agent-native-node-id="page" style="margin:0;min-height:900px;background:#0b0f19"></body>
</html>`;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

test.use({ viewport: { width: 1600, height: 1000 } });

async function openDesign(
  app: App,
  html = BLANK_SCREEN,
  files?: Record<string, string>,
) {
  const id = await app.seed(html, { files });
  await app.open(id);
  await app.zoomToFit();
  return id;
}

async function useTool(app: App, name: ToolbarTool) {
  await selectTool(app.page, name);
  await expect(
    app.page.locator(
      `[data-design-bottom-toolbar] button[aria-label="${name}"]`,
    ),
  ).toHaveAttribute("aria-pressed", "true");
}

async function drawBox(app: App, tool: "Frame" | "Rectangle", box: Box) {
  await useTool(app, tool);
  const start = await app.pagePoint(box.left, box.top);
  const end = await app.pagePoint(box.left + box.width, box.top + box.height);
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move(end.x, end.y, { steps: 14 });
  await app.page.mouse.up();
  await app.settled();
}

async function typeText(app: App, at: { x: number; y: number }, text: string) {
  await useTool(app, "Text");
  const point = await app.pagePoint(at.x, at.y);
  await app.page.mouse.click(point.x, point.y);
  const editing = app.node("page").locator("[data-agent-native-text-editing]");
  await expect(editing).toHaveCount(1);
  await app.page.keyboard.press("ControlOrMeta+a");
  await app.page.keyboard.type(text);
  await expect(editing).toHaveText(text);
  await app.page.keyboard.press("Escape");
  await expect(editing).toHaveCount(0);
  await app.settled();
}

async function clickAt(app: App, x: number, y: number) {
  const point = await app.pagePoint(x, y);
  await app.page.mouse.click(point.x, point.y);
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

function summary(nodes: SavedNode[]) {
  return nodes.map((node) => [
    node.tag,
    node.parent,
    node.attrs["data-an-primitive"],
    node.text,
  ]);
}

function savedBox(node: SavedNode) {
  const style = styleOf(node);
  return ["left", "top", "width", "height"].map((key) =>
    Number.parseFloat(style[key]!),
  );
}

async function renderedBox(app: App, nodeId: string) {
  const rect = await app.designRect(nodeId);
  return [rect.x, rect.y, rect.width, rect.height];
}

/** Pointer input lands on whole page pixels, so a pointed-at edge can be off by one page pixel in design px. */
async function expectNear(
  app: App,
  label: string,
  actual: number[],
  want: number[],
) {
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

async function expectBox(
  app: App,
  label: string,
  actual: number[],
  expected: Box,
) {
  await expectNear(app, label, actual, [
    expected.left,
    expected.top,
    expected.width,
    expected.height,
  ]);
}

function paintOf(node: SavedNode) {
  const {
    left: _left,
    top: _top,
    width: _width,
    height: _height,
    ...rest
  } = styleOf(node);
  return rest;
}

async function renderedColor(app: App, nodeId: string) {
  return app
    .node(nodeId)
    .evaluate((element) => getComputedStyle(element).color);
}

/** WCAG contrast ratio between two `rgb(...)` colours. */
function contrastRatio(foreground: string, background: string) {
  const luminance = (color: string) => {
    const [r, g, b] = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map((channel) => {
        const value = Number(channel) / 255;
        return value <= 0.03928
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [light, dark] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (light! + 0.05) / (dark! + 0.05);
}

test("0:53 — the Frame tool saves exactly the box you dragged", async ({
  app,
}) => {
  const id = await openDesign(app);
  const before = await app.savedNodes(id);
  const box = { left: 20, top: 40, width: 280, height: 96 };

  await drawBox(app, "Frame", box);

  await expect.poll(() => app.selectedLayers()).toEqual(["Frame"]);
  const after = await app.savedNodes(id);
  const drawn = added(before, after);
  expect(summary(drawn)).toEqual([["div", "page", "frame", ""]]);
  const frame = drawn[0]!;
  expect(paintOf(frame)).toEqual({
    position: "absolute",
    background: "rgb(255, 255, 255)",
    overflow: "hidden",
  });
  await expectBox(app, "saved frame", savedBox(frame), box);
  await expectBox(app, "rendered frame", await renderedBox(app, frame.id), box);
  expectOnlyChanged(before, after, [frame.id]);
});

test("1:16 — text typed on the dark canvas is committed in a readable light colour", async ({
  app,
}) => {
  const id = await openDesign(app);
  const before = await app.savedNodes(id);

  await typeText(app, { x: 24, y: 36 }, "Builder.io");

  const after = await app.savedNodes(id);
  const typed = added(before, after);
  expect(summary(typed)).toEqual([["div", "page", "text", "Builder.io"]]);
  const text = typed[0]!;
  expect(styleOf(text).color).toBe("rgb(255, 255, 255)");
  expect(await renderedColor(app, text.id)).toBe("rgb(255, 255, 255)");
  await expectNear(
    app,
    "typed text",
    (await renderedBox(app, text.id)).slice(0, 2),
    [24, 36],
  );
  expectOnlyChanged(before, after, [text.id]);
});

test("8:35 — a frame adopts text typed inside it, keeping the text where it was typed", async ({
  app,
}) => {
  const id = await openDesign(app);
  const before = await app.savedNodes(id);
  await drawBox(app, "Frame", { left: 20, top: 150, width: 280, height: 300 });
  const frame = added(before, await app.savedNodes(id));
  expect(summary(frame), "the Frame tool must commit one frame").toEqual([
    ["div", "page", "frame", ""],
  ]);

  await typeText(app, { x: 60, y: 260 }, "Design and code, one canvas");

  const after = await app.savedNodes(id);
  const typed = added(before, after).filter((node) => node.id !== frame[0]!.id);
  expect(summary(typed)).toEqual([
    ["div", frame[0]!.id, "text", "Design and code, one canvas"],
  ]);
  expect(childrenOf(after, frame[0]!.id)).toStrictEqual([typed[0]!.id]);
  await expectNear(
    app,
    "typed text",
    (await renderedBox(app, typed[0]!.id)).slice(0, 2),
    [60, 260],
  );
  expectOnlyChanged(before, after, [frame[0]!.id, typed[0]!.id]);
});

// fixme: product bug: The auto text colour follows the dark page, not the shape under the text: 'Not a child' is committed rgb(255,255,255) over the #D9D9D9
test.fixme("text typed over a light rectangle stays a page child and is readable on the rectangle", async ({
  app,
}) => {
  const id = await openDesign(app);
  const before = await app.savedNodes(id);
  await drawBox(app, "Rectangle", {
    left: 20,
    top: 150,
    width: 280,
    height: 300,
  });
  const rectangle = added(before, await app.savedNodes(id));
  expect(
    summary(rectangle),
    "the Rectangle tool must commit one rectangle",
  ).toEqual([["div", "page", "rectangle", ""]]);

  await typeText(app, { x: 60, y: 260 }, "Not a child");

  const after = await app.savedNodes(id);
  const typed = added(before, after).filter(
    (node) => node.id !== rectangle[0]!.id,
  );
  expect(summary(typed)).toEqual([["div", "page", "text", "Not a child"]]);
  expect(childrenOf(after, rectangle[0]!.id)).toStrictEqual([]);
  expectOnlyChanged(before, after, [rectangle[0]!.id, typed[0]!.id]);
  const color = await renderedColor(app, typed[0]!.id);
  expect(
    contrastRatio(color, "rgb(217, 217, 217)"),
    `text committed ${color} over the #D9D9D9 rectangle`,
  ).toBeGreaterThanOrEqual(4.5);
});

// fixme: product bug: Known family, clipped inspector fields: the Gap input holds '10px' but shows only '1' (scrollWidth > clientWidth). All saved-state
test.fixme("2:35 / 8:09 — Shift+A turns a frame holding text into an auto-layout container that keeps the text", async ({
  app,
}) => {
  const id = await openDesign(app);
  const seeded = await app.savedNodes(id);
  await drawBox(app, "Frame", { left: 20, top: 120, width: 280, height: 300 });
  await typeText(app, { x: 50, y: 200 }, "Hero title");
  const before = await app.savedNodes(id);
  const [frame, text] = added(seeded, before);
  expect(
    summary([frame!, text!]),
    "the frame must hold the typed text",
  ).toEqual([
    ["div", "page", "frame", ""],
    ["div", frame!.id, "text", "Hero title"],
  ]);
  await clickAt(app, 250, 380);
  await expect.poll(() => app.selectedLayers()).toEqual(["Frame"]);

  await app.page.keyboard.press("Shift+A");
  await app.settled();

  const after = await app.savedNodes(id);
  expect(styleOf(after.get(frame!.id))).toEqual({
    ...styleOf(frame),
    display: "flex",
    "flex-direction": "column",
    gap: "10px",
  });
  expect(childrenOf(after, frame!.id)).toStrictEqual([text!.id]);
  expect(after.get(text!.id)?.text).toBe("Hero title");
  expect(styleOf(after.get(text!.id))).toEqual({
    ...styleOf(text),
    position: "static",
    left: "auto",
    top: "auto",
    right: "auto",
    bottom: "auto",
  });
  expectOnlyChanged(before, after, [frame!.id, text!.id]);
  await expectBox(app, "rendered frame", await renderedBox(app, frame!.id), {
    left: 20,
    top: 120,
    width: 280,
    height: 300,
  });
  const gap = app.page.locator('input[aria-label="Gap"]');
  await expect(gap).toHaveValue("10px");
  expect(
    await gap.evaluate((input) => input.scrollWidth <= input.clientWidth),
    "the inspector's Gap field shows its whole value",
  ).toBe(true);
});

// fixme: product bug: The drag delta is exact, but the rectangle's bottom (460) lands within snap range of the screen's horizontal centre line (450) at zoom-to-fit, so it snaps and saves top 290 instead of 300. Whether that snap should win over the exact delta is undecided.
test.fixme("3:17 / 5:30 — a freshly drawn rectangle drags by exactly the pointer delta and the background never changes", async ({
  app,
}) => {
  const id = await openDesign(app);
  const seeded = await app.savedNodes(id);
  const drawn = { left: 40, top: 200, width: 200, height: 160 };
  await drawBox(app, "Rectangle", drawn);
  const before = await app.savedNodes(id);
  const rectangle = added(seeded, before);
  expect(
    summary(rectangle),
    "the Rectangle tool must commit one rectangle",
  ).toEqual([["div", "page", "rectangle", ""]]);
  await expectBox(app, "drawn rectangle", savedBox(rectangle[0]!), drawn);
  const background = () =>
    app.node("page").evaluate((body) => getComputedStyle(body).backgroundColor);

  const start = await app.pagePoint(140, 280);
  const end = await app.pagePoint(180, 380);
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, {
    steps: 8,
  });
  expect(await background(), "the screen background mid-drag").toBe(
    "rgb(11, 15, 25)",
  );
  await app.page.mouse.move(end.x, end.y, { steps: 8 });
  await app.page.mouse.up();
  await app.settled();

  const after = await app.savedNodes(id);
  const moved = { left: 80, top: 300, width: 200, height: 160 };
  await expectBox(
    app,
    "saved rectangle",
    savedBox(after.get(rectangle[0]!.id)!),
    moved,
  );
  await expectBox(
    app,
    "rendered rectangle",
    await renderedBox(app, rectangle[0]!.id),
    moved,
  );
  expectOnlyChanged(before, after, [rectangle[0]!.id]);
  expect(await background()).toBe("rgb(11, 15, 25)");
});

test("2:59 / 5:41 — a generated layer without a node id drags by exactly the pointer delta", async ({
  app,
}) => {
  const id = await openDesign(
    app,
    `<!doctype html><html><head><meta charset="utf-8"><title>Generated</title></head>
<body data-agent-native-node-id="page" style="margin:0;min-height:900px;background:#0f1115">
<div data-an-primitive="rectangle" data-agent-native-layer-name="Promo card"
     style="position:absolute;left:40px;top:200px;width:200px;height:160px;background:#374151"></div>
</body></html>`,
  );
  const before = await app.savedNodes(id);
  const card = [...before.values()].filter(
    (node) => node.attrs["data-agent-native-layer-name"] === "Promo card",
  );
  expect(
    card.map((node) => node.parent),
    "opening the design must give the card a node id",
  ).toEqual(["page"]);

  await clickAt(app, 140, 280);
  await expect.poll(() => app.selectedLayers()).toEqual(["Promo card"]);
  await dragBy(app, { x: 140, y: 280 }, 0, 120);

  const after = await app.savedNodes(id);
  const moved = { left: 40, top: 320, width: 200, height: 160 };
  await expectBox(app, "saved card", savedBox(after.get(card[0]!.id)!), moved);
  await expectBox(
    app,
    "rendered card",
    await renderedBox(app, card[0]!.id),
    moved,
  );
  expectOnlyChanged(before, after, [card[0]!.id]);
});

const MIXED_TEXT_SCREEN = `<!doctype html><html><head><meta charset="utf-8"><title>Headline</title></head>
<body data-agent-native-node-id="page" style="margin:0;min-height:900px;background:#0f1115;color:#fff">
<div data-agent-native-node-id="headline" data-agent-native-layer-name="Headline"
     style="position:absolute;left:40px;top:200px;width:360px;font-size:32px;line-height:1.2">
  Your prompt.<br><span data-agent-native-node-id="accent" style="color:#93c5fd">Production UI.</span>
</div></body></html>`;

test("Typography edits apply to a headline with direct text and inline children", async ({
  app,
}) => {
  const id = await openDesign(app, MIXED_TEXT_SCREEN);
  const before = await app.savedNodes(id);
  await clickAt(app, 120, 220);
  await expect.poll(() => app.selectedLayers()).toEqual(["Headline"]);
  const typography = app.page.locator("section").filter({
    has: app.page.getByRole("heading", { name: "Typography", exact: true }),
  });
  const size = typography.getByLabel("Size", { exact: true });
  await expect(size).toHaveValue("32px");

  await size.fill("40");
  await size.press("Enter");
  await app.settled();

  const after = await app.savedNodes(id);
  expect(styleOf(after.get("headline"))).toEqual({
    ...styleOf(before.get("headline")),
    "font-size": "40px",
  });
  expect(after.get("headline")?.text).toBe("Your prompt.");
  expectOnlyChanged(before, after, ["headline"]);
  await expect(app.node("accent")).toHaveCSS("font-size", "40px");
});

const STACK_SCREEN = `<!doctype html><html><head><meta charset="utf-8"><title>Stack</title></head>
<body data-agent-native-node-id="page" style="margin:0;min-height:900px;background:#0f1115;color:#fff">
<div data-agent-native-node-id="stack" data-agent-native-layer-name="Stack"
     style="position:absolute;left:20px;top:200px;width:280px;display:flex;flex-direction:column;gap:12px">
  <p data-agent-native-node-id="p1" data-agent-native-layer-name="First"
     style="margin:0;padding:12px;background:#1f2937">First paragraph</p>
  <p data-agent-native-node-id="p2" data-agent-native-layer-name="Second"
     style="margin:0;padding:12px;background:#374151">Second paragraph</p>
</div></body></html>`;

test("5:07 — dragging a text layer above its sibling on the canvas reorders the stack", async ({
  app,
}) => {
  const id = await openDesign(app, STACK_SCREEN);
  const before = await app.savedNodes(id);
  const first = await app.designRect("p1");
  const second = await app.designRect("p2");
  const grab = {
    x: second.x + second.width / 2,
    y: second.y + second.height / 2,
  };
  await clickAt(app, grab.x, grab.y);
  await expect.poll(() => app.selectedLayers()).toEqual(["Second"]);

  await dragBy(app, grab, 0, first.y + 4 - grab.y);

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "stack")).toStrictEqual(["p2", "p1"]);
  expect(after.get("p2")?.attrs.style).toBe(before.get("p2")?.attrs.style);
  expectOnlyChanged(before, after, ["p2"]);
  expect((await app.designRect("p2")).y).toBeLessThan(
    (await app.designRect("p1")).y,
  );
});

test("4:39 — Align top on a two-layer selection moves both to the higher top", async ({
  app,
}) => {
  const id = await openDesign(
    app,
    `<!doctype html><html><head><meta charset="utf-8"><title>Cards</title></head>
<body data-agent-native-node-id="page" style="margin:0;min-height:900px;background:#0b0f19">
<div data-agent-native-node-id="a" data-agent-native-layer-name="Card A" data-an-primitive="rectangle"
     style="position:absolute;left:20px;top:500px;width:130px;height:120px;background:#d9d9d9"></div>
<div data-agent-native-node-id="b" data-agent-native-layer-name="Card B" data-an-primitive="rectangle"
     style="position:absolute;left:170px;top:560px;width:130px;height:120px;background:#d9d9d9"></div>
</body></html>`,
  );
  const before = await app.savedNodes(id);
  await clickAt(app, 85, 560);
  await expect.poll(() => app.selectedLayers()).toEqual(["Card A"]);
  await app.page.keyboard.down("Shift");
  await clickAt(app, 235, 620);
  await app.page.keyboard.up("Shift");
  await expect.poll(() => app.selectedLayers()).toEqual(["Card B", "Card A"]);

  await app.page
    .getByRole("button", { name: "Align top", exact: true })
    .first()
    .click();
  await app.settled();

  const after = await app.savedNodes(id);
  expect(styleOf(after.get("b"))).toEqual({
    ...styleOf(before.get("b")),
    top: "500px",
  });
  expectOnlyChanged(before, after, ["b"]);
  expect((await app.designRect("b")).y).toBe(500);
});

// fixme: fails in CI on current main: app reported http 404: POST /_agent-native/collab/5V1oMS7Zi_4MJKPXtkFWn/awareness
test.fixme("deleting a selected screen removes its file and canvas frame and leaves the other screen untouched", async ({
  app,
}) => {
  const id = await openDesign(app, BLANK_SCREEN, {
    "scratch.html": BLANK_SCREEN,
  });
  const { files } = await app.savedRecord(id);
  const homeId = files.find((file) => file.filename === "index.html")!.id;
  const homeBefore = await app.savedNodes(id);
  const row = app.page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem")
    .filter({ hasText: "Scratch" });
  await row.click();
  await expect(row).toHaveAttribute("aria-selected", "true");

  await app.page.keyboard.press("Delete");
  await expect(row).toHaveCount(0);
  await app.settled();

  const saved = await app.savedRecord(id);
  expect(saved.files.map((file) => file.filename)).toStrictEqual([
    "index.html",
    "__board__.html",
  ]);
  expect(
    Object.keys(saved.data?.canvasFrames as Record<string, unknown>),
  ).toStrictEqual([homeId]);
  expectOnlyChanged(homeBefore, await app.savedNodes(id), []);
});

test("6:03 — drawing a header, hero and footer cards in sequence saves every shape where it was drawn", async ({
  app,
}) => {
  const id = await openDesign(app);
  const seeded = await app.savedNodes(id);
  const header = { left: 40, top: 24, width: 1200, height: 72 };
  const hero = { left: 120, top: 160, width: 1040, height: 420 };
  const cardOne = { left: 120, top: 640, width: 500, height: 200 };
  const cardTwo = { left: 660, top: 640, width: 500, height: 200 };

  await drawBox(app, "Frame", header);
  await typeText(app, { x: 64, y: 44 }, "Builder.io");
  await drawBox(app, "Rectangle", hero);
  await typeText(app, { x: 160, y: 300 }, "Ship design and code together");
  await drawBox(app, "Rectangle", cardOne);
  await drawBox(app, "Rectangle", cardTwo);

  const after = await app.savedNodes(id);
  const shapes = added(seeded, after);
  const headerId = shapes[0]!.id;
  expect(summary(shapes)).toEqual([
    ["div", "page", "frame", ""],
    ["div", headerId, "text", "Builder.io"],
    ["div", "page", "rectangle", ""],
    ["div", "page", "text", "Ship design and code together"],
    ["div", "page", "rectangle", ""],
    ["div", "page", "rectangle", ""],
  ]);
  const drawn = [
    [shapes[0]!, header],
    [shapes[2]!, hero],
    [shapes[4]!, cardOne],
    [shapes[5]!, cardTwo],
  ] as const;
  for (const [node, box] of drawn) {
    await expectBox(
      app,
      `saved ${node.attrs["data-an-primitive"]}`,
      savedBox(node),
      box,
    );
    await expectBox(
      app,
      `rendered ${node.attrs["data-an-primitive"]}`,
      await renderedBox(app, node.id),
      box,
    );
  }
  await expectNear(
    app,
    "header text",
    (await renderedBox(app, shapes[1]!.id)).slice(0, 2),
    [64, 44],
  );
  await expectNear(
    app,
    "hero text",
    (await renderedBox(app, shapes[3]!.id)).slice(0, 2),
    [160, 300],
  );
  expectOnlyChanged(
    seeded,
    after,
    shapes.map((node) => node.id),
  );
});
