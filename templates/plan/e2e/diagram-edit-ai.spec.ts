import { test, expect, type Page, type APIResponse } from "@playwright/test";


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

async function createPlanFixture(
  page: Page,
  content: PlanContentInput,
): Promise<string> {
  let res: APIResponse | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      res = await page.request.post(CREATE_ACTION, {
        data: { title: content.title, brief: content.brief, content },
        timeout: 15_000,
      });
    } catch {
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
  return page
    .locator(
      `.plan-document-editor-surface .plan-block-node[data-block-id="${blockId}"]`,
    )
    .first();
}

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

function diagramFrame(page: Page, blockId: string) {
  return blockNode(page, blockId).locator(".plan-diagram-frame").first();
}

async function toggleWireframeStyleViaMenu(page: Page) {
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

    expect((await getPlanBlocks(page, planId)).map((b) => b.type)).toEqual([
      "rich-text",
      "diagram",
    ]);

    await openPlanForEditing(page, planId);

    const node = blockNode(page, blockId);
    await expect(
      node,
      "the diagram planBlock NodeView should mount",
    ).toBeVisible({ timeout: 25_000 });

    const marker = node.getByTestId(DIAGRAM_MARKER_TESTID);
    await expect(marker, "the diagram html marker element renders").toBeVisible(
      {
        timeout: 15_000,
      },
    );
    await expect(marker).toContainText(DIAGRAM_MARKER_TEXT);

    const editableProseAroundMarker = node.locator(
      `.an-rich-md-prose[contenteditable="true"] [data-testid="${DIAGRAM_MARKER_TESTID}"]`,
    );
    await expect(
      editableProseAroundMarker,
      "diagram html must NOT be rendered inside an editable prose block",
    ).toHaveCount(0);

    const shell = node.locator(".plan-block-node__shell").first();
    await expect(shell).toHaveAttribute("contenteditable", "false", {
      timeout: 10_000,
    });

    await expect(diagramFrame(page, blockId)).toBeVisible({ timeout: 15_000 });

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

    await expect(node).toContainText("Ingest", { timeout: 15_000 });
    await expect(node).toContainText("Normalize");
    await expect(node).toContainText("Persist");
    await expect(node).not.toContainText("Diagram content is empty");

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

    await node.getByTestId(DIAGRAM_MARKER_TESTID).click();

    const pencil = node.getByRole("button", { name: "Edit Diagram" }).first();
    await expect(
      pencil,
      "a corner pencil edit button should appear when the diagram is selected",
    ).toBeVisible({ timeout: 12_000 });

    await expect(diagramFrame(page, blockId)).toBeVisible();

    await pencil.click();
    const editPopover = page.locator(".an-block-edit-popover").first();
    await expect(
      editPopover,
      "the corner pencil opens the diagram edit popover",
    ).toBeVisible({ timeout: 10_000 });

    const htmlField = editPopover
      .getByLabel("HTML / SVG fragment", { exact: true })
      .first();
    await expect(htmlField).toBeVisible({ timeout: 8_000 });
    await expect(htmlField).toHaveValue(new RegExp(DIAGRAM_MARKER_TESTID), {
      timeout: 8_000,
    });
    await expect(
      editPopover.getByRole("button", { name: "Save diagram" }),
    ).toBeVisible();
  });
});

test.describe("diagram block: edit by prompt", () => {
  test("an html/css field exposes an edit-by-prompt action that opens a prompt composer", async ({
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

    const pencil = node.getByRole("button", { name: "Edit Diagram" }).first();
    await expect(pencil).toBeVisible({ timeout: 12_000 });
    await pencil.click();
    const editPopover = page.locator(".an-block-edit-popover").first();
    await expect(editPopover).toBeVisible({ timeout: 10_000 });

    const fieldLabel = "CSS";
    const cssField = editPopover
      .getByLabel(fieldLabel, { exact: true })
      .first();
    await expect(cssField).toBeVisible({ timeout: 8_000 });
    const aiField = editPopover
      .locator(`textarea[data-ai-field-action="${fieldLabel}"]`)
      .first();
    await expect(
      aiField,
      "the CSS field should expose an inline edit-by-prompt textarea",
    ).toBeVisible({ timeout: 8_000 });
    await expect(aiField).toHaveAttribute("placeholder", /Describe a change/);
    await expect(aiField).toBeInViewport();

    await aiField.click();
    const collapsed = await aiField.boundingBox();
    await aiField.fill(
      "Make the boxes rounded and add a settings step with extra padding so this instruction wraps onto multiple lines",
    );
    await expect(aiField).toHaveValue(/settings step/, { timeout: 8_000 });
    const grown = await aiField.boundingBox();
    expect(grown?.height ?? 0).toBeGreaterThan(collapsed?.height ?? 0);
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

    await expect(frame).toHaveAttribute("data-style", "sketchy", {
      timeout: 12_000,
    });
    const roughOverlay = node.locator("svg.plan-rough-overlay");
    await expect(
      roughOverlay,
      "sketchy mode draws a rough overlay over the diagram",
    ).toHaveCount(1, { timeout: 12_000 });

    await toggleWireframeStyleViaMenu(page);

    await expect(
      frame,
      "toggling restyles the diagram to clean",
    ).toHaveAttribute("data-style", "clean", { timeout: 12_000 });
    await expect(
      node.locator("svg.plan-rough-overlay"),
      "clean mode removes the rough overlay",
    ).toHaveCount(0, { timeout: 12_000 });

    await expect(node.getByTestId(DIAGRAM_MARKER_TESTID)).toBeVisible();

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

    const newMarker = `DIAGRAM-EDITED-${Date.now()}`;
    const newHtml = `<div class="diagram-card" data-testid="${DIAGRAM_MARKER_TESTID}"><div class="diagram-box">${newMarker}</div></div>`;
    await htmlField.fill(newHtml);

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

    await expect(
      node.getByTestId(DIAGRAM_MARKER_TESTID),
      "the diagram read view updates after saving new html",
    ).toContainText(newMarker, { timeout: 15_000 });
    await expect(node).not.toContainText(DIAGRAM_MARKER_TEXT, {
      timeout: 10_000,
    });

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

    expect((await getPlanBlocks(page, planId)).map((b) => b.type)).toEqual([
      "rich-text",
      "diagram",
    ]);
  });
});
