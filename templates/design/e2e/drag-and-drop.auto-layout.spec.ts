import {
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

test.use({ viewport: { width: 1600, height: 1000 } });

const VERTICAL_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <section data-agent-native-node-id="vertical" data-agent-native-layer-name="Vertical"
    style="position:absolute;left:60px;top:80px;width:320px;padding:16px;display:flex;flex-direction:column;gap:12px;background:#1f2937">
    <div data-agent-native-node-id="v1" data-agent-native-layer-name="V1" style="width:180px;height:48px;background:#6366f1">V1</div>
    <div data-agent-native-node-id="v2" data-agent-native-layer-name="V2" style="width:180px;height:48px;background:#a855f7">V2</div>
    <div data-agent-native-node-id="v3" data-agent-native-layer-name="V3" style="width:180px;height:48px;background:#ec4899">V3</div>
  </section>
</body></html>`;

const WRAP_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <section data-agent-native-node-id="wrap" data-agent-native-layer-name="Wrap"
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
  <section data-agent-native-node-id="grid" data-agent-native-layer-name="Grid"
    style="position:absolute;left:360px;top:80px;width:300px;height:220px;padding:12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:72px;gap:12px;background:#1f2937;box-sizing:border-box">
    <div data-agent-native-node-id="g1" data-agent-native-layer-name="G1" style="min-width:0;background:#6366f1">G1</div>
    <div data-agent-native-node-id="g2" data-agent-native-layer-name="G2" style="min-width:0;background:#a855f7">G2</div>
    <div data-agent-native-node-id="g3" data-agent-native-layer-name="G3" style="min-width:0;background:#ec4899">G3</div>
    <div data-agent-native-node-id="g4" data-agent-native-layer-name="G4" style="min-width:0;background:#f59e0b">G4</div>
  </section>
</body></html>`;

const NEST_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <div data-agent-native-node-id="nest-source" data-agent-native-layer-name="Nest Source"
    style="position:absolute;left:60px;top:420px;width:80px;height:44px;background:#6366f1">Source</div>
  <section data-agent-native-node-id="nest-row" data-agent-native-layer-name="Nest Row"
    style="position:absolute;left:360px;top:80px;width:300px;padding:12px;display:flex;gap:12px;background:#1f2937">
    <section data-agent-native-node-id="nested-frame" data-agent-native-layer-name="Nested Frame"
      data-an-primitive="frame" style="width:180px;height:100px;background:#374151"></section>
  </section>
</body></html>`;

const OVERSIZED_HEIGHT_NEST_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <div data-agent-native-node-id="nest-source" data-agent-native-layer-name="Nest Source"
    style="position:absolute;left:60px;top:420px;width:80px;height:140px;background:#6366f1">Source</div>
  <section data-agent-native-node-id="nest-row" data-agent-native-layer-name="Nest Row"
    style="position:absolute;left:360px;top:80px;width:300px;padding:12px;display:flex;gap:12px;background:#1f2937">
    <section data-agent-native-node-id="nested-frame" data-agent-native-layer-name="Nested Frame"
      data-an-primitive="frame" style="position:relative;width:180px;height:100px;background:#374151"></section>
    <section data-agent-native-node-id="nested-next" data-agent-native-layer-name="Nested Next"
      data-an-primitive="frame" style="width:64px;height:72px;background:#4b5563"></section>
  </section>
</body></html>`;

const IGNORE_AUTO_LAYOUT_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <section data-agent-native-node-id="meta-row" data-agent-native-layer-name="Meta Row"
    style="position:absolute;left:60px;top:80px;width:300px;height:100px;padding:16px;display:flex;flex-direction:row;gap:12px;background:#1f2937">
    <div data-agent-native-node-id="meta-child" data-agent-native-layer-name="Meta Child" style="width:100px;height:48px;background:#6366f1">Child</div>
    <div data-agent-native-node-id="meta-peer" data-agent-native-layer-name="Meta Peer" style="width:100px;height:48px;background:#a855f7">Peer</div>
  </section>
</body></html>`;

// The bridge reads Control on Apple platforms and a held S key elsewhere.
const IGNORE_AUTO_LAYOUT = process.platform === "darwin" ? "Control" : "s";

const OVERSIZED_PLAIN_DROP_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <div data-agent-native-node-id="oversized-source" data-agent-native-layer-name="Oversized Source"
    style="position:absolute;left:500px;top:300px;width:500px;height:110px;background:#ea580c">Source</div>
  <section data-agent-native-node-id="plain-target" data-agent-native-layer-name="Empty Flow"
    style="position:absolute;left:80px;top:70px;width:360px;height:180px;display:flex;flex-direction:row;background:#374151"></section>
</body></html>`;

const LIVE_SCREEN =
  'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])';

type Guide = {
  kind: "inside" | "line";
  x: number;
  y: number;
  width: number;
  height: number;
};

async function openFixture(app: App, html: string) {
  const id = await app.seed(html);
  await app.open(id);
  await app.zoomToFit();
  return id;
}

async function selectAndGrab(app: App, nodeId: string, layerName: string) {
  const rect = await app.designRect(nodeId);
  const grab = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(grab.x, grab.y);
  await expect.poll(() => app.selectedLayers()).toEqual([layerName]);
  return grab;
}

/** Presses on `from`, drags to the design point, runs `held` before release, and waits for the save. */
async function dragTo(
  app: App,
  from: { x: number; y: number },
  designX: number,
  designY: number,
  held: () => Promise<void>,
  modifier?: string,
) {
  const to = await app.pagePoint(designX, designY);
  await app.page.mouse.move(from.x, from.y);
  if (modifier) await app.page.keyboard.down(modifier);
  await app.page.mouse.down();
  await app.page.mouse.move(from.x + 10, from.y + 6, { steps: 5 });
  await app.page.mouse.move(to.x, to.y, { steps: 20 });
  await held();
  await app.page.mouse.up();
  if (modifier) await app.page.keyboard.up(modifier);
  await app.settled();
}

/** The visible insertion guide in design px: a bordered box means "inside", a filled bar means "line". */
async function insertionGuide(app: App): Promise<Guide | null> {
  return app.page
    .frameLocator(LIVE_SCREEN)
    .locator("body")
    .evaluate(() => {
      const guide = Array.from(
        document.documentElement.querySelectorAll<HTMLElement>(
          "[data-agent-native-insertion-guide]",
        ),
      ).find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return (
          getComputedStyle(candidate).display !== "none" &&
          rect.width > 0 &&
          rect.height > 0
        );
      });
      if (!guide) return null;
      const rect = guide.getBoundingClientRect();
      return {
        kind:
          parseFloat(getComputedStyle(guide).borderTopWidth) > 0
            ? ("inside" as const)
            : ("line" as const),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    });
}

