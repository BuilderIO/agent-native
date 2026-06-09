import { test, expect, type Page, type APIResponse } from "@playwright/test";

/*
 * TOP-LEVEL SIDE-DROP → COLUMNS. Repro/verify for: "I see the blue line on the
 * left/right of a block but dropping does not create columns."
 *
 * Drags one TOP-LEVEL block onto the left/right side zone of another top-level
 * block and asserts a `columns` block is created wrapping both. Uses a non-
 * adjacent source so the side drop indicator is not nulled by the adjacency
 * guard (a drop on the immediate-neighbour seam shows no indicator by design).
 *
 * Captures the in-app `[coldrop]` diagnostics so a failure says WHERE handleDrop
 * bailed (placement / block resolution / applyColumnSideDrop).
 */

const CREATE_ACTION = "/_agent-native/actions/create-visual-plan";
const GET_ACTION = "/_agent-native/actions/get-visual-plan";

type PlanBlock = {
  id: string;
  type: string;
  data?: Record<string, unknown>;
};

async function readJson(res: APIResponse): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function createPlan(page: Page, blocks: PlanBlock[]): Promise<string> {
  const content = {
    version: 2,
    title: `Top-level column drop ${Date.now()}`,
    brief: "Side-drop fixture.",
    blocks,
  };
  let res: APIResponse | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    res = await page.request.post(CREATE_ACTION, {
      data: { title: content.title, brief: content.brief, content },
    });
    if (res.ok()) break;
    await page.waitForTimeout(800);
  }
  expect(res?.ok(), `create ok (${res?.status()})`).toBeTruthy();
  const body = await readJson(res as APIResponse);
  const planId =
    (body.planId as string | undefined) ??
    (body.plan as { id?: string } | undefined)?.id;
  expect(planId, "create returns id").toBeTruthy();
  return planId as string;
}

async function getBlocks(page: Page, planId: string): Promise<PlanBlock[]> {
  const res = await page.request.get(
    `${GET_ACTION}?id=${encodeURIComponent(planId)}`,
  );
  expect(res.ok(), `get ok (${res.status()})`).toBeTruthy();
  const body = await readJson(res);
  const plan = (body.plan ?? body) as { content?: { blocks?: PlanBlock[] } };
  return plan.content?.blocks ?? [];
}

function collectColumnChildIds(blocks: PlanBlock[]): string[][] {
  // Returns the child-id lists of every top-level columns block.
  return blocks
    .filter((b) => b.type === "columns")
    .map((b) => {
      const cols =
        (b.data as { columns?: { blocks?: PlanBlock[] }[] } | undefined)
          ?.columns ?? [];
      return cols.flatMap((c) => (c.blocks ?? []).map((cb) => cb.id));
    });
}

async function proseReady(page: Page) {
  const prose = page
    .locator(".plan-document-editor-surface .an-rich-md-prose")
    .first();
  await expect(prose).toBeVisible({ timeout: 25_000 });
  await expect(prose).toHaveAttribute("contenteditable", "true", {
    timeout: 15_000,
  });
  return prose;
}

/**
 * Drive a top-level side drop: hover the source block to bind its grip, press on
 * the grip, drag to the target block's left/right side band (vertical middle,
 * well inside the 28%/48px side zone), release.
 */
