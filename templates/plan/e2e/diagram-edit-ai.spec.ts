import { test, expect, type Page, type APIResponse } from "@playwright/test";

/*
 * DIAGRAM BLOCK REWORK + EDIT-WITH-AI — adversarial E2E.
 *
 * Area under test: the reworked `diagram` plan block. A diagram is NOT a big
 * editable prose block — it is a registered structured block (`planBlocks.tsx`,
 * `editSurface: "panel"`) that renders its model-authored HTML/SVG as a stable
 * READ artboard inside the single-document editor, and is edited through an
 * explicit corner-pencil popover (NOT inline contenteditable text).
 *
 * Verified against source:
 *   - DiagramBlock.tsx → `Read` = `<SketchDiagram>`; for `data.html` that is
 *     `HtmlDiagram` (Wireframe.tsx) which injects sanitized html into
 *     `.plan-diagram-frame` (carrying `data-style="sketchy"|"clean"`) and overlays
 *     a `<svg class="plan-rough-overlay">` ONLY in sketchy mode (RoughOverlay
 *     renders null when style !== "sketchy"). The block wrapper is
 *     `section.plan-block[data-block-id]`.
 *   - RegistryBlockNode.tsx → in the single-doc editor the block mounts as an
 *     inline `planBlock` NodeView (`.plan-block-node[data-block-id]`) with a
 *     `contentEditable={false}` shell. For a `panel`-surface spec, an editable
 *     plan shows a corner pencil button `.an-block-edit-trigger` whose
 *     `data-visible` flips true when the node is `props.selected`; clicking it
 *     opens the host popover (`renderEditSurface` → shadcn Popover with content
 *     `.an-block-edit-popover`) — NOT an inline text editor.
 *   - DiagramBlockEdit.tsx → inside that popover, each field is wrapped in a
 *     `.group/field` and carries an `AiEditableFieldLabel`; the host renders the
 *     field's "Edit with AI" action (`PlanAiFieldAction` in planBlocks.tsx) as a
 *     button `[data-ai-field-action="<field label>"]` with the text "Edit with
 *     AI". Clicking it opens a second popover containing a `PromptComposer`
 *     (Tiptap → a `role=textbox` contenteditable `.ProseMirror`).
 *   - use-wireframe-style.ts → the viewer-level "sketchy"/"clean" style toggle is
 *     localStorage-backed; the real UI toggle is the "Plan actions" dropdown
 *     (`aria-label="Plan actions"`) item "Clean wireframes" / "Sketchy
 *     wireframes" (PlansPage.tsx). Toggling it restyles every diagram live.
 *
 * Asserts CORRECT behavior. A failing assertion IS the bug it reports. retries:2
 * + web-first auto-retrying expects absorb transient HMR reloads on the shared
 * dev server. SELECTOR RISKS are flagged inline where a class/attr is the only
 * available handle.
 */

const CREATE_ACTION = "/_agent-native/actions/create-visual-plan";
const UPDATE_ACTION = "/_agent-native/actions/update-visual-plan";
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

const RICH_SEED_ID = "rt-seed";
// A recognizable, inert marker element inside the diagram html. `data-testid`,
// `id`, and `class` all survive the render-layer sanitizer (sanitize-html.ts),
// so this is a stable handle for the rendered (NOT prose) diagram body.
const DIAGRAM_MARKER_TESTID = "diagram-marker";
const DIAGRAM_MARKER_TEXT = "LoginToDashboard";

