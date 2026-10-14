import { parse } from "parse5";

import {
  indexHtml,
  newDesign,
  node,
  openEditor,
  postAction,
  setBaseURL,
} from "./drag-and-drop.shared";
import { expect, expectOnlyChanged, test, type App } from "./rails";

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({}, testInfo) => {
  setBaseURL(testInfo);
});

const GROUPED_GRID_FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Grouped grid drop</title></head>
<body style="margin:0;width:1200px;height:700px;background:#f8fafc">
  <section data-agent-native-node-id="source-group" data-agent-native-layer-name="Source group"
    style="position:absolute;left:60px;top:120px;width:260px;height:180px;padding:12px;display:grid;grid-template-columns:repeat(2,100px);grid-template-rows:repeat(2,60px);gap:12px;background:#e2e8f0;box-sizing:border-box">
    <div data-agent-native-node-id="source-a" data-agent-native-layer-name="Source A" style="grid-column:1 / span 2;grid-row:1;background:#6366f1">A</div>
    <div data-agent-native-node-id="source-b" data-agent-native-layer-name="Source B" style="grid-column:1 / span 2;grid-row:2;background:#a855f7">B</div>
  </section>
  <section data-agent-native-node-id="target-grid" data-agent-native-layer-name="Target grid"
    style="position:absolute;left:500px;top:100px;width:560px;height:360px;padding:16px;display:grid;grid-template-columns:repeat(4,100px);grid-template-rows:repeat(3,72px);gap:16px;background:#e0e7ff;box-sizing:border-box">
    <div data-agent-native-node-id="occupied-a" data-agent-native-layer-name="Occupied A" style="grid-column:1 / span 2;grid-row:1;background:#f59e0b">OA</div>
    <div data-agent-native-node-id="occupied-b" data-agent-native-layer-name="Occupied B" style="grid-column:3 / span 2;grid-row:1;background:#22c55e">OB</div>
    <div data-agent-native-node-id="occupied-c" data-agent-native-layer-name="Occupied C" style="grid-column:4;grid-row:3;background:#ef4444">OC</div>
    <div data-agent-native-node-id="occupied-d" data-agent-native-layer-name="Occupied D" style="grid-column:2;grid-row:3;background:#14b8a6">OD</div>
  </section>
