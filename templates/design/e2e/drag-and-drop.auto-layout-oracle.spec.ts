import { expect, test, type Page } from "@playwright/test";

import {
  indexHtml,
  MOD,
  newDesign,
  node,
  openEditor,
  postAction,
  setBaseURL,
} from "./drag-and-drop.shared";

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

const WRAP_ORACLE_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <section data-agent-native-node-id="wrap-oracle" data-agent-native-layer-name="Wrap Oracle"
    style="position:absolute;left:60px;top:80px;width:256px;height:190px;padding:16px;display:flex;flex-direction:row;flex-wrap:wrap;gap:12px;background:#1f2937">
    <div data-agent-native-node-id="w1" data-agent-native-layer-name="W1" style="flex:0 0 104px;height:48px;background:#6366f1">W1</div>
    <div data-agent-native-node-id="w2" data-agent-native-layer-name="W2" style="flex:0 0 104px;height:48px;background:#a855f7">W2</div>
    <div data-agent-native-node-id="w3" data-agent-native-layer-name="W3" style="flex:0 0 104px;height:48px;background:#ec4899">W3</div>
  </section>
</body></html>`;

const GRID_ORACLE_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <div data-agent-native-node-id="grid-source" data-agent-native-layer-name="Grid Source"
    style="position:absolute;left:60px;top:420px;width:80px;height:44px;background:#6366f1">Source</div>
  <section data-agent-native-node-id="grid-oracle" data-agent-native-layer-name="Grid Oracle"
    style="position:absolute;left:360px;top:80px;width:300px;height:220px;padding:12px;display:grid;grid-template-columns:repeat(2,120px);grid-auto-rows:56px;column-gap:16px;row-gap:16px;background:#1f2937;box-sizing:border-box">
    <div data-agent-native-node-id="g1" data-agent-native-layer-name="G1" style="background:#6366f1">G1</div>
    <div data-agent-native-node-id="g2" data-agent-native-layer-name="G2" style="background:#a855f7">G2</div>
    <div data-agent-native-node-id="g3" data-agent-native-layer-name="G3" style="background:#ec4899">G3</div>
  </section>
</body></html>`;

const GRID_FULL_ORACLE_FIXTURE = GRID_ORACLE_FIXTURE.replace(
  '    <div data-agent-native-node-id="g3" data-agent-native-layer-name="G3" style="background:#ec4899">G3</div>',
  '    <div data-agent-native-node-id="g3" data-agent-native-layer-name="G3" style="background:#ec4899">G3</div>\n    <div data-agent-native-node-id="g4" data-agent-native-layer-name="G4" style="background:#f59e0b">G4</div>',
);

const GRID_COLUMN_ORACLE_FIXTURE = `<!doctype html>
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

const GRID_EXPLICIT_ORACLE_FIXTURE = `<!doctype html>
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

const GRID_EXPLICIT_SOURCE_ORACLE_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <section data-agent-native-node-id="explicit-source-grid" data-agent-native-layer-name="Explicit Source Grid"
    style="position:absolute;left:360px;top:80px;width:300px;height:220px;padding:12px;display:grid;grid-template-columns:repeat(2,120px);grid-auto-rows:56px;gap:16px;background:#1f2937;box-sizing:border-box">
    <div data-agent-native-node-id="explicit-source" data-agent-native-layer-name="Explicit Source" style="grid-column:1;grid-row:1;background:#6366f1">Source</div>
    <div data-agent-native-node-id="explicit-peer-1" data-agent-native-layer-name="Explicit Peer 1" style="background:#a855f7">Peer 1</div>
    <div data-agent-native-node-id="explicit-peer-2" data-agent-native-layer-name="Explicit Peer 2" style="background:#ec4899">Peer 2</div>
  </section>