function uniqueTitle(label: string): string {
  return `Diagram ${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
 * shared dev server can HMR/reload mid-request while other agents edit the app
 * (a transient 500), so retry a few times — a fixture hiccup must never read as
 * the render bug under test.
 */
async function createPlanFixture(
  page: Page,
  content: PlanContentInput,
): Promise<string> {
  let res: APIResponse | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      // Bound each attempt below the per-test budget (config `timeout: 45_000`)
      // so a single stalled POST under the shared dev server can be retried within
      // the same test rather than throwing and ending it. The catch below turns a
      // timed-out/aborted attempt into a retry, never the test result.
      res = await page.request.post(CREATE_ACTION, {
        data: { title: content.title, brief: content.brief, content },
        timeout: 15_000,
      });
    } catch {
      // A timed-out / aborted attempt is a fixture hiccup, not the bug under
      // test. Pause and retry rather than letting the throw fail the test.
      res = null;
      await page.waitForTimeout(1000);
      continue;
    }
    if (res.ok()) break;
    await page.waitForTimeout(1000);
  }
  expect(
    res?.ok(),
    `create-visual-plan should succeed (status ${res?.status() ?? "no response"}): ${await (res
      ? res.text().catch(() => "")
      : Promise.resolve("request timed out"))}`,
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

/** Read the current stored blocks for type/data assertions. */
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
  return page
    .locator(
      `.plan-document-editor-surface .plan-block-node[data-block-id="${blockId}"]`,
    )
    .first();
}

/**
 * An inert, sanitizer-safe HTML diagram fragment carrying a recognizable marker
 * element. The schema (`diagram.config.ts` `noActiveDiagramText`) rejects active
 * content; plain `div`/`data-*`/`class`/text is fine.
 */
function htmlDiagramHtml(): string {
  return [
    `<div class="diagram-card" data-testid="${DIAGRAM_MARKER_TESTID}">`,
    `  <div class="diagram-box">Login</div>`,
    `  <div class="diagram-pill accent">${DIAGRAM_MARKER_TEXT}</div>`,
    `  <small class="diagram-muted">Renderer-token muted text</small>`,
    `  <div class="diagram-box">Dashboard</div>`,
    `</div>`,
  ].join("\n");
}

/**
 * A 2-block plan: a rich-text seed (keeps the document non-empty) plus one
 * `diagram` block authored with html/css.
 */
function htmlDiagramContent(opts: {
  title: string;
  blockId: string;
}): PlanContentInput {
  return {
    version: 2,
    title: opts.title,
    brief: "Diagram html/css render + edit fixture.",
    blocks: [
      {
        id: RICH_SEED_ID,
        type: "rich-text",
        editable: true,
        data: { markdown: "Seed paragraph above the diagram block." },
      },
      {
        id: opts.blockId,
        type: "diagram",
        title: "Auth flow",
        editable: true,
        data: {
          html: htmlDiagramHtml(),
          css: ".diagram-card { display: flex; gap: 8px; }\n.diagram-box { padding: 6px; }",
          caption: "Login to dashboard",
        },
      },
    ],
  };
}

/** Locate the diagram READ artboard frame for a given block id. */
function diagramFrame(page: Page, blockId: string) {
  // SELECTOR RISK: `.plan-diagram-frame` (HtmlDiagram in Wireframe.tsx) is the
  // only handle that carries `data-style`. If the read renderer class is renamed,
  // this and the sketchy/clean assertions must follow.
  return blockNode(page, blockId).locator(".plan-diagram-frame").first();
}

/** Open the Plan actions menu and toggle the wireframe style (sketchy<->clean). */
async function toggleWireframeStyleViaMenu(page: Page) {
  // The plan reader toolbar exposes a "Plan actions" dropdown; its style item
  // reads "Clean wireframes" while sketchy is active and "Sketchy wireframes"
  // while clean is active (PlansPage.tsx).
  const trigger = page.getByRole("button", { name: "Plan actions" }).first();
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();
  const styleItem = page
    .getByRole("menuitem")
    .filter({ hasText: /(Clean|Sketchy) wireframes/ })
    .first();
  await expect(styleItem).toBeVisible({ timeout: 8_000 });
  await styleItem.click();
}

test.describe("diagram block: html/css render (not a prose text block)", () => {
  test("an html diagram renders its marker element and is NOT outlined editable prose", async ({
    page,
  }) => {
    const blockId = "blk-diagram-html";
    const planId = await createPlanFixture(
      page,
      htmlDiagramContent({ title: uniqueTitle("render"), blockId }),
    );

    // Fixture persisted exactly [rich-text seed, diagram].
    expect((await getPlanBlocks(page, planId)).map((b) => b.type)).toEqual([
      "rich-text",
      "diagram",
    ]);

    await openPlanForEditing(page, planId);

    // The diagram mounts as an inline registry NodeView, NOT as a giant prose run.
    const node = blockNode(page, blockId);
    await expect(
      node,
      "the diagram planBlock NodeView should mount",
    ).toBeVisible({ timeout: 25_000 });

    // (1) The model-authored html actually renders: the marker element is present
    // with its text. This is the rework's whole point — the html renders as a
    // diagram, not as escaped source or a big editable textarea.
    const marker = node.getByTestId(DIAGRAM_MARKER_TESTID);
    await expect(marker, "the diagram html marker element renders").toBeVisible(
      {
        timeout: 15_000,
      },
    );
    await expect(marker).toContainText(DIAGRAM_MARKER_TEXT);

    // (2) The block must NOT be an editable prose surface. The diagram body lives
    // in a `contentEditable=false` NodeView shell, never inside an editable
    // `.an-rich-md-prose[contenteditable="true"]` run. (A regression that turned
    // the diagram back into a big text block WOULD nest the marker under editable
    // prose — assert it does not.)
    const editableProseAroundMarker = node.locator(
      `.an-rich-md-prose[contenteditable="true"] [data-testid="${DIAGRAM_MARKER_TESTID}"]`,
    );
    await expect(
      editableProseAroundMarker,
      "diagram html must NOT be rendered inside an editable prose block",
    ).toHaveCount(0);

    // The NodeView shell itself is non-editable (atom). SELECTOR RISK:
    // `.plan-block-node__shell` is the inner non-editable div from
    // RegistryBlockNode.tsx.
    const shell = node.locator(".plan-block-node__shell").first();
    await expect(shell).toHaveAttribute("contenteditable", "false", {
      timeout: 10_000,
    });

    // (3) It renders through the diagram read artboard frame (HtmlDiagram), which
    // is the structured renderer — not a markdown reader / textarea.
    await expect(diagramFrame(page, blockId)).toBeVisible({ timeout: 15_000 });

    // Opening the plan must not have wiped/dropped the structured diagram.
    await expect
      .poll(
        async () => (await getPlanBlocks(page, planId)).map((b) => b.type),
        {
          timeout: 15_000,
        },
      )
      .toEqual(["rich-text", "diagram"]);
  });

  test("a legacy nodes/edges diagram still renders", async ({ page }) => {
    // Backward-compat: a diagram authored with the legacy node graph (no html)
    // must still render through SketchDiagram's node path, not error out.
    const blockId = "blk-diagram-legacy";
    const planId = await createPlanFixture(page, {
      version: 2,
      title: uniqueTitle("legacy"),
      brief: "Legacy node-graph diagram fixture.",
      blocks: [
        {
          id: RICH_SEED_ID,
          type: "rich-text",
          editable: true,
          data: { markdown: "Seed paragraph above the legacy diagram." },
        },
        {
          id: blockId,
          type: "diagram",
          title: "Legacy flow",
          editable: true,
          data: {
            nodes: [
              { id: "n1", label: "Ingest" },
              { id: "n2", label: "Normalize" },
              { id: "n3", label: "Persist" },
            ],
            edges: [
              { from: "n1", to: "n2", label: "clean" },
              { from: "n2", to: "n3" },
            ],
            notes: [{ id: "note1", text: "Legacy pipeline note." }],
          },
        },
      ],
    });

    expect((await getPlanBlocks(page, planId)).map((b) => b.type)).toEqual([
      "rich-text",
      "diagram",
    ]);

    await openPlanForEditing(page, planId);
    const node = blockNode(page, blockId);
    await expect(node).toBeVisible({ timeout: 25_000 });

    // The legacy node labels render (the node-graph path of SketchDiagram).
    await expect(node).toContainText("Ingest", { timeout: 15_000 });
    await expect(node).toContainText("Normalize");
    await expect(node).toContainText("Persist");
    // It must NOT collapse to the empty-diagram fallback message.
    await expect(node).not.toContainText("Diagram content is empty");

    // Still a structured block (not prose); persisted unchanged.
    const editableProseInside = node.locator(
      `.an-rich-md-prose[contenteditable="true"]`,
    );
    await expect(editableProseInside).toHaveCount(0);
    await expect
      .poll(
        async () => (await getPlanBlocks(page, planId)).map((b) => b.type),
        {
          timeout: 15_000,
        },
      )
      .toEqual(["rich-text", "diagram"]);
  });
});

test.describe("diagram block: corner edit (pencil) popover", () => {
  test("selecting the block reveals a corner pencil that opens a popover editor (not inline text)", async ({
    page,
  }) => {
    const blockId = "blk-diagram-pencil";
    const planId = await createPlanFixture(
      page,
      htmlDiagramContent({ title: uniqueTitle("pencil"), blockId }),
    );
    await openPlanForEditing(page, planId);

    const node = blockNode(page, blockId);
    await expect(node).toBeVisible({ timeout: 25_000 });
    await expect(node.getByTestId(DIAGRAM_MARKER_TESTID)).toBeVisible({
      timeout: 15_000,
    });

    // Select the atom block by clicking its rendered body. The NodeView is a
    // selectable atom; clicking inside it puts a NodeSelection on it, which flips
    // the corner trigger's `data-visible` to true (RegistryBlockNode.tsx).
    await node.getByTestId(DIAGRAM_MARKER_TESTID).click();

    // The corner pencil edit trigger. SELECTOR RISK: `.an-block-edit-trigger` is
    // the only stable class for the panel-surface corner button; it also carries
    // aria-label "Edit Diagram" (spec.label === "Diagram").
    const pencil = node.getByRole("button", { name: "Edit Diagram" }).first();
    await expect(
      pencil,
      "a corner pencil edit button should appear when the diagram is selected",
    ).toBeVisible({ timeout: 12_000 });

    // Crucially the block stays a READ artboard in place — selecting it does NOT
    // swap the body to an inline editor (panel surface keeps the read view).
    await expect(diagramFrame(page, blockId)).toBeVisible();

    // Clicking the pencil opens the shadcn popover editor — NOT an inline text
    // box. The popover content carries the host class `.an-block-edit-popover`
    // and the DiagramBlockEdit form fields (HTML / SVG fragment, CSS, Caption).
    await pencil.click();
    const editPopover = page.locator(".an-block-edit-popover").first();
    await expect(
      editPopover,
      "the corner pencil opens the diagram edit popover",
    ).toBeVisible({ timeout: 10_000 });

    // The popover hosts the structured field editor (textareas), not a prose
    // contenteditable. The "HTML / SVG fragment" textarea carries the seeded html.
    const htmlField = editPopover
      .getByLabel("HTML / SVG fragment", { exact: true })
      .first();
    await expect(htmlField).toBeVisible({ timeout: 8_000 });
    await expect(htmlField).toHaveValue(new RegExp(DIAGRAM_MARKER_TESTID), {
      timeout: 8_000,
    });
    // And a "Save diagram" button exists in the popover form.
    await expect(
      editPopover.getByRole("button", { name: "Save diagram" }),
    ).toBeVisible();
  });
});

test.describe("diagram block: Edit with AI", () => {
  test("an html/css field exposes an 'Edit with AI' action that opens a prompt composer", async ({
    page,
  }) => {
    const blockId = "blk-diagram-ai";
    const planId = await createPlanFixture(
      page,
      htmlDiagramContent({ title: uniqueTitle("edit-ai"), blockId }),
    );
    await openPlanForEditing(page, planId);

    const node = blockNode(page, blockId);
    await expect(node).toBeVisible({ timeout: 25_000 });
    await node.getByTestId(DIAGRAM_MARKER_TESTID).click();

    // Open the corner edit popover (the AI field actions live inside the editor).
    const pencil = node.getByRole("button", { name: "Edit Diagram" }).first();
    await expect(pencil).toBeVisible({ timeout: 12_000 });
    await pencil.click();
    const editPopover = page.locator(".an-block-edit-popover").first();
    await expect(editPopover).toBeVisible({ timeout: 10_000 });

    // The "Edit with AI" button is rendered next to an html/css field label
    // field label (AiEditableFieldLabel → PlanAiFieldAction). SELECTOR RISK:
    // `[data-ai-field-action]` is the stable handle (the button text is also
    // "Edit with AI"). The CSS field uses the same field action component as the
    // large HTML field without coupling this test to the HTML textarea's height.
    const fieldLabel = "CSS";
    const cssField = editPopover
      .getByLabel(fieldLabel, { exact: true })
      .first();
    await expect(cssField).toBeVisible({ timeout: 8_000 });
    const aiButton = editPopover
      .locator(`[data-ai-field-action="${fieldLabel}"]`)
      .first();
    await expect(
      aiButton,
      "the CSS field should expose an 'Edit with AI' action",
    ).toBeVisible({ timeout: 8_000 });
    await expect(aiButton).toContainText("Edit with AI");
    await expect(aiButton).toBeInViewport();

    // Clicking it opens a SECOND popover with a prompt composer (NOT a plain
    // textarea): PromptComposer mounts a Tiptap editor exposed as a textbox.
    await aiButton.click();
    // The Edit-with-AI popover is a Radix `PopoverContent` (role=dialog, portaled
    // to body) carrying the field heading. Scope the composer lookup to THIS
    // dialog so a separately-mounted agent sidebar composer can never satisfy the
    // `.agent-composer-editor` selector instead.
    const aiPopover = page
      .getByRole("dialog")
      .filter({ hasText: `Edit ${fieldLabel}` })
      .first();
    await expect(
      aiPopover,
      "the Edit-with-AI popover should open with the field heading",
    ).toBeVisible({ timeout: 10_000 });

    // The composer textbox is the Tiptap contenteditable (role=textbox). Assert it
    // is present AND focusable — clicking it must place an editable caret (the
    // user must be able to dictate the change). SELECTOR RISK: this targets the
    // composer's contenteditable surface (`.agent-composer-editor` wraps the
    // `EditorContent`); PromptComposer auto-focuses it.
    const composer = aiPopover
      .locator(".agent-composer-editor [contenteditable='true']")
      .first();
    await expect(
      composer,
      "the Edit-with-AI popover hosts a focusable prompt composer",
    ).toBeVisible({ timeout: 10_000 });

    // The composer accepts typed text (proves it is a real editable input, not a
    // disabled/read-only display).
    await page.keyboard.type("Make the boxes rounded and add a settings step", {
      delay: 8,
    });
    await expect(composer).toContainText("settings step", { timeout: 8_000 });
  });
});

test.describe("diagram block: sketchy / clean toggle", () => {
  test("toggling the plan's wireframe style restyles the diagram (data-style + rough overlay flip)", async ({
    page,
  }) => {
    const blockId = "blk-diagram-style";
    const planId = await createPlanFixture(
      page,
      htmlDiagramContent({ title: uniqueTitle("style"), blockId }),
    );

    // Start from a known style. The viewer style is localStorage-backed
    // (`plan-wireframe-style`); seed "sketchy" before load so the first render is
    // deterministic regardless of a prior run's stored preference.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("plan-wireframe-style", "sketchy");
      } catch {
        /* ignore */
      }
    });

    await openPlanForEditing(page, planId);
    const node = blockNode(page, blockId);
    await expect(node).toBeVisible({ timeout: 25_000 });
    await expect(node.getByTestId(DIAGRAM_MARKER_TESTID)).toBeVisible({
      timeout: 15_000,
    });

    const frame = diagramFrame(page, blockId);
    await expect(frame).toBeVisible({ timeout: 15_000 });

    // Sketchy: the frame is styled sketchy AND the rough overlay renders (an
    // <svg.plan-rough-overlay> appears only when style === "sketchy" with paths).
    await expect(frame).toHaveAttribute("data-style", "sketchy", {
      timeout: 12_000,
    });
    const roughOverlay = node.locator("svg.plan-rough-overlay");
    await expect(
      roughOverlay,
      "sketchy mode draws a rough overlay over the diagram",
    ).toHaveCount(1, { timeout: 12_000 });

    // Toggle to clean via the real UI control.
    await toggleWireframeStyleViaMenu(page);

    // Clean: the frame's data-style flips to "clean" and the rough overlay is gone
    // (RoughOverlay returns null when style !== "sketchy").
    await expect(
      frame,
      "toggling restyles the diagram to clean",
    ).toHaveAttribute("data-style", "clean", { timeout: 12_000 });
    await expect(
      node.locator("svg.plan-rough-overlay"),
      "clean mode removes the rough overlay",
    ).toHaveCount(0, { timeout: 12_000 });

    // The diagram content itself survives the restyle (style is a render-only
    // preference, not a content edit).
    await expect(node.getByTestId(DIAGRAM_MARKER_TESTID)).toBeVisible();

    // Toggle back to sketchy — the overlay returns. Proves the toggle is live and
    // reversible, not a one-way render.
    await toggleWireframeStyleViaMenu(page);
    await expect(frame).toHaveAttribute("data-style", "sketchy", {
      timeout: 12_000,
    });
    await expect
      .poll(() => frame.evaluate((el) => getComputedStyle(el).fontFamily))
      .toContain("Excalifont");
    await expect(node.locator("svg.plan-rough-overlay")).toHaveCount(1, {
      timeout: 12_000,
    });
  });
});

test.describe("diagram block: saving html updates the read view", () => {
  test("editing the html in the popover and saving updates both the read render and persisted data", async ({
    page,
  }) => {
    const blockId = "blk-diagram-save";
    const planId = await createPlanFixture(
      page,
      htmlDiagramContent({ title: uniqueTitle("save"), blockId }),
    );
    await openPlanForEditing(page, planId);

    const node = blockNode(page, blockId);
    await expect(node).toBeVisible({ timeout: 25_000 });
    await node.getByTestId(DIAGRAM_MARKER_TESTID).click();

    const pencil = node.getByRole("button", { name: "Edit Diagram" }).first();
    await expect(pencil).toBeVisible({ timeout: 12_000 });
    await pencil.click();
    const editPopover = page.locator(".an-block-edit-popover").first();
    await expect(editPopover).toBeVisible({ timeout: 10_000 });

    const htmlField = editPopover
      .getByLabel("HTML / SVG fragment", { exact: true })
      .first();
    await expect(htmlField).toBeVisible({ timeout: 8_000 });

    // Replace the html with a new inert fragment carrying a fresh marker.
    const newMarker = `DIAGRAM-EDITED-${Date.now()}`;
    const newHtml = `<div class="diagram-card" data-testid="${DIAGRAM_MARKER_TESTID}"><div class="diagram-box">${newMarker}</div></div>`;
    await htmlField.fill(newHtml);

    // Save the diagram; the save commits the new block data, which the renderer's
    // debounced autosave persists with a successful `update-visual-plan` POST.
    // We observe that POST as a fast signal, but it is NOT the only proof of
    // success: the read-render update and the `get-visual-plan` poll below are the
    // authoritative checks, so a missed/raced listener never masks a real failure
    // (a save that genuinely did not persist still fails those assertions).
    const okSave = page
      .waitForResponse(
        (r) =>
          r.url().includes(UPDATE_ACTION) &&
          r.request().method() === "POST" &&
          r.ok(),
        { timeout: 15_000 },
      )
      .catch(() => null);
    await editPopover.getByRole("button", { name: "Save diagram" }).click();
    await okSave;

    // The READ render updates to show the new marker text (the artboard re-renders
    // from the new html).
    await expect(
      node.getByTestId(DIAGRAM_MARKER_TESTID),
      "the diagram read view updates after saving new html",
    ).toContainText(newMarker, { timeout: 15_000 });
    // And the old text is gone from the read render.
    await expect(node).not.toContainText(DIAGRAM_MARKER_TEXT, {
      timeout: 10_000,
    });

    // Server-of-record agrees: the persisted diagram html carries the new marker.
    await expect
      .poll(
        async () => {
          const blocks = await getPlanBlocks(page, planId);
          const diagram = blocks.find((b) => b.id === blockId);
          return String(
            (diagram?.data as { html?: string } | undefined)?.html ?? "",
          );
        },
        { timeout: 20_000 },
      )
      .toContain(newMarker);

    // It is still exactly [rich-text, diagram] — saving did not duplicate or drop
    // the block.
    expect((await getPlanBlocks(page, planId)).map((b) => b.type)).toEqual([
      "rich-text",
      "diagram",
    ]);
  });
});
