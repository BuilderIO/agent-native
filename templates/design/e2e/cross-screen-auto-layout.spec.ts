import { type Page } from "@playwright/test";

import { appPath, designFrame, selectTool } from "./helpers";
import {
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const PRIMARY = process.platform === "darwin" ? "Meta" : "Control";

const SOURCE_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Auto layout source</title></head>
  <body style="margin:0;position:relative;min-height:780px;width:1000px;height:780px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <section data-agent-native-node-id="source-flow" data-agent-native-layer-name="Source Flow" data-an-primitive="frame"
      style="position:absolute;left:80px;top:100px;width:360px;min-height:180px;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:16px;background:#1f2937">
      <div data-agent-native-node-id="screen-source" data-agent-native-layer-name="Screen Source"
        style="box-sizing:border-box;flex:0 0 56px;width:180px;height:56px;background:#38bdf8;color:#082f49">Source</div>
      <div data-agent-native-node-id="source-anchor" data-agent-native-layer-name="Source Anchor"
        style="box-sizing:border-box;flex:0 0 48px;width:180px;height:48px;background:#64748b;color:#f8fafc">Anchor</div>
    </section>
  </body>
</html>`;

const DESTINATION_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Auto layout destination</title></head>
  <body style="margin:0;position:relative;min-height:780px;width:1000px;height:780px;background:#111827;color:#fff;font-family:system-ui,sans-serif">
    <section data-agent-native-node-id="destination-flow" data-agent-native-layer-name="Destination Flow" data-an-primitive="frame"
      style="position:absolute;left:80px;top:100px;width:360px;min-height:260px;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:16px;background:#334155">
      <div data-agent-native-node-id="destination-anchor" data-agent-native-layer-name="Destination Anchor"
        style="box-sizing:border-box;flex:0 0 56px;width:180px;height:56px;background:#94a3b8;color:#0f172a">Anchor</div>
    </section>
  </body>
</html>`;

const REVERSE_DESTINATION_SCREEN = `<!doctype html>
<html lang="en">
  <body style="margin:0;position:relative;min-height:780px;width:1000px;height:780px;background:#111827;color:#fff">
    <section data-agent-native-node-id="destination-flow" data-agent-native-layer-name="Destination Flow" data-an-primitive="frame"
      style="position:absolute;left:80px;top:100px;width:360px;min-height:120px;box-sizing:border-box;display:flex;flex-direction:row-reverse;align-items:flex-start;gap:12px;padding:16px;background:#334155">
      <div data-agent-native-node-id="destination-anchor" data-agent-native-layer-name="Destination Anchor"
        style="box-sizing:border-box;flex:0 0 100px;width:100px;height:56px;background:#94a3b8;color:#0f172a">Anchor</div>
      <div data-agent-native-node-id="destination-tail" data-agent-native-layer-name="Destination Tail"
        style="box-sizing:border-box;flex:0 0 80px;width:80px;height:56px;background:#64748b;color:#f8fafc">Tail</div>
    </section>
  </body>
</html>`;

const WRAPPED_DESTINATION_SCREEN = `<!doctype html>
<html lang="en">
  <body style="margin:0;position:relative;min-height:780px;width:1000px;height:780px;background:#111827;color:#fff">
    <section data-agent-native-node-id="destination-flow" data-agent-native-layer-name="Wrapped Destination Flow" data-an-primitive="frame"
      style="position:absolute;left:80px;top:100px;width:360px;height:260px;box-sizing:border-box;display:flex;flex-direction:row;flex-wrap:wrap;align-content:flex-start;align-items:flex-start;gap:12px;padding:16px;background:#334155">
      <div data-agent-native-node-id="wrapped-first" data-agent-native-layer-name="Wrapped First"
        style="box-sizing:border-box;flex:0 0 140px;width:140px;height:56px;background:#94a3b8;color:#0f172a">First</div>
      <div data-agent-native-node-id="wrapped-second" data-agent-native-layer-name="Wrapped Second"
        style="box-sizing:border-box;flex:0 0 140px;width:140px;height:56px;background:#64748b;color:#f8fafc">Second</div>
      <div data-agent-native-node-id="wrapped-third" data-agent-native-layer-name="Wrapped Third"
        style="box-sizing:border-box;flex:0 0 140px;width:140px;height:56px;background:#64748b;color:#f8fafc">Third</div>
      <div data-agent-native-node-id="wrapped-fourth" data-agent-native-layer-name="Wrapped Fourth"
        style="box-sizing:border-box;flex:0 0 140px;width:140px;height:56px;background:#64748b;color:#f8fafc">Fourth</div>
    </section>
  </body>
</html>`;

const FREE_SOURCE_SCREEN = `<!doctype html>
<html lang="en">
  <body style="margin:0;position:relative;min-height:780px;width:1000px;height:780px;background:#0f1115;color:#fff">
    <div data-agent-native-node-id="free-source" data-agent-native-layer-name="Free Source"
      style="position:absolute;left:100px;top:420px;width:140px;height:60px;background:#38bdf8;color:#082f49">Free</div>
  </body>
</html>`;

const NESTED_DESTINATION_SCREEN = `<!doctype html>
<html lang="en">
  <body style="margin:0;position:relative;min-height:780px;width:1000px;height:780px;background:#111827;color:#fff">
    <section data-agent-native-node-id="destination-shell" data-agent-native-layer-name="Destination Shell"
      style="position:absolute;left:80px;top:100px;width:600px;min-height:240px;padding:20px;box-sizing:border-box;display:flex;flex-direction:row;align-items:flex-start;gap:12px;background:#334155">
      <section data-agent-native-node-id="nested-auto" data-agent-native-layer-name="Nested Auto"
        style="display:flex;flex-direction:column;gap:12px;padding:16px;background:#475569">
        <div data-agent-native-node-id="destination-first" data-agent-native-layer-name="Destination First"
          style="width:180px;height:40px;background:#94a3b8;color:#0f172a">First</div>
        <div data-agent-native-node-id="destination-second" data-agent-native-layer-name="Destination Second"
          style="width:180px;height:40px;background:#64748b;color:#f8fafc">Second</div>
      </section>
      <div data-agent-native-node-id="destination-outer-anchor" data-agent-native-layer-name="Destination Outer Anchor"
        style="width:90px;height:32px;background:#64748b;color:#f8fafc">Outer slot</div>
    </section>
  </body>
</html>`;

const NESTED_SOURCE_SCREEN = `<!doctype html>
<html lang="en">
  <body style="margin:0;position:relative;min-height:780px;width:1000px;height:780px;background:#0f1115;color:#fff">
    <section data-agent-native-node-id="source-shell" data-agent-native-layer-name="Source Shell"
      style="position:absolute;left:80px;top:100px;width:420px;min-height:240px;padding:20px;box-sizing:border-box;background:#1f2937">
      <section data-agent-native-node-id="nested-source-auto" data-agent-native-layer-name="Nested Source Auto"
        style="display:flex;flex-direction:column;gap:12px;padding:16px;background:#334155">
        <div data-agent-native-node-id="nested-source" data-agent-native-layer-name="Nested Source"
          style="width:180px;height:40px;background:#38bdf8;color:#082f49">Source</div>
        <div data-agent-native-node-id="nested-source-anchor" data-agent-native-layer-name="Nested Source Anchor"
          style="width:180px;height:40px;background:#64748b;color:#f8fafc">Anchor</div>
      </section>
    </section>
  </body>
</html>`;

const EMPTY_DESTINATION_SCREEN = `<!doctype html>
<html lang="en">
  <body style="margin:0;position:relative;min-height:780px;width:1000px;height:780px;background:#111827;color:#fff"></body>
</html>`;
type Box = { x: number; y: number; width: number; height: number };
type Nodes = Map<string, SavedNode>;
type Screens = { id: string; sourceId: string; destinationId: string };

const BOARD = "__board__.html";

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok())
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  return response.json();
}