</body></html>`;

const GRID_INTRINSIC_SIZE_ORACLE_FIXTURE = `<!doctype html>
<html><body style="margin:0;min-height:900px;background:#0f1115">
  <div data-agent-native-node-id="sized-source" data-agent-native-layer-name="Sized Source"
    style="position:absolute;left:60px;top:420px;width:44px;height:28px;min-width:44px;max-width:44px;min-height:28px;max-height:28px;align-self:end;justify-self:end;background:#6366f1">Source</div>
  <section data-agent-native-node-id="intrinsic-grid" data-agent-native-layer-name="Intrinsic Grid"
    style="position:absolute;left:360px;top:80px;width:340px;height:240px;padding:12px;display:grid;grid-template-columns:repeat(2,140px);grid-auto-rows:88px;gap:16px;background:#1f2937;box-sizing:border-box">
    <div data-agent-native-node-id="sized-peer-1" data-agent-native-layer-name="Sized Peer 1" style="background:#a855f7">Peer 1</div>
    <div data-agent-native-node-id="sized-peer-2" data-agent-native-layer-name="Sized Peer 2" style="background:#ec4899">Peer 2</div>
  </section>
</body></html>`;

const GRID_LOCKED_EXPLICIT_ORACLE_FIXTURE = `<!doctype html>
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

const GRID_TRANSFORM_ORACLE_FIXTURE = `<!doctype html>
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

const GRID_DENSE_ORACLE_FIXTURE = `<!doctype html>
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

function preview(page: Page) {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame();
}

async function selectNode(page: Page, id: string): Promise<void> {
  const name = await node(page, id).getAttribute(
    "data-agent-native-layer-name",
  );
  if (!name) throw new Error(`missing layer name for ${id}`);
  const tree = page.getByRole("tree", { name: "Layers" });
  await tree.getByRole("button", { name, exact: true }).first().click({
    force: true,
  });
  await expect(
    tree.locator(
      '[role="treeitem"][aria-selected="true"] [data-layer-row-button][data-layer-node-id]',
    ),
  ).toHaveCount(1);
}

type RectSnapshot = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  transform: string;
};

async function childrenSnapshot(
  page: Page,
  parentId: string,
): Promise<RectSnapshot[]> {
  return preview(page)
    .locator("body")
    .evaluate((body, id) => {
      const parent = body.querySelector(`[data-agent-native-node-id="${id}"]`);
      if (!parent) throw new Error(`missing parent ${id}`);
      return Array.from(parent.children)
        .map((el) => {
          const node = el as HTMLElement;
          const rect = node.getBoundingClientRect();
          return {
            id: node.getAttribute("data-agent-native-node-id") ?? "",
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            transform: getComputedStyle(node).transform,
          };
        })
        .filter((child) => child.id);
    }, parentId);
}

async function frameRectSnapshot(page: Page, id: string) {
  return preview(page)
    .locator(`[data-agent-native-node-id="${id}"]`)
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    });
}

async function guideSnapshot(page: Page) {
  return preview(page)
    .locator("body")
    .evaluate(() => {
      const guide = document.querySelector(
        "[data-agent-native-insertion-guide]",
      ) as HTMLElement | null;
      if (!guide) return null;
      const style = getComputedStyle(guide);
      const rect = guide.getBoundingClientRect();
      return {
        display: style.display,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        borderTop: parseFloat(style.borderTopWidth),
        borderLeft: parseFloat(style.borderLeftWidth),
        background: style.backgroundColor,
      };
    });
}

async function dragToHeldPoint(
  page: Page,
  sourceId: string,
  target: { x: number; y: number },
): Promise<void> {
  const source = (await node(page, sourceId).boundingBox())!;
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    source.x + source.width / 2 + 12,
    source.y + source.height / 2 + 8,
    { steps: 6 },
  );
  await page.mouse.move(target.x, target.y, { steps: 24 });
  await expect
    .poll(() => guideSnapshot(page), {
      timeout: 5_000,
      message: `no visible insertion guide while dragging ${sourceId}`,
    })
    .toMatchObject({ display: "block" });
}

async function deleteDesign(page: Page, designId: string): Promise<void> {
  await postAction(page, "delete-design", { id: designId }).catch(() => {});
}

