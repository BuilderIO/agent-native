import { test, expect, type Page, type APIResponse } from "@playwright/test";

/*
 * SINGLE-CLICK DRAG-HANDLE POPOVER MENU — interactive E2E.
 *
 * Area under test: the NEW left-margin drag-grip block menu in the shared
 * RichMarkdownEditor's `DragHandle` ProseMirror plugin
 * (packages/toolkit/src/editor/DragHandle.ts), driven inside the
 * single-document plan editor (PlanDocumentEditor / SharedRichEditor). The whole
 * plan body is ONE ProseMirror doc; its editable surface is `.an-rich-md-prose`
 * inside `.plan-document-editor-surface`, and that surface lives inside the
 * `.plan-document-editor` wrapper the grip is anchored to. Custom blocks render as
 * inline `planBlock` NodeViews (`.plan-block-node[data-block-id]`).
 *
 * The grip (`.drag-handle`) appears on hover in the left margin. It is BOTH a drag
 * source and a button:
 *   - A real DRAG (mousedown → move past ~4px → mouseup over another block)
 *     reorders the block and does NOT open the menu.
 *   - A SINGLE CLICK (mousedown → mouseup with no movement) opens a popover block
 *     menu — a `.an-rich-md-drag-menu` element (role="menu", appended to
 *     <body>) carrying three `.an-rich-md-drag-menu__item` buttons (role="menuitem")
 *     in DOM order: "Duplicate", "Delete", "Insert block below".
 *   - "Insert block below" inserts an empty focused paragraph; the caret lands in
 *     it, so typing "/" immediately opens the slash menu (`.an-rich-md-slash-menu`).
 *   - Escape closes the menu.
 *
 * Exact item labels/roles/DOM-order are pinned by DragHandle.spec.ts (the unit
 * test) and by DragHandle.ts `openMenu()` (Duplicate / Delete / Insert block
 * below). slash-insert-drag.spec.ts already covers ONE drag-reorder via the grip
 * and slash-insert; this file owns the NEW single-click MENU affordance and only
 * re-asserts drag-reorder to prove a real drag still bypasses the menu.
 *
 * Asserts CORRECT behavior; a FAILING assertion IS the bug it reports. The shared
 * dev server may HMR mid-run, so specs use web-first auto-retrying expects and
 * avoid fixed sleeps where a wait-for works. retries:2 is configured globally.
 */

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

/** Create a fresh plan fixture via the authed action surface; return its id. */
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

/** Read the current stored blocks for order/count/type assertions. */
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

/** Open the plan and wait for the editable single-document surface to be ready. */
async function openPlanForEditing(page: Page, planId: string) {
  await page.goto(`/plans/${planId}`);
  const prose = proseFor(page);
  await expect(prose).toBeVisible({ timeout: 25_000 });
  await expect(prose).toHaveAttribute("contenteditable", "true", {
    timeout: 15_000,
  });
  return prose;
}

/** The inline `planBlock` NodeView wrapper for a given stored block id. */
function blockNode(page: Page, blockId: string) {
  return page.locator(
    `.plan-document-editor-surface .plan-block-node[data-block-id="${blockId}"]`,
  );
}

/**
 * The left-margin drag grip. The DragHandle plugin appends ONE `.drag-handle`
 * element to the `.plan-document-editor` wrapper (the top-level editor's wrapper
 * selector is `.plan-document-editor`). These fixtures carry no nested editor
 * regions, so a single grip exists; scope to the top wrapper + `.first()` for
 * resilience anyway.
 *
 * Selector risk: if the plan editor's wrapper class or the grip class
 * (`.drag-handle`) changes, this and the hover affordance break — both are read
 * from DragHandle.ts / PlanDocumentEditor.tsx (WRAPPER_CLASS="plan-document-editor").
 */
function grip(page: Page) {
  return page.locator(".plan-document-editor .drag-handle").first();
}

/** The popover block menu (role="menu", appended to <body>). */
function blockMenu(page: Page) {
  return page.locator(".an-rich-md-drag-menu");
}

/** A single block-menu item by its visible label (role="menuitem" button). */
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
    // Hover the block's own center so the plugin's hover handler picks THIS block
    // (first/last blocks sit at the document edges; their center is always inside
    // the forgiving hover zone).
    await target.hover();
    await expect(g).toBeVisible({ timeout: 1_500 });
    const gripBox = await g.boundingBox();
    const blockBox = await target.boundingBox();
    expect(gripBox, "grip has a bounding box").not.toBeNull();
    expect(blockBox, "block has a bounding box").not.toBeNull();
    // The grip has snapped to THIS block (top anchored at block.top + ~2px), not a
    // previously-hovered block.
    expect(
      Math.abs(gripBox!.y - blockBox!.y),
      "grip top is anchored to the hovered block top",
    ).toBeLessThanOrEqual(6);
  }).toPass({ timeout: 15_000 });
  return g;
}

