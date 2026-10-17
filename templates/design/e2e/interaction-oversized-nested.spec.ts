import { type Page } from "@playwright/test";

import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

test.use({ viewport: { width: 1600, height: 1000 } });

const FIXTURE = `<!doctype html><html><body style="margin:0;min-height:900px;background:#111827">
  <div data-agent-native-node-id="source" data-agent-native-layer-name="Source" style="position:absolute;left:80px;top:520px;width:220px;height:96px;background:#f97316">Source</div>
  <section data-agent-native-node-id="outer" data-agent-native-layer-name="Outer" style="position:absolute;left:500px;top:120px;width:340px;height:260px;padding:16px;display:flex;flex-direction:column;gap:12px;background:#334155">
    <section data-agent-native-node-id="nested" data-agent-native-layer-name="Nested" data-an-primitive="frame" style="flex:0 0 160px;width:180px;height:160px;display:flex;flex-direction:column;gap:8px;padding:8px;background:#64748b">
      <div data-agent-native-node-id="anchor" data-agent-native-layer-name="Anchor" style="flex:0 0 32px;width:80px;height:32px;background:#94a3b8">Anchor</div>
    </section>
  </section>
</body></html>`;

const NESTED_PLAIN_FRAME_FIXTURE = `<!doctype html><html><body style="margin:0;min-height:900px;background:#111827">
  <div data-agent-native-node-id="source" data-agent-native-layer-name="Source" style="position:absolute;left:80px;top:520px;width:220px;height:96px;background:#f97316">Source</div>
  <section data-agent-native-node-id="outer" data-agent-native-layer-name="Outer" style="position:absolute;left:500px;top:120px;width:420px;height:320px;padding:16px;display:flex;flex-direction:column;gap:12px;background:#334155">
    <section data-agent-native-node-id="middle" data-agent-native-layer-name="Middle" data-an-primitive="frame" style="position:relative;flex:0 0 180px;width:180px;height:180px;background:#475569">
      <section data-agent-native-node-id="nested" data-agent-native-layer-name="Nested" data-an-primitive="frame" style="position:relative;width:140px;height:140px;background:#64748b">
        <div data-agent-native-node-id="anchor" data-agent-native-layer-name="Anchor" style="position:absolute;left:12px;top:12px;width:60px;height:32px;background:#94a3b8">Anchor</div>
      </section>
    </section>
  </section>
</body></html>`;

const STATIC_SECTION_FIXTURE = `<!doctype html><html><body style="margin:0;min-height:900px;position:relative;background:#111827">
  <div data-agent-native-node-id="source" data-agent-native-layer-name="Source" style="position:absolute;left:80px;top:520px;width:220px;height:96px;background:#f97316">Source</div>
  <section data-agent-native-node-id="static" data-agent-native-layer-name="Static Section" style="width:480px;height:320px;padding:16px;background:#334155">
    <section data-agent-native-node-id="nested" data-agent-native-layer-name="Nested" data-an-primitive="frame" style="position:relative;width:140px;height:140px;background:#64748b">
      <div data-agent-native-node-id="anchor" data-agent-native-layer-name="Anchor" style="position:absolute;left:12px;top:12px;width:60px;height:32px;background:#94a3b8">Anchor</div>
    </section>
  </section>
</body></html>`;

function frameRoot(page: Page) {
  return page
    .locator(
      'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])',
    )
    .contentFrame();
}

async function guide(page: Page) {
  return frameRoot(page)
    .locator("[data-agent-native-insertion-guide]")
    .evaluateAll(
      (els) =>
        els
          .map((el) => {
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return {
              display: s.display,
              left: r.left,
              top: r.top,
              width: r.width,
              height: r.height,
              borderTop: s.borderTopColor,
              borderLeft: s.borderLeftColor,
            };
          })
          .find(
            (x) =>
              x.display !== "none" &&
              (x.width > 0 || x.height > 0) &&
              (x.borderTop !== "rgba(0, 0, 0, 0)" ||
                x.borderLeft !== "rgba(0, 0, 0, 0)"),
          ) ?? null,
    );
}

function childrenOf(
  nodes: Map<string, { parent: string | null; index: number }>,
  parent: string,
) {
  return [...nodes.entries()]
    .filter(([, node]) => node.parent === parent)
    .sort(([, a], [, b]) => a.index - b.index)
    .map(([id]) => id);
}

function subtree(
  nodes: Map<string, { parent: string | null }>,
  id: string,
): string[] {
  return [
    id,
    ...[...nodes.entries()]
      .filter(([, node]) => node.parent === id)
      .flatMap(([child]) => subtree(nodes, child)),
  ];
}

function bodyOf(nodes: Map<string, { tag: string }>) {
  return [...nodes.entries()].find(([, node]) => node.tag === "body")?.[0];
}

async function selectSource(app: App) {
  const rect = await app.designRect("source");
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(point.x, point.y);
  expect(await app.selectedLayers()).toEqual(["Source"]);
}

/** Drags Source by its centre onto a point of the target box; returns the held guide just before release. */
async function dragSourceOnto(
  app: App,
  targetId: string,
  at: { xRatio: number; yRatio: number },
  modifier?: string,
) {
  const page = app.page;
  const source = (await app.node("source").boundingBox())!;
  const target = (await app.node(targetId).boundingBox())!;
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    source.x + source.width / 2 + 12,
    source.y + source.height / 2 + 8,
    {
      steps: 6,
    },
  );
  await page.mouse.move(
    target.x + target.width * at.xRatio,
    target.y + target.height * at.yRatio,
    {
      steps: 24,
    },
  );
  const held = await guide(page);
  return {
    held,
    release: async () => {
      await page.mouse.up();
      if (modifier) await page.keyboard.up(modifier);
      await app.settled();
    },
  };
}

