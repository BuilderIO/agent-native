import { test, expect, type Page, type APIResponse } from "@playwright/test";

/*
 * ATOM SAFETY + UNDO/REDO — adversarial E2E for the single-document plan editor.
 *
 * Area under test: the new `keyboardGuard` ProseMirror plugin on the registry
 * block atom (`createRegistryBlockNode` in
 * packages/core/src/client/rich-markdown-editor/RegistryBlockNode.tsx) plus the
 * editor's undo/redo history. The whole plan body is ONE ProseMirror/Tiptap doc
 * rendered by `SharedRichEditor`, wrapper class `plan-document-editor-surface`,
 * contenteditable surface `.an-rich-md-prose`. Structured blocks are inline
 * `planBlock` NodeViews wrapped in `.plan-block-node[data-block-id=<id>]`; when a
 * block atom is the active `NodeSelection` the wrapper carries the attribute
 * `data-plan-block-selected=""` (RegistryBlockNodeView passes `props.selected`).
 *
 * The reported "module box" bug: with a structured block atom node-selected,
 * typing a printable character used to fall through to ProseMirror's default
 * "replace the selected atom with typed text" — which, combined with the doc↔
 * blocks bridge re-deriving a fresh `diagram` block from `empty()`, materialized
 * a STRAY default diagram whose seeded node graph is `{ nodes: [{ label:
 * "Module" }] }` (planBlocks.tsx diagram `empty()`), i.e. a "Module box". The
 * keyboardGuard plugin now `preventDefault`s printable keys (`handleKeyDown` +
 * `handleTextInput`), `Enter`, paste (`handlePaste`), and insert `beforeinput`
 * events while a registry-block atom is node-selected, so the atom and the doc
 * must be left untouched.
 *
 * Asserts CORRECT behavior. A FAILING assertion IS the bug it reports. In
 * particular `isMutatingKey` only treats single-character keys and `Enter` as
 * mutating; if any guarded surface still lets a keystroke / paste / Enter slip
 * through, the "no stray block / atom unchanged" assertions fail and pin exactly
 * that gap.
 *
 * Resilience: the shared dev server may HMR/reload mid-run; specs use web-first
 * auto-retrying expects, tolerate a stray reload, and avoid fixed sleeps where a
 * wait-for is possible. retries:2 is configured globally in playwright.config.ts.
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
  return `Atom/Undo ${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
 * times — a fixture hiccup must never read as the atom/undo bug under test.
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

/** Read the current stored blocks for count / type / data assertions. */
async function getPlanBlocks(page: Page, planId: string): Promise<PlanBlock[]> {
  const res = await page.request.get(
    `${GET_ACTION}?id=${encodeURIComponent(planId)}`,
  );
  expect(res.ok(), `get-visual-plan ok (status ${res.status()})`).toBeTruthy();
  const body = await readJson(res);
  const plan = (body.plan ?? body) as { content?: { blocks?: PlanBlock[] } };
  return plan.content?.blocks ?? [];
}

/** Read just one block's persisted `data` by id (null if missing). */
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

/** The first rich-text block's persisted markdown (null if missing). */
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

