import { expect, test } from "@playwright/test";

import { E2E_MENTION_EMAIL } from "./global-setup";
import { createFixtureDesign, gotoEditor } from "./helpers";

test("comments toolbar opens an anchored composer", async ({
  page,
}, testInfo) => {
  const designId = await createFixtureDesign(
    page,
    `E2E Comment Parity ${testInfo.workerIndex}-${testInfo.repeatEachIndex}`,
  );
  await gotoEditor(page, designId);

  await page.getByRole("tab", { name: "Comments", exact: true }).click();
  await expect(page.locator("[data-review-comments-panel]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Filter" })).toBeVisible();

  await page
    .locator('[data-design-bottom-toolbar] button[aria-label="Pin comment"]')
    .click();

  const clickPlane = page.locator(
    '[data-review-click-plane][data-review-click-plane-target]:not([data-review-click-plane-target="board"])',
  );
  await expect(clickPlane).toHaveCount(1);
  await expect(clickPlane).toBeVisible();
  const box = await clickPlane.boundingBox();
  if (!box) throw new Error("comment click plane has no layout box");
  await clickPlane.click({
    force: true,
    position: {
      x: Math.min(120, box.width / 2),
      y: Math.min(120, box.height / 2),
    },
  });

  const composer = page.locator('textarea[placeholder="Leave feedback…"]');
  await expect(composer).toBeVisible();
  const commentButton = page.getByRole("button", {
    name: "Comment",
    exact: true,
  });
  await expect(commentButton).toBeDisabled();
  await composer.fill("Browser parity check ");
  await composer.press("@");
  const mentionMenu = page.getByRole("menu", { name: "Mention someone" });
  await expect(mentionMenu).toBeVisible();
  await expect(composer).toHaveValue("Browser parity check @");
  await composer.type("Ali");
  await expect(composer).toHaveValue("Browser parity check @Ali");
  await expect(
    mentionMenu.getByRole("textbox", { name: "Mention someone" }),
  ).toHaveValue("Ali");
  await expect(mentionMenu.getByRole("menuitem").first()).toBeVisible();
  await mentionMenu.getByRole("menuitem").first().click();
  await expect(composer).toHaveValue("Browser parity check @alice+e2e");

  const tools = page.locator("[data-review-comment-tools]");
  const emojiButton = page.getByRole("button", { name: "Add emoji" });
  const mentionButton = page.getByRole("button", {
    name: "Mention someone",
  });
  const attachmentButton = page.getByRole("button", {
    name: "Attach image",
  });
  const commentButtonBox = await commentButton.boundingBox();
  const toolsBox = await tools.boundingBox();
  const emojiBox = await emojiButton.boundingBox();
  const mentionBox = await mentionButton.boundingBox();
  const attachmentBox = await attachmentButton.boundingBox();
  const sendToAgent = page.getByRole("button", { name: "Send to agent" });
  const sendToAgentBox = await sendToAgent.boundingBox();
  for (const [label, box] of [
    ["comment button", commentButtonBox],
    ["comment tools", toolsBox],
    ["emoji button", emojiBox],
    ["mention button", mentionBox],
    ["attachment button", attachmentBox],
    ["send-to-agent button", sendToAgentBox],
  ] as const) {
    if (!box || box.width <= 0 || box.height <= 0) {
      throw new Error(`${label} has no rendered layout box`);
    }
  }
  expect(emojiBox!.x).toBeLessThan(mentionBox!.x);
  expect(mentionBox!.x).toBeLessThan(attachmentBox!.x);
  expect(attachmentBox!.x).toBeGreaterThanOrEqual(toolsBox!.x);
  expect(attachmentBox!.x + attachmentBox!.width).toBeLessThanOrEqual(
    toolsBox!.x + toolsBox!.width,
  );

  await expect(commentButton).toBeEnabled();
  const createResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/_agent-native/actions/create-review-comment") &&
      response.request().method() === "POST",
  );
  await commentButton.click();
  const created = await createResponse;
  expect(
    created.ok(),
    `create-review-comment returned ${created.status()}`,
  ).toBe(true);
  const createdComment = (await created.json()) as {
    body?: string;
    mentions?: Array<{ email?: string; id?: string | null; label?: string }>;
  };
  expect(createdComment.body).toBe("Browser parity check @alice+e2e");
  expect(createdComment.mentions).toEqual([
    { label: "alice+e2e", email: E2E_MENTION_EMAIL, id: null },
  ]);
  await expect(composer).toBeHidden();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("tab", { name: "Comments", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Comments", exact: true }).click();
  await expect(page.locator("[data-review-pin]").last()).toBeVisible();
  await page.locator("[data-review-pin]").last().click();
  await expect(
    page
      .locator("[data-review-comments-panel] article")
      .getByText("Browser parity check @alice+e2e", { exact: true }),
  ).toBeVisible();
});
