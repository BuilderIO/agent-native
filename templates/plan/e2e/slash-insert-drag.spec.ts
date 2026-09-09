import { test, expect, type Page, type APIResponse } from "@playwright/test";

/*
 * SLASH-INSERT + DRAG-REORDER + NOTION-SYNC SLASH FILTER — interactive E2E.
 *
 * These cover the single-document plan editor affordances that can't be driven
 * reliably through raw CDP `execCommand` (they need real ProseMirror keyboard /
 * mouse input): typing "/" to INSERT a custom block, dragging a block's grip to
 * REORDER it, and the slash menu's Notion-compatible-only filtering.
 *
 * The editor is ONE ProseMirror doc (`SharedRichEditor`, wrapper
 * `.plan-document-editor-surface`, contenteditable `.an-rich-md-prose`). Custom
 * blocks are inline `planBlock` NodeViews (`.plan-block-node[data-block-id]`).
 * The "/" menu is `.an-rich-md-slash-menu` with `.an-rich-md-slash-item` rows
 * (each carrying an `.an-rich-md-slash-title`). The left-margin drag grip is
 * `.drag-handle`. Every edit serializes the whole doc back to `blocks[]` and
 * autosaves via `update-visual-plan` `{ op: "replace-blocks" }` (no debounce).
 *
 * Asserts CORRECT behavior; a failing assertion IS the bug. retries:2 absorbs
 * transient HMR reloads on the shared dev server.
 */

const UPDATE_ACTION = "/_agent-native/actions/update-visual-plan";
const CREATE_ACTION = "/_agent-native/actions/create-visual-plan";
const GET_ACTION = "/_agent-native/actions/get-visual-plan";

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
  notionSync?: boolean;
  blocks: PlanBlock[];
};

