import { type Locator } from "@playwright/test";

import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

test.use({ viewport: { width: 1600, height: 1000 } });

const PRIMARY = process.platform === "darwin" ? "Meta" : "Control";
const IGNORE_AUTO_LAYOUT = process.platform === "darwin" ? "Control" : "s";
const LIVE_SCREEN =
  'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])';

const CONTROL_FIXTURE = `<!doctype html>
<html><body style="margin:0;position:relative;width:900px;height:900px;background:#0f1115;color:#fff">
  <section data-agent-native-node-id="control-row" data-agent-native-layer-name="Control Row"
    style="position:absolute;left:80px;top:80px;width:360px;height:112px;padding:16px;box-sizing:border-box;display:flex;gap:16px;background:#1f2937">
    <div data-agent-native-node-id="control-child" data-agent-native-layer-name="Control Child"
      style="width:100px;height:48px;background:#6366f1">Control Child</div>
    <div data-agent-native-node-id="control-peer" data-agent-native-layer-name="Control Peer"
      style="width:100px;height:48px;background:#a855f7">Control Peer</div>
  </section>
  <section data-agent-native-node-id="control-target-row" data-agent-native-layer-name="Control Target Row"
    style="position:absolute;left:520px;top:80px;width:280px;height:112px;padding:16px;box-sizing:border-box;display:flex;gap:16px;background:#374151">
    <div data-agent-native-node-id="control-target-peer" data-agent-native-layer-name="Control Target Peer"
      style="width:100px;height:48px;background:#ec4899">Control Target Peer</div>
  </section>
</body></html>`;

const GRID_FLOW_ALT_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115;color:#fff">
  <section data-agent-native-node-id="grid-flow" data-agent-native-layer-name="Grid Flow"
    style="position:absolute;left:360px;top:80px;width:300px;height:220px;padding:12px;display:grid;grid-template-columns:repeat(2,120px);grid-auto-rows:56px;gap:16px;background:#1f2937;box-sizing:border-box">
    <div data-agent-native-node-id="grid-flow-source" data-agent-native-layer-name="Grid Flow Source"
      style="grid-column:1;grid-row:1;width:120px;height:56px;background:#6366f1">Source</div>
    <div data-agent-native-node-id="grid-flow-peer" data-agent-native-layer-name="Grid Flow Peer"
      style="width:120px;height:56px;background:#a855f7">Peer</div>
  </section>
</body></html>`;

const COPY_FIXTURE = `<!doctype html>
<html><body data-agent-native-node-id="page" style="margin:0;position:relative;width:900px;height:900px;background:#0f1115;color:#fff">
  <div data-agent-native-node-id="copy-source" data-agent-native-layer-name="Copy Source"
    style="position:absolute;left:80px;top:80px;width:120px;height:64px;background:#6366f1">Copy Source</div>
  <div data-agent-native-node-id="copy-peer" data-agent-native-layer-name="Copy Peer"
    style="position:absolute;left:300px;top:80px;width:120px;height:64px;background:#a855f7">Copy Peer</div>
</body></html>`;

const META_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <section data-agent-native-node-id="meta-row" data-agent-native-layer-name="Meta Row"
    style="position:absolute;left:60px;top:80px;width:300px;height:100px;padding:16px;display:flex;flex-direction:row;gap:12px;background:#1f2937">
    <div data-agent-native-node-id="meta-child" data-agent-native-layer-name="Meta Child" style="width:100px;height:48px;background:#6366f1">Child</div>
    <div data-agent-native-node-id="meta-peer" data-agent-native-layer-name="Meta Peer" style="width:100px;height:48px;background:#a855f7">Peer</div>
  </section>
</body></html>`;

// flex-shrink:0 is how Design writes a fixed-width layer in a row, so the oversized source keeps its 260px.
const COMMAND_FIXTURE = `<!doctype html>
<html><body style="margin:0;position:relative;width:900px;height:900px;background:#0f1115;color:#fff">
  <section data-agent-native-node-id="command-source-row" data-agent-native-layer-name="Command Source Row"
    style="position:absolute;left:60px;top:360px;width:320px;height:120px;padding:16px;box-sizing:border-box;display:flex;gap:12px;background:#1f2937">
    <div data-agent-native-node-id="command-source" data-agent-native-layer-name="Command Source"
      style="width:260px;height:80px;flex-shrink:0;background:#6366f1">Command Source</div>
  </section>
  <section data-agent-native-node-id="command-target-row" data-agent-native-layer-name="Command Target Row"
    style="position:absolute;left:460px;top:80px;width:190px;height:140px;padding:16px;box-sizing:border-box;display:flex;gap:12px;background:#374151">
    <div data-agent-native-node-id="command-peer" data-agent-native-layer-name="Command Peer"
      style="width:80px;height:64px;flex-shrink:0;background:#a855f7">Command Peer</div>
  </section>
</body></html>`;

