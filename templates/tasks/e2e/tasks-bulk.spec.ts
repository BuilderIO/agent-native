import { expect, test } from "@playwright/test";

import {
  gotoTasksPage,
  resetTasks,
  taskRowByTitle,
  taskTitleButton,
  waitForTasksLoaded,
} from "./helpers/tasks";

test.describe("Tasks bulk selection", () => {
  test.beforeEach(async ({ page, request }) => {
    await resetTasks(request);
    await gotoTasksPage(page);
  });

  test("enters selection mode, selects rows, and bulk-deletes tasks", async ({
    page,
  }) => {
    const first = `E2E bulk one ${Date.now()}`;
    const second = `E2E bulk two ${Date.now()}`;

    for (const title of [first, second]) {
      await page.getByLabel("New task title").fill(title);
      await page.getByRole("button", { name: "Add task" }).click();
      await expect(taskTitleButton(page, title)).toBeVisible();
    }

    await page.getByRole("button", { name: "Select" }).click();
    await expect(page.getByText("Tap tasks to select them.")).toBeVisible();

    await taskRowByTitle(page, first).click();
    await expect(page.getByText("1 selected")).toBeVisible();
    await expect(taskRowByTitle(page, first)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await taskRowByTitle(page, second).click();
    await expect(page.getByText("2 selected")).toBeVisible();
    await expect(taskRowByTitle(page, second)).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Delete tasks?");
    await expect(page.getByRole("alertdialog")).toContainText(first);
    await expect(page.getByRole("alertdialog")).toContainText(second);
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete" })
      .click();

    await waitForTasksLoaded(page);
    await expect(page.locator(`[data-task-id]`)).toHaveCount(0);
    await expect(page.getByText("No tasks yet")).toBeVisible();
  });

  test("bulk-marks selected tasks complete", async ({ page }) => {
    const first = `E2E bulk done one ${Date.now()}`;
    const second = `E2E bulk done two ${Date.now()}`;

    for (const title of [first, second]) {
      await page.getByLabel("New task title").fill(title);
      await page.getByRole("button", { name: "Add task" }).click();
      await expect(taskTitleButton(page, title)).toBeVisible();
    }

    await page.getByRole("button", { name: "Select" }).click();
    await taskRowByTitle(page, first).click();
    await taskRowByTitle(page, second).click();
    await expect(page.getByText("2 selected")).toBeVisible();

    await page.getByRole("button", { name: "Mark complete" }).click();
    await waitForTasksLoaded(page);

    await expect(taskTitleButton(page, first)).toHaveCount(0);
    await expect(taskTitleButton(page, second)).toHaveCount(0);
    await expect(page.getByText("All tasks complete")).toBeVisible();
    await expect(page.getByRole("button", { name: "Select" })).toBeVisible();
  });

  test("reorders selected tasks by dragging the grip handle", async ({
    page,
  }) => {
    const first = `E2E bulk drag A ${Date.now()}`;
    const second = `E2E bulk drag B ${Date.now()}`;
    const third = `E2E bulk drag C ${Date.now()}`;

    for (const title of [first, second, third]) {
      await page.getByLabel("New task title").fill(title);
      await page.getByRole("button", { name: "Add task" }).click();
      await expect(taskTitleButton(page, title)).toBeVisible();
    }

    await page.getByRole("button", { name: "Select" }).click();
    await taskRowByTitle(page, first).click();
    await taskRowByTitle(page, second).click();
    await expect(page.getByText("2 selected")).toBeVisible();

    const orderBefore = await page
      .locator("[data-task-id]")
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-task-id")),
      );

    const movingRow = taskRowByTitle(page, second);
    const targetRow = taskRowByTitle(page, third);
    const movingBox = await movingRow.boundingBox();
    const targetBox = await targetRow.boundingBox();
    expect(movingBox).toBeTruthy();
    expect(targetBox).toBeTruthy();

    const grip = movingRow.getByRole("button", {
      name: new RegExp(`Reorder ${second}`),
    });
    const gripBox = await grip.boundingBox();
    expect(gripBox).toBeTruthy();

    const dragX = gripBox!.x + gripBox!.width / 2;
    const dragStartY = gripBox!.y + gripBox!.height / 2;
    const dragEndY = targetBox!.y + targetBox!.height / 2;

    await page.mouse.move(dragX, dragStartY);
    await page.mouse.down();
    await page.mouse.move(dragX, dragStartY - 12);
    await page.mouse.move(dragX, dragEndY, { steps: 8 });
    await page.mouse.up();
    await waitForTasksLoaded(page);

    const orderAfter = await page
      .locator("[data-task-id]")
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-task-id")),
      );
    expect(orderAfter).not.toEqual(orderBefore);
  });
});