function uniqueTitle(label: string): string {
  return `Slash/Drag ${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
    `create-visual-plan should succeed (status ${res?.status()})`,
  ).toBeTruthy();
  const body = await readJson(res as APIResponse);
  const planId =
    (body.planId as string | undefined) ??
    (body.plan as { id?: string } | undefined)?.id;
  expect(planId, "create-visual-plan returns a plan id").toBeTruthy();
  return planId as string;
}

/** Read the current stored blocks for order/type assertions. */
async function getPlanBlocks(page: Page, planId: string): Promise<PlanBlock[]> {
  const res = await page.request.get(
    `${GET_ACTION}?id=${encodeURIComponent(planId)}`,
  );
  expect(res.ok(), `get-visual-plan ok (status ${res.status()})`).toBeTruthy();
  const body = await readJson(res);
  const plan = (body.plan ?? body) as {
    content?: { blocks?: PlanBlock[]; notionSync?: boolean };
  };
  return plan.content?.blocks ?? [];
}

function proseFor(page: Page) {
  return page
    .locator(".plan-document-editor-surface .an-rich-md-prose")
    .first();
}

/** Open the plan and wait for the editable single-document surface. */
async function openPlanForEditing(page: Page, planId: string) {
  await page.goto(`/plans/${planId}`);
  const prose = proseFor(page);
  await expect(prose).toBeVisible({ timeout: 25_000 });
  await expect(prose).toHaveAttribute("contenteditable", "true", {
    timeout: 15_000,
  });
  return prose;
}

const slashMenu = (page: Page) => page.locator(".an-rich-md-slash-menu");
const slashTitles = (page: Page) =>
  page.locator(".an-rich-md-slash-menu .an-rich-md-slash-title");

/** Place caret at the doc end, open a fresh line, and type a slash query. */
async function openSlashMenu(
  page: Page,
  prose: ReturnType<typeof proseFor>,
  query: string,
) {
  await prose.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(query, { delay: 20 });
  await expect(slashMenu(page)).toBeVisible({ timeout: 8_000 });
}

test.describe("single-document slash-insert, drag-reorder, notion filter", () => {
  test("typing /callout inserts a callout block that persists", async ({
    page,
  }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("slash-insert"),
      brief: "Slash-insert fixture.",
      blocks: [
        {
          id: "rt-seed",
          type: "rich-text",
          editable: true,
          data: { markdown: "Seed paragraph." },
        },
      ],
    });
    const prose = await openPlanForEditing(page, planId);

    // Open the menu filtered to Callout. The block command's description is the
    // block type ("callout"), so "/callout" narrows to the single Callout item.
    await openSlashMenu(page, prose, "/callout");
    await expect(slashTitles(page).filter({ hasText: "Callout" })).toHaveCount(
      1,
    );

    const okSave = page.waitForResponse(
      (r) =>
        r.url().includes(UPDATE_ACTION) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20_000 },
    );

    // Selecting the item inserts a `planBlock` node; the editor seeds its data
    // from the spec's empty() and autosaves the whole doc.
    await page
      .locator(".an-rich-md-slash-item")
      .filter({ hasText: "Callout" })
      .first()
      .click();

    await okSave;

    // A callout block now exists in the persisted content (it did not before).
    await expect
      .poll(
        async () =>
          (await getPlanBlocks(page, planId)).filter(
            (b) => b.type === "callout",
          ).length,
        { timeout: 15_000 },
      )
      .toBe(1);

    // And it renders as an inline block NodeView after a reload.
    await page.reload();
    await expect(
      page.locator(".plan-document-editor-surface .plan-block-node").first(),
    ).toBeVisible({ timeout: 25_000 });
  });

  test("dragging a block's grip reorders it above the prose and persists", async ({
    page,
  }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("drag-reorder"),
      brief: "Drag-reorder fixture.",
      blocks: [
        {
          id: "rt-top",
          type: "rich-text",
          editable: true,
          data: { markdown: "ALPHA top paragraph." },
        },
        {
          id: "cal-mid",
          type: "callout",
          data: { tone: "info", body: "Movable callout body." },
        },
      ],
    });
    const prose = await openPlanForEditing(page, planId);

    // Sanity: initial order is [rich-text, callout].
    const before = await getPlanBlocks(page, planId);
    expect(before[0]?.type).toBe("rich-text");
    expect(before[1]?.type).toBe("callout");

    const callout = page.locator('.plan-block-node[data-block-id="cal-mid"]');
    await expect(callout).toBeVisible({ timeout: 20_000 });

    // Hover the callout so the DragHandle binds its grip to that node, then read
    // the grip box. (The grip appears on hover and is anchored to the wrapper.)
    await callout.hover();
    const grip = page.locator(".drag-handle");
    await expect(grip).toBeVisible({ timeout: 8_000 });
    const gripBox = await grip.boundingBox();
    const proseBox = await prose.boundingBox();
    expect(gripBox && proseBox).toBeTruthy();

    const okSave = page.waitForResponse(
      (r) =>
        r.url().includes(UPDATE_ACTION) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20_000 },
    );

    // Drag the grip up to just below the very top of the document — drop the
    // callout before the first prose block.
    await page.mouse.move(
      gripBox!.x + gripBox!.width / 2,
      gripBox!.y + gripBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(proseBox!.x + 40, proseBox!.y + 6, { steps: 12 });
    await page.mouse.up();

    await okSave;

    // The callout is now the FIRST block (order flipped); ids are preserved.
    await expect
      .poll(async () => (await getPlanBlocks(page, planId))[0]?.type, {
        timeout: 15_000,
      })
      .toBe("callout");
    const after = await getPlanBlocks(page, planId);
    expect(after.find((b) => b.id === "cal-mid")).toBeTruthy();
  });

  test("notion-sync mode hides incompatible block types from the slash menu", async ({
    page,
  }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("notion-filter"),
      brief: "Notion-sync slash filter fixture.",
      blocks: [
        {
          id: "rt-seed",
          type: "rich-text",
          editable: true,
          data: { markdown: "Seed paragraph." },
        },
      ],
    });

    // Turn on Notion sync deterministically via the targeted patch op.
    const patchRes = await page.request.post(UPDATE_ACTION, {
      data: {
        planId,
        contentPatches: [{ op: "set-notion-sync", value: true }],
      },
    });
    expect(patchRes.status(), "set-notion-sync patch returns 200").toBe(200);

    const prose = await openPlanForEditing(page, planId);
    await openSlashMenu(page, prose, "/");

    // Notion-compatible registry blocks stay offered…
    for (const label of ["Callout", "Checklist"]) {
      await expect(
        slashTitles(page).filter({ hasText: new RegExp(`^${label}$`) }),
      ).toHaveCount(1);
    }
    // The structured `table` registry block stays offered too, but is now
    // labeled "Structured table" to disambiguate it from the prose markdown
    // table command (which remains "Table"). So each appears exactly once.
    await expect(
      slashTitles(page).filter({ hasText: /^Structured table$/ }),
    ).toHaveCount(1);
    await expect(slashTitles(page).filter({ hasText: /^Table$/ })).toHaveCount(
      1,
    );
    // …and the NFM-incompatible ones are filtered out.
    for (const label of ["Wireframe", "Diagram", "Code tabs", "Tabs"]) {
      await expect(
        slashTitles(page).filter({ hasText: new RegExp(`^${label}$`) }),
      ).toHaveCount(0);
    }
    // The "HTML / Tailwind" (html) registry block is also hidden.
    await expect(
      slashTitles(page).filter({ hasText: "HTML / Tailwind" }),
    ).toHaveCount(0);
  });
});