/** The inline `planBlock` NodeView wrapper for a given stored block id. */
function blockNode(page: Page, blockId: string) {
  return page
    .locator(
      `.plan-document-editor-surface .plan-block-node[data-block-id="${blockId}"]`,
    )
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

/**
 * Select a registry-block atom as a ProseMirror `NodeSelection`. Clicking a leaf
 * atom selects the node by default; we click the block, then confirm the node's
 * outer DOM gained the class `ProseMirror-selectednode`. ProseMirror applies that
 * class SYNCHRONOUSLY to a NodeView's wrapper element (here `.plan-block-node`,
 * the `NodeViewWrapper`) whenever it is the active `NodeSelection` — see the
 * `.plan-block-node.ProseMirror-selectednode` rules in plan's global.css. That is
 * the real, reliable selection marker. (The React-rendered
 * `data-plan-block-selected=""` attribute reflects the same state but only after
 * a React re-render propagates `props.selected`, so asserting on it races; the
 * class never does.) The inner read view is `contentEditable={false}`, so a click
 * lands on the atom and PM resolves a NodeSelection over it.
 *
 * RISK: if a future read view swallows the click (e.g. an interactive child
 * captures mousedown), the atom would not select — this helper would then time
 * out and that itself is worth surfacing. We click the wrapper chrome
 * (top-left), which is the non-interactive shell, not an inner control.
 */
async function selectBlockAtom(page: Page, blockId: string) {
  const node = blockNode(page, blockId);
  await expect(node).toBeVisible({ timeout: 20_000 });

  // Click the wrapper's chrome (top-left), which is the non-interactive shell,
  // not an inner control.
  const box = await node.boundingBox();
  if (box) {
    await page.mouse.click(box.x + 6, box.y + 6);
  } else {
    await node.click({ position: { x: 6, y: 6 } });
  }

  // The selection signal is the `ProseMirror-selectednode` class ProseMirror puts
  // on the node's wrapper element. Auto-retry briefly for the dispatched
  // NodeSelection to settle.
  await expect(node).toHaveClass(/ProseMirror-selectednode/, {
    timeout: 8_000,
  });
}

/**
 * Live record of every `update-visual-plan` autosave POST. Attach BEFORE acting.
 * Each entry is the response status; an empty list after a guarded keystroke
 * proves the editor never even serialized a doc change (the strongest signal that
 * the guard suppressed the mutation, not merely that the save round-tripped).
 */
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

/**
 * A plan with a leading prose block and a `diagram` atom whose node graph carries
 * a RECOGNIZABLE label (NOT the default "Module" seed). If the atom guard fails
 * and the doc↔blocks bridge re-derives a fresh diagram from `empty()`, the stray
 * block's graph is the default `{ nodes: [{ label: "Module" }] }` — so a "Module"
 * box appearing where our "KEEP-THIS-NODE" diagram was is the exact bug.
 */
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

test.describe("atom safety: keyboardGuard blocks mutation on a node-selected block", () => {
  test("typing a printable char with a diagram atom selected inserts NO stray block and leaves the atom data unchanged", async ({
    page,
  }) => {
    const planId = await createPlanFixture(
      page,
      atomFixtureContent(uniqueTitle("type-on-atom")),
    );

    // Baseline: exactly [rich-text, diagram]; the diagram keeps OUR label, NOT
    // the default "Module" seed.
    const before = await getPlanBlocks(page, planId);
    expect(before.map((b) => b.type)).toEqual(["rich-text", "diagram"]);
    const beforeData = await getBlockData(page, planId, DIAGRAM_BLOCK_ID);
    expect(JSON.stringify(beforeData)).toContain(DIAGRAM_LABEL);
    expect(JSON.stringify(beforeData)).not.toContain("Module");

    await openPlanForEditing(page, planId);
    // The diagram renders its node label verbatim (SketchDiagram → {node.label}).
    const node = blockNode(page, DIAGRAM_BLOCK_ID);
    await expect(node).toContainText(DIAGRAM_LABEL, { timeout: 20_000 });

    const saves = watchSaves(page);
    await selectBlockAtom(page, DIAGRAM_BLOCK_ID);

    // Type printable characters while the atom is node-selected. The guard's
    // handleKeyDown / handleTextInput / beforeinput must each preventDefault, so
    // NOTHING is inserted and the atom is not replaced.
    await page.keyboard.type("xyz", { delay: 30 });
    // Also try a single space and a letter that, unguarded, would replace the
    // atom and the bridge would re-seed a default "Module" diagram.
    await page.keyboard.press("a");

    // Give any (erroneous) autosave a beat to fire, then assert nothing landed.
    await page.waitForTimeout(1500);

    // (a) No new block appeared and the diagram atom is still the second block.
    await expect
      .poll(
        async () => (await getPlanBlocks(page, planId)).map((b) => b.type),
        {
          timeout: 12_000,
        },
      )
      .toEqual(["rich-text", "diagram"]);

    // (b) The atom's data is byte-identical: still our label, never the default
    // "Module" seed and never the typed characters.
    const afterData = await getBlockData(page, planId, DIAGRAM_BLOCK_ID);
    expect(
      JSON.stringify(afterData),
      `atom data must be unchanged after typing on a node-selected diagram. before=${JSON.stringify(
        beforeData,
      )} after=${JSON.stringify(afterData)}`,
    ).toBe(JSON.stringify(beforeData));
    expect(JSON.stringify(afterData)).not.toContain("Module");
    // The typed characters must not have landed in the atom's data anywhere.
    expect(JSON.stringify(afterData)).not.toContain("xyz");

    // (c) No stray "Module" box rendered anywhere in the document.
    await expect(
      page
        .locator(".plan-document-editor-surface .plan-block-node")
        .filter({ hasText: "Module" }),
    ).toHaveCount(0);

    // (d) The leading prose is untouched too (the typed keys didn't leak into it).
    expect(await getRichTextMarkdown(page, planId, RT_BLOCK_ID)).toBe(
      "Intro paragraph above the diagram.",
    );

    // (e) Strongest signal: a correctly-guarded keystroke serializes NO doc change
    // at all, so the autosave surface stays silent. (If anything DID mutate, the
    // editor would have fired at least one replace-blocks POST.)
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

    // Enter is explicitly listed as a mutating key in `isMutatingKey`, so the
    // guard must preventDefault it. Unguarded, Enter on a NodeSelection inserts a
    // paragraph after the atom (and can re-trigger the bridge re-derivation).
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);

    // The block list is unchanged — no stray block, no re-derived "Module" diagram.
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
    // Enter on a guarded atom serializes no change → no autosave.
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

    // Stage clipboard text that, if pasted onto the atom, would replace it.
    const pasted = "PASTED-INTO-ATOM-SHOULD-NOT-LAND";
    await page.evaluate(async (text) => {
      await navigator.clipboard.writeText(text).catch(() => {});
    }, pasted);

    await selectBlockAtom(page, DIAGRAM_BLOCK_ID);

    // The guard's `handlePaste` must preventDefault while the atom is selected.
    await page.keyboard.press("ControlOrMeta+V");
    await page.waitForTimeout(1500);

    // No pasted text leaked into any block, no stray block, atom data intact.
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
    // A guarded paste serializes no change → no autosave.
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
    // Two diagram atoms with DISTINCT labels. Selecting one and (attempting to)
    // mutate it must not cause the dedupe plugin to re-mint or cross-wire the
    // OTHER atom's id/data. This guards the dedupe + keyboardGuard interaction:
    // a no-op guarded keystroke must not perturb sibling atoms.
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
    // Both ids survive, each with its OWN label (no re-mint, no data bleed).
    const one = blocks.find((b) => b.id === "diag-one");
    const two = blocks.find((b) => b.id === "diag-two");
    expect(one, "diag-one still present by id").toBeTruthy();
    expect(two, "diag-two still present by id").toBeTruthy();
    expect(JSON.stringify(one?.data)).toContain("ALPHA-DIAGRAM");
    expect(JSON.stringify(two?.data)).toContain("BETA-DIAGRAM");
    // No bleed, no default-seed "Module" box.
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

    // Type a recognizable token at the end of the prose.
    const typed = " UNDOABLE-EDIT";
    await prose.getByText("Tail prose to edit.").click();
    await page.keyboard.press("End");
    await page.keyboard.type(typed, { delay: 15 });

    // Optimistic render: the edit appears in the editor immediately.
    await expect(prose).toContainText("UNDOABLE-EDIT", { timeout: 5_000 });

    // It also persists (autosave is per-keystroke replace-blocks).
    await expect
      .poll(async () => await getRichTextMarkdown(page, planId, RT_BLOCK_ID), {
        timeout: 15_000,
      })
      .toContain("UNDOABLE-EDIT");

    // Undo. The editor uses the ProseMirror/Tiptap history; Mod+Z undoes the last
    // input group. Repeat a few times to coalesce any per-character history steps,
    // then assert the typed token is gone from the DOM.
    await prose.getByText("TAIL-EDIT-TOKEN").click();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("ControlOrMeta+z");
    }
    await expect(prose).not.toContainText("UNDOABLE-EDIT", { timeout: 8_000 });
    // The original text survives the undo (we didn't undo past the seed).
    await expect(prose).toContainText("Original sentence", { timeout: 8_000 });

    // Undo writes a NEW doc state → autosaves it; the persisted markdown must drop
    // the token. (If undo only mutated the DOM without re-serializing, this fails.)
    await expect
      .poll(async () => await getRichTextMarkdown(page, planId, RT_BLOCK_ID), {
        timeout: 15_000,
      })
      .not.toContain("UNDOABLE-EDIT");

    // Redo re-applies the edit (the token comes back) and re-persists.
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
    // A rich-text block whose markdown is a NESTED bullet list — the deepest leaf
    // is an indented sub-item. Editing that leaf and undoing must restore the
    // nested structure, not flatten or corrupt it. This exercises an undo across a
    // deep ProseMirror leaf node (listItem > paragraph), the kind of nested region
    // the task calls out.
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

    // The nested list rendered with all four items.
    await expect(prose).toContainText("Nested leaf A", { timeout: 15_000 });
    await expect(prose).toContainText("Nested leaf B");

    // Place the caret at the END of the deepest leaf ("Nested leaf B") and append
    // a token to that specific leaf. Clicking the text node, then Control+End would
    // jump to the doc end, so click directly into the leaf and use End (line end).
    const leafB = prose
      .locator("li")
      .filter({ hasText: "Nested leaf B" })
      .last();
    await expect(leafB).toBeVisible({ timeout: 8_000 });
    await leafB.click();
    await page.keyboard.press("End");
    const leafToken = "-DEEPEDIT";
    await page.keyboard.type(leafToken, { delay: 15 });

    // The leaf now carries the token; sibling leaves are untouched.
    await expect(leafB).toContainText("Nested leaf B-DEEPEDIT", {
      timeout: 5_000,
    });
    await expect(prose).toContainText("Nested leaf A");

    // Persist check: the appended token reached SQL inside the nested list markdown.
    await expect
      .poll(async () => await getRichTextMarkdown(page, planId, RT_BLOCK_ID), {
        timeout: 15_000,
      })
      .toContain("Nested leaf B-DEEPEDIT");

    // Undo the leaf edit. The nested list must be restored EXACTLY — the token
    // gone, all four items present, and the indentation/structure intact.
    await prose.click();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("ControlOrMeta+z");
    }
    await expect(prose).not.toContainText("DEEPEDIT", { timeout: 8_000 });
    // All four original items survive — undo restored the nested region, not a
    // flattened or truncated doc.
    for (const item of [
      "Top item one",
      "Top item two",
      "Nested leaf A",
      "Nested leaf B",
    ]) {
      await expect(prose).toContainText(item, { timeout: 8_000 });
    }

    // The persisted markdown is restored to the original nested list (token gone),
    // and the nesting is preserved (an indented "Nested leaf B" line, two leading
    // spaces, with no trailing edit token).
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
    // Prose + a labelled diagram atom + trailing prose. Edit the trailing prose,
    // then undo: the prose edit reverts while the diagram atom (and its data) stays
    // exactly as seeded. Undo must not "reach into" or re-derive the atom.
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

    // Edit at the very end of the post-atom tail prose run. Click directly on the
    // tail paragraph's TEXT (centre of the run, which is inside the editable text
    // node) so the caret lands in this specific block — clicking the far-right
    // empty edge can drop the caret outside the text node, so the token never
    // lands. Then press End to move to the end of that line before typing.
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

    // Undo the tail edit.
    await tailParagraph.click();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("ControlOrMeta+z");
    }
    await expect(prose).not.toContainText("TAIL-EDIT-TOKEN", {
      timeout: 8_000,
    });

    // The diagram atom is untouched: same data, same single block, label intact,
    // and crucially NOT re-seeded to the default "Module" graph.
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

    // And the tail prose reverted to its seed.
    await expect
      .poll(async () => await getRichTextMarkdown(page, planId, "rt-tail"), {
        timeout: 15_000,
      })
      .not.toContain("TAIL-EDIT-TOKEN");
  });
});
