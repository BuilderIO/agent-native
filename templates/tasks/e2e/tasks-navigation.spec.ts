import { expect, test } from "@playwright/test";

import {
  gotoTasksPage,
  resetTasks,
  taskTitleButton,
  waitForServerTaskId,
  waitForTasksLoaded,
} from "./helpers/tasks";

test.describe("Tasks navigation", () => {
  test.beforeEach(async ({ page, request }) => {
    await resetTasks(request);
    await gotoTasksPage(page);
  });

  test("redirects / to the task list", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/tasks\/?$/);
    await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  });

  test("highlights a completed task from a deep link", async ({ page }) => {
    const title = `E2E deeplink ${Date.now()}`;

    await page.getByLabel("New task title").fill(title);
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(taskTitleButton(page, title)).toBeVisible();

    const taskId = await waitForServerTaskId(page, title);

    await page
      .getByRole("checkbox", { name: new RegExp(`Mark ${title} complete`) })
      .click();
    await expect(taskTitleButton(page, title)).toHaveCount(0);

    await page.goto(`/tasks?task=${taskId}`);
    await waitForTasksLoaded(page);
    await expect(page).toHaveURL(/includeDone=true/);
    await expect(page.getByLabel("Show all")).toBeChecked();
    await expect(page.locator(`[data-task-id="${taskId}"]`)).toHaveClass(
      /ring-2/,
    );
    await expect(taskTitleButton(page, title)).toBeVisible();
  });

  test("persists the show-all filter in the URL", async ({ page }) => {
    const title = `E2E filter ${Date.now()}`;
    await page.getByLabel("New task title").fill(title);
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(taskTitleButton(page, title)).toBeVisible();

    await page.getByRole("switch", { name: "Show all" }).click();
    await expect(page).toHaveURL(/includeDone=true/);
    await page.reload();
    await expect(page.getByLabel("Show all")).toBeChecked();
  });
});