async function openSeeded(app: App, html: string) {
  const id = await app.seed(html);
  await app.open(id);
  await app.zoomToFit();
  return id;
}

/** Plain-clicks the node's centre on the canvas and returns that page point. */
async function selectOnCanvas(app: App, nodeId: string, layerName: string) {
  const rect = await app.designRect(nodeId);
  const centre = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(centre.x, centre.y);
  await expect.poll(() => app.selectedLayers()).toEqual([layerName]);
  return centre;
}

/** Presses at `from` and moves just past the drag threshold, so a key pressed next arrives mid-drag. */
async function pressAndStartDrag(app: App, from: { x: number; y: number }) {
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(from.x + 5, from.y + 4, { steps: 2 });
}

async function moveToDesign(app: App, designX: number, designY: number) {
  const to = await app.pagePoint(designX, designY);
  await app.page.mouse.move(to.x, to.y, { steps: 18 });
}

function screen(app: App) {
  return app.page.locator(LIVE_SCREEN).contentFrame();
}

function heldCopy(app: App) {
  return screen(app).locator('[data-agent-native-clone-root="true"]');
}

function selectionOutline(app: App) {
  return screen(app).locator('[data-agent-native-edit-overlay="selection"]');
}

async function boxOf(locator: Locator) {
  return locator.evaluate((element) => {
    const r = element.getBoundingClientRect();
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  });
}

async function visibleInsertionGuides(app: App) {
  return screen(app)
    .locator("[data-agent-native-insertion-guide]")
    .evaluateAll(
      (guides) =>
        guides.filter((guide) => {
          const r = guide.getBoundingClientRect();
          return (
            getComputedStyle(guide).display !== "none" &&
            r.width > 0 &&
            r.height > 0
          );
        }).length,
    );
}

function addedNodes(
  before: Map<string, SavedNode>,
  after: Map<string, SavedNode>,
) {
  return [...after.keys()].filter((id) => !before.has(id));
}

function attrsBesidesStyle(node: SavedNode | undefined) {
  const { style: _style, ...attrs } = node?.attrs ?? {};
  return attrs;
}

test("the platform modifier after pointerdown removes a flow child from flow and it returns cleanly", async ({
  app,
}) => {
  const id = await openSeeded(app, CONTROL_FIXTURE);
  const seededHtml = await app.savedHtml(id);
  const seeded = await app.savedNodes(id);
  const grab = await selectOnCanvas(app, "control-child", "Control Child");
  expect(await app.designRect("control-target-peer")).toEqual({
    x: 536,
    y: 96,
    width: 100,
    height: 48,
  });

  await pressAndStartDrag(app, grab);
  await app.page.keyboard.down(IGNORE_AUTO_LAYOUT);
  await moveToDesign(app, 586, 120);
  await expect
    .poll(() => app.designRect("control-child"), {
      message: "precondition: Control Child follows the pointer",
    })
    .not.toEqual({ x: 96, y: 96, width: 100, height: 48 });
  expect(
    await app.designRect("control-target-peer"),
    "the target row does not make room while the modifier is held",
  ).toEqual({ x: 536, y: 96, width: 100, height: 48 });
  await app.page.mouse.up();
  await app.page.keyboard.up(IGNORE_AUTO_LAYOUT);
  await app.settled();

  const ignored = await app.savedNodes(id);
  expect(ignored.get("control-child")?.parent).toBe("control-target-row");
  expect(styleOf(ignored.get("control-child"))).toEqual({
    width: "100px",
    height: "48px",
    background: "rgb(99, 102, 241)",
    position: "absolute",
    left: "16px",
    top: "16px",
  });
  expectOnlyChanged(seeded, ignored, ["control-child"]);
  expect(await app.designRect("control-child")).toEqual({
    x: 536,
    y: 96,
    width: 100,
    height: 48,
  });
  expect(await app.designRect("control-target-peer")).toEqual({
    x: 536,
    y: 96,
    width: 100,
    height: 48,
  });

  await app.page.keyboard.press("ControlOrMeta+z");
  await app.settled();
  expect(await app.savedHtml(id), "undo restores the seeded document").toBe(
    seededHtml,
  );
  await expect
    .poll(() => app.designRect("control-child"))
    .toEqual({ x: 96, y: 96, width: 100, height: 48 });

  await app.page.keyboard.press("ControlOrMeta+Shift+z");
  await app.settled();
  expectOnlyChanged(ignored, await app.savedNodes(id), []);

  await app.open(id);
  await app.zoomToFit();
  expect(await app.designRect("control-child")).toEqual({
    x: 536,
    y: 96,
    width: 100,
    height: 48,
  });

  const absoluteGrab = await selectOnCanvas(
    app,
    "control-child",
    "Control Child",
  );
  await pressAndStartDrag(app, absoluteGrab);
  await moveToDesign(app, 561, 120);
  await expect
    .poll(() => visibleInsertionGuides(app), {
      message:
        "precondition: an insertion guide shows before Control Target Peer",
    })
    .toBeGreaterThan(0);
  await app.page.mouse.up();
  await app.settled();

  const returned = await app.savedNodes(id);
  expect(childrenOf(returned, "control-target-row")).toEqual([
    "control-child",
    "control-target-peer",
  ]);
  expect(styleOf(returned.get("control-child"))).toEqual({
    width: "100px",
    height: "48px",
    background: "rgb(99, 102, 241)",
  });
  expectOnlyChanged(ignored, returned, ["control-child"]);
  await expect.poll(() => app.selectedLayers()).toEqual(["Control Child"]);

  await app.open(id);
  await app.zoomToFit();
  expect(await app.designRect("control-child")).toEqual({
    x: 536,
    y: 96,
    width: 100,
    height: 48,
  });
  expect(await app.designRect("control-target-peer")).toEqual({
    x: 652,
    y: 96,
    width: 100,
    height: 48,
  });
});