async function sideDrop(
  page: Page,
  sourceLocator: string,
  targetLocator: string,
  side: "left" | "right",
) {
  const source = page.locator(sourceLocator).first();
  const target = page.locator(targetLocator).first();
  await expect(source).toBeVisible({ timeout: 15_000 });
  await expect(target).toBeVisible({ timeout: 15_000 });
  await source.scrollIntoViewIfNeeded();
  await source.hover();

  const grip = page.locator(".drag-handle").first();
  await expect(grip).toBeVisible({ timeout: 8_000 });
  const g = await grip.boundingBox();
  const t = await target.boundingBox();
  expect(g && t, "grip + target boxes").toBeTruthy();
  if (!g || !t) return;

  // Land ~24px inside the chosen edge (inside the >=48px side zone), vertical mid.
  const xTarget = side === "right" ? t.x + t.width - 24 : t.x + 24;
  const yTarget = t.y + t.height / 2;

  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  // pass the drag threshold first
  await page.mouse.move(g.x + g.width / 2 + 8, g.y + g.height / 2 + 8, {
    steps: 4,
  });
  await page.mouse.move(xTarget, yTarget, { steps: 24 });
  // settle on the side band so the placement resolves to left/right
  await page.mouse.move(xTarget, yTarget, { steps: 6 });
  await page.waitForTimeout(120);
  await page.mouse.up();
}

/**
 * Drop the source onto a fractional point of the target (fx/fy in 0..1 of the
 * target's box) — used to prove that a NATURAL human release point (anywhere in
 * the outer third, at ANY height), not just the precise 24px-from-edge point,
 * builds columns. This is the regression guard for "I see the line but dropping
 * does nothing": the old activation zone was a thin edge sliver in the vertical
 * middle, so a human glimpsed the indicator then drifted out before releasing.
 */
async function dropAtFraction(
  page: Page,
  sourceLocator: string,
  targetLocator: string,
  fx: number,
  fy: number,
) {
  const source = page.locator(sourceLocator).first();
  const target = page.locator(targetLocator).first();
  await expect(source).toBeVisible({ timeout: 15_000 });
  await expect(target).toBeVisible({ timeout: 15_000 });
  await source.scrollIntoViewIfNeeded();
  await source.hover();

  const grip = page.locator(".drag-handle").first();
  await expect(grip).toBeVisible({ timeout: 8_000 });
  const g = await grip.boundingBox();
  const t = await target.boundingBox();
  expect(g && t, "grip + target boxes").toBeTruthy();
  if (!g || !t) return;

  const xTarget = t.x + t.width * fx;
  const yTarget = t.y + t.height * fy;

  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + 8, g.y + g.height / 2 + 8, {
    steps: 4,
  });
  await page.mouse.move(xTarget, yTarget, { steps: 24 });
  await page.mouse.move(xTarget, yTarget, { steps: 6 });
  await page.waitForTimeout(120);
  await page.mouse.up();
}

function blockNode(blockId: string): string {
  return `.plan-document-editor-surface .plan-block-node[data-block-id="${blockId}"]`;
}