/**
 * Single-click the grip WITHOUT moving the mouse, so the DragHandle treats it as a
 * menu click (mousedown → mouseup, hypot movement 0 ≤ 4px threshold) rather than a
 * drag, and opens the block menu. Playwright's `.click()` issues mousedown+mouseup
 * at the same point, which is exactly the no-movement "click" the plugin keys on.
 */
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

    // Before any hover the grip is hidden (display:none / not visible).
    await expect(grip(page)).toBeHidden();

    // Hovering the callout block reveals the grip in the left margin.
    const g = await revealGripFor(page, blockNode(page, "cal-one"));
    await expect(g).toBeVisible();

    // The grip is a button affordance (role=button, opens a menu) — not a plain
    // decoration. Pinned from DragHandle.ts createHandle().
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
    // The grip reflects the open state for assistive tech.
    await expect(g).toHaveAttribute("aria-expanded", "true");

    // EXACTLY three items in DOM order — pinned by DragHandle.spec.ts.
    const items = menu.locator(".an-rich-md-drag-menu__item");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveText("Duplicate");
    await expect(items.nth(1)).toHaveText("Delete");
    await expect(items.nth(2)).toHaveText("Insert block below");
    // Each is a real menuitem button.
    for (let i = 0; i < 3; i += 1) {
      await expect(items.nth(i)).toHaveAttribute("role", "menuitem");
    }
    // The Delete item is flagged destructive (data-danger) — leaf-level detail
    // that distinguishes it from the additive actions.
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
    // The menu closes after acting.
    await expect(blockMenu(page)).toHaveCount(0, { timeout: 5_000 });

    // The caret lands in the freshly-inserted empty paragraph, so typing "/" with
    // NO extra navigation opens the slash menu — the proof that the new block is
    // focused and empty (a "/" at the start of an empty line triggers the menu).
    await page.keyboard.type("/", { delay: 20 });
    await expect(page.locator(".an-rich-md-slash-menu")).toBeVisible({
      timeout: 8_000,
    });

    // Sanity: typing a query narrows the menu (the inserted block is a real
    // editable paragraph, not a read-only artifact).
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

    // Count callouts by their unique body text — the CalloutBlock renderer shows
    // `data.body` verbatim via PlanMarkdownReader (it does NOT emit a
    // data-block-type attribute, only data-block-id + data-tone), so the body is
    // the reliable per-instance fingerprint. Exactly one before duplicating.
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

    // The block is cloned in the document: TWO NodeViews now carry the same body.
    await expect(calloutByBody).toHaveCount(2, { timeout: 10_000 });

    // The duplicate autosaves; the persisted content gains a second callout.
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

    // Sanity: the callout exists in both DOM and storage to start.
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

    // The NodeView is gone from the live document.
    await expect(blockNode(page, "cal-del")).toHaveCount(0, {
      timeout: 10_000,
    });

    // And the deletion persists: no callout block remains in storage; the
    // rich-text seed survives (delete removes only the targeted block).
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

    // Initial order: [rich-text, callout].
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

    // A real drag: press on the grip, move WELL past the ~4px threshold up to the
    // very top of the document, release before the first prose block.
    await page.mouse.move(
      gripBox!.x + gripBox!.width / 2,
      gripBox!.y + gripBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(proseBox!.x + 40, proseBox!.y + 6, { steps: 14 });
    await page.mouse.up();

    // The drag must NOT have opened the block menu (a drag and a menu-click are
    // mutually exclusive: movement > 4px => drag, not menu).
    await expect(blockMenu(page)).toHaveCount(0);

    // The reorder committed: the callout is now the FIRST block; ids preserved.
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
    // The grip reflects the collapsed state again.
    await expect(g).toHaveAttribute("aria-expanded", "false");

    // Closing the menu must not have mutated the document order/types.
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

    // FIRST block: the grip + menu open and offer all three actions even when the
    // block sits at the very top (the forgiving hover zone extends above it).
    const gFirst = await revealGripFor(page, blockNode(page, "cal-first"));
    await clickGripOpenMenu(page, gFirst);
    await expect(
      blockMenu(page).locator(".an-rich-md-drag-menu__item"),
    ).toHaveCount(3);
    await page.keyboard.press("Escape");
    await expect(blockMenu(page)).toHaveCount(0, { timeout: 5_000 });

    // LAST block: same affordance at the bottom of the document.
    const gLast = await revealGripFor(page, blockNode(page, "cal-last"));
    await clickGripOpenMenu(page, gLast);
    const items = blockMenu(page).locator(".an-rich-md-drag-menu__item");
    await expect(items).toHaveCount(3);

    // Deleting the LAST block from its menu removes that block specifically and
    // leaves the first two — proving the menu targets the right (last) node.
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