test("late Alt on a free drag drops a selected copy where it is released and leaves the source in place", async ({
  app,
}) => {
  const id = await openSeeded(app, COPY_FIXTURE);
  const before = await app.savedNodes(id);
  const grab = await selectOnCanvas(app, "copy-source", "Copy Source");

  await pressAndStartDrag(app, grab);
  await app.page.keyboard.down("Alt");
  await moveToDesign(app, 560, 300);
  await expect(heldCopy(app), "precondition: a copy is held").toHaveCount(1);
  expect(
    await app.designRect("copy-source"),
    "the source stays put while the copy is held",
  ).toEqual({ x: 80, y: 80, width: 120, height: 64 });
  await app.page.mouse.up();
  await app.page.keyboard.up("Alt");
  await app.settled();

  const after = await app.savedNodes(id);
  const added = addedNodes(before, after);
  expect(added).toHaveLength(2);
  const [copyId, copyTextId] = added;
  const copy = after.get(copyId);
  expect(copy).toMatchObject({ tag: "div", parent: "page" });
  expect(attrsBesidesStyle(copy)).toEqual({
    "data-agent-native-node-id": copyId,
    "data-agent-native-layer-name": "Copy Source",
    "data-agent-native-clone-root": "true",
  });
  expect(after.get(copyTextId)).toMatchObject({
    tag: "span",
    parent: copyId,
    text: "Copy Source",
  });
  // Grabbed at the source's centre (60,32) and released at 560,300.
  expect.soft(styleOf(copy), "the copy lands under the pointer").toEqual({
    position: "absolute",
    left: "500px",
    top: "268px",
    width: "120px",
    height: "64px",
    background: "rgb(99, 102, 241)",
  });
  expectOnlyChanged(before, after, added);
  expect
    .soft(await app.designRect(copyId))
    .toEqual({ x: 500, y: 268, width: 120, height: 64 });
  expect(await app.designRect("copy-source")).toEqual({
    x: 80,
    y: 80,
    width: 120,
    height: 64,
  });
  await expect.poll(() => app.selectedLayers()).toEqual(["Copy Source"]);
  await expect(
    app.page.getByLabel("X-position", { exact: true }),
    "the copy, not the source, is selected",
  ).toHaveValue("500px");
  await expect(app.page.getByLabel("Y-position", { exact: true })).toHaveValue(
    "268px",
  );
});