test.describe("top-level side-drop creates columns", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (e) => {
      // eslint-disable-next-line no-console
      console.log("PAGEERROR", String(e).slice(0, 300));
    });
  });

  test("callout dropped on another callout's side wraps both in columns", async ({
    page,
  }) => {
    // intro + two callouts; drag the LAST callout onto the FIRST callout's left
    // (non-adjacent, so the side indicator is not nulled by the seam guard).
    const planId = await createPlan(page, [
      {
        id: "intro",
        type: "rich-text",
        data: { markdown: "Intro paragraph." },
      },
      { id: "alpha", type: "callout", data: { tone: "info", body: "ALPHA" } },
      { id: "beta", type: "callout", data: { tone: "info", body: "BETA" } },
    ]);
    await page.goto(`/plans/${planId}`);
    await proseReady(page);
    await expect(page.locator(blockNode("alpha"))).toBeVisible({
      timeout: 15_000,
    });

    await sideDrop(page, blockNode("beta"), blockNode("alpha"), "left");

    await expect
      .poll(
        async () => {
          const groups = collectColumnChildIds(await getBlocks(page, planId));
          return groups.some(
            (ids) => ids.includes("alpha") && ids.includes("beta"),
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    // CRITICAL: the columns must also RENDER in the live editor WITHOUT a reload.
    // The user looks at the screen — if data updates but the editor does not
    // repaint the new columns block, they perceive "dropping does not create
    // columns". Two side-by-side nested column regions must appear in place.
    await expect(
      page.locator(".plan-nested-document-editor-region"),
    ).toHaveCount(2, { timeout: 8_000 });
    await page.screenshot({
      path: "test-results/coldrop-live-render.png",
      fullPage: true,
    });
  });

  test("callout dropped on a rich-text block's side wraps both in columns", async ({
    page,
  }) => {
    const planId = await createPlan(page, [
      {
        id: "lead",
        type: "rich-text",
        data: { markdown: "LEADPARA drop beside me." },
      },
      { id: "mid", type: "callout", data: { tone: "info", body: "MIDDLE" } },
      { id: "tail", type: "callout", data: { tone: "info", body: "TAIL" } },
    ]);
    await page.goto(`/plans/${planId}`);
    await proseReady(page);
    await expect(page.locator(blockNode("tail"))).toBeVisible({
      timeout: 15_000,
    });

    // Drag the trailing callout onto the RIGHT side of the LEAD rich-text
    // paragraph specifically (not the whole prose surface, whose midpoint would
    // land on the middle block's adjacent seam).
    const leadPara =
      ".plan-document-editor-surface .an-rich-md-prose p:has-text('LEADPARA')";
    await sideDrop(page, blockNode("tail"), leadPara, "right");

    await expect
      .poll(
        async () => {
          const groups = collectColumnChildIds(await getBlocks(page, planId));
          return groups.some(
            (ids) => ids.includes("lead") && ids.includes("tail"),
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test("rich-text block dragged onto a callout's side wraps both in columns", async ({
    page,
  }) => {
    // Source is a RICH-TEXT (prose) block — exercises source-id resolution
    // through planBlockFromPmNode on a prose node, not a planBlock NodeView.
    const planId = await createPlan(page, [
      {
        id: "para",
        type: "rich-text",
        data: { markdown: "DRAGME paragraph source." },
      },
      { id: "c1", type: "callout", data: { tone: "info", body: "C-ONE" } },
      { id: "c2", type: "callout", data: { tone: "info", body: "C-TWO" } },
    ]);
    await page.goto(`/plans/${planId}`);
    await proseReady(page);
    await expect(page.locator(blockNode("c2"))).toBeVisible({
      timeout: 15_000,
    });

    // Drag the lead PARAGRAPH onto the LEFT side of the LAST callout (non-adjacent).
    const para =
      ".plan-document-editor-surface .an-rich-md-prose p:has-text('DRAGME')";
    await sideDrop(page, para, blockNode("c2"), "left");

    await expect
      .poll(
        async () => {
          const groups = collectColumnChildIds(await getBlocks(page, planId));
          return groups.some(
            (ids) => ids.includes("para") && ids.includes("c2"),
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test("structured IMAGE block dragged onto a block's side wraps both in columns", async ({
    page,
  }) => {
    // The real "Image hover demo" plan has a structured `image` block. This drives
    // an image block as the drag SOURCE. Kept to two blocks (anchor callout on top,
    // image directly below) so both stay on-screen — a tall image plus a distant
    // target would scroll the target out of view and the drop would have no target.
    const planId = await createPlan(page, [
      { id: "anchor", type: "callout", data: { tone: "info", body: "ANCHOR" } },
      {
        id: "pic",
        type: "image",
        data: {
          url: "https://picsum.photos/seed/structured/1200/640",
          alt: "Structured image block",
          fit: "cover",
        },
      },
    ]);
    await page.goto(`/plans/${planId}`);
    await proseReady(page);
    await expect(page.locator(blockNode("pic"))).toBeVisible({
      timeout: 15_000,
    });

    // Drag the image block onto the LEFT side of the anchor callout just above it.
    await sideDrop(page, blockNode("pic"), blockNode("anchor"), "left");

    await expect
      .poll(
        async () => {
          const groups = collectColumnChildIds(await getBlocks(page, planId));
          return groups.some(
            (ids) => ids.includes("pic") && ids.includes("anchor"),
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    await expect(
      page.locator(".plan-nested-document-editor-region"),
    ).toHaveCount(2, { timeout: 8_000 });
    await page.screenshot({
      path: "test-results/image-block-columns.png",
      fullPage: true,
    });
  });

  test("ADJACENT side-drop (facing seam) still creates columns", async ({
    page,
  }) => {
    // Regression for "side drop works sometimes": dropping a block onto the
    // facing edge of its IMMEDIATE neighbour used to be nulled by the adjacency
    // guard, so half of all side drops between two blocks silently did nothing.
    const planId = await createPlan(page, [
      { id: "a", type: "callout", data: { tone: "info", body: "A" } },
      { id: "b", type: "callout", data: { tone: "info", body: "B" } },
    ]);
    await page.goto(`/plans/${planId}`);
    await proseReady(page);
    await expect(page.locator(blockNode("b"))).toBeVisible({ timeout: 15_000 });

    // Drag B onto A's RIGHT edge — A and B are adjacent (the previously-dead case).
    await sideDrop(page, blockNode("b"), blockNode("a"), "right");

    await expect
      .poll(
        async () => {
          const groups = collectColumnChildIds(await getBlocks(page, planId));
          return groups.some((ids) => ids.includes("a") && ids.includes("b"));
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test("blocks inside the RIGHT column show their own grip (not the left block's)", async ({
    page,
  }) => {
    // Regression for "no grip dots on right-column blocks": the left column's
    // forgiving side zone used to win the hover, so the grip appeared for the
    // left block. Hovering a right-column block must reveal a grip near THAT
    // block (in the inter-column gap), not back in the far-left page gutter.
    const planId = await createPlan(page, [
      {
        id: "cols",
        type: "columns",
        data: {
          columns: [
            {
              id: "colL",
              blocks: [
                {
                  id: "L",
                  type: "callout",
                  data: { tone: "info", body: "LEFT" },
                },
              ],
            },
            {
              id: "colR",
              blocks: [
                {
                  id: "R",
                  type: "callout",
                  data: { tone: "info", body: "RIGHT" },
                },
              ],
            },
          ],
        },
      },
    ]);
    await page.goto(`/plans/${planId}`);
    await proseReady(page);
    const rightBlock = page
      .locator(
        '.plan-nested-document-editor-region[data-region-id="colR"] .plan-block-node[data-block-id="R"]',
      )
      .first();
    await expect(rightBlock).toBeVisible({ timeout: 15_000 });

    await rightBlock.hover();
    const grip = page.locator(".drag-handle").first();
    await expect(grip).toBeVisible({ timeout: 8_000 });

    // The grip must sit just left of the RIGHT block (its gap), well right of the
    // page's left gutter — proving it belongs to the right-column block.
    const g = await grip.boundingBox();
    const r = await rightBlock.boundingBox();
    const surface = await page
      .locator(".plan-document-editor-surface")
      .first()
      .boundingBox();
    expect(g && r && surface).toBeTruthy();
    if (!g || !r || !surface) return;
    // Grip is near the right block's left edge (within ~40px), not at page gutter.
    expect(g.x).toBeGreaterThan(surface.x + 60);
    expect(g.x).toBeLessThan(r.x);
    expect(r.x - g.x).toBeLessThan(48);
  });

  test("NATURAL drop over the right THIRD (not the edge) creates columns", async ({
    page,
  }) => {
    // The core regression for "I see the line but dropping does nothing": a human
    // releases over the block's body (~70% across), not the precise 24px edge the
    // other tests use. With the old thin edge zone that resolved to a reorder; the
    // widened, full-height side zone must now build columns from this natural drop.
    const planId = await createPlan(page, [
      { id: "intro", type: "rich-text", data: { markdown: "Intro." } },
      { id: "alpha", type: "callout", data: { tone: "info", body: "ALPHA" } },
      { id: "beta", type: "callout", data: { tone: "info", body: "BETA" } },
    ]);
    await page.goto(`/plans/${planId}`);
    await proseReady(page);
    await expect(page.locator(blockNode("alpha"))).toBeVisible({
      timeout: 15_000,
    });

    // Drop BETA at 72% of ALPHA's width, vertical middle — squarely in the body,
    // far from the edge, the point a natural "drag beside" gesture lands on.
    await dropAtFraction(
      page,
      blockNode("beta"),
      blockNode("alpha"),
      0.72,
      0.5,
    );

    await expect
      .poll(
        async () => {
          const groups = collectColumnChildIds(await getBlocks(page, planId));
          return groups.some(
            (ids) => ids.includes("alpha") && ids.includes("beta"),
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await expect(
      page.locator(".plan-nested-document-editor-region"),
    ).toHaveCount(2, { timeout: 8_000 });
  });

  test("NATURAL drop near the TOP edge of the side region still creates columns", async ({
    page,
  }) => {
    // The side zone now spans the FULL block height — dropping high (10% down)
    // inside the left third must build columns, where the old middle-60%-only band
    // would have reordered.
    const planId = await createPlan(page, [
      { id: "intro", type: "rich-text", data: { markdown: "Intro." } },
      { id: "alpha", type: "callout", data: { tone: "info", body: "ALPHA" } },
      { id: "beta", type: "callout", data: { tone: "info", body: "BETA" } },
    ]);
    await page.goto(`/plans/${planId}`);
    await proseReady(page);
    await expect(page.locator(blockNode("alpha"))).toBeVisible({
      timeout: 15_000,
    });

    // Drop BETA at the LEFT third (15% across) but high up (10% down).
    await dropAtFraction(
      page,
      blockNode("beta"),
      blockNode("alpha"),
      0.15,
      0.1,
    );

    await expect
      .poll(
        async () => {
          const groups = collectColumnChildIds(await getBlocks(page, planId));
          return groups.some(
            (ids) => ids.includes("alpha") && ids.includes("beta"),
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test("dropping over the CENTER reorders and does NOT create columns", async ({
    page,
  }) => {
    // The middle band must stay a before/after reorder so columns don't hijack a
    // plain move — proof the widened side zones still leave a reorder lane.
    const planId = await createPlan(page, [
      { id: "intro", type: "rich-text", data: { markdown: "Intro." } },
      { id: "alpha", type: "callout", data: { tone: "info", body: "ALPHA" } },
      { id: "beta", type: "callout", data: { tone: "info", body: "BETA" } },
    ]);
    await page.goto(`/plans/${planId}`);
    await proseReady(page);
    await expect(page.locator(blockNode("alpha"))).toBeVisible({
      timeout: 15_000,
    });

    // Drop BETA dead-centre of ALPHA — should reorder, never wrap in columns.
    await dropAtFraction(page, blockNode("beta"), blockNode("alpha"), 0.5, 0.5);

    // Give the editor time to settle, then assert NO columns block was created.
    await page.waitForTimeout(1500);
    const blocks = await getBlocks(page, planId);
    expect(blocks.some((b) => b.type === "columns")).toBe(false);
  });

  test("dragging a NON-FIRST paragraph of a multi-paragraph text block moves the WHOLE block into a column", async ({
    page,
  }) => {
    // Regression for the silent text-side-drop failure: a rich-text block expands
    // to a run of prose nodes and only the FIRST carries runId, so the 2nd/3rd
    // paragraph resolved to a fresh id the columns tree couldn't find and the drop
    // no-op'd. Resolving by position now maps any paragraph to its whole block.
    const planId = await createPlan(page, [
      {
        id: "para",
        type: "rich-text",
        data: { markdown: "PARA one line.\n\nPARA two line." },
      },
      { id: "sep", type: "callout", data: { tone: "info", body: "sep" } },
      { id: "anchor", type: "callout", data: { tone: "info", body: "ANCHOR" } },
    ]);
    await page.goto(`/plans/${planId}`);
    await proseReady(page);
    await expect(page.locator(blockNode("anchor"))).toBeVisible({
      timeout: 15_000,
    });

    // Source is the SECOND paragraph (no runId) of the multi-paragraph block.
    const para2 = ".plan-document-editor-surface p:has-text('PARA two line')";
    await dropAtFraction(page, para2, blockNode("anchor"), 0.72, 0.5);

    await expect
      .poll(
        async () => {
          const groups = collectColumnChildIds(await getBlocks(page, planId));
          // The whole `para` block (both paragraphs) must land in the column.
          return groups.some(
            (ids) => ids.includes("para") && ids.includes("anchor"),
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test("dropping a structured block onto a NON-FIRST paragraph of a text block creates columns", async ({
    page,
  }) => {
    // The same position-resolution gap on the TARGET side (not text-specific):
    // dropping a callout onto a text block's 2nd paragraph used to fail because
    // the target resolved to a fresh id not in the tree.
    const planId = await createPlan(page, [
      { id: "c", type: "callout", data: { tone: "info", body: "DRAGME" } },
      { id: "sep", type: "callout", data: { tone: "info", body: "sep" } },
      {
        id: "txt",
        type: "rich-text",
        data: { markdown: "TXT one line.\n\nTXT two line." },
      },
    ]);
    await page.goto(`/plans/${planId}`);
    await proseReady(page);
    await expect(page.locator(blockNode("c"))).toBeVisible({ timeout: 15_000 });

    // Target is the SECOND paragraph of the text block.
    const txt2 = ".plan-document-editor-surface p:has-text('TXT two line')";
    await dropAtFraction(page, blockNode("c"), txt2, 0.72, 0.5);

    await expect
      .poll(
        async () => {
          const groups = collectColumnChildIds(await getBlocks(page, planId));
          return groups.some((ids) => ids.includes("c") && ids.includes("txt"));
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test("created columns STAY rendered across a poll cycle (no revert glitch)", async ({
    page,
  }) => {
    // Regression for "drop works, then undoes, then a second or two later goes
    // back": the optimistic cache write must keep the new layout authoritative so
    // the lagging get-visual-plan poll (3s) never reverts it during the save
    // window. Sample the rendered region count continuously across a FULL poll
    // cycle — it must never dip below 2 (a dip is the revert flicker).
    const planId = await createPlan(page, [
      { id: "intro", type: "rich-text", data: { markdown: "Intro." } },
      { id: "alpha", type: "callout", data: { tone: "info", body: "ALPHA" } },
      { id: "beta", type: "callout", data: { tone: "success", body: "BETA" } },
    ]);
    await page.goto(`/plans/${planId}`);
    await proseReady(page);
    await expect(page.locator(blockNode("alpha"))).toBeVisible({
      timeout: 15_000,
    });

    await dropAtFraction(
      page,
      blockNode("beta"),
      blockNode("alpha"),
      0.72,
      0.5,
    );

    const regions = page.locator(".plan-nested-document-editor-region");
    await expect(regions).toHaveCount(2, { timeout: 8_000 });

    // Sample continuously for ~4.2s (past the 3s poll + the ~600ms save window).
    const counts: number[] = [];
    for (let i = 0; i < 28; i += 1) {
      counts.push(await regions.count());
      await page.waitForTimeout(150);
    }
    expect(
      Math.min(...counts),
      `region count dipped (revert flicker): [${counts.join(",")}]`,
    ).toBe(2);

    // And the columns are persisted, not rolled back.
    const groups = collectColumnChildIds(await getBlocks(page, planId));
    expect(
      groups.some((ids) => ids.includes("alpha") && ids.includes("beta")),
    ).toBe(true);
  });
});
