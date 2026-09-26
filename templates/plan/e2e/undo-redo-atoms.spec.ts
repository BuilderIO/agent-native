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
  return `Atom/Undo ${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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

async function getBlockData(
  page: Page,
  planId: string,
  blockId: string,
): Promise<Record<string, unknown> | null> {
  const blocks = await getPlanBlocks(page, planId);
  return (blocks.find((b) => b.id === blockId)?.data ?? null) as Record<
    string,
    unknown
  > | null;
}

async function getRichTextMarkdown(
  page: Page,
  planId: string,
  blockId: string,
): Promise<string | null> {
  const data = await getBlockData(page, planId, blockId);
  const md = (data as { markdown?: unknown } | null)?.markdown;
  return typeof md === "string" ? md : null;
}

function proseFor(page: Page) {
  return page
    .locator(".plan-document-editor-surface .an-rich-md-prose")
    .first();
}

function blockNode(page: Page, blockId: string) {
  return page
    .locator(
      `.plan-document-editor-surface .plan-block-node[data-block-id="${blockId}"]`,
    )
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

async function selectBlockAtom(page: Page, blockId: string) {
  const node = blockNode(page, blockId);
  await expect(node).toBeVisible({ timeout: 20_000 });

  const box = await node.boundingBox();
  if (box) {
    await page.mouse.click(box.x + 6, box.y + 6);
  } else {
    await node.click({ position: { x: 6, y: 6 } });
  }

  await expect(node).toHaveClass(/ProseMirror-selectednode/, {
    timeout: 8_000,
  });
}

type SaveWatch = { statuses: number[] };
function watchSaves(page: Page): SaveWatch {
  const watch: SaveWatch = { statuses: [] };
  page.on("response", (r) => {
    if (r.url().includes(UPDATE_ACTION) && r.request().method() === "POST") {
      watch.statuses.push(r.status());
    }
  });
  return watch;
}

const DIAGRAM_BLOCK_ID = "diag-keep";
const DIAGRAM_LABEL = "KEEP-THIS-NODE";
const RT_BLOCK_ID = "rt-intro";

function atomFixtureContent(title: string): PlanContentInput {
  return {
    version: 2,
    title,
    brief: "Atom-safety fixture: prose + a labelled diagram atom.",
    blocks: [
      {
        id: RT_BLOCK_ID,
        type: "rich-text",
        editable: true,
        data: { markdown: "Intro paragraph above the diagram." },
      },
      {
        id: DIAGRAM_BLOCK_ID,
        type: "diagram",
        title: "Architecture",
        data: {
          nodes: [
            { id: "keep", label: DIAGRAM_LABEL },
            { id: "other", label: "Service" },
          ],
          edges: [{ from: "keep", to: "other" }],
        },
      },
    ],
  };
}

test.describe
  .fixme("atom safety: keyboardGuard blocks mutation on a node-selected block", () => {
  test("typing a printable char with a diagram atom selected inserts NO stray block and leaves the atom data unchanged", async ({
    page,
  }) => {
    const planId = await createPlanFixture(
      page,
      atomFixtureContent(uniqueTitle("type-on-atom")),
    );

    const before = await getPlanBlocks(page, planId);
    expect(before.map((b) => b.type)).toEqual(["rich-text", "diagram"]);
    const beforeData = await getBlockData(page, planId, DIAGRAM_BLOCK_ID);
    expect(JSON.stringify(beforeData)).toContain(DIAGRAM_LABEL);
    expect(JSON.stringify(beforeData)).not.toContain("Module");

    await openPlanForEditing(page, planId);
    const node = blockNode(page, DIAGRAM_BLOCK_ID);
    await expect(node).toContainText(DIAGRAM_LABEL, { timeout: 20_000 });

    const saves = watchSaves(page);
    await selectBlockAtom(page, DIAGRAM_BLOCK_ID);

    await page.keyboard.type("xyz", { delay: 30 });
    await page.keyboard.press("a");

    await page.waitForTimeout(1500);

    await expect
      .poll(
        async () => (await getPlanBlocks(page, planId)).map((b) => b.type),
        {
          timeout: 12_000,
        },
      )
      .toEqual(["rich-text", "diagram"]);

    const afterData = await getBlockData(page, planId, DIAGRAM_BLOCK_ID);
    expect(
      JSON.stringify(afterData),
      `atom data must be unchanged after typing on a node-selected diagram. before=${JSON.stringify(
        beforeData,
      )} after=${JSON.stringify(afterData)}`,
    ).toBe(JSON.stringify(beforeData));
    expect(JSON.stringify(afterData)).not.toContain("Module");
    expect(JSON.stringify(afterData)).not.toContain("xyz");

    await expect(
      page
        .locator(".plan-document-editor-surface .plan-block-node")
        .filter({ hasText: "Module" }),
    ).toHaveCount(0);

    expect(await getRichTextMarkdown(page, planId, RT_BLOCK_ID)).toBe(
      "Intro paragraph above the diagram.",
    );

    expect(
      saves.statuses,
      `guarded keystrokes must not trigger an autosave; saw statuses=[${saves.statuses.join(
        ",",
      )}]`,
    ).toEqual([]);
  });

  test("EDGE: pressing Enter while a diagram atom is selected does not split/replace it into a default diagram", async ({
    page,
  }) => {
    const planId = await createPlanFixture(
      page,
      atomFixtureContent(uniqueTitle("enter-on-atom")),
    );
    const before = await getPlanBlocks(page, planId);
    expect(before.map((b) => b.type)).toEqual(["rich-text", "diagram"]);
    const beforeData = await getBlockData(page, planId, DIAGRAM_BLOCK_ID);

    await openPlanForEditing(page, planId);
    const saves = watchSaves(page);
    await selectBlockAtom(page, DIAGRAM_BLOCK_ID);

    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);

    await expect
      .poll(
        async () => (await getPlanBlocks(page, planId)).map((b) => b.type),
        {
          timeout: 12_000,
        },
      )
      .toEqual(["rich-text", "diagram"]);
    const afterData = await getBlockData(page, planId, DIAGRAM_BLOCK_ID);
    expect(JSON.stringify(afterData)).toBe(JSON.stringify(beforeData));
    expect(JSON.stringify(afterData)).not.toContain("Module");
    await expect(
      page
        .locator(".plan-document-editor-surface .plan-block-node")
        .filter({ hasText: "Module" }),
    ).toHaveCount(0);
    expect(
      saves.statuses,
      `Enter on a node-selected atom must not autosave; statuses=[${saves.statuses.join(
        ",",
      )}]`,
    ).toEqual([]);
  });

  test("EDGE: pasting while a diagram atom is selected does not corrupt the doc into a default diagram", async ({
    page,
  }) => {
    const planId = await createPlanFixture(
      page,
      atomFixtureContent(uniqueTitle("paste-on-atom")),
    );
    const before = await getPlanBlocks(page, planId);
    expect(before.map((b) => b.type)).toEqual(["rich-text", "diagram"]);
    const beforeData = await getBlockData(page, planId, DIAGRAM_BLOCK_ID);

    await openPlanForEditing(page, planId);
    const saves = watchSaves(page);

    const pasted = "PASTED-INTO-ATOM-SHOULD-NOT-LAND";
    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text).catch(() => {});
    }, pasted);

    await selectBlockAtom(page, DIAGRAM_BLOCK_ID);

    await page.keyboard.press("ControlOrMeta+V");
    await page.waitForTimeout(1500);

    await expect
      .poll(
        async () => (await getPlanBlocks(page, planId)).map((b) => b.type),
        {
          timeout: 12_000,
        },
      )
      .toEqual(["rich-text", "diagram"]);
    const afterData = await getBlockData(page, planId, DIAGRAM_BLOCK_ID);
    expect(JSON.stringify(afterData)).toBe(JSON.stringify(beforeData));
    expect(JSON.stringify(afterData)).not.toContain("Module");

    const allMarkdown = (await getPlanBlocks(page, planId))
      .map((b) => JSON.stringify(b.data ?? {}))
      .join("\n");
    expect(
      allMarkdown,
      "pasted text must not have landed anywhere in the doc",
    ).not.toContain(pasted);
    await expect(
      page
        .locator(".plan-document-editor-surface .plan-block-node")
        .filter({ hasText: "Module" }),
    ).toHaveCount(0);
    expect(
      saves.statuses,
      `paste on a node-selected atom must not autosave; statuses=[${saves.statuses.join(
        ",",
      )}]`,
    ).toEqual([]);
  });

  test("dedupe: a SECOND block keeps its own id and data when an atom is selected and typed on (no id collision / data bleed)", async ({
    page,
  }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("two-atoms"),
      brief: "Two distinct diagram atoms.",
      blocks: [
        {
          id: "rt-seed",
          type: "rich-text",
          editable: true,
          data: { markdown: "Seed." },
        },
        {
          id: "diag-one",
          type: "diagram",
          data: { nodes: [{ id: "one", label: "ALPHA-DIAGRAM" }], edges: [] },
        },
        {
          id: "diag-two",
          type: "diagram",
          data: { nodes: [{ id: "two", label: "BETA-DIAGRAM" }], edges: [] },
        },
      ],
    });

    await openPlanForEditing(page, planId);
    await expect(blockNode(page, "diag-one")).toContainText("ALPHA-DIAGRAM", {
      timeout: 20_000,
    });
    await expect(blockNode(page, "diag-two")).toContainText("BETA-DIAGRAM");

    await selectBlockAtom(page, "diag-one");
    await page.keyboard.type("zzz", { delay: 30 });
    await page.waitForTimeout(1200);

    const blocks = await getPlanBlocks(page, planId);
    const one = blocks.find((b) => b.id === "diag-one");
    const two = blocks.find((b) => b.id === "diag-two");
    expect(one, "diag-one still present by id").toBeTruthy();
    expect(two, "diag-two still present by id").toBeTruthy();
    expect(JSON.stringify(one?.data)).toContain("ALPHA-DIAGRAM");
    expect(JSON.stringify(two?.data)).toContain("BETA-DIAGRAM");
    expect(JSON.stringify(one?.data)).not.toContain("BETA-DIAGRAM");
    expect(JSON.stringify(blocks)).not.toContain("Module");
    expect(JSON.stringify(blocks)).not.toContain("zzz");
  });
});

test.describe("undo / redo restores the document", () => {
  test("type text in a rich-text block then Ctrl/Cmd+Z removes it; redo re-applies", async ({
    page,
  }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("undo-text"),
      brief: "Undo/redo rich-text fixture.",
      blocks: [
        {
          id: RT_BLOCK_ID,
          type: "rich-text",
          editable: true,
          data: { markdown: "Original sentence." },
        },
      ],
    });
    const prose = await openPlanForEditing(page, planId);

    const typed = " UNDOABLE-EDIT";
    await prose.getByText("Original sentence.").click();
    await page.keyboard.press("End");
    await page.keyboard.type(typed, { delay: 15 });

    await expect(prose).toContainText("UNDOABLE-EDIT", { timeout: 5_000 });

    await expect
      .poll(async () => await getRichTextMarkdown(page, planId, RT_BLOCK_ID), {
        timeout: 15_000,
      })
      .toContain("UNDOABLE-EDIT");

    await prose.click();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("ControlOrMeta+z");
    }
    await expect(prose).not.toContainText("UNDOABLE-EDIT", { timeout: 8_000 });
    await expect(prose).toContainText("Original sentence", { timeout: 8_000 });

    // the token. (If undo only mutated the DOM without re-serializing, this fails.)
    await expect
      .poll(async () => await getRichTextMarkdown(page, planId, RT_BLOCK_ID), {
        timeout: 15_000,
      })
      .not.toContain("UNDOABLE-EDIT");

    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("ControlOrMeta+y");
      await page.keyboard.press("ControlOrMeta+Shift+z");
    }
    await expect(prose).toContainText("UNDOABLE-EDIT", { timeout: 8_000 });
    await expect
      .poll(async () => await getRichTextMarkdown(page, planId, RT_BLOCK_ID), {
        timeout: 15_000,
      })
      .toContain("UNDOABLE-EDIT");
  });

  test("EDGE: undo after editing deep inside a nested list item restores that leaf exactly", async ({
    page,
  }) => {
    const nestedMarkdown = [
      "- Top item one",
      "- Top item two",
      "  - Nested leaf A",
      "  - Nested leaf B",
    ].join("\n");
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("undo-nested"),
      brief: "Undo inside a nested list leaf.",
      blocks: [
        {
          id: RT_BLOCK_ID,
          type: "rich-text",
          editable: true,
          data: { markdown: nestedMarkdown },
        },
      ],
    });
    const prose = await openPlanForEditing(page, planId);

    await expect(prose).toContainText("Nested leaf A", { timeout: 15_000 });
    await expect(prose).toContainText("Nested leaf B");

    // a token to that specific leaf. Clicking the text node, then Control+End would
    const leafB = prose
      .locator("li")
      .filter({ hasText: "Nested leaf B" })
      .last();
    await expect(leafB).toBeVisible({ timeout: 8_000 });
    await leafB.click();
    await page.keyboard.press("End");
    const leafToken = "-DEEPEDIT";
    await page.keyboard.type(leafToken, { delay: 15 });

    await expect(leafB).toContainText("Nested leaf B-DEEPEDIT", {
      timeout: 5_000,
    });
    await expect(prose).toContainText("Nested leaf A");

    await expect
      .poll(async () => await getRichTextMarkdown(page, planId, RT_BLOCK_ID), {
        timeout: 15_000,
      })
      .toContain("Nested leaf B-DEEPEDIT");

    // Undo the leaf edit. The nested list must be restored EXACTLY — the token
    await prose.click();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("ControlOrMeta+z");
    }
    await expect(prose).not.toContainText("DEEPEDIT", { timeout: 8_000 });
    for (const item of [
      "Top item one",
      "Top item two",
      "Nested leaf A",
      "Nested leaf B",
    ]) {
      await expect(prose).toContainText(item, { timeout: 8_000 });
    }

    await expect
      .poll(async () => await getRichTextMarkdown(page, planId, RT_BLOCK_ID), {
        timeout: 15_000,
      })
      .not.toContain("DEEPEDIT");
    const restored =
      (await getRichTextMarkdown(page, planId, RT_BLOCK_ID)) ?? "";
    expect(
      restored,
      `nested list must be restored with indentation intact, got:\n${restored}`,
    ).toMatch(/(^|\n)\s{1,4}[-*]\s+Nested leaf B\s*(\n|$)/);
  });

  test("EDGE: undo of an edit made AFTER a structured atom restores the prose without disturbing the atom", async ({
    page,
  }) => {
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("undo-after-atom"),
      brief: "Undo a prose edit that follows a diagram atom.",
      blocks: [
        {
          id: "rt-head",
          type: "rich-text",
          editable: true,
          data: { markdown: "Heading prose." },
        },
        {
          id: DIAGRAM_BLOCK_ID,
          type: "diagram",
          data: {
            nodes: [{ id: "keep", label: DIAGRAM_LABEL }],
            edges: [],
          },
        },
        {
          id: "rt-tail",
          type: "rich-text",
          editable: true,
          data: { markdown: "Tail prose to edit." },
        },
      ],
    });
    const prose = await openPlanForEditing(page, planId);
    await expect(blockNode(page, DIAGRAM_BLOCK_ID)).toContainText(
      DIAGRAM_LABEL,
      { timeout: 20_000 },
    );
    const atomBefore = await getBlockData(page, planId, DIAGRAM_BLOCK_ID);

    // empty edge can drop the caret outside the text node, so the token never
    const tailParagraph = prose
      .locator("p")
      .filter({ hasText: "Tail prose to edit." })
      .last();
    await expect(tailParagraph).toBeVisible({ timeout: 10_000 });
    await tailParagraph.click();
    await page.keyboard.press("End");
    const token = " TAIL-EDIT-TOKEN";
    await page.keyboard.type(token, { delay: 15 });
    await expect(prose).toContainText("TAIL-EDIT-TOKEN", { timeout: 5_000 });
    await expect
      .poll(async () => await getRichTextMarkdown(page, planId, "rt-tail"), {
        timeout: 15_000,
      })
      .toContain("TAIL-EDIT-TOKEN");

    await tailParagraph.click();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("ControlOrMeta+z");
    }
    await expect(prose).not.toContainText("TAIL-EDIT-TOKEN", {
      timeout: 8_000,
    });

    await expect
      .poll(
        async () => (await getPlanBlocks(page, planId)).map((b) => b.type),
        {
          timeout: 12_000,
        },
      )
      .toEqual(["rich-text", "diagram", "rich-text"]);
    const atomAfter = await getBlockData(page, planId, DIAGRAM_BLOCK_ID);
    expect(
      JSON.stringify(atomAfter),
      "diagram atom data must be unchanged across the prose undo",
    ).toBe(JSON.stringify(atomBefore));
    expect(JSON.stringify(atomAfter)).toContain(DIAGRAM_LABEL);
    expect(JSON.stringify(atomAfter)).not.toContain("Module");

    await expect
      .poll(async () => await getRichTextMarkdown(page, planId, "rt-tail"), {
        timeout: 15_000,
      })
      .not.toContain("TAIL-EDIT-TOKEN");
  });
});