test("W-1 held wrapped reorder shows a 2D marker and projected sibling reflow", async ({
  page,
}) => {
  const designId = await newDesign(page, WRAP_ORACLE_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectNode(page, "w3");
    const before = await childrenSnapshot(page, "wrap-oracle");
    const w1 = (await node(page, "w1").boundingBox())!;
    await dragToHeldPoint(page, "w3", {
      x: w1.x + 2,
      y: w1.y + w1.height / 2,
    });
    try {
      const guide = await guideSnapshot(page);
      expect(guide).toMatchObject({ display: "block" });
      expect(guide!.width).toBeLessThan(guide!.height);
      const held = await childrenSnapshot(page, "wrap-oracle");
      const beforeById = new Map(before.map((child) => [child.id, child]));
      const movedSiblings = held
        .filter((child) => child.id !== "w3")
        .some((child) => {
          const prior = beforeById.get(child.id)!;
          return (
            Math.abs(child.left - prior.left) > 2 ||
            Math.abs(child.top - prior.top) > 2 ||
            child.transform !== prior.transform
          );
        });
      expect(movedSiblings).toBe(true);
    } finally {
      await page.mouse.up();
    }
    await expect
      .poll(() => indexHtml(page, designId), { timeout: 5_000 })
      .toContain('data-agent-native-node-id="w3"');
    await openEditor(page, designId);
    const html = await indexHtml(page, designId);
    expect(html.indexOf('data-agent-native-node-id="w3"')).toBeLessThan(
      html.indexOf('data-agent-native-node-id="w1"'),
    );
    const afterReload = await childrenSnapshot(page, "wrap-oracle");
    expect(afterReload.map((child) => child.id)).toEqual(["w3", "w1", "w2"]);
  } finally {
    await deleteDesign(page, designId);
  }
});

test("W-2 held wrapped reorder changes marker row before the final persisted slot", async ({
  page,
}) => {
  const designId = await newDesign(page, WRAP_ORACLE_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectNode(page, "w1");
    const w2 = (await node(page, "w2").boundingBox())!;
    const w3 = (await node(page, "w3").boundingBox())!;
    const source = (await node(page, "w1").boundingBox())!;
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
    await page.mouse.move(w2.x + w2.width - 2, w2.y + w2.height / 2, {
      steps: 18,
    });
    await expect
      .poll(() => guideSnapshot(page), { timeout: 5_000 })
      .toMatchObject({ display: "block" });
    const rowOneGuide = await guideSnapshot(page);
    await page.mouse.move(w3.x + w3.width - 2, w3.y + w3.height / 2, {
      steps: 18,
    });
    await expect
      .poll(() => guideSnapshot(page), { timeout: 5_000 })
      .toMatchObject({ display: "block" });
    const rowTwoGuide = await guideSnapshot(page);
    expect(Math.abs(rowTwoGuide!.top - rowOneGuide!.top)).toBeGreaterThan(10);
    expect(rowTwoGuide!.width).toBeLessThan(rowTwoGuide!.height);
    await page.mouse.up();
    await expect
      .poll(() => indexHtml(page, designId), { timeout: 5_000 })
      .toContain('data-agent-native-node-id="w1"');
    await openEditor(page, designId);
    const afterReload = await childrenSnapshot(page, "wrap-oracle");
    expect(afterReload.map((child) => child.id)).toEqual(["w2", "w3", "w1"]);
  } finally {
    await deleteDesign(page, designId);
  }
});

test("G-1 held drop into an empty grid cell previews that exact cell", async ({
  page,
}) => {
  const designId = await newDesign(page, GRID_ORACLE_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectNode(page, "grid-source");
    const sourceBefore = await frameRectSnapshot(page, "grid-source");
    const g2 = (await node(page, "g2").boundingBox())!;
    const g3 = (await node(page, "g3").boundingBox())!;
    const target = {
      x: g2.x + g2.width / 2,
      y: g3.y + g3.height / 2,
    };
    await dragToHeldPoint(page, "grid-source", target);
    try {
      const guide = await guideSnapshot(page);
      const g2Frame = await frameRectSnapshot(page, "g2");
      const g3Frame = await frameRectSnapshot(page, "g3");
      expect(guide).toMatchObject({ display: "block" });
      expect(Math.abs(guide!.left - g2Frame.left)).toBeLessThan(3);
      expect(Math.abs(guide!.top - g3Frame.top)).toBeLessThan(3);
      expect(Math.abs(guide!.width - sourceBefore.width)).toBeLessThan(3);
      expect(Math.abs(guide!.height - sourceBefore.height)).toBeLessThan(3);
    } finally {
      await page.mouse.up();
    }
    await expect
      .poll(() => indexHtml(page, designId), { timeout: 5_000 })
      .toContain('data-agent-native-node-id="grid-source"');
    await openEditor(page, designId);
    const afterReload = await childrenSnapshot(page, "grid-oracle");
    expect(afterReload.map((child) => child.id)).toEqual([
      "g1",
      "g2",
      "g3",
      "grid-source",
    ]);
    const placed = afterReload[afterReload.length - 1]!;
    const g2AfterReload = afterReload.find((child) => child.id === "g2")!;
    const g3AfterReload = afterReload.find((child) => child.id === "g3")!;
    expect(placed.left).toBeGreaterThan(g2AfterReload.left - 3);
    expect(placed.top).toBeGreaterThan(g3AfterReload.top - 3);
  } finally {
    await deleteDesign(page, designId);
  }
});

