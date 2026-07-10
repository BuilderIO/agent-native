import { expect, test } from "@playwright/test";
import {
  gotoInboxPage,
  inboxItemTitleButton,
  resetInbox,
  waitForInboxLoaded,
} from "./helpers/inbox";

test.describe("Inbox CRUD", () => {
  test.beforeEach(async ({ page, request }) => {
    await resetInbox(request);
    await gotoInboxPage(page);
  });

  test("shows empty state on fresh database", async ({ page }) => {
    await expect(page.getByText("Inbox is empty")).toBeVisible();
    await expect(
      page.getByText("Add an item above or ask chat to capture something for triage."),
    ).toBeVisible();
  });

  test("adds an inbox item from the inbox list", async ({ page }) => {
    const title = `E2E inbox add ${Date.now()}`;

    await page.getByLabel("New inbox item title").fill(title);
    await page.getByRole("button", { name: "Add item" }).click();

    await expect(inboxItemTitleButton(page, title)).toBeVisible();
    await expect(page.getByText("Inbox is empty")).toHaveCount(0);
  });

  test("inline-edits an inbox item title", async ({ page }) => {
    const title = `E2E inbox edit ${Date.now()}`;
    const updated = `${title} updated`;

    await page.getByLabel("New inbox item title").fill(title);
    await page.getByRole("button", { name: "Add item" }).click();
    await inboxItemTitleButton(page, title).click();

    const editor = page.getByLabel("Edit inbox item title");
    await expect(editor).toBeVisible();
    await editor.fill(updated);
    await editor.press("Enter");

    await expect(inboxItemTitleButton(page, updated)).toBeVisible();
    await expect(inboxItemTitleButton(page, title)).toHaveCount(0);
  });

  test("marks an inbox item ready and keeps the user on inbox", async ({ page }) => {
    const title = `E2E inbox ready ${Date.now()}`;

    await page.getByLabel("New inbox item title").fill(title);
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(inboxItemTitleButton(page, title)).toBeVisible();

    await page.getByRole("button", { name: "Mark ready" }).click();

    await expect(inboxItemTitleButton(page, title)).toHaveCount(0);
    await expect(page).toHaveURL(/\/inbox(?:\?.*)?$/);
    await waitForInboxLoaded(page);
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  });

  test("deletes an inbox item after confirmation", async ({ page }) => {
    const title = `E2E inbox delete ${Date.now()}`;

    await page.getByLabel("New inbox item title").fill(title);
    await page.getByRole("button", { name: "Add item" }).click();
    await expect(inboxItemTitleButton(page, title)).toBeVisible();

    await page
      .getByRole("button", { name: new RegExp(`Delete ${title}`) })
      .click();

    await expect(page.getByRole("alertdialog")).toContainText(
      "Delete inbox item?",
    );
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete" })
      .click();

    await expect(inboxItemTitleButton(page, title)).toHaveCount(0);
  });
});
