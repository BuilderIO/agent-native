import { expect, test } from "@playwright/test";

import {
  createTask,
  chooseTaskRowMenuItem,
  gotoTasksPage,
  openTaskRowMenu,
  resetTasks,
  taskTitleButton,
  waitForServerTaskId,
  waitForTasksLoaded,
} from "./helpers/tasks";

test.describe("Tasks CRUD", () => {
  test.beforeEach(async ({ page, request }) => {
    await resetTasks(request);
    await gotoTasksPage(page);
  });

  test("shows empty state on fresh database", async ({ page }) => {
    await expect(page.getByText("No tasks yet")).toBeVisible();
    await expect(
      page.getByText("Add one above or ask chat to create a task for you."),
    ).toBeVisible();
    await expect(page.getByLabel("Show all")).toBeVisible();
    await expect(page.getByLabel("Show all")).not.toBeChecked();
  });

  test("adds a task from the task list", async ({ page }) => {
    const title = `E2E add ${Date.now()}`;
    const nextTitle = `${title} second`;

    await page.getByLabel("New task title").fill(title);
    await page.getByRole("button", { name: "Add task" }).click();

    await expect(taskTitleButton(page, title)).toBeVisible();
    await page.getByLabel("New task title").fill(nextTitle);
    await page.getByRole("button", { name: "Add task" }).click();

    await expect(taskTitleButton(page, nextTitle)).toBeVisible();
    await expect(
      page.locator("[data-task-id]").first().getByRole("button", {
        name: nextTitle,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByLabel("Show all")).toBeVisible();
    await expect(page.getByLabel("Show all")).not.toBeChecked();
    await expect(page.getByText("No tasks yet")).toHaveCount(0);
  });

  test("shows a newly created task while create is pending", async ({
    page,
  }) => {
    const title = `E2E create pending ${Date.now()}`;
    let releaseCreate: (() => void) | undefined;
    let sawPendingCreate = false;

    await page.route("**/_agent-native/actions/create-task", async (route) => {
      const payload = route.request().postDataJSON() as { title?: string };
      if (payload.title === title) {
        sawPendingCreate = true;
        await new Promise<void>((resolve) => {
          releaseCreate = resolve;
        });
      }
      await route.continue();
    });

    await page.getByLabel("New task title").fill(title);
    await page.getByRole("button", { name: "Add task" }).click();
    await expect.poll(() => sawPendingCreate).toBe(true);
    await page.evaluate(() => new Promise(requestAnimationFrame));

    await expect(taskTitleButton(page, title)).toBeVisible();

    releaseCreate?.();
    await waitForTasksLoaded(page);
    await expect(taskTitleButton(page, title)).toBeVisible();
  });

  test("completes a task and hides it until show-all is enabled", async ({
    page,
  }) => {
    const title = `E2E complete ${Date.now()}`;

    await page.getByLabel("New task title").fill(title);
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(taskTitleButton(page, title)).toBeVisible();

    await page
      .getByRole("checkbox", { name: new RegExp(`Mark ${title} complete`) })
      .click();

    await expect(taskTitleButton(page, title)).toHaveCount(0);

    await page.getByRole("switch", { name: "Show all" }).click();
    await expect(page.getByLabel("Show all")).toBeChecked();
    await waitForTasksLoaded(page);

    const completedTitle = taskTitleButton(page, title);
    await expect(completedTitle).toBeVisible();
    await expect(completedTitle).toHaveClass(/line-through/);
  });

  test("hides a completed task while the update is pending", async ({
    page,
  }) => {
    const title = `E2E complete pending ${Date.now()}`;
    let releaseUpdate: (() => void) | undefined;
    let sawPendingUpdate = false;

    await page.getByLabel("New task title").fill(title);
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(taskTitleButton(page, title)).toBeVisible();

    await page.route("**/_agent-native/actions/update-task", async (route) => {
      const payload = route.request().postDataJSON() as { done?: boolean };
      if (payload.done === true) {
        sawPendingUpdate = true;
        await new Promise<void>((resolve) => {
          releaseUpdate = resolve;
        });
      }
      await route.continue();
    });

    await page
      .getByRole("checkbox", { name: new RegExp(`Mark ${title} complete`) })
      .click();
    await expect.poll(() => sawPendingUpdate).toBe(true);
    await expect(taskTitleButton(page, title)).toHaveCount(0);

    releaseUpdate?.();
    await waitForTasksLoaded(page);
    await expect(taskTitleButton(page, title)).toHaveCount(0);
  });

  test("inline-edits a task title", async ({ page }) => {
    const title = `E2E edit ${Date.now()}`;
    const updated = `${title} updated`;
    let updateRequests = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().includes("/_agent-native/actions/update-task")
      ) {
        updateRequests += 1;
      }
    });

    await page.getByLabel("New task title").fill(title);
    await page.getByRole("button", { name: "Add task" }).click();
    await taskTitleButton(page, title).click();

    const editor = page.getByLabel("Edit task title");
    await expect(editor).toBeVisible();
    await editor.fill(updated);
    await editor.press("Enter");

    await expect(taskTitleButton(page, updated)).toBeVisible();
    await expect(taskTitleButton(page, title)).toHaveCount(0);
    await expect.poll(() => updateRequests).toBe(1);
  });

  test("keeps the submitted title visible while inline edit update is pending", async ({
    page,
  }) => {
    const title = `E2E edit pending ${Date.now()}`;
    const updated = `${title} updated`;
    let releaseUpdate: (() => void) | undefined;
    let sawPendingUpdate = false;

    await page.route("**/_agent-native/actions/update-task", async (route) => {
      const payload = route.request().postDataJSON() as { title?: string };
      if (payload.title === updated) {
        sawPendingUpdate = true;
        await new Promise<void>((resolve) => {
          releaseUpdate = resolve;
        });
      }
      await route.continue();
    });

    await page.getByLabel("New task title").fill(title);
    await page.getByRole("button", { name: "Add task" }).click();
    await taskTitleButton(page, title).click();

    const editor = page.getByLabel("Edit task title");
    await expect(editor).toBeVisible();
    await editor.fill(updated);
    await editor.press("Enter");
    await expect.poll(() => sawPendingUpdate).toBe(true);
    await page.evaluate(() => new Promise(requestAnimationFrame));

    await expect(taskTitleButton(page, updated)).toBeVisible();
    await expect(taskTitleButton(page, title)).toHaveCount(0);

    releaseUpdate?.();
    await waitForTasksLoaded(page);
    await expect(taskTitleButton(page, updated)).toBeVisible();
  });

  test("rolls back an inline title edit when update fails", async ({
    page,
  }) => {
    const title = `E2E edit failure ${Date.now()}`;
    const updated = `${title} updated`;
    let failedUpdateRequests = 0;

    await page.route("**/_agent-native/actions/update-task", async (route) => {
      const payload = route.request().postDataJSON() as { title?: string };
      if (payload.title === updated) {
        failedUpdateRequests += 1;
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "forced update failure" }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByLabel("New task title").fill(title);
    await page.getByRole("button", { name: "Add task" }).click();
    await taskTitleButton(page, title).click();

    const editor = page.getByLabel("Edit task title");
    await expect(editor).toBeVisible();
    await editor.fill(updated);
    await editor.press("Enter");

    await expect.poll(() => failedUpdateRequests).toBe(1);
    await expect(taskTitleButton(page, title)).toBeVisible();
    await expect(taskTitleButton(page, updated)).toHaveCount(0);
  });

  test("deletes a task after confirmation", async ({ page }) => {
    const title = `E2E delete ${Date.now()}`;

    await page.getByLabel("New task title").fill(title);
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(taskTitleButton(page, title)).toBeVisible();

    await expect(
      page.getByRole("button", { name: new RegExp(`Actions for ${title}`) }),
    ).toBeVisible();
    await openTaskRowMenu(page, title);
    await chooseTaskRowMenuItem(page, "Delete");

    await expect(page.getByRole("alertdialog")).toContainText("Delete task?");
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete" })
      .click();

    await expect(taskTitleButton(page, title)).toHaveCount(0);
  });

  test("removes a deleted task while delete is pending", async ({ page }) => {
    const title = `E2E delete pending ${Date.now()}`;
    let releaseDelete: (() => void) | undefined;
    let sawPendingDelete = false;

    await page.getByLabel("New task title").fill(title);
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(taskTitleButton(page, title)).toBeVisible();

    await page.route("**/_agent-native/actions/delete-task", async (route) => {
      sawPendingDelete = true;
      await new Promise<void>((resolve) => {
        releaseDelete = resolve;
      });
      await route.continue();
    });

    await openTaskRowMenu(page, title);
    await chooseTaskRowMenuItem(page, "Delete");
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete" })
      .click();

    await expect.poll(() => sawPendingDelete).toBe(true);
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(taskTitleButton(page, title)).toHaveCount(0);

    releaseDelete?.();
    await waitForTasksLoaded(page);
    await expect(taskTitleButton(page, title)).toHaveCount(0);
  });

  test("reflects tasks created via the action API without refresh", async ({
    page,
    request,
  }) => {
    const title = `E2E sync ${Date.now()}`;

    const createResponse = await request.post(
      "/_agent-native/actions/create-task",
      {
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Native-Frontend": "1",
        },
        data: { title },
      },
    );
    expect(createResponse.ok()).toBeTruthy();

    await expect(taskTitleButton(page, title)).toBeVisible({ timeout: 10_000 });
  });

  test("reflects task completion via the action API without refresh", async ({
    page,
    request,
  }) => {
    const title = `E2E done sync ${Date.now()}`;

    const createResponse = await request.post(
      "/_agent-native/actions/create-task",
      {
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Native-Frontend": "1",
        },
        data: { title },
      },
    );
    expect(createResponse.ok()).toBeTruthy();
    const { id } = (await createResponse.json()) as { id: string };

    await expect(taskTitleButton(page, title)).toBeVisible({ timeout: 10_000 });

    const updateResponse = await request.post(
      "/_agent-native/actions/update-task",
      {
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Native-Frontend": "1",
        },
        data: { taskId: id, done: true },
      },
    );
    expect(updateResponse.ok()).toBeTruthy();

    await expect(taskTitleButton(page, title)).toHaveCount(0, {
      timeout: 10_000,
    });
  });

  test("shows all-complete state when every task is done", async ({ page }) => {
    const title = `E2E all done ${Date.now()}`;

    await page.getByLabel("New task title").fill(title);
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(taskTitleButton(page, title)).toBeVisible();

    await page
      .getByRole("checkbox", { name: new RegExp(`Mark ${title} complete`) })
      .click();

    await expect(page.getByText("All tasks complete")).toBeVisible();
    await expect(page.getByText("No tasks yet")).toHaveCount(0);
  });

  test("marks a completed task incomplete again in show-all mode", async ({
    page,
  }) => {
    const title = `E2E reopen ${Date.now()}`;

    await page.getByLabel("New task title").fill(title);
    await page.getByRole("button", { name: "Add task" }).click();
    await page
      .getByRole("checkbox", { name: new RegExp(`Mark ${title} complete`) })
      .click();
    await expect(page.getByText("All tasks complete")).toBeVisible();

    await page.getByRole("switch", { name: "Show all" }).click();
    await waitForTasksLoaded(page);
    await page
      .getByRole("checkbox", { name: new RegExp(`Mark ${title} incomplete`) })
      .click();
    await waitForTasksLoaded(page);

    await page.getByRole("switch", { name: "Show all" }).click();
    await waitForTasksLoaded(page);
    await expect(taskTitleButton(page, title)).toBeVisible();
  });

  test("keeps a reopened task unchecked while the update is pending", async ({
    page,
  }) => {
    const title = `E2E reopen pending ${Date.now()}`;

    await page.getByLabel("New task title").fill(title);
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(taskTitleButton(page, title)).toBeVisible();
    await waitForServerTaskId(page, title);

    await page
      .getByRole("checkbox", { name: new RegExp(`Mark ${title} complete`) })
      .click();
    await expect(page.getByText("All tasks complete")).toBeVisible();

    await page.getByRole("switch", { name: "Show all" }).click();
    await waitForTasksLoaded(page);
    await expect(
      page.getByRole("checkbox", {
        name: new RegExp(`Mark ${title} incomplete`),
      }),
    ).toBeVisible();

    let releaseUpdate: (() => void) | undefined;
    let sawPendingUpdate = false;
    await page.route("**/_agent-native/actions/update-task", async (route) => {
      const payload = route.request().postDataJSON() as { done?: boolean };
      if (payload.done === false) {
        sawPendingUpdate = true;
        await new Promise<void>((resolve) => {
          releaseUpdate = resolve;
        });
      }
      await route.continue();
    });

    const row = page.locator("[data-task-id]").filter({
      has: taskTitleButton(page, title),
    });
    const checkbox = row.getByRole("checkbox");
    await checkbox.click();
    await expect.poll(() => sawPendingUpdate).toBe(true);
    await page.evaluate(() => new Promise(requestAnimationFrame));

    await expect(checkbox).not.toBeChecked();

    releaseUpdate?.();
    await waitForTasksLoaded(page);
    await expect(checkbox).not.toBeChecked();
  });
});