async function seedScreens(
  app: App,
  sourceContent: string,
  destinationContent: string,
): Promise<Screens> {
  const id = await app.seed(sourceContent, {
    files: { "destination.html": destinationContent },
  });
  const response = await app.page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${id}`),
  );
  const files = ((await response.json()).files ?? []) as {
    filename: string;
    id: string;
  }[];
  const sourceId = files.find((file) => file.filename === "index.html")?.id;
  const destinationId = files.find(
    (file) => file.filename === "destination.html",
  )?.id;
  if (!sourceId || !destinationId) throw new Error("seeded screens missing");
  await postAction(app.page, "update-design", {
    id,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", sourceId],
        value: { sourceType: "inline", width: 1000, height: 780 },
      },
      {
        op: "set",
        path: ["canvasFrames", sourceId],
        value: { x: 0, y: 0, width: 1000, height: 780, z: 0 },
      },
      {
        op: "set",
        path: ["screenMetadata", destinationId],
        value: { sourceType: "inline", width: 1000, height: 780 },
      },
      {
        op: "set",
        path: ["canvasFrames", destinationId],
        value: { x: 1120, y: 0, width: 1000, height: 780, z: 1 },
      },
    ],
  });
  return { id, sourceId, destinationId };
}

async function openScreens(
  app: App,
  sourceContent: string,
  destinationContent: string,
): Promise<Screens> {
  const screens = await seedScreens(app, sourceContent, destinationContent);
  await app.open(screens.id);
  await app.page.keyboard.press("Shift+1");
  let previous = "";
  await expect
    .poll(
      async () => {
        const boxes = await Promise.all(
          [screens.sourceId, screens.destinationId].map((screenId) =>
            screenIframe(app.page, screenId).boundingBox(),
          ),
        );
        const current = JSON.stringify(boxes);
        const stable = current === previous;
        previous = current;
        return stable;
      },
      {
        timeout: 5_000,
        message: "screen positions never settled after zoom to fit",
      },
    )
    .toBe(true);
  await app.settled();
  return screens;
}

function screenIframe(page: Page, screenId: string) {
  return page.locator(
    `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
  );
}

async function boxFor(
  page: Page,
  screenId: string,
  nodeId: string,
): Promise<Box> {
  const box = await designFrame(page, screenId)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .boundingBox();
  if (!box) throw new Error(`missing ${nodeId} on ${screenId}`);
  return box;
}