test("G-2 held grid reorder previews occupancy without duplicating the child", async ({
  page,
}) => {
  const designId = await newDesign(page, GRID_ORACLE_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectNode(page, "g1");
    const grid = (await node(page, "grid-oracle").boundingBox())!;
    const g2 = (await node(page, "g2").boundingBox())!;
    const g3 = (await node(page, "g3").boundingBox())!;
    const target = {
      x: g2.x + g2.width / 2,
      y: g3.y + g3.height / 2,
    };
    const before = await childrenSnapshot(page, "grid-oracle");
    await dragToHeldPoint(page, "g1", target);
    try {
      const guide = await guideSnapshot(page);
      expect(guide).toMatchObject({ display: "block" });
      const held = await childrenSnapshot(page, "grid-oracle");
      expect(held.filter((child) => child.id === "g1")).toHaveLength(1);
      expect(
        held.some(
          (child) =>
            child.id === "g2" && child.transform !== before[1].transform,
        ),
      ).toBe(true);
    } finally {
      await page.mouse.up();
    }
    await expect
      .poll(() => indexHtml(page, designId), { timeout: 5_000 })
      .toContain('data-agent-native-node-id="g1"');
    await openEditor(page, designId);
    const afterReload = await childrenSnapshot(page, "grid-oracle");
    expect(afterReload.filter((child) => child.id === "g1")).toHaveLength(1);
    expect(afterReload.map((child) => child.id)).toContain("g1");
  } finally {
    await deleteDesign(page, designId);
  }
});

test("G-3 full grid edge drop retains every child and creates the next flow slot", async ({
  page,
}) => {
  const designId = await newDesign(page, GRID_FULL_ORACLE_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectNode(page, "grid-source");
    const sourceBefore = await frameRectSnapshot(page, "grid-source");
    const grid = (await node(page, "grid-oracle").boundingBox())!;
    const g4 = await frameRectSnapshot(page, "g4");
    await dragToHeldPoint(page, "grid-source", {
      x: grid.x + grid.width - 12,
      y: grid.y + grid.height - 12,
    });
    try {
      const guide = await guideSnapshot(page);
      expect(guide).toMatchObject({ display: "block" });
      expect(guide!.top).toBeGreaterThan(g4.top + g4.height / 2);
      expect(Math.abs(guide!.width - sourceBefore.width)).toBeLessThan(3);
    } finally {
      await page.mouse.up();
    }
    await expect
      .poll(() => indexHtml(page, designId), { timeout: 5_000 })
      .toContain('data-agent-native-node-id="grid-source"');
    await openEditor(page, designId);
    const afterReload = await childrenSnapshot(page, "grid-oracle");
    expect(afterReload.map((child) => child.id).sort()).toEqual(
      ["g1", "g2", "g3", "g4", "grid-source"].sort(),
    );
  } finally {
    await deleteDesign(page, designId);
  }
});

