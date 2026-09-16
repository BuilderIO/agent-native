import { expect, test } from "@playwright/test";

import { gotoEditor, readSeedDesignId } from "./helpers";

test("comments toolbar opens an anchored composer", async ({ page }) => {
  await gotoEditor(page, await readSeedDesignId());

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
  await composer.fill("Browser parity check");
  await expect(commentButton).toBeEnabled();

  const tools = page.locator("[data-review-comment-tools]");
  const mentionButton = tools.getByRole("button", {
    name: "Mention someone",
    exact: true,
  });
  const attachmentButton = tools.getByRole("button", {
    name: "Attach image",
    exact: true,
  });
  const sendToAgent = page.getByRole("button", {
    name: "Send to agent",
    exact: true,
  });
  await expect(mentionButton).toBeVisible();
  await expect(attachmentButton).toBeVisible();
  await expect(sendToAgent).toBeVisible();
  const mentionBox = await mentionButton.boundingBox();
  const attachmentBox = await attachmentButton.boundingBox();
  if (!mentionBox || !attachmentBox) {
    throw new Error("review composer tools have no layout boxes");
  }
  expect(
    Math.abs(
      mentionBox.y +
        mentionBox.height / 2 -
        (attachmentBox.y + attachmentBox.height / 2),
    ),
  ).toBeLessThanOrEqual(1);
  expect(attachmentBox.x).toBeGreaterThanOrEqual(
    mentionBox.x + mentionBox.width - 1,
  );

  await composer.fill("Browser ");
  await composer.press("@");
  const mentionOption = page.getByRole("menuitem").first();
  await expect(mentionOption).toBeVisible();
  await mentionOption.click();
  await expect(composer).toHaveValue(/Browser @.+/);
  await composer.press("Escape");
  await expect(composer).toBeHidden();
});
