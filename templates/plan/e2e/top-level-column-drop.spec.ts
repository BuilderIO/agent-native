import { test, expect, type Page, type APIResponse } from "@playwright/test";


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

  const xTarget = side === "right" ? t.x + t.width - 24 : t.x + 24;
  const yTarget = t.y + t.height / 2;

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
    const planId = await createPlan(page, [
      { id: "a", type: "callout", data: { tone: "info", body: "A" } },
      { id: "b", type: "callout", data: { tone: "info", body: "B" } },
    ]);
    await page.goto(`/plans/${planId}`);
    await proseReady(page);
    await expect(page.locator(blockNode("b"))).toBeVisible({ timeout: 15_000 });

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

    const g = await grip.boundingBox();
    const r = await rightBlock.boundingBox();
    const surface = await page
      .locator(".plan-document-editor-surface")
      .first()
      .boundingBox();
    expect(g && r && surface).toBeTruthy();
    if (!g || !r || !surface) return;
    expect(g.x).toBeGreaterThan(surface.x + 60);
    expect(g.x).toBeLessThan(r.x);
    expect(r.x - g.x).toBeLessThan(48);
  });

  test("NATURAL drop over the right THIRD (not the edge) creates columns", async ({
    page,
  }) => {
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

    await dropAtFraction(page, blockNode("beta"), blockNode("alpha"), 0.5, 0.5);

    await page.waitForTimeout(1500);
    const blocks = await getBlocks(page, planId);
    expect(blocks.some((b) => b.type === "columns")).toBe(false);
  });

  test("dragging a NON-FIRST paragraph of a multi-paragraph text block moves the WHOLE block into a column", async ({
    page,
  }) => {
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

    const para2 = ".plan-document-editor-surface p:has-text('PARA two line')";
    await dropAtFraction(page, para2, blockNode("anchor"), 0.72, 0.5);

    await expect
      .poll(
        async () => {
          const groups = collectColumnChildIds(await getBlocks(page, planId));
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

    const counts: number[] = [];
    for (let i = 0; i < 28; i += 1) {
      counts.push(await regions.count());
      await page.waitForTimeout(150);
    }
    expect(
      Math.min(...counts),
      `region count dipped (revert flicker): [${counts.join(",")}]`,
    ).toBe(2);

    const groups = collectColumnChildIds(await getBlocks(page, planId));
    expect(
      groups.some((ids) => ids.includes("alpha") && ids.includes("beta")),
    ).toBe(true);
  });
});
