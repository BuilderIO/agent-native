import { test, expect, type Page, type APIResponse } from "@playwright/test";

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

test.describe("editable plan title + subtitle (header)", () => {
  function titleEl(page: Page) {
    return page.locator('[aria-label="Plan title"]');
  }
  function subtitleEl(page: Page) {
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

    const savePromise = page.waitForResponse(
      (r) => r.url().includes(UPDATE_ACTION) && r.request().method() === "POST",
      { timeout: 20_000 },
    );

    await title.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(newTitle, { delay: 8 });
    await page.keyboard.press("Enter");

    const saveRes = await savePromise;
    expect(
      saveRes.status(),
      `title autosave returned ${saveRes.status()} — must be 200`,
    ).toBe(200);

    const reqBody = saveRes.request().postDataJSON() as
      | { title?: string }
      | undefined;
    expect(
      reqBody?.title,
      `update-visual-plan should send the edited title as a top-level arg (body=${JSON.stringify(
        reqBody,
      ).slice(0, 200)})`,
    ).toBe(newTitle);

    await expect
      .poll(async () => (await getPlan(page, planId)).title, {
        timeout: 15_000,
      })
      .toBe(newTitle);

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

    const emptyTitleSaves: number[] = [];
    page.on("request", (req) => {
      if (req.url().includes(UPDATE_ACTION) && req.method() === "POST") {
        const body = req.postDataJSON() as { title?: string } | undefined;
        if (body && "title" in body && (body.title ?? "").trim() === "") {
          emptyTitleSaves.push(1);
        }
      }
    });

    await title.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Delete");
    await page.keyboard.press("Enter");

    await expect(title).toHaveText(originalTitle, { timeout: 10_000 });
    await page.waitForTimeout(1500);
    expect(
      emptyTitleSaves.length,
      "an empty title must never be committed/saved (EditableHeaderText guards the h1)",
    ).toBe(0);
    expect((await getPlan(page, planId)).title).toBe(originalTitle);

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

test.describe("structured table block (inline cell editing)", () => {
  const TABLE_ID = "tbl-1";

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

    const editor = node.locator(".an-table-block-editor");
    await expect(editor).toBeVisible({ timeout: 15_000 });

    await expect(
      node.getByRole("textbox", { name: "Column 1 header" }),
    ).toContainText("Name", { timeout: 10_000 });
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
    await expect(cellA1).toContainText("AlphaEDITED");

    await expect
      .poll(
        async () =>
          (await getTableData(page, planId, TABLE_ID))?.rows?.[0]?.[0],
        { timeout: 15_000 },
      )
      .toBe("AlphaEDITED");

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

    const before = await getTableData(page, planId, TABLE_ID);
    expect(before?.columns.length).toBe(2);
    expect(before?.rows.length).toBe(2);

    await addRowBtn.click();
    await expect
      .poll(
        async () =>
          (await getTableData(page, planId, TABLE_ID))?.rows?.length ?? 0,
        { timeout: 15_000 },
      )
      .toBe(3);

    await node.locator(".an-table-block-editor").hover();
    await addColBtn.click();
    await expect
      .poll(
        async () =>
          (await getTableData(page, planId, TABLE_ID))?.columns?.length ?? 0,
        { timeout: 15_000 },
      )
      .toBe(3);

    const after = await getTableData(page, planId, TABLE_ID);
    expect(after?.rows.length).toBe(3);
    for (const row of after?.rows ?? []) {
      expect(
        row.length,
        `every row must match the 3-column count after add-column (got ${row.length})`,
      ).toBe(3);
    }

    await expect(
      node.getByRole("textbox", { name: "Column 3 header" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      node.getByRole("textbox", { name: "Row 3, column 1" }),
    ).toBeVisible({ timeout: 10_000 });
  });

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

    const removeRow1 = node.getByRole("button", { name: "Remove row 1" });
    await expect(removeRow1).toBeVisible({ timeout: 8_000 });
    await expect(removeRow1).toBeEnabled();
    await expect(
      node.getByRole("button", { name: "Remove row 2" }),
    ).toHaveCount(0);

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

    expect(
      (await getPlanBlocks(page, planId)).some((b) => b.type === "table"),
    ).toBe(false);

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

    await expect
      .poll(
        async () =>
          (await getPlanBlocks(page, planId)).filter((b) => b.type === "table")
            .length,
        { timeout: 15_000 },
      )
      .toBe(1);

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

    const blockquote = prose.locator("blockquote").first();
    await expect(blockquote).toBeVisible({ timeout: 10_000 });

    const line1 = `Quoted line ${Date.now()}`;
    await page.keyboard.type(line1, { delay: 10 });
    await page.keyboard.press("Enter");
    const line2 = "Second quoted line";
    await page.keyboard.type(line2, { delay: 10 });

    await expect(blockquote).toContainText(line1, { timeout: 8_000 });
    await expect(blockquote).toContainText(line2, { timeout: 8_000 });

    await expect(
      prose.locator(".plan-block-node blockquote"),
      "the blockquote must be inline prose, not inside a planBlock atom NodeView",
    ).toHaveCount(0);

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

    const statuses: number[] = [];
    page.on("response", (r) => {
      if (r.url().includes(UPDATE_ACTION) && r.request().method() === "POST") {
        statuses.push(r.status());
      }
    });

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

    await page.waitForTimeout(3000);

    const fiveXX = statuses.filter((s) => s >= 500);
    expect(
      fiveXX,
      `blockquote autosave 5xx'd ${fiveXX.length}/${statuses.length} times while typing one burst — the debounced/serialized save must never race itself. statuses=[${statuses.join(",")}]`,
    ).toEqual([]);

    await expect
      .poll(async () => await getProseMarkdown(page, planId, RICH_SEED_ID), {
        timeout: 15_000,
      })
      .toContain(`> ${burst}`);
  });
});
