import { test, expect, type Page, type APIResponse } from "@playwright/test";

const CREATE_ACTION = "/_agent-native/actions/create-visual-plan";
const GET_ACTION = "/_agent-native/actions/get-visual-plan";
const UPDATE_ACTION = "/_agent-native/actions/update-visual-plan";

type PlanBlock = {
  id: string;
  type: string;
  title?: string;
  editable?: boolean;
  data?: Record<string, unknown>;
};

type PlanContentInput = {
  version: number;
  title?: string;
  brief?: string;
  blocks: PlanBlock[];
};

function uniqueTitle(label: string): string {
  return `DragMenu ${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function readJson(res: APIResponse): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function createPlanFixture(
  page: Page,
  content: PlanContentInput,
): Promise<string> {
  let res: APIResponse | null = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    res = await page.request.post(CREATE_ACTION, {
      data: { title: content.title, brief: content.brief, content },
    });
    if (res.ok()) break;
    await page.waitForTimeout(800);
  }
  expect(
    res?.ok(),
    `create-visual-plan should succeed (status ${res?.status()}): ${await (
      res as APIResponse
    )
      .text()
      .catch(() => "")}`,
  ).toBeTruthy();
  const body = await readJson(res as APIResponse);
  const planId =
    (body.planId as string | undefined) ??
    (body.plan as { id?: string } | undefined)?.id;
  expect(
    planId,
    `create-visual-plan returns a plan id: ${JSON.stringify(body).slice(0, 300)}`,
  ).toBeTruthy();
  return planId as string;
}

async function getPlanBlocks(page: Page, planId: string): Promise<PlanBlock[]> {
  const res = await page.request.get(
    `${GET_ACTION}?id=${encodeURIComponent(planId)}`,
  );
  expect(res.ok(), `get-visual-plan ok (status ${res.status()})`).toBeTruthy();
  const body = await readJson(res);
  const plan = (body.plan ?? body) as { content?: { blocks?: PlanBlock[] } };
  return plan.content?.blocks ?? [];
}

function proseFor(page: Page) {
  return page
    .locator(".plan-document-editor-surface .an-rich-md-prose")
    .first();
}

async function openPlanForEditing(page: Page, planId: string) {
  await page.goto(`/plans/${planId}`);
  const prose = proseFor(page);
  await expect(prose).toBeVisible({ timeout: 25_000 });
  await expect(prose).toHaveAttribute("contenteditable", "true", {
    timeout: 15_000,
  });
  return prose;
}

function blockNode(page: Page, blockId: string) {
  return page.locator(
    `.plan-document-editor-surface .plan-block-node[data-block-id="${blockId}"]`,
  );
}

function grip(page: Page) {
  return page.locator(".plan-document-editor .drag-handle").first();
}

function blockMenu(page: Page) {
  return page.locator(".an-rich-md-drag-menu");
}

function menuItem(page: Page, label: string) {
  return blockMenu(page)
    .locator(".an-rich-md-drag-menu__item")
    .filter({ hasText: new RegExp(`^${label}$`) });
}

/**
 * Hover a target block until the SINGLE shared grip is both visible AND
 * repositioned onto THAT block, then return it.
 *
 * The DragHandle plugin keeps exactly one `.drag-handle` element and moves it on a
 * global mousemove to the hovered top-level block, anchoring its top to
 * `block.rect.top - wrapperRect.top + 2` (DragHandle.ts `showHandleForBlock`).
 * Because the wrapper is the grip's positioned offset parent, the grip's viewport
 * `top` lands at `block top + 2`. A bare `toBeVisible()` is NOT enough here: when
 * the menu test moves between the FIRST and the LAST block, the grip can already
 * be visible at the *previous* block's y, so visibility passes while the grip
 * still targets the wrong node — clicking it would then open/Delete the wrong
 * block. Hovering the block's bounding-box center and waiting for the grip to
 * realign to this block's top (within a couple px) defeats that shared-grip race.
 */
async function revealGripFor(page: Page, target: ReturnType<typeof blockNode>) {
  await expect(target).toBeVisible({ timeout: 20_000 });
  const g = grip(page);
  await expect(async () => {
    await target.hover();
    await expect(g).toBeVisible({ timeout: 1_500 });
    const gripBox = await g.boundingBox();
    const blockBox = await target.boundingBox();
    expect(gripBox, "grip has a bounding box").not.toBeNull();
    expect(blockBox, "block has a bounding box").not.toBeNull();
    expect(
      Math.abs(gripBox!.y - blockBox!.y),
      "grip top is anchored to the hovered block top",
    ).toBeLessThanOrEqual(6);
  }).toPass({ timeout: 15_000 });
  return g;
}

async function clickGripOpenMenu(page: Page, g: ReturnType<typeof grip>) {
  await g.click();
  await expect(blockMenu(page)).toBeVisible({ timeout: 8_000 });
}

test.describe("drag-handle single-click block menu", () => {
  test("hovering a block reveals the left-margin drag grip", async ({
    page,
  }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("hover-grip"),
      brief: "Drag grip hover fixture.",
      blocks: [
        {
          id: "rt-seed",
          type: "rich-text",
          editable: true,
          data: { markdown: "Hover me to reveal the grip." },
        },
        {
          id: "cal-one",
          type: "callout",
          data: { tone: "info", body: "A callout block to hover." },
        },
      ],
    });
    await openPlanForEditing(page, planId);

    await expect(grip(page)).toBeHidden();

    const g = await revealGripFor(page, blockNode(page, "cal-one"));
    await expect(g).toBeVisible();

    await expect(g).toHaveAttribute("role", "button");
    await expect(g).toHaveAttribute("aria-haspopup", "menu");
  });

  test("single-click on the grip opens a popover menu with Duplicate, Delete, Insert block below", async ({
    page,
  }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("open-menu"),
      brief: "Block menu open fixture.",
      blocks: [
        {
          id: "rt-seed",
          type: "rich-text",
          editable: true,
          data: { markdown: "Paragraph above the callout." },
        },
        {
          id: "cal-target",
          type: "callout",
          data: { tone: "info", body: "Menu target callout." },
        },
      ],
    });
    await openPlanForEditing(page, planId);

    const g = await revealGripFor(page, blockNode(page, "cal-target"));
    await clickGripOpenMenu(page, g);

    const menu = blockMenu(page);
    await expect(menu).toHaveAttribute("role", "menu");
    await expect(g).toHaveAttribute("aria-expanded", "true");

    const items = menu.locator(".an-rich-md-drag-menu__item");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveText("Duplicate");
    await expect(items.nth(1)).toHaveText("Delete");
    await expect(items.nth(2)).toHaveText("Insert block below");
    for (let i = 0; i < 3; i += 1) {
      await expect(items.nth(i)).toHaveAttribute("role", "menuitem");
    }
    await expect(items.nth(1)).toHaveAttribute("data-danger", "true");
  });

  test('"Insert block below" inserts an empty focused paragraph you can immediately type "/" into', async ({
    page,
  }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("insert-below"),
      brief: "Insert-block-below fixture.",
      blocks: [
        {
          id: "rt-seed",
          type: "rich-text",
          editable: true,
          data: { markdown: "Anchor paragraph for insert-below." },
        },
        {
          id: "cal-anchor",
          type: "callout",
          data: { tone: "info", body: "Insert below this callout." },
        },
      ],
    });
    await openPlanForEditing(page, planId);

    const g = await revealGripFor(page, blockNode(page, "cal-anchor"));
    await clickGripOpenMenu(page, g);

    await menuItem(page, "Insert block below").click();
    await expect(blockMenu(page)).toHaveCount(0, { timeout: 5_000 });

    await page.keyboard.type("/", { delay: 20 });
    await expect(page.locator(".an-rich-md-slash-menu")).toBeVisible({
      timeout: 8_000,
    });

    await page.keyboard.type("callout", { delay: 20 });
    await expect(
      page
        .locator(".an-rich-md-slash-menu .an-rich-md-slash-title")
        .filter({ hasText: "Callout" }),
    ).toHaveCount(1, { timeout: 8_000 });
  });

  test("Duplicate clones the block (two instances of the same callout)", async ({
    page,
  }) => {
    const uniqueBody = `DUPME-${Date.now()}`;
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("duplicate"),
      brief: "Duplicate-block fixture.",
      blocks: [
        {
          id: "rt-seed",
          type: "rich-text",
          editable: true,
          data: { markdown: "Paragraph above the duplicatable callout." },
        },
        {
          id: "cal-dup",
          type: "callout",
          data: { tone: "info", body: uniqueBody },
        },
      ],
    });
    await openPlanForEditing(page, planId);

    const calloutByBody = page
      .locator(".plan-document-editor-surface .plan-block-node")
      .filter({ hasText: uniqueBody });
    await expect(calloutByBody).toHaveCount(1, { timeout: 20_000 });

    const okSave = page.waitForResponse(
      (r) =>
        r.url().includes(UPDATE_ACTION) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20_000 },
    );

    const g = await revealGripFor(page, blockNode(page, "cal-dup"));
    await clickGripOpenMenu(page, g);
    await menuItem(page, "Duplicate").click();
    await expect(blockMenu(page)).toHaveCount(0, { timeout: 5_000 });

    await expect(calloutByBody).toHaveCount(2, { timeout: 10_000 });

    await okSave;
    await expect
      .poll(
        async () =>
          (await getPlanBlocks(page, planId)).filter(
            (b) => b.type === "callout",
          ).length,
        { timeout: 15_000 },
      )
      .toBe(2);
  });

  test("Delete removes the block from the document and persisted content", async ({
    page,
  }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("delete"),
      brief: "Delete-block fixture.",
      blocks: [
        {
          id: "rt-seed",
          type: "rich-text",
          editable: true,
          data: { markdown: "Keep this paragraph; delete the callout below." },
        },
        {
          id: "cal-del",
          type: "callout",
          data: { tone: "info", body: "Delete this callout." },
        },
      ],
    });
    await openPlanForEditing(page, planId);

    await expect(blockNode(page, "cal-del")).toBeVisible({ timeout: 20_000 });
    expect(
      (await getPlanBlocks(page, planId)).some((b) => b.id === "cal-del"),
    ).toBe(true);

    const okSave = page.waitForResponse(
      (r) =>
        r.url().includes(UPDATE_ACTION) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20_000 },
    );

    const g = await revealGripFor(page, blockNode(page, "cal-del"));
    await clickGripOpenMenu(page, g);
    await menuItem(page, "Delete").click();
    await expect(blockMenu(page)).toHaveCount(0, { timeout: 5_000 });

    await expect(blockNode(page, "cal-del")).toHaveCount(0, {
      timeout: 10_000,
    });

    await okSave;
    await expect
      .poll(
        async () =>
          (await getPlanBlocks(page, planId)).some((b) => b.id === "cal-del"),
        { timeout: 15_000 },
      )
      .toBe(false);
    expect(
      (await getPlanBlocks(page, planId)).some((b) => b.id === "rt-seed"),
    ).toBe(true);
  });

  test("a real drag-to-reorder moves the block and does NOT open the menu", async ({
    page,
  }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("drag-not-menu"),
      brief: "Drag bypasses menu fixture.",
      blocks: [
        {
          id: "rt-top",
          type: "rich-text",
          editable: true,
          data: { markdown: "ALPHA top paragraph." },
        },
        {
          id: "cal-move",
          type: "callout",
          data: { tone: "info", body: "Drag me above the paragraph." },
        },
      ],
    });
    const prose = await openPlanForEditing(page, planId);

    const before = await getPlanBlocks(page, planId);
    expect(before[0]?.type).toBe("rich-text");
    expect(before[1]?.type).toBe("callout");

    const g = await revealGripFor(page, blockNode(page, "cal-move"));
    const gripBox = await g.boundingBox();
    const proseBox = await prose.boundingBox();
    expect(gripBox && proseBox).toBeTruthy();

    const okSave = page.waitForResponse(
      (r) =>
        r.url().includes(UPDATE_ACTION) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20_000 },
    );

    await page.mouse.move(
      gripBox!.x + gripBox!.width / 2,
      gripBox!.y + gripBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(proseBox!.x + 40, proseBox!.y + 6, { steps: 14 });
    await page.mouse.up();

    await expect(blockMenu(page)).toHaveCount(0);

    await okSave;
    await expect
      .poll(async () => (await getPlanBlocks(page, planId))[0]?.type, {
        timeout: 15_000,
      })
      .toBe("callout");
    const after = await getPlanBlocks(page, planId);
    expect(after.find((b) => b.id === "cal-move")).toBeTruthy();
    expect(after.find((b) => b.id === "rt-top")).toBeTruthy();
  });

  test("Escape closes the open block menu and reorders nothing", async ({
    page,
  }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("escape"),
      brief: "Escape-closes-menu fixture.",
      blocks: [
        {
          id: "rt-seed",
          type: "rich-text",
          editable: true,
          data: { markdown: "Paragraph above the escapable menu." },
        },
        {
          id: "cal-esc",
          type: "callout",
          data: { tone: "info", body: "Open then escape this menu." },
        },
      ],
    });
    await openPlanForEditing(page, planId);

    const before = await getPlanBlocks(page, planId);

    const g = await revealGripFor(page, blockNode(page, "cal-esc"));
    await clickGripOpenMenu(page, g);
    await expect(blockMenu(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(blockMenu(page)).toHaveCount(0, { timeout: 5_000 });
    await expect(g).toHaveAttribute("aria-expanded", "false");

    const after = await getPlanBlocks(page, planId);
    expect(after.map((b) => b.id)).toEqual(before.map((b) => b.id));
    expect(after.map((b) => b.type)).toEqual(before.map((b) => b.type));
  });

  test("the menu works on the FIRST and the LAST block", async ({ page }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("first-last"),
      brief: "First/last block menu fixture.",
      blocks: [
        {
          id: "cal-first",
          type: "callout",
          data: { tone: "info", body: "FIRST block callout." },
        },
        {
          id: "rt-mid",
          type: "rich-text",
          editable: true,
          data: { markdown: "Middle paragraph." },
        },
        {
          id: "cal-last",
          type: "callout",
          data: { tone: "warning", body: "LAST block callout." },
        },
      ],
    });
    await openPlanForEditing(page, planId);

    const gFirst = await revealGripFor(page, blockNode(page, "cal-first"));
    await clickGripOpenMenu(page, gFirst);
    await expect(
      blockMenu(page).locator(".an-rich-md-drag-menu__item"),
    ).toHaveCount(3);
    await page.keyboard.press("Escape");
    await expect(blockMenu(page)).toHaveCount(0, { timeout: 5_000 });

    const gLast = await revealGripFor(page, blockNode(page, "cal-last"));
    await clickGripOpenMenu(page, gLast);
    const items = blockMenu(page).locator(".an-rich-md-drag-menu__item");
    await expect(items).toHaveCount(3);

    const okSave = page.waitForResponse(
      (r) =>
        r.url().includes(UPDATE_ACTION) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20_000 },
    );
    await menuItem(page, "Delete").click();
    await expect(blockMenu(page)).toHaveCount(0, { timeout: 5_000 });
    await expect(blockNode(page, "cal-last")).toHaveCount(0, {
      timeout: 10_000,
    });

    await okSave;
    await expect
      .poll(
        async () =>
          (await getPlanBlocks(page, planId)).map((b) => b.id).join(","),
        { timeout: 15_000 },
      )
      .toBe("cal-first,rt-mid");
  });
});