test("G-4 held column-flow drop maps the excluded source to the empty cell", async ({
  page,
}) => {
  const designId = await newDesign(page, GRID_COLUMN_ORACLE_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectNode(page, "column-source");
    const sourceBefore = await frameRectSnapshot(page, "column-source");
    const c2 = (await node(page, "c2").boundingBox())!;
    const c3 = (await node(page, "c3").boundingBox())!;
    const c2Frame = await frameRectSnapshot(page, "c2");
    const c3Frame = await frameRectSnapshot(page, "c3");
    await dragToHeldPoint(page, "column-source", {
      x: c3.x + c3.width / 2,
      y: c2.y + c2.height / 2,
    });
    try {
      const guide = await guideSnapshot(page);
      expect(guide).toMatchObject({ display: "block" });
      expect(Math.abs(guide!.left - c3Frame.left)).toBeLessThan(3);
      expect(Math.abs(guide!.top - c2Frame.top)).toBeLessThan(3);
      expect(Math.abs(guide!.width - sourceBefore.width)).toBeLessThan(3);
      expect(Math.abs(guide!.height - sourceBefore.height)).toBeLessThan(3);
    } finally {
      await page.mouse.up();
    }
    await expect
      .poll(() => indexHtml(page, designId), { timeout: 5_000 })
      .toContain('data-agent-native-node-id="column-source"');
    await openEditor(page, designId);
    const afterReload = await childrenSnapshot(page, "column-grid");
    expect(afterReload.map((child) => child.id)).toEqual([
      "c1",
      "c2",
      "c3",
      "column-source",
    ]);
    expect(
      afterReload.filter((child) => child.id === "column-source"),
    ).toHaveLength(1);
  } finally {
    await deleteDesign(page, designId);
  }
});

test("G-5 held explicit-span grid drop uses a conservative line and preserves authored placement", async ({
  page,
}) => {
  const designId = await newDesign(page, GRID_EXPLICIT_ORACLE_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectNode(page, "explicit-source");
    const e2 = (await node(page, "e2").boundingBox())!;
    await dragToHeldPoint(page, "explicit-source", {
      x: e2.x + 4,
      y: e2.y + e2.height / 2,
    });
    try {
      const guide = await guideSnapshot(page);
      expect(guide).toMatchObject({ display: "block" });
      expect(Math.min(guide!.width, guide!.height)).toBeLessThan(10);
    } finally {
      await page.mouse.up();
    }
    await expect
      .poll(() => indexHtml(page, designId), { timeout: 5_000 })
      .toContain("grid-column: 3 / 4");
    expect(
      (await childrenSnapshot(page, "explicit-grid")).map((child) => child.id),
    ).toEqual(["e1", "explicit-source", "e2", "e3"]);
    const persistedBefore = await indexHtml(page, designId);
    expect(
      persistedBefore.indexOf('data-agent-native-node-id="explicit-source"'),
    ).toBeLessThan(persistedBefore.indexOf('data-agent-native-node-id="e2"'));
    const state = await preview(page)
      .locator("body")
      .evaluate(() => {
        const grid = document.querySelector(
          '[data-agent-native-node-id="explicit-grid"]',
        );
        const span = document.querySelector(
          '[data-agent-native-node-id="e1"]',
        ) as HTMLElement | null;
        const source = document.querySelector(
          '[data-agent-native-node-id="explicit-source"]',
        ) as HTMLElement | null;
        return {
          parent: source?.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ),
          sourceCount: document.querySelectorAll(
            '[data-agent-native-node-id="explicit-source"]',
          ).length,
          span: span?.style.gridColumn,
          gridContains: !!grid && !!source && grid.contains(source),
        };
      });
    expect(state).toMatchObject({
      parent: "explicit-grid",
      sourceCount: 1,
      span: "1 / span 2",
      gridContains: true,
    });

    await page.keyboard.down(MOD);
    await page.keyboard.press("z");
    await page.keyboard.up(MOD);
    await expect
      .poll(() => indexHtml(page, designId), { timeout: 5_000 })
      .not.toContain("grid-column: 3 / 4");
    await expect
      .poll(() =>
        preview(page)
          .locator('[data-agent-native-node-id="explicit-source"]')
          .evaluate((source) => source.parentElement?.tagName),
      )
      .toBe("BODY");

    await page.keyboard.down(MOD);
    await page.keyboard.press("Shift+z");
    await page.keyboard.up(MOD);
    await expect
      .poll(() => indexHtml(page, designId), { timeout: 5_000 })
      .toContain("grid-column: 3 / 4");
    await openEditor(page, designId);
    const redone = await preview(page)
      .locator('[data-agent-native-node-id="explicit-source"]')
      .evaluate((source) => ({
        parent: source.parentElement?.getAttribute("data-agent-native-node-id"),
        column: (source as HTMLElement).style.gridColumn,
        row: (source as HTMLElement).style.gridRow,
      }));
    expect(redone).toEqual({
      parent: "explicit-grid",
      column: "3 / 4",
      row: "auto",
    });
  } finally {
    await deleteDesign(page, designId);
  }
});

