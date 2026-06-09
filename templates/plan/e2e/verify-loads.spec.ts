import { test, expect } from "@playwright/test";

test("test plan loads + renders the editable surface when authed", async ({
  page,
}) => {
  await page.goto("/plans/plan-adf608632a634e80");
  const prose = page
    .locator(".plan-document-editor-surface .an-rich-md-prose")
    .first();
  await expect(prose).toBeVisible({ timeout: 25_000 });
  await expect(prose).toHaveAttribute("contenteditable", "true", {
    timeout: 15_000,
  });
  // The drag handle appears on hover — confirms the columns gesture is live here.
  await page
    .locator('.plan-block-node[data-block-id="alpha"]')
    .first()
    .hover();
  await expect(page.locator(".drag-handle").first()).toBeVisible({
    timeout: 8_000,
  });
});