</body></html>`;

function preview(page: Parameters<typeof node>[0]) {
  return page
    .locator(
      "iframe[data-agent-native-preview-iframe], iframe[data-design-preview-iframe]",
    )
    .first()
    .contentFrame();
}

async function stylePlacement(page: Parameters<typeof node>[0], id: string) {
  return preview(page)
    .locator(`[data-agent-native-node-id="${id}"]`)
    .evaluate((element) => {
      const style = getComputedStyle(element as HTMLElement);
      const rect = element.getBoundingClientRect();
      return {
        column: style.gridColumn,
        row: style.gridRow,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      };
    });
}

async function persistedTargetGridOrder(
  page: Parameters<typeof node>[0],
  designId: string,
) {
  const html = await indexHtml(page, designId);
  type Node = {
    attrs?: Array<{ name: string; value: string }>;
    childNodes?: Node[];
  };
  const find = (node: Node): Node | undefined =>
    node.attrs?.some(
      ({ name, value }) =>
        name === "data-agent-native-node-id" && value === "target-grid",
    )
      ? node
      : node.childNodes?.flatMap((child) => find(child) ?? [])[0];
  return (find(parse(html) as Node)?.childNodes ?? [])
    .map(
      (child) =>
        child.attrs?.find(({ name }) => name === "data-agent-native-node-id")
          ?.value,
    )
    .filter((id): id is string => Boolean(id));
}

function overlaps(
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
) {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}

test("grouped span-2 grid drop previews without overlap and persists undo/redo placement", async ({
  app,
  page,
}) => {
  const designId = await app.seed(GROUPED_GRID_FIXTURE);
  await openEditor(page, designId);
  const sourceA = node(page, "source-a");
  const sourceARow = page.getByRole("treeitem", { name: /Source A/ });
  const sourceBRow = page.getByRole("treeitem", { name: /Source B/ });
  await sourceARow.click();
  await sourceBRow.click({ modifiers: ["Shift"] });
  await expect(sourceARow).toHaveAttribute("aria-selected", "true");
  await expect(sourceBRow).toHaveAttribute("aria-selected", "true");

  const occupiedA = (await node(page, "occupied-a").boundingBox())!;
  const occupiedB = (await node(page, "occupied-b").boundingBox())!;
  const occupiedC = (await node(page, "occupied-c").boundingBox())!;
  const dropPoint = {
    x: occupiedB.x + occupiedB.width / 4, // Third column of the span-2 row.
    y: (occupiedA.y + occupiedA.height + occupiedC.y) / 2, // Second row.
  };
  const dragToGrid = async () => {
    const sourceBox = (await sourceA.boundingBox())!;
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2 + 12,
      sourceBox.y + sourceBox.height / 2 + 8,
      { steps: 6 },
    );
    await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 24 });
  };
  const originalHtml = await indexHtml(page, designId);
  await dragToGrid();

  const heldA = await stylePlacement(page, "source-a");
  const heldB = await stylePlacement(page, "source-b");
  const heldOccupiedB = await stylePlacement(page, "occupied-b");
  const heldOccupiedC = await stylePlacement(page, "occupied-c");
  expect(heldA.column).toMatch(/3\s*\/\s*5/);
  expect(heldA.row).toMatch(/2\s*\/\s*3/);
  expect(heldB.column).toMatch(/3\s*\/\s*5/);
  expect(heldB.row).toMatch(/3\s*\/\s*4/);
  expect(heldOccupiedC.row).not.toBe("3");
  expect(overlaps(heldA, heldB)).toBe(false);
  expect(overlaps(heldA, heldOccupiedB)).toBe(false);
  expect(overlaps(heldA, heldOccupiedC)).toBe(false);
  expect(overlaps(heldB, heldOccupiedB)).toBe(false);
  expect(overlaps(heldB, heldOccupiedC)).toBe(false);
  await expect(
    preview(page).locator("[data-agent-native-insertion-guide]"),
  ).toBeVisible();
  expect(await indexHtml(page, designId)).toBe(originalHtml);

  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await indexHtml(page, designId)).toBe(originalHtml);
  expect(await stylePlacement(page, "source-a")).toMatchObject({
    column: "1 / span 2",
    row: "1",
  });
  expect(await stylePlacement(page, "occupied-c")).toMatchObject({
    column: "4",
    row: "3",
  });
  await sourceARow.click();
  await sourceBRow.click({ modifiers: ["Shift"] });
  await dragToGrid();

  await page.mouse.up();
  await expect
    .poll(() => indexHtml(page, designId), { timeout: 10_000 })
    .toMatch(
      /data-agent-native-node-id="source-a"[^>]*style="[^"]*grid-column:\s*3\s*\/\s*5/i,
    );

  const persisted = await indexHtml(page, designId);
  expect(persisted).toMatch(
    /data-agent-native-node-id="source-a"[^>]*style="[^"]*grid-column:\s*3\s*\/\s*5/i,
  );
  expect(persisted).toMatch(
    /data-agent-native-node-id="source-b"[^>]*style="[^"]*grid-column:\s*3\s*\/\s*5/i,
  );

  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(() => indexHtml(page, designId), { timeout: 10_000 })
    .toMatch(
      /data-agent-native-node-id="source-a"[^>]*grid-column:\s*1\s*\/\s*span\s*2/i,
    );
  const undone = await indexHtml(page, designId);
  expect(undone).toMatch(
    /data-agent-native-node-id="source-b"[^>]*grid-column:\s*1\s*\/\s*span\s*2/i,
  );
  expect(undone).toMatch(
    /data-agent-native-node-id="occupied-c"[^>]*grid-column:\s*4(?:;|")/i,
  );
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect
    .poll(() => indexHtml(page, designId), { timeout: 10_000 })
    .toMatch(
      /data-agent-native-node-id="source-a"[^>]*grid-column:\s*3\s*\/\s*5/i,
    );
  const redone = await indexHtml(page, designId);
  expect(redone).toMatch(
    /data-agent-native-node-id="source-b"[^>]*grid-column:\s*3\s*\/\s*5/i,
  );
  expect(redone).toMatch(
    /data-agent-native-node-id="occupied-c"[^>]*grid-column:\s*1\s*\/\s*2/i,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  const afterReloadA = await stylePlacement(page, "source-a");
  const afterReloadB = await stylePlacement(page, "source-b");
  expect(afterReloadA.column).toMatch(/3\s*\/\s*5/);
  expect(afterReloadB.column).toMatch(/3\s*\/\s*5/);
});

function childrenOf(
  nodes: Map<string, { parent: string | null; index: number }>,
  parent: string,
) {
  return [...nodes.entries()]
    .filter(([, node]) => node.parent === parent)
    .sort(([, a], [, b]) => a.index - b.index)
    .map(([id]) => id);
}

const TARGET_GRID_ITEMS = [
  "source-a",
  "source-b",
  "occupied-a",
  "occupied-b",
  "occupied-c",
  "occupied-d",
];

/** Rendered boxes of the target grid's items, in design pixels. */
async function targetGridBoxes(app: App) {
  const boxes: Record<
    string,
    { left: number; top: number; right: number; bottom: number }
  > = {};
  for (const id of TARGET_GRID_ITEMS) {
    const { x, y, width, height } = await app.designRect(id);
    boxes[id] = { left: x, top: y, right: x + width, bottom: y + height };
  }
  return boxes;
}

// fixme: product bug: Displaced Occupied A is pushed outside the 4 explicit columns: rendered at x 980-1044 (64px wide, a sliver) instead of keeping a 216px
test.fixme("dropping a two-item group on an occupied grid cell keeps every item inside the 4×3 grid without overlap, and undo, redo and reload agree", async ({
  app,
  page,
}) => {
  const designId = await app.seed(GROUPED_GRID_FIXTURE);
  await openEditor(page, designId);
  await page.getByRole("treeitem", { name: /Source A/ }).click();
  await page
    .getByRole("treeitem", { name: /Source B/ })
    .click({ modifiers: ["Shift"] });
  expect(await app.selectedLayers()).toEqual(["Source B", "Source A"]);
  const before = await app.savedNodes(designId);
  const occupiedA = (await app.node("occupied-a").boundingBox())!;
  const sourceBox = (await app.node("source-a").boundingBox())!;

  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2 + 12,
    sourceBox.y + sourceBox.height / 2 + 8,
    { steps: 6 },
  );
  await page.mouse.move(
    occupiedA.x + occupiedA.width / 2,
    occupiedA.y + occupiedA.height / 2,
    {
      steps: 24,
    },
  );
  await expect
    .poll(() => stylePlacement(page, "source-a"))
    .toMatchObject({ column: "1 / 3", row: "1 / 2" });
  await page.mouse.up();
  await app.settled();

  const dropped = await app.savedNodes(designId);
  expect(childrenOf(dropped, "target-grid")).toEqual(TARGET_GRID_ITEMS);
  expect(childrenOf(dropped, "source-group")).toEqual([]);
  const boxes = await targetGridBoxes(app);
  const gridContent = { left: 516, top: 116, right: 964, bottom: 364 };
  const outside = Object.entries(boxes)
    .filter(
      ([, box]) =>
        box.left < gridContent.left - 1 ||
        box.top < gridContent.top - 1 ||
        box.right > gridContent.right + 1 ||
        box.bottom > gridContent.bottom + 1,
    )
    .map(([id, box]) => `${id} at ${JSON.stringify(box)}`);
  expect(
    outside,
    "items pushed outside the 4 explicit columns or 3 rows",
  ).toEqual([]);
  const overlapping = TARGET_GRID_ITEMS.flatMap((a, i) =>
    TARGET_GRID_ITEMS.slice(i + 1)
      .filter((b) => overlaps(boxes[a]!, boxes[b]!))
      .map((b) => `${a}+${b}`),
  );
  expect(overlapping).toEqual([]);
  expect(
    boxes["occupied-a"]!.right - boxes["occupied-a"]!.left,
    "Occupied A keeps its 2-column span",
  ).toBe(216);

  await page.keyboard.press("ControlOrMeta+z");
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(designId), []);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await app.settled();
  expectOnlyChanged(dropped, await app.savedNodes(designId), []);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect.poll(() => targetGridBoxes(app)).toEqual(boxes);
});