test("Escape during a late-Alt free drag discards the copy and leaves the source's position fields untouched", async ({
  app,
}) => {
  const id = await openSeeded(app, COPY_FIXTURE);
  const grab = await selectOnCanvas(app, "copy-source", "Copy Source");
  const x = app.page.getByLabel("X-position", { exact: true });
  const y = app.page.getByLabel("Y-position", { exact: true });
  await expect(x).toHaveValue("80px");
  await expect(y).toHaveValue("80px");
  const before = await app.savedHtml(id);

  await pressAndStartDrag(app, grab);
  await app.page.keyboard.down("Alt");
  await moveToDesign(app, 640, 340);
  await expect(heldCopy(app), "precondition: a copy is held").toHaveCount(1);
  await app.page.keyboard.press("Escape");
  await app.page.mouse.up();
  await app.page.keyboard.up("Alt");
  await app.settled();

  expect(await app.savedHtml(id)).toBe(before);
  await expect(heldCopy(app)).toHaveCount(0);
  expect(await app.designRect("copy-source")).toEqual({
    x: 80,
    y: 80,
    width: 120,
    height: 64,
  });
  await expect.poll(() => app.selectedLayers()).toEqual(["Copy Source"]);
  await expect(x).toHaveValue("80px");
  await expect(y).toHaveValue("80px");
});

test("late Alt free drag waits for post-key movement before duplicating", async ({
  app,
}) => {
  const id = await openSeeded(app, COPY_FIXTURE);
  const before = await app.savedNodes(id);
  const grab = await selectOnCanvas(app, "copy-source", "Copy Source");

  await pressAndStartDrag(app, grab);
  await moveToDesign(app, 560, 300);
  await expect
    .poll(() => app.designRect("copy-source"), {
      message: "precondition: Copy Source follows the pointer",
    })
    .not.toEqual({ x: 80, y: 80, width: 120, height: 64 });
  await app.page.keyboard.down("Alt");
  await expect(heldCopy(app)).toHaveCount(0);
  await app.page.mouse.up();
  await app.page.keyboard.up("Alt");
  await app.settled();

  const after = await app.savedNodes(id);
  expect(addedNodes(before, after)).toEqual([]);
  expectOnlyChanged(before, after, ["copy-source"]);
  // Grabbed at the centre (60,32) and released at 560,300.
  expect(styleOf(after.get("copy-source"))).toEqual({
    position: "absolute",
    left: "500px",
    top: "268px",
    width: "120px",
    height: "64px",
    background: "#6366f1",
  });
  expect(await app.designRect("copy-source")).toEqual({
    x: 500,
    y: 268,
    width: 120,
    height: 64,
  });
});

// fixme: product bug: While the copy is held, the source row reflows: Control Child and Control Peer shrink to 99px and Control Peer jumps from x 212 to 325.
test.fixme("late Alt flow reorder inserts a copy at the hovered slot and leaves the source in its row", async ({
  app,
}) => {
  const id = await openSeeded(app, CONTROL_FIXTURE);
  const before = await app.savedNodes(id);
  const grab = await selectOnCanvas(app, "control-child", "Control Child");

  await pressAndStartDrag(app, grab);
  await app.page.keyboard.down("Alt");
  await moveToDesign(app, 611, 120);
  await expect(heldCopy(app), "precondition: a copy is held").toHaveCount(1);
  await expect
    .poll(() => visibleInsertionGuides(app), {
      message:
        "precondition: an insertion guide shows after Control Target Peer",
    })
    .toBeGreaterThan(0);
  expect
    .soft(
      [
        await app.designRect("control-child"),
        await app.designRect("control-peer"),
      ],
      "the source row does not reflow while the copy is held",
    )
    .toEqual([
      { x: 96, y: 96, width: 100, height: 48 },
      { x: 212, y: 96, width: 100, height: 48 },
    ]);
  await app.page.mouse.up();
  await app.page.keyboard.up("Alt");
  await app.settled();

  const after = await app.savedNodes(id);
  const added = addedNodes(before, after);
  expect(added).toHaveLength(2);
  const [copyId, copyTextId] = added;
  expect(childrenOf(after, "control-row")).toEqual([
    "control-child",
    "control-peer",
  ]);
  expect(childrenOf(after, "control-target-row")).toEqual([
    "control-target-peer",
    copyId,
  ]);
  const copy = after.get(copyId);
  expect(attrsBesidesStyle(copy)).toEqual({
    "data-agent-native-node-id": copyId,
    "data-agent-native-layer-name": "Control Child",
    "data-agent-native-clone-root": "true",
  });
  expect(after.get(copyTextId)).toMatchObject({
    tag: "span",
    parent: copyId,
    text: "Control Child",
  });
  expect(styleOf(copy)).toEqual({
    width: "100px",
    height: "48px",
    background: "rgb(99, 102, 241)",
  });
  expectOnlyChanged(before, after, added);
  expect(await app.designRect(copyId)).toEqual({
    x: 652,
    y: 96,
    width: 100,
    height: 48,
  });
  expect(await app.designRect("control-child")).toEqual({
    x: 96,
    y: 96,
    width: 100,
    height: 48,
  });
  await expect
    .poll(() => boxOf(selectionOutline(app)), {
      message: "the copy, not the source, is selected",
    })
    .toEqual({ x: 652, y: 96, width: 100, height: 48 });
});

