import { test, expect, type Page, type APIResponse } from "@playwright/test";

/*
 * DEEP column drag coverage — "behave like Notion":
 *  - make columns from ANY pair of top-level blocks (side drop), adjacent or not
 *  - drag a top-level block INTO an existing column (side drop) → adds a column
 *  - drag a block OUT of a column to the document (vertical drop)
 *  - drag a block BETWEEN columns (vertical drop into another region)
 *  - drag a column block onto another block's side → make more columns
 *  - grip is present on blocks in every column
 *
 * Cross-region (vertical) moves go through the DragHandle's own transfer path,
 * which is the historically-flaky one — these tests pin its real behavior.
 */

const CREATE = "/_agent-native/actions/create-visual-plan";
const GET = "/_agent-native/actions/get-visual-plan";

type Block = { id: string; type: string; data?: Record<string, unknown> };

async function readJson(res: APIResponse) {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function createPlan(page: Page, blocks: Block[]): Promise<string> {
  let res: APIResponse | null = null;
  for (let i = 0; i < 4; i += 1) {
    res = await page.request.post(CREATE, {
      data: {
        title: `Col manip ${Date.now()}`,
        brief: "x",
        content: { version: 2, title: "Col manip", brief: "x", blocks },
      },
    });
    if (res.ok()) break;
    await page.waitForTimeout(700);
  }
  expect(res?.ok(), `create ok ${res?.status()}`).toBeTruthy();
  const b = await readJson(res as APIResponse);
  return ((b.planId as string) ?? (b.plan as { id?: string })?.id) as string;
}

type Tree = { id: string; type: string; data?: any }[];
async function getBlocks(page: Page, planId: string): Promise<Tree> {
  const res = await page.request.get(`${GET}?id=${encodeURIComponent(planId)}`);
  const b = await readJson(res);
  const plan = (b.plan ?? b) as { content?: { blocks?: Tree } };
  return plan.content?.blocks ?? [];
}

/** Where does block `id` live? "top" | "col:<columnsId>" | null */
function locate(blocks: Tree, id: string): string | null {
  for (const b of blocks) {
    if (b.id === id) return "top";
  }
  for (const b of blocks) {
    if (b.type === "columns") {
      for (const col of b.data?.columns ?? []) {
        for (const cb of col.blocks ?? []) {
          if (cb.id === id) return `col:${b.id}`;
          if (cb.type === "columns") {
            // nested columns unlikely, ignore
          }
        }
      }
    }
  }
  return null;
}

function columnsOf(blocks: Tree): { id: string; childIds: string[][] }[] {
  return blocks
    .filter((b) => b.type === "columns")
    .map((b) => ({
      id: b.id,
      childIds: (b.data?.columns ?? []).map((c: any) =>
        (c.blocks ?? []).map((cb: any) => cb.id),
      ),
    }));
}

async function proseReady(page: Page) {
  const prose = page
    .locator(".plan-document-editor-surface .an-rich-md-prose")
    .first();
  await expect(prose).toBeVisible({ timeout: 25_000 });
  await expect(prose).toHaveAttribute("contenteditable", "true", {
    timeout: 15_000,
  });
}

const topNode = (id: string) =>
  `.plan-document-editor-surface .plan-block-node[data-block-id="${id}"]`;
const colNode = (regionId: string, blockId: string) =>
  `.plan-nested-document-editor-region[data-region-id="${regionId}"] .plan-block-node[data-block-id="${blockId}"]`;

/** Grab the grip that appears for `sourceSel` and return its center + the source box. */
async function grabGrip(page: Page, sourceSel: string) {
  const source = page.locator(sourceSel).first();
  await expect(source).toBeVisible({ timeout: 15_000 });
  await source.scrollIntoViewIfNeeded();
  const box = await source.boundingBox();
  expect(box, "source box").toBeTruthy();
  // Hover near the source's LEFT content (where its grip resolves), not the
  // element center — a center hover on a wide block can resolve a different
  // editor, and a nested flush-left block shares its container's gutter.
  const hoverX = box!.x + Math.min(30, box!.width / 2);
  const hoverY = box!.y + box!.height / 2;
  await page.mouse.move(hoverX, hoverY);
  await page.waitForTimeout(80);
  await page.mouse.move(hoverX + 1, hoverY);
  await page.waitForTimeout(160);
  // Several grips can be visible (container + columns); pick the one on the
  // SOURCE's row, not DOM-order `.first()`, so we drag the intended block.
  const grips = page.locator(".drag-handle:visible");
  await expect(grips.first()).toBeVisible({ timeout: 8_000 });
  const count = await grips.count();
  let best: { x: number; y: number; width: number; height: number } | null =
    null;
  let bestDy = Infinity;
  for (let i = 0; i < count; i += 1) {
    const g = await grips.nth(i).boundingBox();
    if (!g) continue;
    const dy = Math.abs(g.y + g.height / 2 - hoverY);
    if (dy < bestDy) {
      bestDy = dy;
      best = g;
    }
  }
  expect(best, "grip box").toBeTruthy();
  return best!;
}

async function pressAndMove(
  page: Page,
  grip: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
) {
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  // Cross the >4px threshold so the drag session actually begins, then let it
  // settle before steering to the target.
  await page.mouse.move(
    grip.x + grip.width / 2 + 8,
    grip.y + grip.height / 2 + 8,
    { steps: 4 },
  );
  await page.waitForTimeout(40);
  await page.mouse.move(x, y, { steps: 22 });
  // Two stationary passes so the final drop target (and its indicator) resolve
  // before the caller releases — the drop reads the LAST resolved target.
  await page.mouse.move(x, y, { steps: 6 });
  await page.waitForTimeout(120);
  await page.mouse.move(x, y);
  await page.waitForTimeout(120);
}

/** Side drop: drop on the left/right edge of `targetSel` to make/extend columns. */
async function sideDrop(
  page: Page,
  sourceSel: string,
  targetSel: string,
  side: "left" | "right",
) {
  const grip = await grabGrip(page, sourceSel);
  const t = await page.locator(targetSel).first().boundingBox();
  expect(t).toBeTruthy();
  const x = side === "right" ? t!.x + t!.width - 22 : t!.x + 22;
  await pressAndMove(page, grip, x, t!.y + t!.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

/** Vertical move: drop just above/below `targetSel` (before/after) — moves a block. */
async function verticalMove(
  page: Page,
  sourceSel: string,
  targetSel: string,
  where: "above" | "below",
) {
  const grip = await grabGrip(page, sourceSel);
  const t = await page.locator(targetSel).first().boundingBox();
  expect(t).toBeTruthy();
  // Aim at the very top (above) or very bottom (below) so placement resolves to
  // before/after, and use the target's horizontal center.
  const x = t!.x + t!.width / 2;
  const y = where === "above" ? t!.y + 4 : t!.y + t!.height - 4;
  await pressAndMove(page, grip, x, y);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

test.describe("column manipulation (Notion-like)", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (e) =>
      // eslint-disable-next-line no-console
      console.log("PAGEERROR", String(e).slice(0, 300)),
    );
  });

  // ---- 1) MAKE COLUMNS from any pair (side drop), non-adjacent + adjacent ----
  for (const c of [
    {
      name: "callout→callout",
      a: { id: "a", type: "callout", data: { body: "A" } },
      b: { id: "b", type: "callout", data: { body: "B" } },
      side: "left" as const,
    },
    {
      name: "richtext→callout",
      a: { id: "a", type: "rich-text", data: { markdown: "AAA para" } },
      b: { id: "b", type: "callout", data: { body: "B" } },
      side: "right" as const,
    },
    {
      name: "image→callout",
      a: {
        id: "a",
        type: "image",
        data: { url: "https://picsum.photos/seed/m1/600/300", alt: "x" },
      },
      b: { id: "b", type: "callout", data: { body: "B" } },
      side: "left" as const,
    },
  ]) {
    test(`make columns: ${c.name} (non-adjacent side drop)`, async ({
      page,
    }) => {
      // spacer between a and b so they are non-adjacent
      const planId = await createPlan(page, [
        c.a,
        { id: "spacer", type: "callout", data: { body: "spacer" } },
        c.b,
      ]);
      await page.goto(`/plans/${planId}`);
      await proseReady(page);
      const aSel =
        c.a.type === "rich-text"
          ? `.plan-document-editor-surface .an-rich-md-prose p:has-text('AAA para')`
          : topNode("a");
      await sideDrop(page, aSel, topNode("b"), c.side);
      await expect
        .poll(
          async () => {
            const groups = columnsOf(await getBlocks(page, planId)).flatMap(
              (c2) => c2.childIds.flat(),
            );
            return groups.includes("a") && groups.includes("b");
          },
          { timeout: 15_000 },
        )
        .toBe(true);
    });
  }

  test("make columns: ADJACENT facing seam", async ({ page }) => {
    const planId = await createPlan(page, [
      { id: "a", type: "callout", data: { body: "A" } },
      { id: "b", type: "callout", data: { body: "B" } },
    ]);
    await page.goto(`/plans/${planId}`);
    await proseReady(page);
    await sideDrop(page, topNode("b"), topNode("a"), "right");
    await expect
      .poll(
        async () => {
          const g = columnsOf(await getBlocks(page, planId)).flatMap((c) =>
            c.childIds.flat(),
          );
          return g.includes("a") && g.includes("b");
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  // ---- 2) top-level block INTO an existing column (side drop) → adds a column
  test("drag a top-level block onto a column block's side → adds a column", async ({
    page,
  }) => {
    const planId = await createPlan(page, [
      { id: "loose", type: "callout", data: { body: "LOOSE" } },
      {
        id: "cols",
        type: "columns",
        data: {
          columns: [
            {
              id: "cL",
              blocks: [{ id: "L1", type: "callout", data: { body: "L1" } }],
            },
            {
              id: "cR",
              blocks: [{ id: "R1", type: "callout", data: { body: "R1" } }],
            },
          ],
        },
      },
    ]);
    await page.goto(`/plans/${planId}`);
    await proseReady(page);
    await expect(page.locator(colNode("cL", "L1"))).toBeVisible({
      timeout: 15_000,
    });
    // Drop loose onto the LEFT edge of L1 → new column before cL inside `cols`.
    await sideDrop(page, topNode("loose"), colNode("cL", "L1"), "left");
    await expect
      .poll(async () => locate(await getBlocks(page, planId), "loose"), {
        timeout: 15_000,
      })
      .toBe("col:cols");
  });

  // ---- 3) drag a block OUT of a column to the document (vertical move) ----
  test("drag a column block OUT to the top-level document", async ({
    page,
  }) => {
    const planId = await createPlan(page, [
      { id: "anchor", type: "callout", data: { body: "ANCHOR" } },
      {
        id: "cols",
        type: "columns",
        data: {
          columns: [
            {
              id: "cL",
              blocks: [
                { id: "L1", type: "callout", data: { body: "L1" } },
                { id: "L2", type: "callout", data: { body: "L2" } },
              ],
            },
            {
              id: "cR",
              blocks: [{ id: "R1", type: "callout", data: { body: "R1" } }],
            },
          ],
        },
      },
    ]);
    await page.goto(`/plans/${planId}`);
    await proseReady(page);
    await expect(page.locator(colNode("cL", "L1"))).toBeVisible({
      timeout: 15_000,
    });
    // Drag L1 out, dropping ABOVE the top-level anchor → L1 becomes top-level.
    await verticalMove(page, colNode("cL", "L1"), topNode("anchor"), "above");
    await expect
      .poll(async () => locate(await getBlocks(page, planId), "L1"), {
        timeout: 15_000,
      })
      .toBe("top");
  });

  // ---- 4) drag a block BETWEEN columns (vertical move into other region) ----
  test("drag a block from one column into another column", async ({ page }) => {
    const planId = await createPlan(page, [
      {
        id: "cols",
        type: "columns",
        data: {
          columns: [
            {
              id: "cL",
              blocks: [
                { id: "L1", type: "callout", data: { body: "L1" } },
                { id: "L2", type: "callout", data: { body: "L2" } },
              ],
            },
            {
              id: "cR",
              blocks: [{ id: "R1", type: "callout", data: { body: "R1" } }],
            },
          ],
        },
      },
    ]);
    await page.goto(`/plans/${planId}`);
    await proseReady(page);
    await expect(page.locator(colNode("cR", "R1"))).toBeVisible({
      timeout: 15_000,
    });
    // Drag L2 into the right column, below R1.
    await verticalMove(page, colNode("cL", "L2"), colNode("cR", "R1"), "below");
    await expect
      .poll(
        async () => {
          const cols = columnsOf(await getBlocks(page, planId));
          const c = cols.find((x) => x.id === "cols");
          // L2 should now be in the RIGHT column (the one containing R1).
          const right = c?.childIds.find((ids) => ids.includes("R1"));
          return Boolean(right?.includes("L2"));
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  // ---- 5) grip present on blocks in EVERY column ----
  test("every column block exposes its own grip", async ({ page }) => {
    const planId = await createPlan(page, [
      {
        id: "cols",
        type: "columns",
        data: {
          columns: [
            {
              id: "cL",
              blocks: [{ id: "L1", type: "callout", data: { body: "L1" } }],
            },
            {
              id: "cM",
              blocks: [{ id: "M1", type: "callout", data: { body: "M1" } }],
            },
            {
              id: "cR",
              blocks: [{ id: "R1", type: "callout", data: { body: "R1" } }],
            },
          ],
        },
      },
    ]);
    await page.goto(`/plans/${planId}`);
    await proseReady(page);
    for (const [region, block] of [
      ["cL", "L1"],
      ["cM", "M1"],
      ["cR", "R1"],
    ] as const) {
      const node = page.locator(colNode(region, block)).first();
      await expect(node).toBeVisible({ timeout: 15_000 });
      await node.hover();
      await page.waitForTimeout(150);
      const grip = page.locator(".drag-handle:visible").first();
      await expect(grip, `grip visible for ${block}`).toBeVisible({
        timeout: 6_000,
      });
      const g = await grip.boundingBox();
      const n = await node.boundingBox();
      // grip sits just left of the block it belongs to (within ~48px), not far away.
      expect(g && n).toBeTruthy();
      expect(n!.x - g!.x, `grip near ${block}`).toBeLessThan(56);
      expect(n!.x - g!.x).toBeGreaterThan(-4);
    }
  });
});
