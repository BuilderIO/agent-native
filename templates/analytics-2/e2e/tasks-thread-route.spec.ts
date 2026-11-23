import { expect, test } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-env";

const BASE = E2E_BASE_URL;

test("Create in thread opens a fresh thread without submitting a prompt", async ({
  page,
}) => {
  await page.goto(`${BASE}/tasks`);
  await page
    .getByRole("button", { name: "Create in thread", exact: true })
    .click();
  await expect(page).toHaveURL(/\/ask\?promptExample=create-task$/);
  await expect(page.locator("[data-agent-page-chat-header] h1")).toHaveText(
    "New thread",
  );
  const input = page.locator('[contenteditable="true"][role="textbox"]');
  await expect(input).toBeVisible();
  await expect(input).toHaveText("");
  await page.reload();
  await expect(page.locator("[data-agent-page-chat-header] h1")).toHaveText(
    "New thread",
  );
  await expect(input).toBeVisible();
  await expect(input).toHaveText("");
});
