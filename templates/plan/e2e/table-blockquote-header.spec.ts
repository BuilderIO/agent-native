import { test, expect, type Page, type APIResponse } from "@playwright/test";

/*
 * TABLE (structured) + BLOCKQUOTE + EDITABLE TITLE/SUBTITLE — inline-editing E2E.
 *
 * Three surfaces of the single-document plan editor, all driven through REAL
 * inline interaction (typing into the live DOM, not a separate overlay/mode):
 *
 *  (1) TITLE + SUBTITLE — the plan header is rendered by `EditableHeaderText`
 *      (PlanContentRenderer.tsx). The <h1> carries `aria-label="Plan title"` and
 *      the <p> carries `aria-label="Plan summary"`; both are `contentEditable`
 *      with class `.plan-header-editable`. Editing is NOT autosaved per keystroke
 *      — `EditableHeaderText` commits on BLUR (or Enter, which blurs) by calling
 *      `onMetadataChange({ title })` / `({ brief })`, which the page persists via
 *      `update-visual-plan` with a top-level `title` / `brief` arg (NOT a content
 *      patch). On blur the text is trimmed + whitespace-collapsed; an EMPTY title
 *      is rejected (the <h1> reverts to its prior value and never commits), while
 *      an empty subtitle IS allowed to commit.
 *
 *  (2) TABLE (structured) — the core `table` registry block (table.tsx). In the
 *      editable document its inline `Edit` (`TableBlockEdit`) renders DIRECTLY in
 *      place (editSurface defaults to "inline" for a custom Edit): an
 *      `.an-table-block-editor` grid of rich text cells (NOT a read-only <td>
 *      and NOT a click-to-edit overlay). Cells/headers carry stable aria-labels
 *      (`Row N, column M`, `Column N header`); add/remove controls carry
 *      `Add row` / `Add column` / `Remove row N` / `Remove column N`. Footer
 *      add controls reveal on table hover; remove controls reveal only for the
 *      hovered row or column header.
 *      Every edit commits a whole new `{ columns, rows }` value through
 *      `onBlockDataChange` → the side-map → `replace-blocks` autosave.
 *
 *  (3) BLOCKQUOTE — inserted via the slash "Quote" command
 *      (planSlashCommands.ts → `toggleBlockquote`). It is a REAL ProseMirror
 *      <blockquote> (freely editable prose, NOT an atom NodeView), serializes to
 *      `> …` GFM lines, and — being prose — lives inside a stable-id rich-text
 *      block (RunId stamps the run), so its text persists through the same
 *      whole-doc autosave.
 *
 * Editor shell (verified against PlanDocumentEditor.tsx): the whole body is ONE
 * ProseMirror doc — wrapper `.plan-document-editor-surface`, contenteditable
 * `.an-rich-md-prose`. Registry blocks are inline `planBlock` NodeViews
 * (`.plan-block-node[data-block-id=<id>]`). Saves are DEBOUNCED + SERIALIZED
 * (~600ms, one in-flight) and POST to `update-visual-plan`.
 *
 * Asserts CORRECT behavior — a FAILING assertion IS the bug it reports. Uses
 * web-first auto-retrying expects (the shared dev server may HMR mid-run;
 * retries:2 is configured). No re-auth: the authed project's storageState is set
 * up by global-setup; just use `page`.
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
  blocks: PlanBlock[];
};

function uniqueTitle(label: string): string {
  return `Inline TBH ${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
 * shared dev server can HMR/reload mid-request (a transient 500), so retry a few
 * times — a fixture hiccup must never read as the bug under test.
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

/** Fetch the full stored plan (content + top-level title/brief metadata). */
async function getPlan(
  page: Page,
  planId: string,
): Promise<{
  title?: string;
  brief?: string;
  content?: { title?: string; brief?: string; blocks?: PlanBlock[] };
}> {
  const res = await page.request.get(
    `${GET_ACTION}?id=${encodeURIComponent(planId)}`,
  );
  expect(res.ok(), `get-visual-plan ok (status ${res.status()})`).toBeTruthy();
  const body = await readJson(res);
  return (body.plan ?? body) as {
    title?: string;
    brief?: string;
    content?: { title?: string; brief?: string; blocks?: PlanBlock[] };
  };
}

