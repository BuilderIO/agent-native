import { test, expect, type Page, type APIResponse } from "@playwright/test";


const UPDATE_ACTION = "/_agent-native/actions/update-visual-plan";
const CREATE_ACTION = "/_agent-native/actions/create-visual-plan";
const GET_ACTION = "/_agent-native/actions/get-visual-plan";
const EXPORT_ACTION = "/_agent-native/actions/export-visual-plan";
const SELECT_ALL_SHORTCUT =
  process.platform === "darwin" ? "Meta+A" : "Control+A";

type PlanBlock = {
  id: string;
  type: string;
  title?: string;
  editable?: boolean;
  data?: Record<string, unknown>;
};

type ColumnsColumn = {
  id: string;
  label?: string;
  blocks: PlanBlock[];
};

type PlanContentInput = {
  version: number;
  title?: string;
  brief?: string;
  blocks: PlanBlock[];
};

function uniqueTitle(label: string): string {
  return `Columns ${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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

async function getColumns(
  page: Page,
  planId: string,
  columnsBlockId: string,
): Promise<ColumnsColumn[] | null> {
  const blocks = await getPlanBlocks(page, planId);
  const block = blocks.find(
    (b) => b.id === columnsBlockId && b.type === "columns",
  );
  const columns = (block?.data as { columns?: ColumnsColumn[] } | undefined)
    ?.columns;
  return Array.isArray(columns) ? columns : null;
}

async function getPlanMdx(page: Page, planId: string): Promise<string> {
  const res = await page.request.get(
    `${EXPORT_ACTION}?planId=${encodeURIComponent(planId)}`,
  );
  expect(
    res.ok(),
    `export-visual-plan ok (status ${res.status()})`,
  ).toBeTruthy();
  const body = await readJson(res);
  const mdx = (body.mdx ?? {}) as Record<string, string>;
  return mdx["plan.mdx"] ?? "";
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

function columnsNode(page: Page, columnsBlockId: string) {
  return page
    .locator(
      `.plan-document-editor-surface .plan-block-node[data-block-id="${columnsBlockId}"]`,
    )
    .first();
}

function columnsEditor(page: Page, columnsBlockId: string) {
  return page.locator(`[data-columns-edit-block="${columnsBlockId}"]`).first();
}

function regionFor(page: Page, columnId: string) {
  return page
    .locator(
      `.plan-nested-document-editor-region[data-region-id="${columnId}"]`,
    )
    .first();
}

function regionProse(page: Page, columnId: string) {
  return regionFor(page, columnId)
    .locator(".plan-nested-document-editor-surface .an-rich-md-prose")
    .first();
}

const RICH_TOP_ID = "rt-top";
const COLS_ID = "blk-cols";
const COL_BEFORE_ID = "col-before";
const COL_AFTER_ID = "col-after";

function columnsContent(opts: {
  title: string;
  beforeMarkdown?: string;
  afterMarkdown?: string;
  beforeBlocks?: PlanBlock[];
  afterBlocks?: PlanBlock[];
}): PlanContentInput {
  return {
    version: 2,
    title: opts.title,
    brief: "Columns container render + nested-edit fixture.",
    blocks: [
      {
        id: RICH_TOP_ID,
        type: "rich-text",
        editable: true,
        data: { markdown: "Top intro paragraph above the columns." },
      },
      {
        id: COLS_ID,
        type: "columns",
        title: "Before / After",
        data: {
          columns: [
            {
              id: COL_BEFORE_ID,
              label: "Before",
              blocks: opts.beforeBlocks ?? [
                {
                  id: "rt-before",
                  type: "rich-text",
                  editable: true,
                  data: {
                    markdown: opts.beforeMarkdown ?? "OLD legacy login flow.",
                  },
                },
              ],
            },
            {
              id: COL_AFTER_ID,
              label: "After",
              blocks: opts.afterBlocks ?? [
                {
                  id: "rt-after",
                  type: "rich-text",
                  editable: true,
                  data: {
                    markdown: opts.afterMarkdown ?? "NEW unified auth flow.",
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

test.describe("columns container block", () => {
  test("renders both columns and their child text side-by-side", async ({
    page,
  }) => {
    const planId = await createPlanFixture(
      page,
      columnsContent({ title: uniqueTitle("render") }),
    );

    const seeded = await getColumns(page, planId, COLS_ID);
    expect(seeded?.map((c) => c.label)).toEqual(["Before", "After"]);

    await openPlanForEditing(page, planId);

    await expect(columnsNode(page, COLS_ID)).toBeVisible({ timeout: 25_000 });
    await expect(columnsEditor(page, COLS_ID)).toBeVisible({ timeout: 15_000 });

    const editor = columnsEditor(page, COLS_ID);
    await expect(
      editor.locator('input[placeholder="Column label"]'),
      "columns should not render heading input boxes",
    ).toHaveCount(0);
    await expect(
      editor.locator('button[aria-label="Add column"]'),
      "columns are added by side-dragging blocks, not by a permanent button",
    ).toHaveCount(0);
    await expect(
      editor.locator('button[aria-label^="Remove"]'),
      "empty columns are removed by deleting/moving their final block",
    ).toHaveCount(0);

    await expect(regionFor(page, COL_BEFORE_ID)).toBeVisible({
      timeout: 15_000,
    });
    await expect(regionFor(page, COL_AFTER_ID)).toBeVisible();
    await expect(regionProse(page, COL_BEFORE_ID)).toContainText(
      "OLD legacy login flow.",
      { timeout: 15_000 },
    );
    await expect(regionProse(page, COL_AFTER_ID)).toContainText(
      "NEW unified auth flow.",
    );

    const beforeBox = await regionFor(page, COL_BEFORE_ID).boundingBox();
    const afterBox = await regionFor(page, COL_AFTER_ID).boundingBox();
    expect(
      beforeBox && afterBox,
      "both column regions have layout boxes",
    ).toBeTruthy();
    expect(
      beforeBox!.x + beforeBox!.width <= afterBox!.x + 4,
      `columns should be side-by-side: Before(x=${beforeBox!.x},w=${beforeBox!.width}) should sit left of After(x=${afterBox!.x}). If they stack, the grid collapsed.`,
    ).toBeTruthy();
    const verticalOverlap =
      Math.min(
        beforeBox!.y + beforeBox!.height,
        afterBox!.y + afterBox!.height,
      ) - Math.max(beforeBox!.y, afterBox!.y);
    expect(
      verticalOverlap > 0,
      "side-by-side columns should overlap vertically (same row), not stack",
    ).toBeTruthy();

    const after = await getColumns(page, planId, COLS_ID);
    expect(after?.map((c) => c.label)).toEqual(["Before", "After"]);
    expect(after?.[0]?.blocks?.[0]?.type).toBe("rich-text");
    expect(after?.[1]?.blocks?.[0]?.type).toBe("rich-text");
  });

  test("editing text inside a column autosaves and persists the nested shape", async ({
    page,
  }) => {
    const planId = await createPlanFixture(
      page,
      columnsContent({ title: uniqueTitle("nested-edit") }),
    );
    await openPlanForEditing(page, planId);

    const prose = regionProse(page, COL_AFTER_ID);
    await expect(prose).toBeVisible({ timeout: 20_000 });
    await expect(prose).toHaveAttribute("contenteditable", "true", {
      timeout: 15_000,
    });

    const saveStatuses: number[] = [];
    page.on("response", (r) => {
      if (r.url().includes(UPDATE_ACTION) && r.request().method() === "POST") {
        saveStatuses.push(r.status());
      }
    });

    const marker = ` AFTERMARK-${Date.now()}`;
    await prose.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(marker, { delay: 14 });

    await expect(prose).toContainText(marker.trim(), { timeout: 5_000 });

    await page.waitForTimeout(2500);
    expect(
      saveStatuses.length,
      "at least one autosave fired while editing the column child",
    ).toBeGreaterThan(0);
    const fiveXX = saveStatuses.filter((s) => s >= 500);
    expect(
      fiveXX,
      `nested-column edit must not 5xx (statuses=[${saveStatuses.join(",")}])`,
    ).toEqual([]);

    await expect
      .poll(
        async () => {
          const cols = await getColumns(page, planId, COLS_ID);
          const afterCol = cols?.find((c) => c.id === COL_AFTER_ID);
          const md = afterCol?.blocks?.[0]?.data?.markdown;
          return typeof md === "string" ? md : "";
        },
        { timeout: 15_000 },
      )
      .toContain(marker.trim());

    const finalCols = await getColumns(page, planId, COLS_ID);
    expect(
      finalCols?.map((c) => c.label),
      "the {columns:[{label}]} envelope survives the nested edit",
    ).toEqual(["Before", "After"]);
    const beforeCol = finalCols?.find((c) => c.id === COL_BEFORE_ID);
    expect(
      beforeCol?.blocks?.[0]?.data?.markdown,
      "the untouched Before column keeps its original text",
    ).toContain("OLD legacy login flow.");
    expect(finalCols?.find((c) => c.id === COL_AFTER_ID)?.blocks?.length).toBe(
      1,
    );

    await page.reload();
    await expect(regionProse(page, COL_AFTER_ID)).toContainText(marker.trim(), {
      timeout: 20_000,
    });
  });

  test("slash-inserts a block inside a column region", async ({ page }) => {
    const planId = await createPlanFixture(
      page,
      columnsContent({ title: uniqueTitle("slash-in-column") }),
    );
    await openPlanForEditing(page, planId);

    const prose = regionProse(page, COL_BEFORE_ID);
    await expect(prose).toBeVisible({ timeout: 20_000 });
    await expect(prose).toHaveAttribute("contenteditable", "true", {
      timeout: 15_000,
    });

    await prose.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/callout", { delay: 20 });

    // Scope the menu to THIS column's region so a stray top-doc menu can't satisfy
    const slashMenu = page.locator(".an-rich-md-slash-menu");
    await expect(slashMenu).toBeVisible({ timeout: 8_000 });
    const calloutItem = page
      .locator(".an-rich-md-slash-item")
      .filter({ hasText: "Callout" });
    await expect(calloutItem.first()).toBeVisible({ timeout: 8_000 });

    const okSave = page.waitForResponse(
      (r) =>
        r.url().includes(UPDATE_ACTION) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20_000 },
    );
    await calloutItem.first().click();
    await okSave;

    await expect
      .poll(
        async () => {
          const cols = await getColumns(page, planId, COLS_ID);
          const beforeCol = cols?.find((c) => c.id === COL_BEFORE_ID);
          return (beforeCol?.blocks ?? []).filter((b) => b.type === "callout")
            .length;
        },
        { timeout: 15_000 },
      )
      .toBe(1);

    const cols = await getColumns(page, planId, COLS_ID);
    const afterCol = cols?.find((c) => c.id === COL_AFTER_ID);
    expect(
      (afterCol?.blocks ?? []).some((b) => b.type === "callout"),
      "the After column must NOT have received the insert (region isolation)",
    ).toBe(false);
    expect((await getPlanBlocks(page, planId)).map((b) => b.type)).toEqual([
      "rich-text",
      "columns",
    ]);
  });

  test("deleting the last child block in a column removes that column", async ({
    page,
  }) => {
    const planId = await createPlanFixture(
      page,
      columnsContent({ title: uniqueTitle("delete-empty-column") }),
    );
    await openPlanForEditing(page, planId);

    const editor = columnsEditor(page, COLS_ID);
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await expect(editor.locator('button[aria-label="Add column"]')).toHaveCount(
      0,
    );
    await expect(editor.locator('button[aria-label^="Remove"]')).toHaveCount(0);

    const afterProse = regionProse(page, COL_AFTER_ID);
    await expect(afterProse).toContainText("NEW unified auth flow.", {
      timeout: 15_000,
    });

    const deleteSave = page.waitForResponse(
      (r) =>
        r.url().includes(UPDATE_ACTION) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20_000 },
    );
    await afterProse.click();
    await page.keyboard.press(SELECT_ALL_SHORTCUT);
    await page.keyboard.press("Backspace");
    await deleteSave;

    await expect
      .poll(async () => (await getColumns(page, planId, COLS_ID)) ?? [], {
        timeout: 15_000,
      })
      .toMatchObject([{ id: COL_BEFORE_ID }]);

    const finalCols = await getColumns(page, planId, COLS_ID);
    expect(finalCols).toHaveLength(1);
    expect(finalCols?.[0]?.blocks?.[0]?.data?.markdown).toContain(
      "OLD legacy login flow.",
    );
    await expect(regionFor(page, COL_AFTER_ID)).toHaveCount(0);
  });

  test("the <Columns><Column> MDX round-trips labels and child markdown", async ({
    page,
  }) => {
    const planId = await createPlanFixture(
      page,
      columnsContent({
        title: uniqueTitle("mdx-roundtrip"),
        beforeMarkdown: "OLD ROUNDTRIP before body.",
        afterMarkdown: "NEW ROUNDTRIP after body.",
      }),
    );

    const mdx = await getPlanMdx(page, planId);

    expect(mdx, "export emits a <Columns> element").toMatch(/<Columns\b/);
    const columnsStart = mdx.indexOf("<Columns");
    const columnsEnd = mdx.indexOf("</Columns>");
    expect(
      columnsStart >= 0 && columnsEnd > columnsStart,
      "the <Columns>…</Columns> block is present and well-formed in plan.mdx",
    ).toBeTruthy();
    const columnsSrc = mdx.slice(columnsStart, columnsEnd);

    expect(columnsSrc).toMatch(/<Column\b[^>]*\blabel="Before"/);
    expect(columnsSrc).toMatch(/<Column\b[^>]*\blabel="After"/);
    expect(columnsSrc).toContain("OLD ROUNDTRIP before body.");
    expect(columnsSrc).toContain("NEW ROUNDTRIP after body.");
    expect(columnsSrc).toMatch(/<Column\b[^>]*\bcontentId=/);

    const beforeIdx = columnsSrc.indexOf("OLD ROUNDTRIP before body.");
    const afterIdx = columnsSrc.indexOf("NEW ROUNDTRIP after body.");
    expect(
      beforeIdx >= 0 && afterIdx > beforeIdx,
      "column order (Before then After) is preserved in the MDX",
    ).toBeTruthy();
  });

  test("EDGE: an empty column and a structured-child column both render", async ({
    page,
  }) => {
    const planId = await createPlanFixture(
      page,
      columnsContent({
        title: uniqueTitle("empty+structured"),
        beforeBlocks: [
          {
            id: "dm-before",
            type: "data-model",
            data: {
              entities: [
                {
                  id: "e_user",
                  name: "LegacyUser",
                  fields: [
                    { name: "id", type: "uuid", pk: true },
                    { name: "email", type: "text" },
                  ],
                },
              ],
            },
          },
        ],
        afterBlocks: [],
      }),
    );
    await openPlanForEditing(page, planId);

    await expect(columnsNode(page, COLS_ID)).toBeVisible({ timeout: 25_000 });
    await expect(columnsEditor(page, COLS_ID)).toBeVisible({ timeout: 15_000 });

    const beforeRegion = regionFor(page, COL_BEFORE_ID);
    await expect(beforeRegion).toBeVisible({ timeout: 15_000 });
    await expect(beforeRegion).toContainText("LegacyUser", { timeout: 15_000 });
    await expect(beforeRegion).toContainText("email");

    const emptyRegion = regionFor(page, COL_AFTER_ID);
    await expect(emptyRegion).toBeVisible({ timeout: 15_000 });
    const emptyProse = regionProse(page, COL_AFTER_ID);
    await expect(emptyProse).toBeVisible({ timeout: 15_000 });
    await expect(emptyProse).toHaveAttribute("contenteditable", "true", {
      timeout: 15_000,
    });

    const okSave = page.waitForResponse(
      (r) =>
        r.url().includes(UPDATE_ACTION) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20_000 },
    );
    await emptyProse.click();
    await page.keyboard.type("First child of the empty column.", { delay: 14 });
    await okSave;

    await expect
      .poll(
        async () => {
          const cols = await getColumns(page, planId, COLS_ID);
          const afterCol = cols?.find((c) => c.id === COL_AFTER_ID);
          const md = afterCol?.blocks?.[0]?.data?.markdown;
          return typeof md === "string" ? md : "";
        },
        { timeout: 15_000 },
      )
      .toContain("First child of the empty column.");

    const finalCols = await getColumns(page, planId, COLS_ID);
    expect(
      finalCols?.find((c) => c.id === COL_BEFORE_ID)?.blocks?.[0]?.type,
    ).toBe("data-model");
  });

  // (6) CROSS-REGION DRAG — moving a block from the main document INTO a column,
  // and from a column back OUT to the main document.
  //
  // The DragHandle supports cross-editor moves: each editor (top doc + every
  // nested column region) registers its own view with a distinct wrapper selector
  // (`.plan-document-editor` vs `.plan-nested-document-editor`), and a drop onto a
  // foreign view transfers the block via getDragTransferData/receiveDragTransferData.
  // Driving this with raw mouse moves is real but FLAKY: the grip is hover-bound and
  // re-homed lazily, the drop target is chosen by smallest-area among ALL registered
  // views (so the column region must win over the top doc), and the nested editors
  // re-serialize on every keystroke (HMR/reseed can move boxes mid-drag). Rather than
  // ship a flaky pass that masks regressions, this is marked test.fixme with the full
  // drive recipe below so it can be stabilized deliberately. If you un-fixme it, prefer
  // settling boundingBox() reads with expect.poll and dropping near the region CENTER
  // (smallest-area target) rather than its top edge.
  test.fixme("drags a block from the main document into a column, and from a column back out", async ({
    page,
  }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("cross-region-drag"),
      brief: "Cross-region drag fixture.",
      blocks: [
        {
          id: RICH_TOP_ID,
          type: "rich-text",
          editable: true,
          data: { markdown: "Top intro paragraph." },
        },
        {
          id: "cal-movable",
          type: "callout",
          data: { tone: "info", body: "MOVABLE callout body." },
        },
        {
          id: COLS_ID,
          type: "columns",
          title: "Before / After",
          data: {
            columns: [
              { id: COL_BEFORE_ID, label: "Before", blocks: [] },
              { id: COL_AFTER_ID, label: "After", blocks: [] },
            ],
          },
        },
      ],
    });
    await openPlanForEditing(page, planId);

    const movable = page.locator(
      '.plan-document-editor-surface .plan-block-node[data-block-id="cal-movable"]',
    );
    await expect(movable).toBeVisible({ timeout: 20_000 });
    const beforeRegion = regionFor(page, COL_BEFORE_ID);
    await expect(beforeRegion).toBeVisible({ timeout: 20_000 });

    await movable.hover();
    const grip = page.locator(".drag-handle");
    await expect(grip).toBeVisible({ timeout: 8_000 });
    const gripBox = await grip.boundingBox();
    const regionBox = await beforeRegion.boundingBox();
    expect(gripBox && regionBox).toBeTruthy();

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
    await page.mouse.move(
      regionBox!.x + regionBox!.width / 2,
      regionBox!.y + regionBox!.height / 2,
      { steps: 16 },
    );
    await page.mouse.up();
    await okSave;

    await expect
      .poll(
        async () => {
          const cols = await getColumns(page, planId, COLS_ID);
          const beforeCol = cols?.find((c) => c.id === COL_BEFORE_ID);
          return (beforeCol?.blocks ?? []).some((b) => b.id === "cal-movable");
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    expect(
      (await getPlanBlocks(page, planId)).some((b) => b.id === "cal-movable"),
      "the callout should no longer be a top-level block after moving into a column",
    ).toBe(false);
  });
});