test("G-5 after-edge grid drop persists through undo, redo, and reload", async ({
  page,
}) => {
  const designId = await newDesign(page, GRID_EXPLICIT_ORACLE_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectNode(page, "explicit-source");
    const e2 = (await node(page, "e2").boundingBox())!;
    await dragToHeldPoint(page, "explicit-source", {
      x: e2.x + e2.width - 4,
      y: e2.y + e2.height / 2,
    });
    try {
      const guide = await guideSnapshot(page);
      expect(guide).toMatchObject({ display: "block" });
      expect(Math.min(guide!.width, guide!.height)).toBeLessThan(10);
    } finally {
      await page.mouse.up();
    }
    await expect
      .poll(() => indexHtml(page, designId), { timeout: 5_000 })
      .toContain("grid-column: 3 / 4");
    expect(
      (await childrenSnapshot(page, "explicit-grid")).map((child) => child.id),
    ).toEqual(["e1", "e2", "explicit-source", "e3"]);
    const persistedAfter = await indexHtml(page, designId);
    expect(
      persistedAfter.indexOf('data-agent-native-node-id="e2"'),
    ).toBeLessThan(
      persistedAfter.indexOf('data-agent-native-node-id="explicit-source"'),
    );

    await page.keyboard.down(MOD);
    await page.keyboard.press("z");
    await page.keyboard.up(MOD);
    await expect
      .poll(() => indexHtml(page, designId), { timeout: 5_000 })
      .not.toContain("grid-column: 3 / 4");
    await expect
      .poll(() =>
        preview(page)
          .locator('[data-agent-native-node-id="explicit-source"]')
          .evaluate((source) => source.parentElement?.tagName),
      )
      .toBe("BODY");
  } finally {
    await deleteDesign(page, designId);
  }
});

test("G-6 held transformed-grid drop uses a conservative line and retains the transform", async ({
  page,
}) => {
  const designId = await newDesign(page, GRID_TRANSFORM_ORACLE_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectNode(page, "transform-source");
    const t2 = (await node(page, "t2").boundingBox())!;
    await dragToHeldPoint(page, "transform-source", {
      x: t2.x + 4,
      y: t2.y + t2.height / 2,
    });
    try {
      const guide = await guideSnapshot(page);
      expect(guide).toMatchObject({ display: "block" });
      expect(Math.min(guide!.width, guide!.height)).toBeLessThan(10);
    } finally {
      await page.mouse.up();
    }
    await expect
      .poll(() => indexHtml(page, designId), { timeout: 5_000 })
      .toContain('data-agent-native-node-id="transform-source"');
    await openEditor(page, designId);
    const state = await preview(page)
      .locator("body")
      .evaluate(() => {
        const grid = document.querySelector(
          '[data-agent-native-node-id="transform-grid"]',
        ) as HTMLElement | null;
        const source = document.querySelector(
          '[data-agent-native-node-id="transform-source"]',
        ) as HTMLElement | null;
        return {
          parent: source?.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ),
          transform: grid ? getComputedStyle(grid).transform : "none",
          gridContains: !!grid && !!source && grid.contains(source),
        };
      });
    expect(state.parent).toBe("transform-grid");
    expect(state.transform).not.toBe("none");
    expect(state.gridContains).toBe(true);
  } finally {
    await deleteDesign(page, designId);
  }
});

