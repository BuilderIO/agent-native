import { test, expect, type Page, type APIResponse } from "@playwright/test";

/*
 * COLUMNS CONTAINER BLOCK — render, nested edit, Notion-like chrome removal,
 * MDX round-trip, and (fixme) cross-region drag. Adversarial E2E.
 *
 * Area under test: the standard `columns` container block
 * (`packages/core/src/client/blocks/library/columns.tsx` + `columns.config.ts`).
 * `columns` data is `{ columns: [{ id, label?, blocks: NestedBlock[] }] }`; each
 * column is a side-by-side panel that holds its OWN list of child blocks rendered
 * recursively through the plan's block dispatcher.
 *
 * How it renders in the single-document editor (verified against the real code):
 *   - The columns block is an inline `planBlock` NodeView wrapped in
 *     `.plan-block-node[data-block-id=<id>]` (RegistryBlockNode), and because its
 *     spec is `editSurface: "container"`, the NodeView renders the block's `Edit`
 *     (`ColumnsBlockEditor`) IN PLACE when the doc is editable — NOT the read view.
 *   - `ColumnsBlockEditor` emits a bare `div[data-columns-edit-block=<id>]`.
 *     Columns are plain document regions: there are no per-column label inputs,
 *     remove buttons, or explicit `Add column` button. New columns are created
 *     by side-dropping a block left/right of another block, like Notion.
 *   - Each column's children render through `ctx.renderBlocksEditor`, which the
 *     plan wires to `NestedPlanBlocksEditor`. That mounts a per-region editor:
 *     `.plan-nested-document-editor-region[data-region-id=<colId>][data-container-block-id=<id>]`
 *     wrapping a `SharedRichEditor` whose contenteditable surface is
 *     `.plan-nested-document-editor-surface .an-rich-md-prose`. So a column's child
 *     text is addressable INSIDE its region's prose.
 *   - Every edit (top doc OR nested region) serializes the whole doc back to
 *     `blocks[]` and autosaves through `update-visual-plan`
 *     `{ op: "replace-blocks", blocks }` (no client debounce; one POST/keystroke).
 *
 * Persistence shape (verified live): `get-visual-plan` returns the columns block
 * with `data.columns: [{ id, label?, blocks:[…] }]` intact; `export-visual-plan`
 * emits the human-readable `<Columns><Column label="…" contentId="…">…markdown…
 * </Column></Columns>` MDX form in `mdx["plan.mdx"]`.
 *
 * Asserts CORRECT behavior — a FAILING assertion IS the bug it reports. retries:2
 * + web-first auto-retrying expects absorb transient HMR reloads on the shared dev
 * server. Uses the editable surface; auth is reused from global-setup storageState.
 */

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

/**
 * Create a fresh plan fixture via the authed action surface; return its id. The
 * shared dev server can HMR/reload mid-request while other agents edit the app (a
 * transient 500), so retry a few times — a fixture hiccup must never read as the
 * render/edit bug under test.
 */
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

/** Read the current stored top-level blocks. */
async function getPlanBlocks(page: Page, planId: string): Promise<PlanBlock[]> {
  const res = await page.request.get(
    `${GET_ACTION}?id=${encodeURIComponent(planId)}`,
  );
  expect(res.ok(), `get-visual-plan ok (status ${res.status()})`).toBeTruthy();
  const body = await readJson(res);
  const plan = (body.plan ?? body) as { content?: { blocks?: PlanBlock[] } };
  return plan.content?.blocks ?? [];
}

/** Find the persisted columns block (by id) and return its `data.columns`. */
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

/** Export the plan and return its `plan.mdx` source (for the MDX round-trip). */
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

/** The inline `planBlock` NodeView wrapper for the columns block id. */
function columnsNode(page: Page, columnsBlockId: string) {
  return page
    .locator(
      `.plan-document-editor-surface .plan-block-node[data-block-id="${columnsBlockId}"]`,
    )
    .first();
}

/** The bare columns editor container (`editSurface: container` renders Edit). */
function columnsEditor(page: Page, columnsBlockId: string) {
  return page.locator(`[data-columns-edit-block="${columnsBlockId}"]`).first();
}

/** The per-column nested editor region for a given column id. */
function regionFor(page: Page, columnId: string) {
  return page
    .locator(
      `.plan-nested-document-editor-region[data-region-id="${columnId}"]`,
    )
    .first();
}

/** The editable prose surface inside a given column region. */
function regionProse(page: Page, columnId: string) {
  return regionFor(page, columnId)
    .locator(".plan-nested-document-editor-surface .an-rich-md-prose")
    .first();
}