// fixme: intermittent: Passed in its worker run and in a solo re-run, failed once in the full confirmation run (2 of 3).
test.fixme("Escape during a late-Alt flow drag discards the copy and leaves the source's size and effects untouched", async ({
  app,
}) => {
  const id = await openSeeded(app, CONTROL_FIXTURE);
  const grab = await selectOnCanvas(app, "control-child", "Control Child");
  const width = app.page.locator('input[aria-label="W size in pixels"]');
  const dropShadow = app.page.getByText("Drop shadow", { exact: true });
  await expect(width).toHaveValue("100px");
  await expect(dropShadow).toHaveCount(0);
  const before = await app.savedHtml(id);

  await pressAndStartDrag(app, grab);
  await app.page.keyboard.down("Alt");
  await moveToDesign(app, 611, 120);
  await expect(heldCopy(app), "precondition: a copy is held").toHaveCount(1);
  await app.page.keyboard.press("Escape");
  await app.page.mouse.up();
  await app.page.keyboard.up("Alt");
  await app.settled();

  expect(await app.savedHtml(id)).toBe(before);
  await expect(heldCopy(app)).toHaveCount(0);
  expect(await app.designRect("control-child")).toEqual({
    x: 96,
    y: 96,
    width: 100,
    height: 48,
  });
  await expect.poll(() => app.selectedLayers()).toEqual(["Control Child"]);
  await expect(width).toHaveValue("100px");
  await expect(dropShadow).toHaveCount(0);
});

test("late Alt grid reorder clears authored placement on the duplicate", async ({
  app,
}) => {
  const id = await openSeeded(app, GRID_FLOW_ALT_FIXTURE);
  const before = await app.savedNodes(id);
  const grab = await selectOnCanvas(
    app,
    "grid-flow-source",
    "Grid Flow Source",
  );

  await pressAndStartDrag(app, grab);
  await app.page.keyboard.down("Alt");
  await moveToDesign(app, 598, 120);
  await expect(heldCopy(app), "precondition: a copy is held").toHaveCount(1);
  expect(
    await heldCopy(app).evaluate((element) => ({
      gridColumn: (element as HTMLElement).style.gridColumn,
      gridRow: (element as HTMLElement).style.gridRow,
    })),
  ).toEqual({ gridColumn: "auto", gridRow: "auto" });
  await app.page.mouse.up();
  await app.page.keyboard.up("Alt");
  await app.settled();

  const after = await app.savedNodes(id);
  const added = addedNodes(before, after);
  expect(added).toHaveLength(2);
  const [copyId, copyTextId] = added;
  expect(childrenOf(after, "grid-flow")).toEqual([
    "grid-flow-source",
    "grid-flow-peer",
    copyId,
  ]);
  expect(after.get(copyTextId)).toMatchObject({
    tag: "span",
    parent: copyId,
    text: "Source",
  });
  expect(attrsBesidesStyle(after.get(copyId))).toEqual({
    "data-agent-native-node-id": copyId,
    "data-agent-native-layer-name": "Grid Flow Source",
    "data-agent-native-clone-root": "true",
  });
  expect(styleOf(after.get(copyId))).toEqual({
    "grid-area": "auto",
    order: "0",
    width: "120px",
    height: "56px",
    background: "rgb(99, 102, 241)",
  });
  expectOnlyChanged(before, after, added);
  expect(await app.designRect("grid-flow-source")).toEqual({
    x: 372,
    y: 92,
    width: 120,
    height: 56,
  });
  expect(await app.designRect(copyId)).toEqual({
    x: 372,
    y: 164,
    width: 120,
    height: 56,
  });
});