/** The node's box inside its own screen document, in design px. */
async function designRect(
  page: Page,
  screenId: string,
  nodeId: string,
): Promise<Box> {
  return designFrame(page, screenId)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
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

/** Page coordinates of a point given in a screen's design px. */
async function pagePoint(
  page: Page,
  screenId: string,
  designX: number,
  designY: number,
) {
  const iframe = screenIframe(page, screenId);
  const box = await iframe.boundingBox();
  if (!box) throw new Error(`screen ${screenId} has no box`);
  const width = await iframe.evaluate(
    (element: HTMLIFrameElement) =>
      element.contentDocument!.documentElement.clientWidth,
  );
  const scale = box.width / width;
  return { x: box.x + designX * scale, y: box.y + designY * scale };
}

async function emptyBoardPoint(page: Page) {
  const point = await page.evaluate(() => {
    const world = document.querySelector("[data-multi-screen-canvas-world]");
    const surface = (world?.parentElement ?? world) as HTMLElement | null;
    if (!surface) return null;
    const bounds = surface.getBoundingClientRect();
    const screens = Array.from(
      document.querySelectorAll("[data-screen-iframe-id]"),
    ).map((element) => element.getBoundingClientRect());
    for (let y = bounds.top + 60; y < bounds.bottom - 60; y += 40) {
      for (let x = bounds.left + 60; x < bounds.right - 60; x += 40) {
        const nearScreen = screens.some(
          (screen) =>
            x >= screen.left - 24 &&
            x <= screen.right + 24 &&
            y >= screen.top - 24 &&
            y <= screen.bottom + 24,
        );
        if (nearScreen) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && surface.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("no empty board point found");
  return point;
}

function childrenOf(nodes: Nodes, parent: string) {
  return [...nodes.values()]
    .filter((node) => node.parent === parent)
    .sort((a, b) => a.index - b.index)
    .map((node) => node.id);
}

/** The node and every saved node nested inside it (the editor gives text runs their own ids). */
function subtree(nodes: Nodes, rootId: string) {
  const ids = [rootId];
  for (let i = 0; i < ids.length; i += 1)
    ids.push(...childrenOf(nodes, ids[i]));
  return ids;
}

function bodyId(nodes: Nodes) {
  const body = [...nodes.values()].find((node) => node.tag === "body");
  if (!body) throw new Error("saved document has no body id");
  return body.id;
}

/** Polls the saved file until `nodeId` sits under `parent` (or is gone, for `null`), then waits for saves to settle. */
async function savedParentBecomes(
  app: App,
  id: string,
  file: string,
  nodeId: string,
  parent: string | null,
) {
  await expect
    .poll(
      async () => (await app.savedNodes(id, file)).get(nodeId)?.parent ?? null,
      {
        timeout: 15_000,
        message: `${nodeId} never saved under ${parent} in ${file}`,
      },
    )
    .toBe(parent);
  await app.settled();
}

async function selectScreenNode(
  page: Page,
  screenId: string,
  nodeId: string,
): Promise<void> {
  const box = await boxFor(page, screenId, nodeId);
  await page.keyboard.down(PRIMARY);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.up(PRIMARY);
}

type Held = {
  guideBox: Box | null;
  ghostBox: Box | null;
  sourceVisible: boolean;
  pointer: { x: number; y: number };
  grabFraction: { x: number; y: number };
  sourceBox: Box;
};

/** Selects the node, drags it to `destination` and releases, running `onHeld` while the pointer is still down. */
async function dragScreenNode(
  page: Page,
  screenId: string,
  nodeId: string,
  destination: { x: number; y: number },
  onHeld: () => Promise<void>,
  grabFraction = { x: 0.5, y: 0.5 },
): Promise<Held> {
  await selectScreenNode(page, screenId, nodeId);
  const source = await boxFor(page, screenId, nodeId);
  const grab = {
    x: source.x + source.width * grabFraction.x,
    y: source.y + source.height * grabFraction.y,
  };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 20, grab.y, { steps: 5 });
  await page.mouse.move(destination.x, destination.y, { steps: 30 });
  const ghost = page.locator("[data-cross-screen-drag-ghost]");
  await expect(ghost).toHaveCount(1);
  await onHeld();
  const guide = page.locator("[data-cross-screen-drop-guide]");
  const held: Held = {
    guideBox: (await guide.count()) ? await guide.first().boundingBox() : null,
    ghostBox: await ghost.boundingBox(),
    sourceVisible: await designFrame(page, screenId)
      .locator(`[data-agent-native-node-id="${nodeId}"]`)
      .isVisible(),
    pointer: destination,
    grabFraction,
    sourceBox: source,
  };
  await page.mouse.up();
  return held;
}

function expectGhostToPreserveGrabOffset(held: Held): void {
  const ghost = held.ghostBox!;
  expect(ghost, "a drag ghost follows the pointer").not.toBeNull();
  expect(Math.abs(ghost.width - held.sourceBox.width)).toBeLessThan(5);
  expect(Math.abs(ghost.height - held.sourceBox.height)).toBeLessThan(5);
  expect(
    Math.abs(ghost.x + ghost.width * held.grabFraction.x - held.pointer.x),
  ).toBeLessThan(5);
  expect(
    Math.abs(ghost.y + ghost.height * held.grabFraction.y - held.pointer.y),
  ).toBeLessThan(5);
}

function expectGuideToContainPointer(held: Held): void {
  const guide = held.guideBox!;
  expect(guide, "a drop guide is shown").not.toBeNull();
  expect(held.pointer.x).toBeGreaterThanOrEqual(guide.x - 5);
  expect(held.pointer.x).toBeLessThanOrEqual(guide.x + guide.width + 5);
  expect(held.pointer.y).toBeGreaterThanOrEqual(guide.y - 5);
  expect(held.pointer.y).toBeLessThanOrEqual(guide.y + guide.height + 5);
}

function expectGuideBelow(held: Held, child: Box): void {
  const guide = held.guideBox!;
  expect(guide, "a drop guide is shown").not.toBeNull();
  expect(guide.height).toBeLessThan(5);
  expect(Math.abs(guide.x - child.x)).toBeLessThan(5);
  expect(Math.abs(guide.width - child.width)).toBeLessThan(5);
  expect(
    Math.abs(guide.y + guide.height / 2 - (child.y + child.height)),
  ).toBeLessThan(5);
}

function expectGuideRightOf(held: Held, child: Box): void {
  const guide = held.guideBox!;
  expect(guide, "a drop guide is shown").not.toBeNull();
  expect(guide.width).toBeLessThan(5);
  expect(
    Math.abs(guide.x + guide.width / 2 - (child.x + child.width)),
  ).toBeLessThan(5);
  expect(Math.abs(guide.y - child.y)).toBeLessThan(5);
  expect(Math.abs(guide.height - child.height)).toBeLessThan(5);
}

async function expectNothingSavedYet(
  app: App,
  id: string,
  before: Record<string, string>,
) {
  for (const [file, html] of Object.entries(before)) {
    expect(
      await app.savedHtml(id, file),
      `${file} was written while the pointer was still down`,
    ).toBe(html);
  }
}

async function savedFiles(app: App, id: string, files: string[]) {
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [file, await app.savedHtml(id, file)] as const),
    ),
  );
}

async function nodesOf(app: App, id: string, files: string[]) {
  return Object.fromEntries(
    await Promise.all(
      files.map(
        async (file) => [file, await app.savedNodes(id, file)] as const,
      ),
    ),
  ) as Record<string, Nodes>;
}

/** Undo must restore both documents exactly; redo must restore the dropped state exactly. */
async function expectUndoRedo(
  app: App,
  id: string,
  moved: string,
  from: { file: string; parent: string; before: Nodes },
  to: {
    file: string;
    parent: string;
    before: Nodes;
    after: Nodes;
    fromAfter: Nodes;
  },
) {
  await app.page.keyboard.press(`${PRIMARY}+z`);
  await savedParentBecomes(app, id, from.file, moved, from.parent);
  const undone = await nodesOf(app, id, [from.file, to.file]);
  expectOnlyChanged(from.before, undone[from.file], []);
  expect(childrenOf(undone[from.file], from.parent)).toEqual(
    childrenOf(from.before, from.parent),
  );
  expectOnlyChanged(to.before, undone[to.file], []);
  expect(childrenOf(undone[to.file], to.parent)).toEqual(
    childrenOf(to.before, to.parent),
  );

  await app.page.keyboard.press(`${PRIMARY}+Shift+z`);
  await savedParentBecomes(app, id, to.file, moved, to.parent);
  const redone = await nodesOf(app, id, [from.file, to.file]);
  expectOnlyChanged(to.after, redone[to.file], []);
  expect(childrenOf(redone[to.file], to.parent)).toEqual(
    childrenOf(to.after, to.parent),
  );
  expectOnlyChanged(to.fromAfter, redone[from.file], []);
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe("physical cross-screen auto-layout behavior", () => {
  // oracle: none — only the toolbar tool selection changed in this test; its own claim is unmeasured against Figma.
  test("board to Screen auto-layout keeps held target/source evidence and full undo-redo publication", async ({
    app,
  }) => {
    const page = app.page;
    const { id, destinationId } = await openScreens(
      app,
      SOURCE_SCREEN,
      DESTINATION_SCREEN,
    );
    const boardPoint = await emptyBoardPoint(page);
    const rectangleTool = page.locator(
      '[data-design-bottom-toolbar] button[aria-label="Rectangle"]',
    );
    await selectTool(page, "Rectangle");
    await expect(rectangleTool).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(boardPoint.x, boardPoint.y);
    await page.mouse.down();
    await page.mouse.move(boardPoint.x + 100, boardPoint.y + 64, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          [...(await app.savedNodes(id, BOARD)).values()].filter(
            (n) => n.attrs["data-an-primitive"] === "rectangle",
          ).length,
      )
      .toBe(1);
    await page
      .locator('[data-design-bottom-toolbar] button[aria-label="Move"]')
      .click();
    await app.settled();
    const before = await nodesOf(app, id, [BOARD, "destination.html"]);
    const rect = [...before[BOARD].values()].find(
      (n) => n.attrs["data-an-primitive"] === "rectangle",
    )!.id;
    const boardRectangle = page
      .locator("[data-board-surface-layer] iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator(`[data-agent-native-node-id="${rect}"]`);
    const sourceBox = (await boardRectangle.boundingBox())!;
    const flow = await boxFor(page, destinationId, "destination-flow");
    const savedBefore = await savedFiles(app, id, [BOARD, "destination.html"]);

    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2 + 20,
      sourceBox.y + sourceBox.height / 2,
      { steps: 5 },
    );
    await page.mouse.move(flow.x + flow.width / 2, flow.y + flow.height / 2, {
      steps: 30,
    });
    await expect(page.locator("[data-cross-screen-drop-guide]")).toHaveCount(1);
    await expectNothingSavedYet(app, id, savedBefore);
    await page.mouse.up();

    await savedParentBecomes(
      app,
      id,
      "destination.html",
      rect,
      "destination-flow",
    );
    const after = await nodesOf(app, id, [BOARD, "destination.html"]);
    expect(after[BOARD].has(rect), "the rectangle left the board").toBe(false);
    expect(childrenOf(after["destination.html"], "destination-flow")).toEqual([
      "destination-anchor",
      rect,
    ]);
    const savedStyle = styleOf(after["destination.html"].get(rect));
    const boardStyle = styleOf(before[BOARD].get(rect));
    expect(
      savedStyle.position,
      "a flow child is not absolutely positioned",
    ).toBeUndefined();
    expect({ width: savedStyle.width, height: savedStyle.height }).toEqual({
      width: boardStyle.width,
      height: boardStyle.height,
    });
    expectOnlyChanged(
      before[BOARD],
      after[BOARD],
      subtree(before[BOARD], rect),
    );
    expectOnlyChanged(
      before["destination.html"],
      after["destination.html"],
      subtree(after["destination.html"], rect),
    );
    const rendered = await designRect(page, destinationId, rect);
    expect(
      { x: rendered.x, y: rendered.y },
      "stacked under the anchor after the 12px gap",
    ).toEqual({ x: 96, y: 184 });

    await expectUndoRedo(
      app,
      id,
      rect,
      { file: BOARD, parent: bodyId(before[BOARD]), before: before[BOARD] },
      {
        file: "destination.html",
        parent: "destination-flow",
        before: before["destination.html"],
        after: after["destination.html"],
        fromAfter: after[BOARD],
      },
    );
  });

  // fixme: fails on current main after the merge: Error: __board__.html was written while the pointer was still down
  test.fixme("Screen to board preserves the auto-layout source boundary and undo-redo publication", async ({
    app,
  }) => {
    const page = app.page;
    const { id, sourceId } = await openScreens(
      app,
      SOURCE_SCREEN,
      DESTINATION_SCREEN,
    );
    const before = await nodesOf(app, id, ["index.html", BOARD]);
    const savedBefore = await savedFiles(app, id, ["index.html", BOARD]);
    const boardPoint = await emptyBoardPoint(page);

    const held = await dragScreenNode(
      page,
      sourceId,
      "screen-source",
      boardPoint,
      () => expectNothingSavedYet(app, id, savedBefore),
    );
    expect(held.sourceVisible).toBe(true);
    expectGhostToPreserveGrabOffset(held);

    const board = bodyId(before[BOARD]);
    await savedParentBecomes(app, id, BOARD, "screen-source", board);
    const after = await nodesOf(app, id, ["index.html", BOARD]);
    expect(childrenOf(after["index.html"], "source-flow")).toEqual([
      "source-anchor",
    ]);
    expect(styleOf(after[BOARD].get("screen-source"))).toMatchObject({
      position: "absolute",
      width: "180px",
      height: "56px",
    });
    expectOnlyChanged(
      before["index.html"],
      after["index.html"],
      subtree(before["index.html"], "screen-source"),
    );
    expectOnlyChanged(
      before[BOARD],
      after[BOARD],
      subtree(after[BOARD], "screen-source"),
    );
    const dropped = (await page
      .locator("[data-board-surface-layer] iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator('[data-agent-native-node-id="screen-source"]')
      .boundingBox())!;
    expect(
      Math.abs(dropped.x + dropped.width / 2 - boardPoint.x),
      "dropped centred on the release point",
    ).toBeLessThan(5);
    expect(
      Math.abs(dropped.y + dropped.height / 2 - boardPoint.y),
      "dropped centred on the release point",
    ).toBeLessThan(5);

    await expectUndoRedo(
      app,
      id,
      "screen-source",
      {
        file: "index.html",
        parent: "source-flow",
        before: before["index.html"],
      },
      {
        file: BOARD,
        parent: board,
        before: before[BOARD],
        after: after[BOARD],
        fromAfter: after["index.html"],
      },
    );
  });

  test("Screen to Screen inserts into the destination auto-layout root with held ghost and undo-redo publication", async ({
    app,
  }) => {
    const page = app.page;
    const { id, sourceId, destinationId } = await openScreens(
      app,
      SOURCE_SCREEN,
      DESTINATION_SCREEN,
    );
    const flow = await boxFor(page, destinationId, "destination-flow");
    const anchor = await boxFor(page, destinationId, "destination-anchor");
    const before = await nodesOf(app, id, ["index.html", "destination.html"]);
    const savedBefore = await savedFiles(app, id, [
      "index.html",
      "destination.html",
    ]);

    const held = await dragScreenNode(
      page,
      sourceId,
      "screen-source",
      { x: flow.x + flow.width / 2, y: flow.y + flow.height / 2 },
      () => expectNothingSavedYet(app, id, savedBefore),
    );
    expect(held.sourceVisible).toBe(true);
    expectGhostToPreserveGrabOffset(held);
    expectGuideBelow(held, anchor);

    await savedParentBecomes(
      app,
      id,
      "destination.html",
      "screen-source",
      "destination-flow",
    );
    const after = await nodesOf(app, id, ["index.html", "destination.html"]);
    expect(childrenOf(after["index.html"], "source-flow")).toEqual([
      "source-anchor",
    ]);
    expect(childrenOf(after["destination.html"], "destination-flow")).toEqual([
      "destination-anchor",
      "screen-source",
    ]);
    const savedStyle = styleOf(after["destination.html"].get("screen-source"));
    expect(savedStyle.position).toBeUndefined();
    expect(savedStyle).toMatchObject({ width: "180px", height: "56px" });
    expectOnlyChanged(
      before["index.html"],
      after["index.html"],
      subtree(before["index.html"], "screen-source"),
    );
    expectOnlyChanged(
      before["destination.html"],
      after["destination.html"],
      subtree(after["destination.html"], "screen-source"),
    );
    expect(await designRect(page, destinationId, "screen-source")).toEqual({
      x: 96,
      y: 184,
      width: 180,
      height: 56,
    });

    await expectUndoRedo(
      app,
      id,
      "screen-source",
      {
        file: "index.html",
        parent: "source-flow",
        before: before["index.html"],
      },
      {
        file: "destination.html",
        parent: "destination-flow",
        before: before["destination.html"],
        after: after["destination.html"],
        fromAfter: after["index.html"],
      },
    );
  });

  // fixme: product bug: The moved layer renders 56x56: its source flex:0 0 56px (a height basis in the column parent) is carried over and becomes the width basis
  test.fixme("Screen to Screen keeps reverse-flex DOM order and draws the guide on the physical edge", async ({
    app,
  }) => {
    const page = app.page;
    const { id, sourceId, destinationId } = await openScreens(
      app,
      SOURCE_SCREEN,
      REVERSE_DESTINATION_SCREEN,
    );
    const flow = await boxFor(page, destinationId, "destination-flow");
    const anchor = await boxFor(page, destinationId, "destination-anchor");
    const release = {
      x: anchor.x + anchor.width + 6,
      y: anchor.y + anchor.height / 2,
    };
    expect(
      release.x,
      "the release point is inside the row's padding",
    ).toBeLessThan(flow.x + flow.width);
    const before = await nodesOf(app, id, ["index.html", "destination.html"]);
    const savedBefore = await savedFiles(app, id, [
      "index.html",
      "destination.html",
    ]);

    const held = await dragScreenNode(
      page,
      sourceId,
      "screen-source",
      release,
      () => expectNothingSavedYet(app, id, savedBefore),
    );
    expect(held.sourceVisible).toBe(true);
    expectGhostToPreserveGrabOffset(held);
    expectGuideRightOf(held, anchor);

    await savedParentBecomes(
      app,
      id,
      "destination.html",
      "screen-source",
      "destination-flow",
    );
    const after = await nodesOf(app, id, ["index.html", "destination.html"]);
    expect(childrenOf(after["destination.html"], "destination-flow")).toEqual([
      "screen-source",
      "destination-anchor",
      "destination-tail",
    ]);
    expect(childrenOf(after["index.html"], "source-flow")).toEqual([
      "source-anchor",
    ]);
    expectOnlyChanged(
      before["index.html"],
      after["index.html"],
      subtree(before["index.html"], "screen-source"),
    );
    expectOnlyChanged(
      before["destination.html"],
      after["destination.html"],
      subtree(after["destination.html"], "screen-source"),
    );
    await expectUndoRedo(
      app,
      id,
      "screen-source",
      {
        file: "index.html",
        parent: "source-flow",
        before: before["index.html"],
      },
      {
        file: "destination.html",
        parent: "destination-flow",
        before: before["destination.html"],
        after: after["destination.html"],
        fromAfter: after["index.html"],
      },
    );

    expect(
      await designRect(page, destinationId, "screen-source"),
      "rightmost in the row, at its own 180x56 size",
    ).toEqual({
      x: 244,
      y: 116,
      width: 180,
      height: 56,
    });
  });

  // fixme: product bug: Same flex-basis carry-over: the layer renders 56x56 on the third row.
  test.fixme("Screen to Screen inserts after the hovered item on a wrapped second row and persists through history", async ({
    app,
  }) => {
    const page = app.page;
    const { id, sourceId, destinationId } = await openScreens(
      app,
      SOURCE_SCREEN,
      WRAPPED_DESTINATION_SCREEN,
    );
    expect(
      await designRect(page, destinationId, "wrapped-third"),
      "the fixture wraps onto a second row",
    ).toEqual({
      x: 96,
      y: 184,
      width: 140,
      height: 56,
    });
    const fourth = await boxFor(page, destinationId, "wrapped-fourth");
    const release = {
      x: fourth.x + fourth.width + 6,
      y: fourth.y + fourth.height / 2,
    };
    const before = await nodesOf(app, id, ["index.html", "destination.html"]);
    const savedBefore = await savedFiles(app, id, [
      "index.html",
      "destination.html",
    ]);

    const held = await dragScreenNode(
      page,
      sourceId,
      "screen-source",
      release,
      () => expectNothingSavedYet(app, id, savedBefore),
    );
    expect(held.sourceVisible).toBe(true);
    expectGhostToPreserveGrabOffset(held);
    expectGuideRightOf(held, fourth);

    await savedParentBecomes(
      app,
      id,
      "destination.html",
      "screen-source",
      "destination-flow",
    );
    const after = await nodesOf(app, id, ["index.html", "destination.html"]);
    expect(childrenOf(after["destination.html"], "destination-flow")).toEqual([
      "wrapped-first",
      "wrapped-second",
      "wrapped-third",
      "wrapped-fourth",
      "screen-source",
    ]);
    expect(childrenOf(after["index.html"], "source-flow")).toEqual([
      "source-anchor",
    ]);
    expectOnlyChanged(
      before["index.html"],
      after["index.html"],
      subtree(before["index.html"], "screen-source"),
    );
    expectOnlyChanged(
      before["destination.html"],
      after["destination.html"],
      subtree(after["destination.html"], "screen-source"),
    );
    await expectUndoRedo(
      app,
      id,
      "screen-source",
      {
        file: "index.html",
        parent: "source-flow",
        before: before["index.html"],
      },
      {
        file: "destination.html",
        parent: "destination-flow",
        before: before["destination.html"],
        after: after["destination.html"],
        fromAfter: after["index.html"],
      },
    );

    expect(
      await designRect(page, destinationId, "screen-source"),
      "wraps to a third row at its own 180x56 size",
    ).toEqual({
      x: 96,
      y: 252,
      width: 180,
      height: 56,
    });
  });

  test("G1: physical drop selects the eligible inner auto-layout frame and its held insertion slot", async ({
    app,
  }) => {
    const page = app.page;
    const { id, sourceId, destinationId } = await openScreens(
      app,
      FREE_SOURCE_SCREEN,
      NESTED_DESTINATION_SCREEN,
    );
    const first = await boxFor(page, destinationId, "destination-first");
    const release = {
      x: first.x + first.width / 2,
      y: first.y + first.height * 0.75,
    };
    const before = await nodesOf(app, id, ["index.html", "destination.html"]);
    const savedBefore = await savedFiles(app, id, [
      "index.html",
      "destination.html",
    ]);

    const held = await dragScreenNode(
      page,
      sourceId,
      "free-source",
      release,
      () => expectNothingSavedYet(app, id, savedBefore),
      { x: 0.31, y: 0.68 },
    );
    expect(held.sourceVisible).toBe(true);
    expectGhostToPreserveGrabOffset(held);
    expectGuideBelow(held, first);

    await savedParentBecomes(
      app,
      id,
      "destination.html",
      "free-source",
      "nested-auto",
    );
    const after = await nodesOf(app, id, ["index.html", "destination.html"]);
    expect(childrenOf(after["destination.html"], "nested-auto")).toEqual([
      "destination-first",
      "free-source",
      "destination-second",
    ]);
    expect(childrenOf(after["destination.html"], "destination-shell")).toEqual([
      "nested-auto",
      "destination-outer-anchor",
    ]);
    const savedStyle = styleOf(after["destination.html"].get("free-source"));
    expect(savedStyle.position).toBeUndefined();
    expect(savedStyle).toMatchObject({ width: "140px", height: "60px" });
    expectOnlyChanged(
      before["index.html"],
      after["index.html"],
      subtree(before["index.html"], "free-source"),
    );
    expectOnlyChanged(
      before["destination.html"],
      after["destination.html"],
      subtree(after["destination.html"], "free-source"),
    );
    expect(
      await designRect(page, destinationId, "free-source"),
      "between First and Second in the inner stack",
    ).toEqual({
      x: 116,
      y: 188,
      width: 140,
      height: 60,
    });

    await expectUndoRedo(
      app,
      id,
      "free-source",
      {
        file: "index.html",
        parent: bodyId(before["index.html"]),
        before: before["index.html"],
      },
      {
        file: "destination.html",
        parent: "nested-auto",
        before: before["destination.html"],
        after: after["destination.html"],
        fromAfter: after["index.html"],
      },
    );
  });

  test("G4: blank space in an auto-layout receiver uses the pointer insertion slot", async ({
    app,
  }) => {
    const page = app.page;
    const { id, sourceId, destinationId } = await openScreens(
      app,
      NESTED_SOURCE_SCREEN,
      NESTED_DESTINATION_SCREEN,
    );
    const receiver = await boxFor(page, destinationId, "destination-shell");
    const marker = await boxFor(
      page,
      destinationId,
      "destination-outer-anchor",
    );
    const release = {
      x: receiver.x + receiver.width - 24,
      y: receiver.y + receiver.height / 2,
    };
    expect(
      release.x,
      "the release point is blank space right of the last child",
    ).toBeGreaterThan(marker.x + marker.width);
    const before = await nodesOf(app, id, ["index.html", "destination.html"]);
    const savedBefore = await savedFiles(app, id, [
      "index.html",
      "destination.html",
    ]);

    const held = await dragScreenNode(
      page,
      sourceId,
      "nested-source",
      release,
      () => expectNothingSavedYet(app, id, savedBefore),
    );
    expect(held.sourceVisible).toBe(true);
    expectGhostToPreserveGrabOffset(held);
    expectGuideRightOf(held, marker);

    await savedParentBecomes(
      app,
      id,
      "destination.html",
      "nested-source",
      "destination-shell",
    );
    const after = await nodesOf(app, id, ["index.html", "destination.html"]);
    expect(childrenOf(after["destination.html"], "destination-shell")).toEqual([
      "nested-auto",
      "destination-outer-anchor",
      "nested-source",
    ]);
    expect(childrenOf(after["index.html"], "nested-source-auto")).toEqual([
      "nested-source-anchor",
    ]);
    expect(
      styleOf(after["destination.html"].get("nested-source")).position,
    ).toBeUndefined();
    expectOnlyChanged(
      before["index.html"],
      after["index.html"],
      subtree(before["index.html"], "nested-source"),
    );
    expectOnlyChanged(
      before["destination.html"],
      after["destination.html"],
      subtree(after["destination.html"], "nested-source"),
    );
    expect(
      await designRect(page, destinationId, "nested-source"),
      "after the outer anchor, 12px gap, top-aligned",
    ).toEqual({
      x: 426,
      y: 120,
      width: 180,
      height: 40,
    });
  });

  test("a free layer dragged to an empty Screen lands under the pointer as an absolute child, with exact undo and redo", async ({
    app,
  }) => {
    const page = app.page;
    const { id, sourceId, destinationId } = await openScreens(
      app,
      FREE_SOURCE_SCREEN,
      EMPTY_DESTINATION_SCREEN,
    );
    const before = await nodesOf(app, id, ["index.html", "destination.html"]);
    const savedBefore = await savedFiles(app, id, [
      "index.html",
      "destination.html",
    ]);
    const release = await pagePoint(page, destinationId, 300, 220);

    const held = await dragScreenNode(
      page,
      sourceId,
      "free-source",
      release,
      () => expectNothingSavedYet(app, id, savedBefore),
    );
    expect(held.sourceVisible).toBe(true);
    expectGhostToPreserveGrabOffset(held);
    expectGuideToContainPointer(held);

    const root = bodyId(before["destination.html"]);
    await savedParentBecomes(app, id, "destination.html", "free-source", root);
    const after = await nodesOf(app, id, ["index.html", "destination.html"]);
    const saved = styleOf(after["destination.html"].get("free-source"));
    expect({
      position: saved.position,
      width: saved.width,
      height: saved.height,
    }).toEqual({
      position: "absolute",
      width: "140px",
      height: "60px",
    });
    expect(
      Math.abs(parseFloat(saved.left) - 230),
      `saved left ${saved.left}`,
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(parseFloat(saved.top) - 190),
      `saved top ${saved.top}`,
    ).toBeLessThanOrEqual(2);
    expectOnlyChanged(
      before["index.html"],
      after["index.html"],
      subtree(before["index.html"], "free-source"),
    );
    expectOnlyChanged(
      before["destination.html"],
      after["destination.html"],
      subtree(after["destination.html"], "free-source"),
    );
    const rendered = await designRect(page, destinationId, "free-source");
    expect(
      Math.abs(rendered.x - 230),
      `rendered x ${rendered.x}`,
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(rendered.y - 190),
      `rendered y ${rendered.y}`,
    ).toBeLessThanOrEqual(2);

    await expectUndoRedo(
      app,
      id,
      "free-source",
      {
        file: "index.html",
        parent: bodyId(before["index.html"]),
        before: before["index.html"],
      },
      {
        file: "destination.html",
        parent: root,
        before: before["destination.html"],
        after: after["destination.html"],
        fromAfter: after["index.html"],
      },
    );
  });

  test("a layer dragged out of a nested auto layout to an empty Screen lands under the pointer as an absolute child, with exact undo and redo", async ({
    app,
  }) => {
    const page = app.page;
    const { id, sourceId, destinationId } = await openScreens(
      app,
      NESTED_SOURCE_SCREEN,
      EMPTY_DESTINATION_SCREEN,
    );
    const before = await nodesOf(app, id, ["index.html", "destination.html"]);
    const savedBefore = await savedFiles(app, id, [
      "index.html",
      "destination.html",
    ]);
    const release = await pagePoint(page, destinationId, 640, 265);

    const held = await dragScreenNode(
      page,
      sourceId,
      "nested-source",
      release,
      () => expectNothingSavedYet(app, id, savedBefore),
    );
    expect(held.sourceVisible).toBe(true);
    expectGhostToPreserveGrabOffset(held);
    expectGuideToContainPointer(held);

    const root = bodyId(before["destination.html"]);
    await savedParentBecomes(
      app,
      id,
      "destination.html",
      "nested-source",
      root,
    );
    const after = await nodesOf(app, id, ["index.html", "destination.html"]);
    expect(childrenOf(after["index.html"], "nested-source-auto")).toEqual([
      "nested-source-anchor",
    ]);
    const saved = styleOf(after["destination.html"].get("nested-source"));
    expect({
      position: saved.position,
      width: saved.width,
      height: saved.height,
    }).toEqual({
      position: "absolute",
      width: "180px",
      height: "40px",
    });
    expect(
      Math.abs(parseFloat(saved.left) - 550),
      `saved left ${saved.left}`,
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(parseFloat(saved.top) - 245),
      `saved top ${saved.top}`,
    ).toBeLessThanOrEqual(2);
    expectOnlyChanged(
      before["index.html"],
      after["index.html"],
      subtree(before["index.html"], "nested-source"),
    );
    expectOnlyChanged(
      before["destination.html"],
      after["destination.html"],
      subtree(after["destination.html"], "nested-source"),
    );
    const rendered = await designRect(page, destinationId, "nested-source");
    expect(
      Math.abs(rendered.x - 550),
      `rendered x ${rendered.x}`,
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(rendered.y - 245),
      `rendered y ${rendered.y}`,
    ).toBeLessThanOrEqual(2);

    await expectUndoRedo(
      app,
      id,
      "nested-source",
      {
        file: "index.html",
        parent: "nested-source-auto",
        before: before["index.html"],
      },
      {
        file: "destination.html",
        parent: root,
        before: before["destination.html"],
        after: after["destination.html"],
        fromAfter: after["index.html"],
      },
    );
  });
});
