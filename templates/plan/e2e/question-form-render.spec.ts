import { test, expect, type Page, type APIResponse } from "@playwright/test";

/*
 * QUESTION FORM RENDERING — plan editor should show the respondent-facing
 * question UI in the document. The schema/config form is still available from
 * the corner edit button, but it must not replace the block body inline.
 */

const CREATE_ACTION = "/_agent-native/actions/create-visual-plan";

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
  expect(planId, "create-visual-plan returns a plan id").toBeTruthy();
  return planId as string;
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
}

function blockNode(page: Page, blockId: string) {
  return page
    .locator(
      `.plan-document-editor-surface .plan-block-node[data-block-id="${blockId}"]`,
    )
    .first();
}

function questionContent(type: "question-form" | "visual-questions") {
  const blockId = `${type}-render-check`;
  return {
    blockId,
    content: {
      version: 2,
      title: `Question render ${Date.now()}`,
      brief: "Question blocks render their answer UI in edit mode.",
      blocks: [
        {
          id: "rt-seed",
          type: "rich-text",
          editable: true,
          data: { markdown: "Intro paragraph above the question block." },
        },
        {
          id: blockId,
          type,
          title: "Feedback question",
          editable: true,
          data: {
            submitLabel: "Send to agent",
            questions: [
              {
                id: "q-polish",
                title:
                  "Which inline/container editing surface should get the next polish pass?",
                mode: "single",
                allowOther: true,
                options: [
                  {
                    id: "tables",
                    label: "Tables",
                    detail: "Refine Notion-like cell focus and inline editing.",
                    recommended: true,
                  },
                  {
                    id: "containers",
                    label: "Containers",
                    detail: "Tune drag/drop and slash-command behavior.",
                  },
                ],
              },
            ],
          },
        },
      ],
    } satisfies PlanContentInput,
  };
}

test.describe("question blocks render answer UI in the plan editor", () => {
  for (const blockType of ["question-form", "visual-questions"] as const) {
    test(`${blockType} keeps config editing behind the corner edit button`, async ({
      page,
    }) => {
      const { blockId, content } = questionContent(blockType);
      const planId = await createPlanFixture(page, content);
      await openPlanForEditing(page, planId);

      const node = blockNode(page, blockId);
      await expect(node).toBeVisible({ timeout: 20_000 });
      await expect(node.locator(".plan-questions-block")).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        node.getByText(
          "Which inline/container editing surface should get the next polish pass?",
        ),
      ).toBeVisible();
      await expect(node.getByRole("button", { name: /Tables/ })).toBeVisible();
      await expect(
        node.getByRole("button", { name: "Send to agent" }),
      ).toBeVisible();

      // The inline body must not be the admin/config editor.
      await expect(node.getByText("SUBMIT BUTTON")).toHaveCount(0);
      await expect(node.getByText("QUESTION 1")).toHaveCount(0);
      await expect(node.getByText("MODE")).toHaveCount(0);

      // The config editor still exists, but only behind the explicit panel.
      await node.hover();
      await node
        .getByRole("button", {
          name:
            blockType === "question-form"
              ? "Edit Question form"
              : "Edit Visual questions",
        })
        .click({ force: true });
      const popover = page.locator(".an-block-edit-popover").last();
      await expect(popover).toBeVisible({ timeout: 10_000 });
      await expect(popover.getByText("Question 1")).toBeVisible();
      await expect(popover.getByText("Mode")).toBeVisible();
    });
  }
});