test("Alt before movement threshold does not duplicate a flow child click", async ({
  app,
}) => {
  const id = await openSeeded(app, CONTROL_FIXTURE);
  const grab = await selectOnCanvas(app, "control-child", "Control Child");
  const before = await app.savedHtml(id);

  await app.page.mouse.move(grab.x, grab.y);
  await app.page.mouse.down();
  await app.page.keyboard.down("Alt");
  await expect(heldCopy(app)).toHaveCount(0);
  await app.page.keyboard.up("Alt");
  await app.page.mouse.up();
  await app.settled();

  expect(await app.savedHtml(id)).toBe(before);
  await expect(heldCopy(app)).toHaveCount(0);
  expect(await app.designRect("control-child")).toEqual({
    x: 96,
    y: 96,
    width: 100,
    height: 48,
  });
  await expect.poll(() => app.selectedLayers()).toEqual(["Control Child"]);
});

test("releasing Meta before the drop restores normal flow ownership", async ({
  app,
}) => {
  const id = await openSeeded(app, META_FIXTURE);
  const before = await app.savedNodes(id);
  const grab = await selectOnCanvas(app, "meta-child", "Meta Child");

  await app.page.keyboard.down(PRIMARY);
  await pressAndStartDrag(app, grab);
  await moveToDesign(app, 500, 320);
  await expect
    .poll(() => app.designRect("meta-child"), {
      message: "precondition: Meta Child floats free under the pointer",
    })
    .not.toEqual({ x: 76, y: 96, width: 100, height: 48 });
  await app.page.keyboard.up(PRIMARY);
  await moveToDesign(app, 263, 120);
  await expect
    .poll(() => visibleInsertionGuides(app), {
      message: "precondition: an insertion guide shows after Meta Peer",
    })
    .toBeGreaterThan(0);
  await app.page.mouse.up();
  await app.settled();

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "meta-row")).toEqual(["meta-peer", "meta-child"]);
  expect(styleOf(after.get("meta-child"))).toEqual({
    width: "100px",
    height: "48px",
    background: "#6366f1",
  });
  expectOnlyChanged(before, after, ["meta-child"]);
  expect(await app.designRect("meta-peer")).toEqual({
    x: 76,
    y: 96,
    width: 100,
    height: 48,
  });
  expect(await app.designRect("meta-child")).toEqual({
    x: 188,
    y: 96,
    width: 100,
    height: 48,
  });
});

test.describe("Command oversized flow insertion", () => {
  async function expectInsertedAfterPeer(
    app: App,
    id: string,
    before: Map<string, SavedNode>,
  ) {
    const after = await app.savedNodes(id);
    expect(childrenOf(after, "command-target-row")).toEqual([
      "command-peer",
      "command-source",
    ]);
    expect(childrenOf(after, "command-source-row")).toEqual([]);
    expect(styleOf(after.get("command-source"))).toEqual({
      width: "260px",
      height: "80px",
      "flex-shrink": "0",
      background: "#6366f1",
    });
    expectOnlyChanged(before, after, ["command-source"]);
    expect(await app.designRect("command-peer")).toEqual({
      x: 476,
      y: 96,
      width: 80,
      height: 64,
    });
    expect(await app.designRect("command-source")).toEqual({
      x: 568,
      y: 96,
      width: 260,
      height: 80,
    });
  }

  test("Meta/Command before-pointerdown enables normal-flow insertion", async ({
    app,
  }) => {
    const id = await openSeeded(app, COMMAND_FIXTURE);
    const before = await app.savedNodes(id);
    const grab = await selectOnCanvas(app, "command-source", "Command Source");

    await app.page.keyboard.down(PRIMARY);
    await pressAndStartDrag(app, grab);
    await moveToDesign(app, 536, 128);
    await expect
      .poll(() => visibleInsertionGuides(app), {
        message: "precondition: an insertion guide shows after Command Peer",
      })
      .toBeGreaterThan(0);
    await app.page.mouse.up();
    await app.page.keyboard.up(PRIMARY);
    await app.settled();

    await expectInsertedAfterPeer(app, id, before);
  });

  test("Meta/Command after-threshold enables normal-flow insertion", async ({
    app,
  }) => {
    const id = await openSeeded(app, COMMAND_FIXTURE);
    const before = await app.savedNodes(id);
    const grab = await selectOnCanvas(app, "command-source", "Command Source");

    await pressAndStartDrag(app, grab);
    await app.page.keyboard.down(PRIMARY);
    await moveToDesign(app, 536, 128);
    await expect
      .poll(() => visibleInsertionGuides(app), {
        message: "precondition: an insertion guide shows after Command Peer",
      })
      .toBeGreaterThan(0);
    await app.page.mouse.up();
    await app.page.keyboard.up(PRIMARY);
    await app.settled();

    await expectInsertedAfterPeer(app, id, before);
  });
});