async function renderedSize(app: App, nodeId: string) {
  const { width, height } = await app.designRect(nodeId);
  return { width, height };
}

// fixme: product bug: Source renders 220x72 after the drop (saved height:96px without flex-shrink:0, so Outer's fixed-height column squeezes it); moving a
test.fixme("a source too wide for Nested drops into Outer just above Nested at its full 220×96 size", async ({
  app,
}) => {
  const id = await app.seed(FIXTURE);
  await app.open(id);
  await selectSource(app);
  const before = await app.savedNodes(id);
  const nested = await app.designRect("nested");
  expect({ nested, source: await renderedSize(app, "source") }).toEqual({
    nested: { x: 516, y: 136, width: 196, height: 176 },
    source: { width: 220, height: 96 },
  });

  const drop = await dragSourceOnto(app, "nested", {
    xRatio: 0.5,
    yRatio: 0.25,
  });
  expect(
    drop.held,
    "an insertion line at Nested's top edge while held",
  ).not.toBeNull();
  expect(drop.held!.height).toBeLessThan(16);
  expect(Math.round(drop.held!.left)).toBe(nested.x);
  expect(
    Math.abs(drop.held!.top + drop.held!.height / 2 - nested.y),
  ).toBeLessThan(3);
  expect(await app.savedNodes(id)).toEqual(before);
  await drop.release();

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "outer")).toEqual(["source", "nested"]);
  const style = styleOf(after.get("source"));
  expect({
    position: style.position,
    left: style.left,
    top: style.top,
  }).toEqual({
    position: undefined,
    left: undefined,
    top: undefined,
  });
  expectOnlyChanged(before, after, ["source"]);
  expect(
    await renderedSize(app, "source"),
    "moving a fixed-size layer into a column must not squeeze it",
  ).toEqual({ width: 220, height: 96 });
});

test("a source too big for nested plain frames lands in Outer, the nearest auto-layout ancestor it fits", async ({
  app,
}) => {
  const id = await app.seed(NESTED_PLAIN_FRAME_FIXTURE);
  await app.open(id);
  await selectSource(app);
  const before = await app.savedNodes(id);
  expect(childrenOf(before, "outer")).toEqual(["middle"]);

  const drop = await dragSourceOnto(app, "nested", {
    xRatio: 0.5,
    yRatio: 0.5,
  });
  expect(drop.held, "an insertion line while held").not.toBeNull();
  expect(drop.held!.height).toBeLessThan(16);
  expect(await app.savedNodes(id)).toEqual(before);
  await drop.release();

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "outer")).toEqual(["source", "middle"]);
  expect(childrenOf(after, "nested")).toEqual(["anchor"]);
  expectOnlyChanged(before, after, ["source"]);
  expect(await renderedSize(app, "source")).toEqual({ width: 220, height: 96 });
});

test("a source dropped on a frame inside a static section with no fitting ancestor stays on the page at the drop point", async ({
  app,
}) => {
  const id = await app.seed(STATIC_SECTION_FIXTURE);
  await app.open(id);
  await selectSource(app);
  const before = await app.savedNodes(id);
  expect(await app.designRect("nested")).toEqual({
    x: 16,
    y: 16,
    width: 140,
    height: 140,
  });

  const drop = await dragSourceOnto(app, "nested", {
    xRatio: 0.5,
    yRatio: 0.5,
  });
  expect(
    drop.held,
    "no insertion guide: nothing can accept the drop",
  ).toBeNull();
  expect(await app.savedNodes(id)).toEqual(before);
  await drop.release();

  const after = await app.savedNodes(id);
  expect(after.get("source")?.parent).toBe(bodyOf(after));
  expect(styleOf(after.get("source"))).toEqual({
    ...styleOf(before.get("source")),
    left: "-24px",
    top: "38px",
  });
  expectOnlyChanged(before, after, ["source"]);
  expect(await app.designRect("source")).toEqual({
    x: -24,
    y: 38,
    width: 220,
    height: 96,
  });
});

test("Command forces an oversized source into Nested's flow after its anchor", async ({
  app,
}) => {
  const id = await app.seed(FIXTURE);
  await app.open(id);
  await selectSource(app);
  const before = await app.savedNodes(id);
  expect(childrenOf(before, "nested")).toEqual(["anchor"]);

  const drop = await dragSourceOnto(
    app,
    "nested",
    { xRatio: 0.5, yRatio: 0.5 },
    MOD,
  );
  expect(drop.held, "an insertion indicator while held").not.toBeNull();
  expect(await app.savedNodes(id)).toEqual(before);
  await drop.release();

  const after = await app.savedNodes(id);
  expect(childrenOf(after, "nested")).toEqual(["anchor", "source"]);
  const style = styleOf(after.get("source"));
  expect({
    position: style.position,
    left: style.left,
    top: style.top,
  }).toEqual({
    position: undefined,
    left: undefined,
    top: undefined,
  });
  expectOnlyChanged(before, after, subtree(after, "source"));
  expect(await renderedSize(app, "source")).toEqual({ width: 220, height: 96 });
});