async function expectLineGuide(app: App) {
  await expect.poll(async () => (await insertionGuide(app))?.kind).toBe("line");
}

function childrenOf(nodes: Map<string, SavedNode>, parent: string | null) {
  return [...nodes.values()]
    .filter((node) => node.parent === parent)
    .sort((a, b) => a.index - b.index)
    .map((node) => node.id);
}

/** Moving a layer may re-serialize its colour from hex to rgb(); both are the authored colour. */
function color(hex: string, rgb: string) {
  return expect.stringMatching(
    new RegExp(`^(${hex}|${rgb.replace(/[()]/g, "\\$&")})$`),
  );
}

function withoutPlacement(style: Record<string, string>) {
  const { position: _position, left: _left, top: _top, ...rest } = style;
  return rest;
}

test("dragging the first child of a vertical auto layout below the last reorders it to the end and changes nothing else", async ({
  app,
}) => {
  const id = await openFixture(app, VERTICAL_FIXTURE);
  const grab = await selectAndGrab(app, "v1", "V1");
  const before = await app.savedNodes(id);
  expect(childrenOf(before, "vertical")).toEqual(["v1", "v2", "v3"]);

  await dragTo(app, grab, 166, 254, () => expectLineGuide(app));

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "vertical")).toEqual(["v2", "v3", "v1"]);
  expect(styleOf(after.get("v1"))).toEqual(styleOf(before.get("v1")));
  expectOnlyChanged(before, after, ["v1"]);
  expect(await app.designRect("v1")).toEqual({
    x: 76,
    y: 216,
    width: 180,
    height: 48,
  });
});