async function getPlanBlocks(page: Page, planId: string): Promise<PlanBlock[]> {
  return (await getPlan(page, planId)).content?.blocks ?? [];
}

/** Find the stored table block (by id) and return its `{ columns, rows }`. */
async function getTableData(
  page: Page,
  planId: string,
  blockId: string,
): Promise<{ columns: string[]; rows: string[][] } | null> {
  const block = (await getPlanBlocks(page, planId)).find(
    (b) => b.id === blockId,
  );
  if (!block) return null;
  const data = block.data as
    | { columns?: string[]; rows?: string[][] }
    | undefined;
  return { columns: data?.columns ?? [], rows: data?.rows ?? [] };
}

/**
 * Return the persisted markdown of the FIRST rich-text block (prose run). The
 * blockquote prose lives in the seed rich-text block (RunId keeps its id stable),
 * but adjacent prose runs can coalesce/re-derive ids through the live editor, so
 * prefer the seed id and fall back to the first rich-text block.
 */
async function getProseMarkdown(
  page: Page,
  planId: string,
  preferredId?: string,
): Promise<string> {
  const blocks = await getPlanBlocks(page, planId);
  const block =
    (preferredId ? blocks.find((b) => b.id === preferredId) : undefined) ??
    blocks.find((b) => b.type === "rich-text");
  return ((block?.data as { markdown?: string } | undefined)?.markdown ??
    "") as string;
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

const RICH_SEED_ID = "rt-seed";

/* ========================================================================== */
/* (1) EDITABLE TITLE + SUBTITLE                                               */
/* ========================================================================== */

test.describe("editable plan title + subtitle (header)", () => {
  // The header h1/p are contentEditable and commit on BLUR via onMetadataChange,
  // which persists through update-visual-plan's top-level title/brief args.
  function titleEl(page: Page) {
    // EditableHeaderText sets aria-label="Plan title" on the <h1>.
    return page.locator('[aria-label="Plan title"]');
  }
  function subtitleEl(page: Page) {
    // EditableHeaderText sets aria-label="Plan summary" on the <p>.
    return page.locator('[aria-label="Plan summary"]');
  }

  test("editing the title inline autosaves (update-visual-plan title) and persists on reload", async ({
    page,
  }) => {
    const originalTitle = uniqueTitle("title");
    const planId = await createPlanFixture(page, {
      version: 2,
      title: originalTitle,
      brief: "Original subtitle text.",
      blocks: [
        {
          id: RICH_SEED_ID,
          type: "rich-text",
          editable: true,
          data: { markdown: "Body paragraph." },
        },
      ],
    });
    await openPlanForEditing(page, planId);

    const title = titleEl(page);
    await expect(title).toBeVisible({ timeout: 20_000 });
    await expect(title).toHaveAttribute("contenteditable", "true", {
      timeout: 10_000,
    });
    await expect(title).toHaveText(originalTitle, { timeout: 10_000 });

    const newTitle = `${originalTitle} EDITED`;

    // The metadata save is fired on blur; capture the exact request.
    const savePromise = page.waitForResponse(
      (r) => r.url().includes(UPDATE_ACTION) && r.request().method() === "POST",
      { timeout: 20_000 },
    );

    // Replace the title text inline: select all within the h1, retype, then blur.
    await title.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(newTitle, { delay: 8 });
    // Enter blurs the field (EditableHeaderText preventDefaults Enter + blur()).
    await page.keyboard.press("Enter");

    const saveRes = await savePromise;
    expect(
      saveRes.status(),
      `title autosave returned ${saveRes.status()} — must be 200`,
    ).toBe(200);

    // The autosave must carry the new title as a top-level `title` arg (NOT a
    // content patch). Read it from the request payload.
    const reqBody = saveRes.request().postDataJSON() as
      | { title?: string }
      | undefined;
    expect(
      reqBody?.title,
      `update-visual-plan should send the edited title as a top-level arg (body=${JSON.stringify(
        reqBody,
      ).slice(0, 200)})`,
    ).toBe(newTitle);

    // Server-of-record agrees.
    await expect
      .poll(async () => (await getPlan(page, planId)).title, {
        timeout: 15_000,
      })
      .toBe(newTitle);

    // And it survives a hard reload (re-rendered into the h1).
    await page.reload();
    await expect(titleEl(page)).toHaveText(newTitle, { timeout: 20_000 });
  });

  test("editing the subtitle inline autosaves (update-visual-plan brief) and persists on reload", async ({
    page,
  }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("subtitle"),
      brief: "Original subtitle text.",
      blocks: [
        {
          id: RICH_SEED_ID,
          type: "rich-text",
          editable: true,
          data: { markdown: "Body paragraph." },
        },
      ],
    });
    await openPlanForEditing(page, planId);

    const subtitle = subtitleEl(page);
    await expect(subtitle).toBeVisible({ timeout: 20_000 });
    await expect(subtitle).toHaveAttribute("contenteditable", "true", {
      timeout: 10_000,
    });
    await expect(subtitle).toHaveText("Original subtitle text.", {
      timeout: 10_000,
    });

    const newBrief = `Revised subtitle ${Date.now()}`;

    const savePromise = page.waitForResponse(
      (r) => r.url().includes(UPDATE_ACTION) && r.request().method() === "POST",
      { timeout: 20_000 },
    );

    await subtitle.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(newBrief, { delay: 8 });
    await page.keyboard.press("Enter");

    const saveRes = await savePromise;
    expect(
      saveRes.status(),
      `subtitle autosave returned ${saveRes.status()} — must be 200`,
    ).toBe(200);
    const reqBody = saveRes.request().postDataJSON() as
      | { brief?: string }
      | undefined;
    expect(
      reqBody?.brief,
      `update-visual-plan should send the edited subtitle as the top-level brief arg (body=${JSON.stringify(
        reqBody,
      ).slice(0, 200)})`,
    ).toBe(newBrief);

    await expect
      .poll(async () => (await getPlan(page, planId)).brief, {
        timeout: 15_000,
      })
      .toBe(newBrief);

    await page.reload();
    await expect(subtitleEl(page)).toHaveText(newBrief, { timeout: 20_000 });
  });

  // EDGE: clearing the title to empty must NOT commit an empty title — the h1
  // reverts to its prior value (EditableHeaderText guards `!next && as === "h1"`).
  // Then retyping a real title commits normally.
  test("clearing the title to empty reverts (no empty commit); retyping persists", async ({
    page,
  }) => {
    const originalTitle = uniqueTitle("empty-title");
    const planId = await createPlanFixture(page, {
      version: 2,
      title: originalTitle,
      brief: "Subtitle.",
      blocks: [
        {
          id: RICH_SEED_ID,
          type: "rich-text",
          editable: true,
          data: { markdown: "Body." },
        },
      ],
    });
    await openPlanForEditing(page, planId);

    const title = titleEl(page);
    await expect(title).toHaveText(originalTitle, { timeout: 20_000 });

    // Record every metadata POST to prove NO save carries an empty title.
    const emptyTitleSaves: number[] = [];
    page.on("request", (req) => {
      if (req.url().includes(UPDATE_ACTION) && req.method() === "POST") {
        const body = req.postDataJSON() as { title?: string } | undefined;
        if (body && "title" in body && (body.title ?? "").trim() === "") {
          emptyTitleSaves.push(1);
        }
      }
    });

    // Clear the title entirely and blur.
    await title.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Delete");
    await page.keyboard.press("Enter");

    // The empty value is rejected: the visible h1 reverts to the original title…
    await expect(title).toHaveText(originalTitle, { timeout: 10_000 });
    // …and the server title is unchanged (still the original).
    await page.waitForTimeout(1500);
    expect(
      emptyTitleSaves.length,
      "an empty title must never be committed/saved (EditableHeaderText guards the h1)",
    ).toBe(0);
    expect((await getPlan(page, planId)).title).toBe(originalTitle);

    // Retyping a real title commits normally.
    const retyped = `${originalTitle} RETYPED`;
    const savePromise = page.waitForResponse(
      (r) =>
        r.url().includes(UPDATE_ACTION) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20_000 },
    );
    await title.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(retyped, { delay: 8 });
    await page.keyboard.press("Enter");
    await savePromise;

    await expect
      .poll(async () => (await getPlan(page, planId)).title, {
        timeout: 15_000,
      })
      .toBe(retyped);
  });
});