const RICH_TOP_ID = "rt-top";
const COLS_ID = "blk-cols";
const COL_BEFORE_ID = "col-before";
const COL_AFTER_ID = "col-after";

/**
 * Seed a plan with a leading rich-text block plus a 2-column comparison block.
 * The "Before" column holds OLD text, "After" holds NEW text — the canonical
 * before/after use of `columns`.
 */
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
  // (1) RENDER — both columns + their child text render side-by-side, and the
  // persisted columns shape survives simply opening the plan.
  test("renders both columns and their child text side-by-side", async ({
    page,
  }) => {
    const planId = await createPlanFixture(
      page,
      columnsContent({ title: uniqueTitle("render") }),
    );

    // Sanity at the API: the columns block persisted with two labeled columns,
    // each holding one rich-text child (no wipe at creation).
    const seeded = await getColumns(page, planId, COLS_ID);
    expect(seeded?.map((c) => c.label)).toEqual(["Before", "After"]);

    await openPlanForEditing(page, planId);

    // The columns block's inline NodeView mounts, and its container editor renders
    // in place (editSurface: "container").
    await expect(columnsNode(page, COLS_ID)).toBeVisible({ timeout: 25_000 });
    await expect(columnsEditor(page, COLS_ID)).toBeVisible({ timeout: 15_000 });

    // Old saved labels remain in data, but the editable surface no longer shows
    // per-column heading boxes or an explicit Add column control.
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

    // Each column's nested region renders its child rich-text verbatim.
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

    // Side-by-side: the two columns sit on the SAME row (md+ grid). Their region
    // boxes overlap vertically and the "Before" region is left of "After".
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

    // Opening never wiped the columns shape.
    const after = await getColumns(page, planId, COLS_ID);
    expect(after?.map((c) => c.label)).toEqual(["Before", "After"]);
    expect(after?.[0]?.blocks?.[0]?.type).toBe("rich-text");
    expect(after?.[1]?.blocks?.[0]?.type).toBe("rich-text");
  });

  // (2) NESTED EDIT — editing text INSIDE a column autosaves (no 5xx) and persists
  // with the {columns:[{label,blocks}]} shape intact.
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

    // Record autosave statuses — a healthy nested editor must not 5xx while typing.
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

    // Optimistic render inside the column.
    await expect(prose).toContainText(marker.trim(), { timeout: 5_000 });

    // Let the per-keystroke autosaves settle, then assert no server error.
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

    // The edit persists INSIDE the After column, and the columns envelope is
    // intact: two labeled columns, the markdown carries the marker, and the
    // Before column is untouched.
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
    // The After child stayed a rich-text block (not coerced/duplicated).
    expect(finalCols?.find((c) => c.id === COL_AFTER_ID)?.blocks?.length).toBe(
      1,
    );

    // And the edit re-renders after a hard reload inside the column.
    await page.reload();
    await expect(regionProse(page, COL_AFTER_ID)).toContainText(marker.trim(), {
      timeout: 20_000,
    });
  });

  // (3) SLASH-INSERT inside a column region — typing "/callout" in a column's
  // nested editor inserts a callout INTO that column and persists it nested.
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

    // Open the slash menu on a fresh line inside the Before column.
    await prose.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/callout", { delay: 20 });

    // Scope the menu to THIS column's region so a stray top-doc menu can't satisfy
    // the assertion. The slash menu portals/renders within the editor flow; the
    // ".an-rich-md-slash-menu" lives under the document. We assert the item exists
    // and click it; the insert lands in whichever editor owns the caret (this
    // region), which we then verify by reading the persisted nested blocks.
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

    // The Before column now contains a callout child (it did not before); the
    // After column is untouched. This proves the nested editor's slash-insert
    // targets the correct column region, not the top document.
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
    // Top-level block list is still [rich-text, columns] — the insert went nested,
    // not into the main document.
    expect((await getPlanBlocks(page, planId)).map((b) => b.type)).toEqual([
      "rich-text",
      "columns",
    ]);
  });

  // (4) REMOVE a column by deleting its last child block. There is deliberately
  // no Add/Remove column chrome; Notion-style structure changes happen through
  // normal block editing and drag/drop.
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

  // (5) MDX ROUND-TRIP — the readable <Columns><Column> source survives create →
  // export, preserving column labels + each column's child markdown.
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

    // The export uses the human-editable <Columns><Column …> form (NOT the compact
    // self-closing JSON-prop encoding), so a reviewer can read/edit the source.
    expect(mdx, "export emits a <Columns> element").toMatch(/<Columns\b/);
    const columnsStart = mdx.indexOf("<Columns");
    const columnsEnd = mdx.indexOf("</Columns>");
    expect(
      columnsStart >= 0 && columnsEnd > columnsStart,
      "the <Columns>…</Columns> block is present and well-formed in plan.mdx",
    ).toBeTruthy();
    const columnsSrc = mdx.slice(columnsStart, columnsEnd);

    // Both column labels survive as `label="…"` on `<Column>` elements.
    expect(columnsSrc).toMatch(/<Column\b[^>]*\blabel="Before"/);
    expect(columnsSrc).toMatch(/<Column\b[^>]*\blabel="After"/);
    // The child markdown of each column survives verbatim inside its <Column>.
    expect(columnsSrc).toContain("OLD ROUNDTRIP before body.");
    expect(columnsSrc).toContain("NEW ROUNDTRIP after body.");
    // The single rich-text child round-trips as a `contentId` reference (the
    // serializer's compact form for one rich-text child), and the markdown sits
    // inside the element body — not flattened away.
    expect(columnsSrc).toMatch(/<Column\b[^>]*\bcontentId=/);

    // Structural ordering: "Before" content precedes "After" content in source.
    const beforeIdx = columnsSrc.indexOf("OLD ROUNDTRIP before body.");
    const afterIdx = columnsSrc.indexOf("NEW ROUNDTRIP after body.");
    expect(
      beforeIdx >= 0 && afterIdx > beforeIdx,
      "column order (Before then After) is preserved in the MDX",
    ).toBeTruthy();
  });

  // EDGE: an empty column (no children) and a column with a structured
  // (data-model) child both render without crashing; the structured child shows
  // its recognizable content, and the empty column still offers an editable region
  // to type into.
  test("EDGE: an empty column and a structured-child column both render", async ({
    page,
  }) => {
    const planId = await createPlanFixture(
      page,
      columnsContent({
        title: uniqueTitle("empty+structured"),
        // Before: a structured data-model child (a deep leaf, not just prose).
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
        // After: an EMPTY column (no children at all).
        afterBlocks: [],
      }),
    );
    await openPlanForEditing(page, planId);

    // The columns NodeView + editor mount without throwing.
    await expect(columnsNode(page, COLS_ID)).toBeVisible({ timeout: 25_000 });
    await expect(columnsEditor(page, COLS_ID)).toBeVisible({ timeout: 15_000 });

    // The structured child renders its entity name + a field inside the Before
    // column (the data-model block survives nesting in a column region).
    const beforeRegion = regionFor(page, COL_BEFORE_ID);
    await expect(beforeRegion).toBeVisible({ timeout: 15_000 });
    await expect(beforeRegion).toContainText("LegacyUser", { timeout: 15_000 });
    await expect(beforeRegion).toContainText("email");

    // The empty After column still mounts an editable region (so a user can add
    // content) — the empty-column case must not collapse the region away.
    const emptyRegion = regionFor(page, COL_AFTER_ID);
    await expect(emptyRegion).toBeVisible({ timeout: 15_000 });
    const emptyProse = regionProse(page, COL_AFTER_ID);
    await expect(emptyProse).toBeVisible({ timeout: 15_000 });
    await expect(emptyProse).toHaveAttribute("contenteditable", "true", {
      timeout: 15_000,
    });

    // Type into the previously-empty column and confirm it persists as a NEW child
    // block in that column (the empty column accepts its first child).
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

    // The structured Before column is untouched and still a data-model.
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

    // Drive recipe (to stabilize when un-fixme'd):
    // 1. Hover the top-doc callout `.plan-block-node[data-block-id="cal-movable"]`
    //    so the top-doc `.drag-handle` binds to it; read the grip box.
    // 2. mouse.down on the grip, mouse.move in steps toward the CENTER of the
    //    Before region (`.plan-nested-document-editor-region[data-region-id=
    //    "col-before"]`), mouse.up. Wait for a 200 replace-blocks save.
    // 3. Assert via get-visual-plan that `cal-movable` now lives in the Before
    //    column's blocks (and is gone from the top-level list).
    // 4. Reverse: hover the now-nested callout's grip (nested editor's own
    //    `.drag-handle`), drag it to the top document's prose area, drop, and
    //    assert it returns to the top-level block list.
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

    // The callout moved INTO the Before column and left the top-level list.
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