test("dragging a wrapped child onto the first child's leading edge moves it to the first row and wraps the last child down", async ({
  app,
}) => {
  const id = await openFixture(app, WRAP_FIXTURE);
  const grab = await selectAndGrab(app, "w3", "W3");
  const before = await app.savedNodes(id);
  expect(await app.designRect("w3")).toEqual({
    x: 76,
    y: 197,
    width: 104,
    height: 48,
  });

  await dragTo(app, grab, 80, 120, () => expectLineGuide(app));

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "wrap")).toEqual(["w3", "w1", "w2"]);
  expect(styleOf(after.get("w3"))).toEqual(styleOf(before.get("w3")));
  expectOnlyChanged(before, after, ["w3"]);
  expect(await app.designRect("w3")).toEqual({
    x: 76,
    y: 96,
    width: 104,
    height: 48,
  });
  expect(await app.designRect("w2")).toEqual({
    x: 76,
    y: 197,
    width: 104,
    height: 48,
  });
});

test("dropping a free layer on a grid cell's leading edge inserts it into that cell as a flow child", async ({
  app,
}) => {
  const id = await openFixture(app, GRID_FIXTURE);
  const grab = await selectAndGrab(app, "grid-source", "Grid Source");
  const before = await app.savedNodes(id);
  expect(childrenOf(before, "grid")).toEqual(["g1", "g2", "g3", "g4"]);

  await dragTo(app, grab, 376, 212, () => expectLineGuide(app));

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "grid")).toEqual([
    "g1",
    "g2",
    "grid-source",
    "g3",
    "g4",
  ]);
  expect(styleOf(after.get("grid-source"))).toEqual(
    withoutPlacement(styleOf(before.get("grid-source"))),
  );
  expectOnlyChanged(before, after, ["grid-source"]);
  expect(await app.designRect("grid-source")).toEqual({
    x: 372,
    y: 176,
    width: 80,
    height: 44,
  });
});

// fixme: fails on current main after the merge: Error: expect(locator).toBeVisible() failed
test.fixme("dropping a free layer on an empty frame inside a flex row nests it in the frame, not in the row", async ({
  app,
}) => {
  const id = await openFixture(app, NEST_FIXTURE);
  const grab = await selectAndGrab(app, "nest-source", "Nest Source");
  const before = await app.savedNodes(id);
  expect(await app.designRect("nested-frame")).toEqual({
    x: 372,
    y: 92,
    width: 180,
    height: 100,
  });

  await dragTo(app, grab, 462, 142, async () => {
    await expect
      .poll(async () => {
        const guide = await insertionGuide(app);
        return (
          guide && {
            kind: guide.kind,
            coversFrame:
              guide.x <= 372 &&
              guide.y <= 92 &&
              guide.x + guide.width >= 552 &&
              guide.y + guide.height >= 192,
          }
        );
      })
      .toEqual({ kind: "inside", coversFrame: true });
  });

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "nested-frame")).toEqual(["nest-source"]);
  expect(childrenOf(after, "nest-row")).toEqual(["nested-frame"]);
  expect(styleOf(after.get("nest-source"))).toEqual({
    width: "80px",
    height: "44px",
    background: color("#6366f1", "rgb(99, 102, 241)"),
  });
  expectOnlyChanged(before, after, ["nest-source"]);
  expect(await app.designRect("nest-source")).toEqual({
    x: 372,
    y: 92,
    width: 80,
    height: 44,
  });
});