test("G-7 held dense-grid drop avoids a reconstructed cell and preserves the span", async ({
  page,
}) => {
  const designId = await newDesign(page, GRID_DENSE_ORACLE_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectNode(page, "dense-source");
    const d2 = (await node(page, "d2").boundingBox())!;
    await dragToHeldPoint(page, "dense-source", {
      x: d2.x + 4,
      y: d2.y + d2.height / 2,
    });
    try {
      const guide = await guideSnapshot(page);
      expect(guide).toMatchObject({ display: "block" });
      expect(Math.min(guide!.width, guide!.height)).toBeLessThan(10);
    } finally {
      await page.mouse.up();
    }
    await expect
      .poll(() => indexHtml(page, designId), { timeout: 5_000 })
      .toContain('data-agent-native-node-id="dense-source"');
    await openEditor(page, designId);
    const state = await preview(page)
      .locator("body")
      .evaluate(() => {
        const span = document.querySelector(
          '[data-agent-native-node-id="d1"]',
        ) as HTMLElement | null;
        const source = document.querySelector(
          '[data-agent-native-node-id="dense-source"]',
        ) as HTMLElement | null;
        return {
          parent: source?.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ),
          span: span?.style.gridColumn,
          sourceCount: document.querySelectorAll(
            '[data-agent-native-node-id="dense-source"]',
          ).length,
        };
      });
    expect(state).toMatchObject({
      parent: "dense-grid",
      span: "1 / span 2",
      sourceCount: 1,
    });
  } finally {
    await deleteDesign(page, designId);
  }
});

test("G-8 held drop with an explicitly placed source keeps a line and projected peers stable", async ({
  page,
}) => {
  const designId = await newDesign(page, GRID_EXPLICIT_SOURCE_ORACLE_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectNode(page, "explicit-source");
    const peer1 = (await node(page, "explicit-peer-1").boundingBox())!;
    const peer1Before = await frameRectSnapshot(page, "explicit-peer-1");
    const peer2Before = await frameRectSnapshot(page, "explicit-peer-2");
    await dragToHeldPoint(page, "explicit-source", {
      x: peer1.x + peer1.width / 2,
      y: peer1.y + peer1.height / 2,
    });
    try {
      const guide = await guideSnapshot(page);
      expect(guide).toMatchObject({ display: "block" });
      expect(Math.min(guide!.width, guide!.height)).toBeLessThan(10);
      const peer1Held = await frameRectSnapshot(page, "explicit-peer-1");
      const peer2Held = await frameRectSnapshot(page, "explicit-peer-2");
      expect(Math.abs(peer1Held.left - peer1Before.left)).toBeLessThan(3);
      expect(Math.abs(peer1Held.top - peer1Before.top)).toBeLessThan(3);
      expect(Math.abs(peer2Held.left - peer2Before.left)).toBeLessThan(3);
      expect(Math.abs(peer2Held.top - peer2Before.top)).toBeLessThan(3);
    } finally {
      await page.mouse.up();
    }
    await expect
      .poll(() => indexHtml(page, designId), { timeout: 5_000 })
      .toContain('data-agent-native-node-id="explicit-source"');
    await openEditor(page, designId);
    const state = await preview(page)
      .locator("body")
      .evaluate(() => {
        const source = document.querySelector(
          '[data-agent-native-node-id="explicit-source"]',
        ) as HTMLElement | null;
        return {
          parent: source?.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ),
          sourceCount: document.querySelectorAll(
            '[data-agent-native-node-id="explicit-source"]',
          ).length,
          gridColumn: source?.style.gridColumn,
          gridRow: source?.style.gridRow,
        };
      });
    expect(state).toMatchObject({
      parent: "explicit-source-grid",
      sourceCount: 1,
      gridColumn: "1",
      gridRow: "1",
    });
  } finally {
    await deleteDesign(page, designId);
  }
});

