import { expect, test } from "@playwright/test";
import { parse } from "parse5";

import {
  indexHtml,
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

async function deleteDesign(
  page: Parameters<typeof postAction>[0],
  id: string,
) {
  await postAction(page, "delete-design", { id }).catch(() => {});
}

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
  page,
}) => {
  const designId = await newDesign(page, GROUPED_GRID_FIXTURE);
  try {
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
  } finally {
    await deleteDesign(page, designId);
  }
});

test("grouped occupied-cell drop preserves child order through Apply, undo, redo, and reload", async ({
  page,
}) => {
  const designId = await newDesign(page, GROUPED_GRID_FIXTURE);
  try {
    await openEditor(page, designId);
    const sourceA = node(page, "source-a");
    await page.getByRole("treeitem", { name: /Source A/ }).click();
    await page
      .getByRole("treeitem", { name: /Source B/ })
      .click({ modifiers: ["Shift"] });
    await expect(
      page.getByRole("treeitem", { name: /Source A/ }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("treeitem", { name: /Source B/ }),
    ).toHaveAttribute("aria-selected", "true");
    await preview(page)
      .locator("body")
      .evaluate(() => {
        const parent = window.parent as Window & { __gridMoves?: unknown };
        parent.__gridMoves = null;
        parent.addEventListener("message", (event) => {
          if (event.data?.type === "visual-grid-group-change")
            parent.__gridMoves = event.data.moves;
        });
      });
    await preview(page)
      .locator("body")
      .evaluate(() =>
        window.postMessage(
          { type: "set-grid-group-batching-enabled", enabled: true },
          "*",
        ),
      );
    await preview(page)
      .locator("body")
      .evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    const occupiedA = (await node(page, "occupied-a").boundingBox())!;
    const sourceBox = (await sourceA.boundingBox())!;
    const dragToOccupied = async () => {
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
        { steps: 24 },
      );
    };
    await dragToOccupied();
    await expect
      .poll(() => stylePlacement(page, "source-a"))
      .toMatchObject({ column: "1 / 3", row: "1 / 2" });
    const liveOrder = async () =>
      preview(page)
        .locator(
          '[data-agent-native-node-id="target-grid"] > [data-agent-native-node-id]',
        )
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("data-agent-native-node-id")),
        );
    await page.mouse.up();
    await expect
      .poll(
        () =>
          preview(page)
            .locator("body")
            .evaluate(
              () =>
                (
                  (window.parent as Window & { __gridMoves?: unknown[] })
                    .__gridMoves ?? []
                ).length,
            ),
        { timeout: 10_000 },
      )
      .toBe(2);
    expect(
      await preview(page)
        .locator("body")
        .evaluate(() =>
          (
            window.parent as Window & {
              __gridMoves?: Array<{
                persistenceAnchorSourceId?: string;
                persistencePlacement?: string;
              }>;
            }
          ).__gridMoves?.map((move) => [
            move.persistenceAnchorSourceId,
            move.persistencePlacement,
          ]),
        ),
    ).toEqual([
      ["occupied-a", "before"],
      ["source-a", "after"],
    ]);
    await expect
      .poll(async () => (await liveOrder()).slice(0, 3), { timeout: 10_000 })
      .toEqual(["source-a", "source-b", "occupied-a"]);
    const placementAfterDrop = await Promise.all(
      ["source-a", "source-b", "occupied-a", "occupied-b"].map((id) =>
        stylePlacement(page, id),
      ),
    );

    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(() => persistedTargetGridOrder(page, designId), { timeout: 10_000 })
      .toEqual(["occupied-a", "occupied-b", "occupied-c", "occupied-d"]);
    await expect
      .poll(async () => (await liveOrder()).slice(-4, -1), { timeout: 10_000 })
      .toEqual(["occupied-a", "occupied-b", "occupied-c"]);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect
      .poll(async () => (await liveOrder()).slice(0, 3), { timeout: 10_000 })
      .toEqual(["source-a", "source-b", "occupied-a"]);
    await expect
      .poll(async () =>
        Promise.all(
          ["source-a", "source-b", "occupied-a", "occupied-b"].map((id) =>
            stylePlacement(page, id),
          ),
        ),
      )
      .toEqual(placementAfterDrop);
    await expect
      .poll(() => persistedTargetGridOrder(page, designId), { timeout: 10_000 })
      .toEqual([
        "source-a",
        "source-b",
        "occupied-a",
        "occupied-b",
        "occupied-c",
        "occupied-d",
      ]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(() => persistedTargetGridOrder(page, designId), { timeout: 10_000 })
      .toEqual([
        "source-a",
        "source-b",
        "occupied-a",
        "occupied-b",
        "occupied-c",
        "occupied-d",
      ]);
    await expect
      .poll(async () => (await liveOrder()).slice(0, 3), { timeout: 10_000 })
      .toEqual(["source-a", "source-b", "occupied-a"]);
  } finally {
    await deleteDesign(page, designId);
  }
});