/* ========================================================================== */
/* (2) STRUCTURED TABLE — inline rich text cells + hover add/remove            */
/* ========================================================================== */

test.describe("structured table block (inline cell editing)", () => {
  const TABLE_ID = "tbl-1";

  /** Seed a plan with a rich-text block + a structured `table` block. */
  function tableContent(opts: { title: string }): PlanContentInput {
    return {
      version: 2,
      title: opts.title,
      brief: "Structured table inline-editing fixture.",
      blocks: [
        {
          id: RICH_SEED_ID,
          type: "rich-text",
          editable: true,
          data: { markdown: "Intro paragraph above the table." },
        },
        {
          id: TABLE_ID,
          type: "table",
          data: {
            columns: ["Name", "Status"],
            rows: [
              ["Alpha", "open"],
              ["Beta", "done"],
            ],
          },
        },
      ],
    };
  }

  /** The inline planBlock NodeView wrapper for the table block id. */
  function tableNode(page: Page) {
    return page
      .locator(
        `.plan-document-editor-surface .plan-block-node[data-block-id="${TABLE_ID}"]`,
      )
      .first();
  }

  test("a cell edits INLINE as rich text (not an overlay) and persists", async ({
    page,
  }) => {
    const planId = await createPlanFixture(
      page,
      tableContent({ title: uniqueTitle("cell-edit") }),
    );
    await openPlanForEditing(page, planId);

    const node = tableNode(page);
    await expect(node, "table NodeView should mount").toBeVisible({
      timeout: 25_000,
    });

    // The editable grid renders DIRECTLY in place (editSurface "inline"): an
    // `.an-table-block-editor` with rich text cells — no click-to-edit overlay.
    const editor = node.locator(".an-table-block-editor");
    await expect(editor).toBeVisible({ timeout: 15_000 });

    // The header editors reflect the seeded columns…
    await expect(
      node.getByRole("textbox", { name: "Column 1 header" }),
    ).toContainText("Name", { timeout: 10_000 });
    // …and cell (row 1, col 1) reflects the seeded value in an editable textbox.
    const cellA1 = node.getByRole("textbox", { name: "Row 1, column 1" });
    await expect(cellA1).toContainText("Alpha");

    const beforeFocusBox = await cellA1.boundingBox();
    const beforeFocusStyles = await cellA1.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        outlineStyle: style.outlineStyle,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
      };
    });

    // Edit the cell inline: focusing/selecting it should not repaint or shift.
    await cellA1.click();
    await expect(cellA1).toBeFocused();
    const afterFocusBox = await cellA1.boundingBox();
    const afterFocusStyles = await cellA1.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        outlineStyle: style.outlineStyle,
        paddingLeft: style.paddingLeft,
        paddingRight: style.paddingRight,
      };
    });
    expect(afterFocusStyles).toEqual(beforeFocusStyles);
    expect(afterFocusBox).not.toBeNull();
    expect(beforeFocusBox).not.toBeNull();
    if (beforeFocusBox && afterFocusBox) {
      expect(afterFocusBox.x).toBeCloseTo(beforeFocusBox.x, 1);
      expect(afterFocusBox.y).toBeCloseTo(beforeFocusBox.y, 1);
      expect(afterFocusBox.width).toBeCloseTo(beforeFocusBox.width, 1);
      expect(afterFocusBox.height).toBeCloseTo(beforeFocusBox.height, 1);
    }

    await cellA1.selectText();
    await expect(cellA1).toBeFocused();
    await page.keyboard.type("hello world");
    await expect(cellA1).toContainText("hello world");
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("ArrowLeft");
    }
    await page.keyboard.type("a");
    await expect(cellA1).toContainText("helloa world");

    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("AlphaEDITED");
    // The optimistic value updates in place.
    await expect(cellA1).toContainText("AlphaEDITED");

    // The whole-block change autosaves (debounced replace-blocks). Poll the SoR.
    await expect
      .poll(
        async () =>
          (await getTableData(page, planId, TABLE_ID))?.rows?.[0]?.[0],
        { timeout: 15_000 },
      )
      .toBe("AlphaEDITED");

    // And the edit survives a reload, re-rendered into the live rich text cell.
    await page.reload();
    const node2 = tableNode(page);
    await expect(node2).toBeVisible({ timeout: 25_000 });
    await expect(
      node2.getByRole("textbox", { name: "Row 1, column 1" }),
    ).toContainText("AlphaEDITED", { timeout: 15_000 });
  });

  test("hovering the table reveals add-row / add-column / remove controls; add row + column persist", async ({
    page,
  }) => {
    const planId = await createPlanFixture(
      page,
      tableContent({ title: uniqueTitle("add-row-col") }),
    );
    await openPlanForEditing(page, planId);

    const node = tableNode(page);
    await expect(node).toBeVisible({ timeout: 25_000 });
    await expect(node.locator(".an-table-block-editor")).toBeVisible({
      timeout: 15_000,
    });

    // Footer add controls start hidden and become visible on table hover. The
    // table renders TWO add-column affordances — the footer button (visible text
    // "Add column", from `addButtonClass`) and an in-grid header button
    // (aria-label "Add column in grid"). Match the footer control EXACTLY so the
    // locator resolves to a single element (a substring "Add column" would also
    // match "Add column in grid" and trip strict mode).
    const addRowBtn = node.getByRole("button", { name: "Add row" });
    const addColBtn = node.getByRole("button", {
      name: "Add column",
      exact: true,
    });
    await expect(addRowBtn).toHaveCSS("opacity", "0", { timeout: 8_000 });
    await expect(addColBtn).toHaveCSS("opacity", "0", { timeout: 8_000 });

    await node.locator(".an-table-block-editor").hover();

    await expect(addRowBtn).toHaveCSS("opacity", "1", { timeout: 8_000 });
    await expect(addColBtn).toHaveCSS("opacity", "1", { timeout: 8_000 });

    // Remove controls are scoped to the active row/header instead of lighting
    // up across the whole table.
    const row1Remove = node.getByRole("button", { name: "Remove row 1" });
    const row2Remove = node.getByRole("button", { name: "Remove row 2" });
    const col1Remove = node.getByRole("button", { name: "Remove column 1" });
    const col2Remove = node.getByRole("button", { name: "Remove column 2" });

    await node.getByRole("textbox", { name: "Row 1, column 1" }).hover();
    await expect(row1Remove).toHaveCSS("opacity", "1", { timeout: 8_000 });
    await expect(row2Remove).toHaveCSS("opacity", "0", { timeout: 8_000 });

    await node.getByRole("textbox", { name: "Row 2, column 1" }).hover();
    await expect(row1Remove).toHaveCSS("opacity", "0", { timeout: 8_000 });
    await expect(row2Remove).toHaveCSS("opacity", "1", { timeout: 8_000 });

    await node.getByRole("textbox", { name: "Column 1 header" }).hover();
    await expect(col1Remove).toHaveCSS("opacity", "1", { timeout: 8_000 });
    await expect(col2Remove).toHaveCSS("opacity", "0", { timeout: 8_000 });

    await node.getByRole("textbox", { name: "Column 2 header" }).hover();
    await expect(col1Remove).toHaveCSS("opacity", "0", { timeout: 8_000 });
    await expect(col2Remove).toHaveCSS("opacity", "1", { timeout: 8_000 });
    await expect(
      node.getByRole("button", { name: /^Table padding:/ }),
    ).toHaveCount(0);

    // Sanity: seed shape is 2 columns × 2 rows.
    const before = await getTableData(page, planId, TABLE_ID);
    expect(before?.columns.length).toBe(2);
    expect(before?.rows.length).toBe(2);

    // Add a row → 3 rows, each rectangular at 2 columns.
    await addRowBtn.click();
    await expect
      .poll(
        async () =>
          (await getTableData(page, planId, TABLE_ID))?.rows?.length ?? 0,
        { timeout: 15_000 },
      )
      .toBe(3);

    // Add a column → 3 columns; existing rows extended with an empty cell. Use
    // the same exact footer control to avoid matching the in-grid "Add column in
    // grid" header button.
    await node.locator(".an-table-block-editor").hover();
    await addColBtn.click();
    await expect
      .poll(
        async () =>
          (await getTableData(page, planId, TABLE_ID))?.columns?.length ?? 0,
        { timeout: 15_000 },
      )
      .toBe(3);

    // Rows stay rectangular with the new column count.
    const after = await getTableData(page, planId, TABLE_ID);
    expect(after?.rows.length).toBe(3);
    for (const row of after?.rows ?? []) {
      expect(
        row.length,
        `every row must match the 3-column count after add-column (got ${row.length})`,
      ).toBe(3);
    }

    // The grid now exposes a 3rd column header editor and a row-3 cell editor.
    await expect(
      node.getByRole("textbox", { name: "Column 3 header" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      node.getByRole("textbox", { name: "Row 3, column 1" }),
    ).toBeVisible({ timeout: 10_000 });
  });

  // EDGE: a table with exactly ONE row still exposes its remove-row control, and
  // removing that last row drops the row count to 0 (columns are preserved). The
  // remove control is NOT hidden/disabled at one row — there is no minimum-row
  // guard in TableBlockEdit, so the single remove-row button stays usable.
  test("single-row table: the remove-row control is present and removes the last row", async ({
    page,
  }) => {
    const oneRowId = "tbl-one-row";
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("one-row"),
      brief: "Single-row table edge fixture.",
      blocks: [
        {
          id: RICH_SEED_ID,
          type: "rich-text",
          editable: true,
          data: { markdown: "Intro." },
        },
        {
          id: oneRowId,
          type: "table",
          data: {
            columns: ["Only"],
            rows: [["solo"]],
          },
        },
      ],
    });
    await openPlanForEditing(page, planId);

    const node = page
      .locator(
        `.plan-document-editor-surface .plan-block-node[data-block-id="${oneRowId}"]`,
      )
      .first();
    await expect(node).toBeVisible({ timeout: 25_000 });
    await expect(node.locator(".an-table-block-editor")).toBeVisible({
      timeout: 15_000,
    });
    await node.hover();

    // Exactly one remove-row control (for the one row); it is enabled, not hidden.
    const removeRow1 = node.getByRole("button", { name: "Remove row 1" });
    await expect(removeRow1).toBeVisible({ timeout: 8_000 });
    await expect(removeRow1).toBeEnabled();
    await expect(
      node.getByRole("button", { name: "Remove row 2" }),
    ).toHaveCount(0);

    // Removing the only row drops to 0 rows while keeping the column intact.
    await removeRow1.click();
    await expect
      .poll(
        async () => {
          const data = await getTableData(page, planId, oneRowId);
          return data ? data.rows.length : -1;
        },
        { timeout: 15_000 },
      )
      .toBe(0);
    const after = await getTableData(page, planId, oneRowId);
    expect(after?.columns).toEqual(["Only"]);
  });

  test("inserting a structured table via the slash menu adds an editable grid that persists", async ({
    page,
  }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("slash-table"),
      brief: "Slash-insert structured table fixture.",
      blocks: [
        {
          id: RICH_SEED_ID,
          type: "rich-text",
          editable: true,
          data: { markdown: "Seed paragraph." },
        },
      ],
    });
    const prose = await openPlanForEditing(page, planId);

    // No table block exists yet.
    expect(
      (await getPlanBlocks(page, planId)).some((b) => b.type === "table"),
    ).toBe(false);

    // Open the "/" menu and narrow to the registry table. Its slash TITLE is
    // "Structured table" (planSlashCommands.ts) — distinct from the prose "Table"
    // command (a native ProseMirror table). Match on the registry title to avoid
    // selecting the prose table.
    await prose.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/Structured table", { delay: 20 });

    const menu = page.locator(".an-rich-md-slash-menu");
    await expect(menu).toBeVisible({ timeout: 8_000 });
    const item = page
      .locator(".an-rich-md-slash-item")
      .filter({ hasText: "Structured table" });
    await expect(item).toHaveCount(1, { timeout: 8_000 });

    const okSave = page.waitForResponse(
      (r) =>
        r.url().includes(UPDATE_ACTION) &&
        r.request().method() === "POST" &&
        r.status() === 200,
      { timeout: 20_000 },
    );
    await item.first().click();
    await okSave;

    // A table block now persists (seeded 2×2 from spec.empty()).
    await expect
      .poll(
        async () =>
          (await getPlanBlocks(page, planId)).filter((b) => b.type === "table")
            .length,
        { timeout: 15_000 },
      )
      .toBe(1);

    // And it renders inline as an editable grid with rich text cells.
    const inserted = (await getPlanBlocks(page, planId)).find(
      (b) => b.type === "table",
    );
    expect(inserted, "inserted table block present").toBeTruthy();
    const node = page
      .locator(
        `.plan-document-editor-surface .plan-block-node[data-block-id="${inserted!.id}"]`,
      )
      .first();
    await expect(node).toBeVisible({ timeout: 20_000 });
    await expect(node.locator(".an-table-block-editor")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      node.getByRole("textbox", { name: "Column 1 header" }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

/* ========================================================================== */
/* (3) BLOCKQUOTE — slash insert, inline freely-editable prose, persists       */
/* ========================================================================== */

test.describe("blockquote (inline prose, not an atom)", () => {
  const slashMenu = (page: Page) => page.locator(".an-rich-md-slash-menu");
  const slashTitles = (page: Page) =>
    page.locator(".an-rich-md-slash-menu .an-rich-md-slash-title");
  const slashItemByTitle = (page: Page, title: string) =>
    page.locator(".an-rich-md-slash-item", {
      has: page.locator(".an-rich-md-slash-title", { hasText: title }),
    });

  test("slash Quote inserts a freely-editable blockquote whose text persists as `> …` markdown", async ({
    page,
  }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("blockquote"),
      brief: "Blockquote inline-editing fixture.",
      blocks: [
        {
          id: RICH_SEED_ID,
          type: "rich-text",
          editable: true,
          data: { markdown: "Lead paragraph." },
        },
      ],
    });
    const prose = await openPlanForEditing(page, planId);

    // Open the "/" menu and narrow to the prose "Quote" command (toggleBlockquote).
    await prose.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/Quote", { delay: 20 });
    await expect(slashMenu(page)).toBeVisible({ timeout: 8_000 });
    await expect(
      slashTitles(page).filter({ hasText: /^Quote$/ }),
      "the prose Quote slash command is offered",
    ).toHaveCount(1);

    await slashItemByTitle(page, "Quote").first().click();

    // A real ProseMirror <blockquote> appears in the prose surface (NOT a
    // planBlock atom NodeView — the blockquote is freely-editable prose).
    const blockquote = prose.locator("blockquote").first();
    await expect(blockquote).toBeVisible({ timeout: 10_000 });

    // Type the first line directly inside the blockquote.
    const line1 = `Quoted line ${Date.now()}`;
    await page.keyboard.type(line1, { delay: 10 });
    // Pressing Enter inside a blockquote adds another line WITHIN the same quote
    // (Tiptap default), so a multi-line quote round-trips to two `>` lines.
    await page.keyboard.press("Enter");
    const line2 = "Second quoted line";
    await page.keyboard.type(line2, { delay: 10 });

    // Optimistic render: both lines appear inside the same <blockquote>.
    await expect(blockquote).toContainText(line1, { timeout: 8_000 });
    await expect(blockquote).toContainText(line2, { timeout: 8_000 });

    // Prove it is NOT an atom: the blockquote text is part of the contenteditable
    // prose. The blockquote is a descendant of the editable surface (no
    // contenteditable="false" atom wrapper, unlike a planBlock NodeView).
    await expect(
      prose.locator(".plan-block-node blockquote"),
      "the blockquote must be inline prose, not inside a planBlock atom NodeView",
    ).toHaveCount(0);

    // The whole-doc autosave (debounced replace-blocks) persists the quote as
    // GFM `> …` lines inside the rich-text prose run. Poll the server-of-record.
    await expect
      .poll(async () => await getProseMarkdown(page, planId, RICH_SEED_ID), {
        timeout: 15_000,
      })
      .toContain(`> ${line1}`);
    const md = await getProseMarkdown(page, planId, RICH_SEED_ID);
    expect(
      md,
      `persisted prose markdown should carry the second quoted line too: ${md}`,
    ).toContain(line2);

    // After a reload the blockquote re-renders with both lines (round-trips).
    await page.reload();
    const proseAfter = proseFor(page);
    await expect(proseAfter).toBeVisible({ timeout: 25_000 });
    const blockquoteAfter = proseAfter.locator("blockquote").first();
    await expect(blockquoteAfter).toContainText(line1, { timeout: 15_000 });
    await expect(blockquoteAfter).toContainText(line2, { timeout: 10_000 });
  });

  // EDGE: typing across the autosave race — type a long burst into a blockquote
  // with NO per-keystroke waits. The editor debounces + serializes saves, so the
  // FINAL coalesced text must win (no 5xx, no dropped tail) and persist as `> …`.
  test("rapid typing into a blockquote coalesces; the final text wins (autosave race)", async ({
    page,
  }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("blockquote-race"),
      brief: "Blockquote autosave-race fixture.",
      blocks: [
        {
          id: RICH_SEED_ID,
          type: "rich-text",
          editable: true,
          data: { markdown: "Lead." },
        },
      ],
    });
    const prose = await openPlanForEditing(page, planId);

    // Record every autosave status to assert the debounced editor never 5xx's.
    const statuses: number[] = [];
    page.on("response", (r) => {
      if (r.url().includes(UPDATE_ACTION) && r.request().method() === "POST") {
        statuses.push(r.status());
      }
    });

    // Insert a blockquote via slash, then fire a fast burst with NO waits.
    await prose.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/Quote", { delay: 20 });
    await expect(page.locator(".an-rich-md-slash-menu")).toBeVisible({
      timeout: 8_000,
    });
    await slashItemByTitle(page, "Quote").first().click();

    const blockquote = prose.locator("blockquote").first();
    await expect(blockquote).toBeVisible({ timeout: 10_000 });

    const burst = "RACEoneTWOthreeFOURfiveSIXsevenEIGHT";
    await page.keyboard.type(burst, { delay: 6 });

    // Let the debounced, serialized saves flush.
    await page.waitForTimeout(3000);

    // CONTRACT: the debounced/serialized single-doc autosave must not 5xx while
    // typing one burst (it coalesces keystrokes + keeps one save in-flight).
    const fiveXX = statuses.filter((s) => s >= 500);
    expect(
      fiveXX,
      `blockquote autosave 5xx'd ${fiveXX.length}/${statuses.length} times while typing one burst — the debounced/serialized save must never race itself. statuses=[${statuses.join(",")}]`,
    ).toEqual([]);

    // The FINAL coalesced text must win (no dropped tail), persisted as `> …`.
    await expect
      .poll(async () => await getProseMarkdown(page, planId, RICH_SEED_ID), {
        timeout: 15_000,
      })
      .toContain(`> ${burst}`);
  });
});