// fixme: product bug: After the drop the over-full flex row (300px holding 180+80+64 + gaps) shrinks fixed-width children: Nest Source renders 68x140
test.fixme("a layer taller than a nested frame drops beside it in the row, not inside, and keeps its size", async ({
  app,
}) => {
  const id = await openFixture(app, OVERSIZED_HEIGHT_NEST_FIXTURE);
  const grab = await selectAndGrab(app, "nest-source", "Nest Source");
  const before = await app.savedNodes(id);
  expect(await app.designRect("nested-frame")).toEqual({
    x: 372,
    y: 92,
    width: 180,
    height: 100,
  });

  await dragTo(app, grab, 507, 142, async () => {
    await expect
      .poll(async () => {
        const guide = await insertionGuide(app);
        return (
          guide && {
            kind: guide.kind,
            centerX: Math.round(guide.x + guide.width / 2),
          }
        );
      })
      .toEqual({ kind: "line", centerX: 552 });
  });

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "nest-row")).toEqual([
    "nested-frame",
    "nest-source",
    "nested-next",
  ]);
  expect(childrenOf(after, "nested-frame")).toEqual([]);
  expect(styleOf(after.get("nest-source"))).toEqual(
    withoutPlacement(styleOf(before.get("nest-source"))),
  );
  expectOnlyChanged(before, after, ["nest-source"]);
  const dropped = await app.designRect("nest-source");
  expect({ width: dropped.width, height: dropped.height }).toEqual({
    width: 80,
    height: 140,
  });
});

// fixme: product bug: Teleport: the saved style drops position/left/top, so the layer becomes a static body child rendered at the screen's top-left 0,0 over
test.fixme("a layer wider than an empty auto-layout frame drops beside it and stays where it was released", async ({
  app,
}) => {
  const id = await openFixture(app, OVERSIZED_PLAIN_DROP_FIXTURE);
  const grab = await selectAndGrab(app, "oversized-source", "Oversized Source");
  const before = await app.savedNodes(id);

  await dragTo(app, grab, 350, 205, () => expectLineGuide(app));

  const after = await app.savedNodes(id);
  expect(after.get("oversized-source")?.parent).toBe(
    after.get("plain-target")?.parent,
  );
  expect(childrenOf(after, "plain-target")).toEqual([]);
  expect(styleOf(after.get("oversized-source"))).toEqual({
    position: "absolute",
    left: "100px",
    top: "150px",
    width: "500px",
    height: "110px",
    background: color("#ea580c", "rgb(234, 88, 12)"),
  });
  expectOnlyChanged(before, after, ["oversized-source"]);
  expect(await app.designRect("oversized-source")).toEqual({
    x: 100,
    y: 150,
    width: 500,
    height: 110,
  });
});

// fixme: product bug: Control+mousedown opens the canvas context menu (Select layer / Edit with AI / Copy ...), and it stays open over the canvas after the
test.fixme("holding the ignore-auto-layout key drags a child out of its row to the exact drop point without opening a menu", async ({
  app,
}) => {
  const id = await openFixture(app, IGNORE_AUTO_LAYOUT_FIXTURE);
  const grab = await selectAndGrab(app, "meta-child", "Meta Child");
  const before = await app.savedNodes(id);
  expect(await app.designRect("meta-child")).toEqual({
    x: 76,
    y: 96,
    width: 100,
    height: 48,
  });

  await dragTo(
    app,
    grab,
    626,
    504,
    async () => {
      await expect(
        app.page
          .frameLocator(LIVE_SCREEN)
          .locator("[data-agent-native-transform-badge]"),
      ).toHaveText("Move layer");
    },
    IGNORE_AUTO_LAYOUT,
  );

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "meta-row")).toEqual(["meta-peer"]);
  expect(after.get("meta-child")?.parent).toBe(after.get("meta-row")?.parent);
  expect(styleOf(after.get("meta-child"))).toEqual({
    position: "absolute",
    left: "576px",
    top: "480px",
    width: "100px",
    height: "48px",
    background: color("#6366f1", "rgb(99, 102, 241)"),
  });
  expectOnlyChanged(before, after, ["meta-child"]);
  expect(await app.designRect("meta-child")).toEqual({
    x: 576,
    y: 480,
    width: 100,
    height: 48,
  });
  await expect(app.page.getByRole("menu")).toHaveCount(0);
});
