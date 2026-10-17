import { FIXTURE } from "./drag-and-drop.shared";
import {
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

test.use({ viewport: { width: 1600, height: 1000 } });

const EXIT_FIXTURE = `<!doctype html><html><body style="margin:0;min-height:700px">
  <main data-agent-native-node-id="outer" data-agent-native-layer-name="Outer" style="position:absolute;left:40px;top:40px;width:700px;height:400px;background:#eee">
    <section data-an-primitive="frame" data-agent-native-node-id="nested" data-agent-native-layer-name="Nested" style="position:absolute;left:0;top:0;display:flex;flex-direction:row;width:180px;height:140px;background:#ccc">
      <div data-agent-native-node-id="dragme" data-agent-native-layer-name="Dragged layer" style="width:80px;height:60px;background:#6366f1">Dragged layer</div>
    </section>
    <div data-agent-native-node-id="candidate" data-agent-native-layer-name="Candidate" style="position:absolute;left:220px;top:20px;width:100px;height:100px;background:#9ca3af">Candidate</div>
    <div data-agent-native-node-id="overlap" data-agent-native-layer-name="Later layer" style="position:absolute;left:340px;top:20px;width:120px;height:100px;background:#ef4444">Later layer</div>
  </main>
</body></html>`;

const NESTED_ROW_FIXTURE = `<!doctype html><html><body style="margin:0;min-height:900px">
  <div data-agent-native-node-id="frame-a" data-agent-native-layer-name="Container" style="position:absolute;left:20px;top:60px;width:280px;height:160px;background:#1f2937"></div>
  <section data-an-primitive="frame" data-agent-native-node-id="outer" data-agent-native-layer-name="Outer" style="position:absolute;left:360px;top:360px;width:300px;height:220px;display:flex;flex-direction:column;gap:8px;background:#374151">
    <div data-agent-native-node-id="row" data-agent-native-layer-name="Row" style="display:flex;flex-direction:row;gap:8px">
      <div data-agent-native-node-id="chip-1" data-agent-native-layer-name="Chip 1" style="width:80px;height:50px;background:#a855f7"></div>
      <div data-agent-native-node-id="chip-2" data-agent-native-layer-name="Chip 2" style="width:80px;height:50px;background:#ec4899"></div>
      <div data-agent-native-node-id="chip-3" data-agent-native-layer-name="Chip 3" style="width:80px;height:50px;background:#f59e0b"></div>
    </div>
  </section>
</body></html>`;

type Point = { x: number; y: number };

function childrenOf(nodes: Map<string, SavedNode>, parent: string) {
  return [...nodes.values()]
    .filter((node) => node.parent === parent)
    .sort((a, b) => a.index - b.index)
    .map((node) => node.id);
}

async function openSeeded(app: App, html: string) {
  const id = await app.seed(html);
  await app.open(id);
  await app.zoomToFit();
  await app.settled();
  return id;
}

/** Plain canvas click at the node's centre; returns that centre in design px. */
async function selectOnCanvas(app: App, nodeId: string): Promise<Point> {
  const rect = await app.designRect(nodeId);
  const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const point = await app.pagePoint(centre.x, centre.y);
  await app.page.mouse.click(point.x, point.y);
  return centre;
}

async function pressAt(app: App, design: Point) {
  const point = await app.pagePoint(design.x, design.y);
  await app.page.mouse.move(point.x, point.y);
  await app.page.mouse.down();
}

async function moveTo(app: App, design: Point, steps: number) {
  const point = await app.pagePoint(design.x, design.y);
  await app.page.mouse.move(point.x, point.y, { steps });
}

async function savedParentBecomes(
  app: App,
  id: string,
  nodeId: string,
  parent: string,
) {
  await expect
    .poll(async () => (await app.savedNodes(id)).get(nodeId)?.parent, {
      message: `${nodeId} never saved under ${parent}`,
    })
    .toBe(parent);
  await app.settled();
}

/** Resolves once the editor reports an active drag, so a "nothing moved" result is not a drag that never began. */
async function watchDragStart(app: App) {
  await app.page.evaluate(() => {
    const host = window as Window & { __e2eDragActive?: boolean };
    host.__e2eDragActive = false;
    window.addEventListener(
      "message",
      (event: MessageEvent) => {
        if (
          event.data?.type === "agent-native:editor-drag-state" &&
          event.data.active === true
        ) {
          host.__e2eDragActive = true;
        }
      },
      true,
    );
  });
  return () =>
    expect
      .poll(() =>
        app.page.evaluate(
          () =>
            (window as Window & { __e2eDragActive?: boolean }).__e2eDragActive,
        ),
      )
      .toBe(true);
}

function expectNear(
  actual: string | undefined,
  expected: number,
  label: string,
) {
  expect(
    Math.abs(parseFloat(actual ?? "NaN") - expected),
    `${label} ${actual}`,
  ).toBeLessThanOrEqual(2);
}

test.describe("reparenting rules", () => {
  test("dragging a flow child out places it directly above the exited frame in visible overlap, with exact undo and redo", async ({
    app,
  }) => {
    const id = await openSeeded(app, EXIT_FIXTURE);
    const before = await app.savedNodes(id);
    expect(childrenOf(before, "outer")).toEqual([
      "nested",
      "candidate",
      "overlap",
    ]);
    expect(await app.designRect("dragme")).toEqual({
      x: 40,
      y: 40,
      width: 80,
      height: 60,
    });
    const savedBefore = await app.savedHtml(id);

    await pressAt(app, { x: 108, y: 70 });
    await moveTo(app, { x: 310, y: 110 }, 8);
    await moveTo(app, { x: 108, y: 70 }, 8);
    await moveTo(app, { x: 240, y: 110 }, 12);
    await app.settled();
    expect(
      await app.savedHtml(id),
      "nothing commits while the pointer crosses frames",
    ).toBe(savedBefore);
    await app.page.mouse.up();

    await savedParentBecomes(app, id, "dragme", "outer");
    const after = await app.savedNodes(id);
    expect(
      childrenOf(after, "outer"),
      "directly above the frame it left",
    ).toEqual(["nested", "dragme", "candidate", "overlap"]);
    expect(childrenOf(after, "nested")).toEqual([]);
    const saved = styleOf(after.get("dragme"));
    expect({
      position: saved.position,
      width: saved.width,
      height: saved.height,
    }).toEqual({
      position: "absolute",
      width: "80px",
      height: "60px",
    });
    expectNear(saved.left, 132, "saved left");
    expectNear(saved.top, 40, "saved top");
    expectOnlyChanged(before, after, ["dragme"]);
    const topmost = await app.node("dragme").evaluate((element) =>
      element.ownerDocument
        .elementsFromPoint(196, 110)
        .map((hit) =>
          hit
            .closest("[data-agent-native-node-id]")
            ?.getAttribute("data-agent-native-node-id"),
        )
        .find((hitId) => hitId === "dragme" || hitId === "nested"),
    );
    expect(topmost, "the dropped layer paints over the frame it overlaps").toBe(
      "dragme",
    );

    await app.page.keyboard.press("ControlOrMeta+z");
    await savedParentBecomes(app, id, "dragme", "nested");
    const undone = await app.savedNodes(id);
    expectOnlyChanged(before, undone, []);
    expect(childrenOf(undone, "outer")).toEqual([
      "nested",
      "candidate",
      "overlap",
    ]);

    await app.page.keyboard.press("ControlOrMeta+Shift+z");
    await savedParentBecomes(app, id, "dragme", "outer");
    const redone = await app.savedNodes(id);
    expectOnlyChanged(after, redone, []);
    expect(childrenOf(redone, "outer")).toEqual([
      "nested",
      "dragme",
      "candidate",
      "overlap",
    ]);
  });

  test("an object smaller than a frame becomes its direct child at the drop point", async ({
    app,
  }) => {
    const id = await openSeeded(app, FIXTURE);
    const grab = await selectOnCanvas(app, "box-a");
    await expect.poll(() => app.selectedLayers()).toEqual(["Box A"]);
    const before = await app.savedNodes(id);

    await pressAt(app, grab);
    await moveTo(app, { x: 160, y: 140 }, 20);
    await app.page.mouse.up();

    await savedParentBecomes(app, id, "box-a", "frame-a");
    const after = await app.savedNodes(id);
    const saved = styleOf(after.get("box-a"));
    expect({
      position: saved.position,
      width: saved.width,
      height: saved.height,
    }).toEqual({
      position: "absolute",
      width: "120px",
      height: "80px",
    });
    expectNear(saved.left, 80, "saved left");
    expectNear(saved.top, 40, "saved top");
    expectOnlyChanged(before, after, ["box-a"]);
    const rendered = await app.designRect("box-a");
    expect(
      Math.abs(rendered.x - 100) + Math.abs(rendered.y - 100),
      `rendered at ${rendered.x},${rendered.y}`,
    ).toBeLessThanOrEqual(3);
  });

  test("holding Space while dragging keeps the object in its current parent", async ({
    app,
  }) => {
    const id = await openSeeded(app, FIXTURE);
    const grab = await selectOnCanvas(app, "chip-1");
    await expect.poll(() => app.selectedLayers()).toEqual(["Chip 1"]);
    const before = await app.savedNodes(id);
    const dragStarted = await watchDragStart(app);

    await pressAt(app, grab);
    await moveTo(app, { x: grab.x + 8, y: grab.y }, 2);
    await dragStarted();
    await app.page.keyboard.down("Space");
    await moveTo(app, { x: 160, y: 140 }, 20);
    await app.page.mouse.up();
    await app.page.keyboard.up("Space");
    await app.settled();

    const after = await app.savedNodes(id);
    expect(
      childrenOf(after, "row"),
      "stays in Row, in the slot under the pointer",
    ).toEqual(["chip-2", "chip-1", "chip-3"]);
    expect(childrenOf(after, "frame-a")).toEqual([]);
    expectOnlyChanged(before, after, []);
    expect(await app.designRect("chip-1")).toEqual({
      x: 108,
      y: 600,
      width: 80,
      height: 50,
    });
  });

  test("holding Space keeps a flow child in its nested auto-layout parent", async ({
    app,
  }) => {
    const id = await openSeeded(app, NESTED_ROW_FIXTURE);
    const grab = await selectOnCanvas(app, "chip-1");
    await expect.poll(() => app.selectedLayers()).toEqual(["Chip 1"]);
    const before = await app.savedNodes(id);
    const dragStarted = await watchDragStart(app);

    await pressAt(app, grab);
    await moveTo(app, { x: grab.x + 8, y: grab.y }, 2);
    await dragStarted();
    await app.page.keyboard.down("Space");
    await moveTo(app, { x: 160, y: 140 }, 20);
    await app.page.mouse.up();
    await app.page.keyboard.up("Space");
    await app.settled();

    const after = await app.savedNodes(id);
    expect(
      childrenOf(after, "row"),
      "stays first in its own Row, not the outer stack",
    ).toEqual(["chip-1", "chip-2", "chip-3"]);
    expect(childrenOf(after, "outer")).toEqual(["row"]);
    expect(childrenOf(after, "frame-a")).toEqual([]);
    expectOnlyChanged(before, after, []);
    expect(await app.designRect("chip-1")).toEqual({
      x: 360,
      y: 360,
      width: 80,
      height: 50,
    });
  });

  test("releasing Space before the drop restores normal reparenting", async ({
    app,
  }) => {
    const id = await openSeeded(app, FIXTURE);
    const grab = await selectOnCanvas(app, "chip-1");
    await expect.poll(() => app.selectedLayers()).toEqual(["Chip 1"]);
    const before = await app.savedNodes(id);

    await pressAt(app, grab);
    await moveTo(app, { x: grab.x + 8, y: grab.y }, 2);
    await app.page.keyboard.down("Space");
    await moveTo(app, { x: 150, y: 130 }, 20);
    await app.page.keyboard.up("Space");
    await moveTo(app, { x: 160, y: 140 }, 4);
    await app.page.mouse.up();

    await savedParentBecomes(app, id, "chip-1", "frame-a");
    const after = await app.savedNodes(id);
    expect(childrenOf(after, "frame-a")).toEqual(["chip-1"]);
    expect(childrenOf(after, "row")).toEqual(["chip-2", "chip-3"]);
    expect(
      styleOf(after.get("frame-a")),
      "an empty container becomes a vertical auto layout",
    ).toEqual({
      ...styleOf(before.get("frame-a")),
      display: "flex",
      "flex-direction": "column",
      gap: "10px",
    });
    expect(styleOf(after.get("chip-1"))).toEqual(styleOf(before.get("chip-1")));
    expectOnlyChanged(before, after, ["chip-1", "frame-a"]);
    expect(await app.designRect("chip-1")).toEqual({
      x: 20,
      y: 60,
      width: 80,
      height: 50,
    });
  });
});
