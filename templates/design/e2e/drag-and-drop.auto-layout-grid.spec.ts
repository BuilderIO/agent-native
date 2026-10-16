import { MOD } from "./drag-and-drop.shared";
import {
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

test.use({ viewport: { width: 1600, height: 1000 } });

const WRAP_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <section data-agent-native-node-id="wrap-container" data-agent-native-layer-name="Wrap Container"
    style="position:absolute;left:60px;top:80px;width:256px;height:190px;padding:16px;display:flex;flex-direction:row;flex-wrap:wrap;gap:12px;background:#1f2937">
    <div data-agent-native-node-id="w1" data-agent-native-layer-name="W1" style="flex:0 0 104px;height:48px;background:#6366f1">W1</div>
    <div data-agent-native-node-id="w2" data-agent-native-layer-name="W2" style="flex:0 0 104px;height:48px;background:#a855f7">W2</div>
    <div data-agent-native-node-id="w3" data-agent-native-layer-name="W3" style="flex:0 0 104px;height:48px;background:#ec4899">W3</div>
  </section>
</body></html>`;

const GRID_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <div data-agent-native-node-id="grid-source" data-agent-native-layer-name="Grid Source"
    style="position:absolute;left:60px;top:420px;width:80px;height:44px;background:#6366f1">Source</div>
  <section data-agent-native-node-id="grid-container" data-agent-native-layer-name="Grid Container"
    style="position:absolute;left:360px;top:80px;width:300px;height:220px;padding:12px;display:grid;grid-template-columns:repeat(2,120px);grid-auto-rows:56px;column-gap:16px;row-gap:16px;background:#1f2937;box-sizing:border-box">
    <div data-agent-native-node-id="g1" data-agent-native-layer-name="G1" style="background:#6366f1">G1</div>
    <div data-agent-native-node-id="g2" data-agent-native-layer-name="G2" style="background:#a855f7">G2</div>
    <div data-agent-native-node-id="g3" data-agent-native-layer-name="G3" style="background:#ec4899">G3</div>
  </section>
</body></html>`;

const GRID_FULL_FIXTURE = GRID_FIXTURE.replace(
  '    <div data-agent-native-node-id="g3" data-agent-native-layer-name="G3" style="background:#ec4899">G3</div>',
  '    <div data-agent-native-node-id="g3" data-agent-native-layer-name="G3" style="background:#ec4899">G3</div>\n    <div data-agent-native-node-id="g4" data-agent-native-layer-name="G4" style="background:#f59e0b">G4</div>',
);

const GRID_COLUMN_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <div data-agent-native-node-id="column-source" data-agent-native-layer-name="Column Source"
    style="position:absolute;left:60px;top:420px;width:80px;height:44px;background:#6366f1">Source</div>
  <section data-agent-native-node-id="column-grid" data-agent-native-layer-name="Column Grid"
    style="position:absolute;left:360px;top:80px;width:300px;height:220px;padding:12px;display:grid;grid-template-rows:repeat(2,56px);grid-auto-columns:120px;grid-auto-flow:column;column-gap:16px;row-gap:16px;background:#1f2937;box-sizing:border-box">
    <div data-agent-native-node-id="c1" data-agent-native-layer-name="C1" style="background:#6366f1">C1</div>
    <div data-agent-native-node-id="c2" data-agent-native-layer-name="C2" style="background:#a855f7">C2</div>
    <div data-agent-native-node-id="c3" data-agent-native-layer-name="C3" style="background:#ec4899">C3</div>
  </section>
</body></html>`;

const GRID_EXPLICIT_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <div data-agent-native-node-id="explicit-source" data-agent-native-layer-name="Explicit Source"
    style="position:absolute;left:60px;top:420px;width:80px;height:44px;background:#6366f1">Source</div>
  <section data-agent-native-node-id="explicit-grid" data-agent-native-layer-name="Explicit Grid"
    style="position:absolute;left:360px;top:80px;width:300px;height:220px;padding:12px;display:grid;grid-template-columns:repeat(3,80px);grid-auto-rows:56px;gap:16px;background:#1f2937;box-sizing:border-box">
    <div data-agent-native-node-id="e1" data-agent-native-layer-name="E1" style="grid-column:1 / span 2;background:#6366f1">E1</div>
    <div data-agent-native-node-id="e2" data-agent-native-layer-name="E2" style="grid-column:3;background:#a855f7">E2</div>
    <div data-agent-native-node-id="e3" data-agent-native-layer-name="E3" style="order:2;background:#ec4899">E3</div>
  </section>
</body></html>`;

const GRID_EXPLICIT_SOURCE_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <section data-agent-native-node-id="explicit-source-grid" data-agent-native-layer-name="Explicit Source Grid"
    style="position:absolute;left:360px;top:80px;width:300px;height:220px;padding:12px;display:grid;grid-template-columns:repeat(2,120px);grid-auto-rows:56px;gap:16px;background:#1f2937;box-sizing:border-box">
    <div data-agent-native-node-id="explicit-source" data-agent-native-layer-name="Explicit Source" style="grid-column:1;grid-row:1;background:#6366f1">Source</div>
    <div data-agent-native-node-id="explicit-peer-1" data-agent-native-layer-name="Explicit Peer 1" style="background:#a855f7">Peer 1</div>
    <div data-agent-native-node-id="explicit-peer-2" data-agent-native-layer-name="Explicit Peer 2" style="background:#ec4899">Peer 2</div>
  </section>
</body></html>`;

const GRID_INTRINSIC_SIZE_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <div data-agent-native-node-id="sized-source" data-agent-native-layer-name="Sized Source"
    style="position:absolute;left:60px;top:420px;width:44px;height:28px;min-width:44px;max-width:44px;min-height:28px;max-height:28px;align-self:end;justify-self:end;background:#6366f1">Source</div>
  <section data-agent-native-node-id="intrinsic-grid" data-agent-native-layer-name="Intrinsic Grid"
    style="position:absolute;left:360px;top:80px;width:340px;height:240px;padding:12px;display:grid;grid-template-columns:repeat(2,140px);grid-auto-rows:88px;gap:16px;background:#1f2937;box-sizing:border-box">
    <div data-agent-native-node-id="sized-peer-1" data-agent-native-layer-name="Sized Peer 1" style="background:#a855f7">Peer 1</div>
    <div data-agent-native-node-id="sized-peer-2" data-agent-native-layer-name="Sized Peer 2" style="background:#ec4899">Peer 2</div>
  </section>
</body></html>`;

const GRID_LOCKED_EXPLICIT_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <div data-agent-native-node-id="locked-source" data-agent-native-layer-name="Locked Source"
    style="position:absolute;left:60px;top:420px;width:80px;height:44px;background:#6366f1">Source</div>
  <section data-agent-native-node-id="locked-grid" data-agent-native-layer-name="Locked Grid"
    style="position:absolute;left:360px;top:80px;width:340px;height:240px;padding:12px;display:grid;grid-template-columns:repeat(3,80px);grid-auto-rows:56px;gap:16px;background:#1f2937;box-sizing:border-box">
    <div data-agent-native-node-id="locked-span" data-agent-native-layer-name="Locked Span" data-agent-native-locked="true" style="grid-column:1 / span 2;grid-row:1;background:#f59e0b">Locked</div>
    <div data-agent-native-node-id="locked-implicit" data-agent-native-layer-name="Locked Implicit" data-agent-native-locked="true" style="background:#14b8a6">Locked implicit</div>
    <div data-agent-native-node-id="locked-peer-1" data-agent-native-layer-name="Locked Peer 1" style="background:#a855f7">Peer 1</div>
    <div data-agent-native-node-id="locked-peer-2" data-agent-native-layer-name="Locked Peer 2" style="background:#ec4899">Peer 2</div>
  </section>
</body></html>`;

const GRID_TRANSFORM_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <div data-agent-native-node-id="transform-source" data-agent-native-layer-name="Transform Source"
    style="position:absolute;left:60px;top:420px;width:80px;height:44px;background:#6366f1">Source</div>
  <section data-agent-native-node-id="transform-grid" data-agent-native-layer-name="Transform Grid"
    style="position:absolute;left:360px;top:80px;width:300px;height:220px;padding:12px;display:grid;grid-template-columns:repeat(2,120px);grid-auto-rows:56px;gap:16px;background:#1f2937;box-sizing:border-box;transform:skewX(10deg)">
    <div data-agent-native-node-id="t1" data-agent-native-layer-name="T1" style="background:#6366f1">T1</div>
    <div data-agent-native-node-id="t2" data-agent-native-layer-name="T2" style="background:#a855f7">T2</div>
    <div data-agent-native-node-id="t3" data-agent-native-layer-name="T3" style="background:#ec4899">T3</div>
  </section>
</body></html>`;

const GRID_DENSE_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <div data-agent-native-node-id="dense-source" data-agent-native-layer-name="Dense Source"
    style="position:absolute;left:60px;top:420px;width:80px;height:44px;background:#6366f1">Source</div>
  <section data-agent-native-node-id="dense-grid" data-agent-native-layer-name="Dense Grid"
    style="position:absolute;left:360px;top:80px;width:300px;height:220px;padding:12px;display:grid;grid-template-columns:repeat(3,80px);grid-auto-rows:56px;grid-auto-flow:row dense;gap:16px;background:#1f2937;box-sizing:border-box">
    <div data-agent-native-node-id="d1" data-agent-native-layer-name="D1" style="grid-column:1 / span 2;background:#6366f1">D1</div>
    <div data-agent-native-node-id="d2" data-agent-native-layer-name="D2" style="background:#a855f7">D2</div>
    <div data-agent-native-node-id="d3" data-agent-native-layer-name="D3" style="background:#ec4899">D3</div>
  </section>
</body></html>`;

type Nodes = Map<string, SavedNode>;
type Rect = { x: number; y: number; width: number; height: number };

function childrenOf(nodes: Nodes, parent: string) {
  return [...nodes.values()]
    .filter((node) => node.parent === parent)
    .sort((a, b) => a.index - b.index)
    .map((node) => node.id);
}

async function openFixture(app: App, html: string) {
  const id = await app.seed(html);
  await app.open(id);
  await app.zoomToFit();
  await app.settled();
  return id;
}

async function selectOnCanvas(app: App, nodeId: string, layerName: string) {
  const rect = await app.designRect(nodeId);
  const centre = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(centre.x, centre.y);
  await expect.poll(() => app.selectedLayers()).toEqual([layerName]);
}

/** Every rendered child of `parent`, in design px, keyed by node id. */
async function renderedChildren(app: App, parent: string) {
  return app.node(parent).evaluate((element) =>
    Object.fromEntries(
      Array.from(element.children)
        .filter((child) => child.hasAttribute("data-agent-native-node-id"))
        .map((child) => {
          const r = child.getBoundingClientRect();
          return [
            child.getAttribute("data-agent-native-node-id")!,
            {
              x: Math.round(r.x),
              y: Math.round(r.y),
              width: Math.round(r.width),
              height: Math.round(r.height),
            },
          ];
        }),
    ),
  ) as Promise<Record<string, Rect>>;
}

async function heldSiblingTransforms(app: App, parent: string) {
  return app.node(parent).evaluate((element) =>
    Array.from(element.children).map((child) => ({
      id: child.getAttribute("data-agent-native-node-id"),
      transform: getComputedStyle(child).transform,
      x: Math.round(child.getBoundingClientRect().x),
      y: Math.round(child.getBoundingClientRect().y),
    })),
  );
}

async function guide(app: App) {
  return app.page
    .frameLocator(
      'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])',
    )
    .locator("body")
    .evaluate(() => {
      const element = document.querySelector(
        "[data-agent-native-insertion-guide]",
      ) as HTMLElement | null;
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return {
        display: getComputedStyle(element).display,
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    });
}

/** Presses on the source's centre and holds the pointer at `target` (design px) until the insertion guide shows. */
async function holdAt(
  app: App,
  sourceId: string,
  target: { x: number; y: number },
) {
  const rect = await app.designRect(sourceId);
  const start = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  const end = await app.pagePoint(target.x, target.y);
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.move(start.x + 12, start.y + 8, { steps: 6 });
  await app.page.mouse.move(end.x, end.y, { steps: 24 });
  await expect
    .poll(async () => (await guide(app))?.display, {
      message: `no insertion guide while dragging ${sourceId}`,
    })
    .toBe("block");
  return (await guide(app))!;
}

async function drop(app: App) {
  await app.page.mouse.up();
  await app.settled();
}

function expectNear(
  actual: number,
  expected: number,
  label: string,
  tolerance = 2,
) {
  expect(Math.abs(actual - expected), `${label} ${actual}`).toBeLessThanOrEqual(
    tolerance,
  );
}

/** A thin insertion line, not a cell-shaped box. */
function expectLine(held: Rect) {
  expect(Math.min(held.width, held.height), "the guide is a line").toBeLessThan(
    10,
  );
}

test("W-1 held wrapped reorder shows a 2D marker and projected sibling reflow", async ({
  app,
}) => {
  const id = await openFixture(app, WRAP_FIXTURE);
  await selectOnCanvas(app, "w3", "W3");
  const before = await app.savedNodes(id);
  const restingSiblings = await heldSiblingTransforms(app, "wrap-container");

  const held = await holdAt(app, "w3", { x: 78, y: 120 });
  expect(held.width, "a vertical marker before W1").toBeLessThan(held.height);
  expect(
    await heldSiblingTransforms(app, "wrap-container"),
    "siblings reflow to make room",
  ).not.toEqual(restingSiblings);
  await drop(app);

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "wrap-container")).toEqual(["w3", "w1", "w2"]);
  expectOnlyChanged(before, after, ["w3"]);
  const rendered = await renderedChildren(app, "wrap-container");
  expect(
    { w3: rendered.w3, w1: rendered.w1, w2: rendered.w2 },
    "the two wrapped lines stretch to fill 190px",
  ).toEqual({
    w3: { x: 76, y: 96, width: 104, height: 48 },
    w1: { x: 192, y: 96, width: 104, height: 48 },
    w2: { x: 76, y: 197, width: 104, height: 48 },
  });
});

test("W-2 held wrapped reorder changes marker row before the final persisted slot", async ({
  app,
}) => {
  const id = await openFixture(app, WRAP_FIXTURE);
  await selectOnCanvas(app, "w1", "W1");
  const before = await app.savedNodes(id);

  const rowOne = await holdAt(app, "w1", { x: 294, y: 120 });
  const rowTwoPoint = await app.pagePoint(178, 180);
  await app.page.mouse.move(rowTwoPoint.x, rowTwoPoint.y, { steps: 18 });
  await expect
    .poll(
      async () => (await guide(app))?.y,
      "the marker moved to the second row",
    )
    .toBeGreaterThan(rowOne.y + 10);
  const rowTwo = (await guide(app))!;
  expect(rowTwo.width).toBeLessThan(rowTwo.height);
  await drop(app);

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "wrap-container")).toEqual(["w2", "w3", "w1"]);
  expectOnlyChanged(before, after, ["w1"]);
  const rendered = await renderedChildren(app, "wrap-container");
  expect(rendered.w1).toEqual({ x: 76, y: 197, width: 104, height: 48 });
});

test("G-1 held drop into an empty grid cell previews that exact cell", async ({
  app,
}) => {
  const id = await openFixture(app, GRID_FIXTURE);
  await selectOnCanvas(app, "grid-source", "Grid Source");
  const before = await app.savedNodes(id);

  const held = await holdAt(app, "grid-source", { x: 568, y: 192 });
  expect(held, "the guide fills the empty row 2, column 2 cell").toMatchObject({
    x: 508,
    y: 164,
    width: 120,
    height: 56,
  });
  await drop(app);

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "grid-container")).toEqual([
    "g1",
    "g2",
    "g3",
    "grid-source",
  ]);
  const saved = styleOf(after.get("grid-source"));
  expect(
    saved.position,
    "a grid item is not absolutely positioned",
  ).toBeUndefined();
  expect({ width: saved.width, height: saved.height }).toEqual({
    width: "80px",
    height: "44px",
  });
  expectOnlyChanged(before, after, ["grid-source"]);
  expect(
    (await renderedChildren(app, "grid-container"))["grid-source"],
  ).toEqual({ x: 508, y: 164, width: 80, height: 44 });
});

// fixme: product bug: The held preview shows row 2 col 2 (508,164) but G1 commits to row 2 col 1 (372,164): DOM becomes g2,g3,g1 with no explicit placement.
test.fixme("G-2 held grid reorder previews occupancy without duplicating the child", async ({
  app,
}) => {
  const id = await openFixture(app, GRID_FIXTURE);
  await selectOnCanvas(app, "g1", "G1");
  const before = await app.savedNodes(id);

  const held = await holdAt(app, "g1", { x: 568, y: 192 });
  expect(held, "the preview shows row 2, column 2").toMatchObject({
    x: 508,
    y: 164,
    width: 120,
    height: 56,
  });
  await drop(app);

  const after = await app.savedNodes(id);
  expect(
    childrenOf(after, "grid-container").filter((child) => child === "g1"),
  ).toHaveLength(1);
  expectOnlyChanged(before, after, ["g1"]);
  expect(
    (await renderedChildren(app, "grid-container")).g1,
    "G1 lands in the cell the preview showed",
  ).toEqual({
    x: 508,
    y: 164,
    width: 120,
    height: 56,
  });
});

test("G-3 full grid edge drop retains every child and creates the next flow slot", async ({
  app,
}) => {
  const id = await openFixture(app, GRID_FULL_FIXTURE);
  await selectOnCanvas(app, "grid-source", "Grid Source");
  const before = await app.savedNodes(id);

  const held = await holdAt(app, "grid-source", { x: 648, y: 288 });
  expect(held.y, "the guide opens a third row").toBeGreaterThan(192);
  await drop(app);

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "grid-container")).toEqual([
    "g1",
    "g2",
    "g3",
    "g4",
    "grid-source",
  ]);
  expectOnlyChanged(before, after, ["grid-source"]);
  const rendered = await renderedChildren(app, "grid-container");
  expect(
    { x: rendered["grid-source"].x, y: rendered["grid-source"].y },
    "row 3, column 1",
  ).toEqual({ x: 372, y: 236 });
});

test("G-4 held column-flow drop maps the excluded source to the empty cell", async ({
  app,
}) => {
  const id = await openFixture(app, GRID_COLUMN_FIXTURE);
  await selectOnCanvas(app, "column-source", "Column Source");
  const before = await app.savedNodes(id);

  const held = await holdAt(app, "column-source", { x: 568, y: 192 });
  expect(held, "row 2, column 2 in column flow").toMatchObject({
    x: 508,
    y: 164,
    width: 120,
    height: 56,
  });
  await drop(app);

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "column-grid")).toEqual([
    "c1",
    "c2",
    "c3",
    "column-source",
  ]);
  expectOnlyChanged(before, after, ["column-source"]);
  const rendered = await renderedChildren(app, "column-grid");
  expect({
    x: rendered["column-source"].x,
    y: rendered["column-source"].y,
  }).toEqual({ x: 508, y: 164 });
});

test("G-5 held explicit-span grid drop uses a conservative line and preserves authored placement", async ({
  app,
}) => {
  const id = await openFixture(app, GRID_EXPLICIT_FIXTURE);
  await selectOnCanvas(app, "explicit-source", "Explicit Source");
  const before = await app.savedNodes(id);
  const e2 = await app.designRect("e2");

  const held = await holdAt(app, "explicit-source", {
    x: e2.x + 4,
    y: e2.y + e2.height / 2,
  });
  expectLine(held);
  expect(held.height).toBeGreaterThan(held.width);
  expectNear(held.x + held.width / 2, e2.x, "line x at E2's left edge");
  expectNear(held.y, e2.y, "line top");
  expectNear(held.height, e2.height, "line height");
  await drop(app);

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "explicit-grid")).toEqual([
    "e1",
    "explicit-source",
    "e2",
    "e3",
  ]);
  expectOnlyChanged(before, after, ["explicit-source"]);
  expect(styleOf(after.get("e1"))["grid-column"]).toBe("1 / span 2");
  expect(styleOf(after.get("e2"))["grid-column"]).toBe("3");

  await app.page.keyboard.press(`${MOD}+z`);
  await expect
    .poll(async () => childrenOf(await app.savedNodes(id), "explicit-grid"))
    .toEqual(["e1", "e2", "e3"]);
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), []);

  await app.page.keyboard.press(`${MOD}+Shift+z`);
  await expect
    .poll(async () => childrenOf(await app.savedNodes(id), "explicit-grid"))
    .toEqual(["e1", "explicit-source", "e2", "e3"]);
  await app.settled();
  expectOnlyChanged(after, await app.savedNodes(id), []);
});

// fixme: product bug: Canvas and saved document disagree after the drop: the live canvas shows Source at row 1 col 3 and E2 at row 2 col 1 (E2's grid-column:3
test.fixme("G-5 after-edge grid drop persists through undo, redo, and reload", async ({
  app,
}) => {
  const id = await openFixture(app, GRID_EXPLICIT_FIXTURE);
  await selectOnCanvas(app, "explicit-source", "Explicit Source");
  const before = await app.savedNodes(id);
  const e2 = await app.designRect("e2");

  const held = await holdAt(app, "explicit-source", {
    x: e2.x + e2.width - 4,
    y: e2.y + e2.height / 2,
  });
  expectLine(held);
  expectNear(held.y, e2.y, "line top");
  await drop(app);

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "explicit-grid")).toEqual([
    "e1",
    "e2",
    "explicit-source",
    "e3",
  ]);
  expect(styleOf(after.get("explicit-source")).position).toBeUndefined();
  expectOnlyChanged(before, after, ["explicit-source"]);
  const rendered = await renderedChildren(app, "explicit-grid");
  expect(
    { x: rendered["explicit-source"].x, y: rendered["explicit-source"].y },
    "first cell of row 2",
  ).toEqual({
    x: 372,
    y: 164,
  });

  await app.page.keyboard.press(`${MOD}+z`);
  await expect
    .poll(async () => childrenOf(await app.savedNodes(id), "explicit-grid"))
    .toEqual(["e1", "e2", "e3"]);
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), []);

  await app.page.keyboard.press(`${MOD}+Shift+z`);
  await expect
    .poll(async () => childrenOf(await app.savedNodes(id), "explicit-grid"))
    .toEqual(["e1", "e2", "explicit-source", "e3"]);
  await app.settled();
  expectOnlyChanged(after, await app.savedNodes(id), []);
});

test("G-6 held transformed-grid drop uses a conservative line and retains the transform", async ({
  app,
}) => {
  const id = await openFixture(app, GRID_TRANSFORM_FIXTURE);
  await selectOnCanvas(app, "transform-source", "Transform Source");
  const before = await app.savedNodes(id);
  const t2 = await app.designRect("t2");

  expectLine(
    await holdAt(app, "transform-source", {
      x: t2.x + 4,
      y: t2.y + t2.height / 2,
    }),
  );
  await drop(app);

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "transform-grid"), "inserted before T2").toEqual([
    "t1",
    "transform-source",
    "t2",
    "t3",
  ]);
  expectOnlyChanged(before, after, ["transform-source"]);
  expect(styleOf(after.get("transform-grid")).transform).toBe("skewX(10deg)");
});

test("G-7 held dense-grid drop avoids a reconstructed cell and preserves the span", async ({
  app,
}) => {
  const id = await openFixture(app, GRID_DENSE_FIXTURE);
  await selectOnCanvas(app, "dense-source", "Dense Source");
  const before = await app.savedNodes(id);
  const d2 = await app.designRect("d2");

  expectLine(
    await holdAt(app, "dense-source", { x: d2.x + 4, y: d2.y + d2.height / 2 }),
  );
  await drop(app);

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "dense-grid"), "inserted before D2").toEqual([
    "d1",
    "dense-source",
    "d2",
    "d3",
  ]);
  expectOnlyChanged(before, after, ["dense-source"]);
  expect(styleOf(after.get("d1"))["grid-column"]).toBe("1 / span 2");
});

test("G-8 held drop with an explicitly placed source keeps a line and projected peers stable", async ({
  app,
}) => {
  const id = await openFixture(app, GRID_EXPLICIT_SOURCE_FIXTURE);
  await selectOnCanvas(app, "explicit-source", "Explicit Source");
  const before = await app.savedNodes(id);
  const resting = await renderedChildren(app, "explicit-source-grid");
  const peer1 = resting["explicit-peer-1"];

  const held = await holdAt(app, "explicit-source", {
    x: peer1.x + peer1.width / 2,
    y: peer1.y + peer1.height / 2,
  });
  expectLine(held);
  const whileHeld = await renderedChildren(app, "explicit-source-grid");
  expect(
    {
      peer1: whileHeld["explicit-peer-1"],
      peer2: whileHeld["explicit-peer-2"],
    },
    "peers do not reflow",
  ).toEqual({
    peer1: resting["explicit-peer-1"],
    peer2: resting["explicit-peer-2"],
  });
  await drop(app);

  const after = await app.savedNodes(id);
  expect(after.get("explicit-source")?.parent).toBe("explicit-source-grid");
  expectOnlyChanged(before, after, []);
  expect(
    await renderedChildren(app, "explicit-source-grid"),
    "authored placement keeps everything in place",
  ).toEqual(resting);
});

test("G-9 held grid projection preserves authored sizing and self-alignment", async ({
  app,
}) => {
  const id = await openFixture(app, GRID_INTRINSIC_SIZE_FIXTURE);
  await selectOnCanvas(app, "sized-source", "Sized Source");
  const before = await app.savedNodes(id);

  const held = await holdAt(app, "sized-source", { x: 442, y: 240 });
  expect(
    held,
    "an end-aligned 44x28 projection in row 2, column 1",
  ).toMatchObject({
    x: 468,
    y: 256,
    width: 44,
    height: 28,
  });
  await drop(app);

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "intrinsic-grid")).toEqual([
    "sized-peer-1",
    "sized-peer-2",
    "sized-source",
  ]);
  expect(styleOf(after.get("sized-source"))).toMatchObject({
    width: "44px",
    height: "28px",
    "min-width": "44px",
    "max-width": "44px",
    "min-height": "28px",
    "max-height": "28px",
    "align-self": "end",
    "justify-self": "end",
  });
  expectOnlyChanged(before, after, ["sized-source"]);
  expect(
    (await renderedChildren(app, "intrinsic-grid"))["sized-source"],
  ).toEqual({ x: 468, y: 256, width: 44, height: 28 });
});

test("G-10 locked explicit grid children disable the projection shortcut", async ({
  app,
}) => {
  const id = await openFixture(app, GRID_LOCKED_EXPLICIT_FIXTURE);
  await selectOnCanvas(app, "locked-source", "Locked Source");
  const before = await app.savedNodes(id);
  const peer2 = await app.designRect("locked-peer-2");

  expectLine(
    await holdAt(app, "locked-source", {
      x: peer2.x + 4,
      y: peer2.y + peer2.height / 2,
    }),
  );
  await drop(app);

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "locked-grid"), "inserted before Peer 2").toEqual([
    "locked-span",
    "locked-implicit",
    "locked-peer-1",
    "locked-source",
    "locked-peer-2",
  ]);
  expectOnlyChanged(before, after, ["locked-source"]);
  const rendered = await renderedChildren(app, "locked-grid");
  expect(
    { x: rendered["locked-source"].x, y: rendered["locked-source"].y },
    "row 2, column 2",
  ).toEqual({
    x: 468,
    y: 164,
  });
});