test("G-9 held grid projection preserves authored sizing and self-alignment", async ({
  page,
}) => {
  const designId = await newDesign(page, GRID_INTRINSIC_SIZE_ORACLE_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectNode(page, "sized-source");
    const sourceBefore = await frameRectSnapshot(page, "sized-source");
    const gridFrame = await frameRectSnapshot(page, "intrinsic-grid");
    const grid = (await node(page, "intrinsic-grid").boundingBox())!;
    const scaleX = grid.width / 340;
    const scaleY = grid.height / 240;
    const target = {
      x: grid.x + (12 + 140 / 2) * scaleX,
      y: grid.y + (12 + 88 + 16 + 88 / 2) * scaleY,
    };
    await dragToHeldPoint(page, "sized-source", {
      x: target.x,
      y: target.y,
    });
    try {
      const guide = await guideSnapshot(page);
      const expectedLeft = gridFrame.left + 12 + 140 - sourceBefore.width;
      const expectedTop =
        gridFrame.top + 12 + 88 + 16 + 88 - sourceBefore.height;
      expect(guide).toMatchObject({ display: "block" });
      expect(Math.min(guide!.width, guide!.height)).toBeGreaterThan(10);
      expect(Math.abs(guide!.width - sourceBefore.width)).toBeLessThan(3);
      expect(Math.abs(guide!.height - sourceBefore.height)).toBeLessThan(3);
      expect(Math.abs(guide!.left - expectedLeft)).toBeLessThan(3);
      expect(Math.abs(guide!.top - expectedTop)).toBeLessThan(3);
    } finally {
      await page.mouse.up();
    }
    await expect
      .poll(() => indexHtml(page, designId), { timeout: 5_000 })
      .toContain('data-agent-native-node-id="sized-source"');
    await openEditor(page, designId);
    const state = await preview(page)
      .locator("body")
      .evaluate(() => {
        const source = document.querySelector(
          '[data-agent-native-node-id="sized-source"]',
        ) as HTMLElement | null;
        return {
          parent: source?.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ),
          sourceCount: document.querySelectorAll(
            '[data-agent-native-node-id="sized-source"]',
          ).length,
          width: source?.style.width,
          height: source?.style.height,
          minWidth: source?.style.minWidth,
          maxWidth: source?.style.maxWidth,
          alignSelf: source?.style.alignSelf,
          justifySelf: source?.style.justifySelf,
        };
      });
    expect(state).toMatchObject({
      parent: "intrinsic-grid",
      sourceCount: 1,
      width: "44px",
      height: "28px",
      minWidth: "44px",
      maxWidth: "44px",
      alignSelf: "end",
      justifySelf: "end",
    });
  } finally {
    await deleteDesign(page, designId);
  }
});

test("G-10 locked explicit grid children disable the projection shortcut", async ({
  page,
}) => {
  const designId = await newDesign(page, GRID_LOCKED_EXPLICIT_ORACLE_FIXTURE);
  try {
    await openEditor(page, designId);
    await selectNode(page, "locked-source");
    const peer2 = (await node(page, "locked-peer-2").boundingBox())!;
    await dragToHeldPoint(page, "locked-source", {
      x: peer2.x + 4,
      y: peer2.y + peer2.height / 2,
    });
    try {
      const guide = await guideSnapshot(page);
      expect(guide).toMatchObject({ display: "block" });
      expect(Math.min(guide!.width, guide!.height)).toBeLessThan(10);
    } finally {
      await page.mouse.up();
    }
    await expect
      .poll(() => indexHtml(page, designId), { timeout: 5_000 })
      .toContain('data-agent-native-node-id="locked-source"');
    await openEditor(page, designId);
    const state = await preview(page)
      .locator("body")
      .evaluate(() => {
        const grid = document.querySelector(
          '[data-agent-native-node-id="locked-grid"]',
        ) as HTMLElement | null;
        const locked = document.querySelector(
          '[data-agent-native-node-id="locked-span"]',
        ) as HTMLElement | null;
        const lockedImplicit = document.querySelector(
          '[data-agent-native-node-id="locked-implicit"]',
        ) as HTMLElement | null;
        const source = document.querySelector(
          '[data-agent-native-node-id="locked-source"]',
        ) as HTMLElement | null;
        return {
          parent: source?.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ),
          sourceCount: document.querySelectorAll(
            '[data-agent-native-node-id="locked-source"]',
          ).length,
          gridContains: !!grid && !!source && grid.contains(source),
          lockedColumn: locked?.style.gridColumn,
          lockedRow: locked?.style.gridRow,
          locked: locked?.getAttribute("data-agent-native-locked"),
          lockedImplicit: lockedImplicit?.getAttribute(
            "data-agent-native-locked",
          ),
          lockedImplicitParent: lockedImplicit?.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ),
        };
      });
    expect(state).toMatchObject({
      parent: "locked-grid",
      sourceCount: 1,
      gridContains: true,
      lockedColumn: "1 / span 2",
      lockedRow: "1",
      locked: "true",
      lockedImplicit: "true",
      lockedImplicitParent: "locked-grid",
    });
  } finally {
    await deleteDesign(page, designId);
  }
});
