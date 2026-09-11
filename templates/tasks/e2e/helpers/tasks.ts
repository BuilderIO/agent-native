import { expect, type APIRequestContext } from "@playwright/test";

export async function resetTasks(request: APIRequestContext) {
  const listResponse = await request.get(
    "/_agent-native/actions/list-tasks?includeDone=true",
    { headers: { "X-Agent-Native-Frontend": "1" } },
  );
  expect(listResponse.ok()).toBeTruthy();
  const { tasks } = (await listResponse.json()) as {
    tasks: Array<{ id: string }>;
  };

  for (const task of tasks) {
    const deleteResponse = await request.post(
      "/_agent-native/actions/delete-task",
      {
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Native-Frontend": "1",
        },
        data: { taskId: task.id },
      },
    );
    expect(deleteResponse.ok()).toBeTruthy();
  }
}

export async function waitForTasksLoaded(
  page: import("@playwright/test").Page,
) {
  await expect(page.locator(".animate-pulse")).toHaveCount(0);
}

export function taskTitleButton(
  page: import("@playwright/test").Page,
  title: string,
) {
  return page.getByRole("button", { name: title, exact: true });
}

export function taskRowByTitle(
  page: import("@playwright/test").Page,
  title: string,
) {
  return page.locator("[data-task-id]").filter({
    has: page.getByText(title, { exact: true }),
  });
}

export async function openTaskRowMenu(
  page: import("@playwright/test").Page,
  title: string,
) {
  const row = taskRowByTitle(page, title);
  await row
    .getByRole("button", { name: new RegExp(`Actions for ${title}`) })
    .click();
}

export async function chooseTaskRowMenuItem(
  page: import("@playwright/test").Page,
  itemName: string,
) {
  await page.getByRole("menuitem", { name: itemName, exact: true }).click();
}

export async function waitForServerTaskId(
  page: import("@playwright/test").Page,
  title: string,
) {
  const row = taskRowByTitle(page, title);
  await expect
    .poll(async () => {
      const id = await row.getAttribute("data-task-id");
      return id && !id.startsWith("optimistic-") ? "server" : "pending";
    })
    .toBe("server");

  const id = await row.getAttribute("data-task-id");
  expect(id).toBeTruthy();
  return id as string;
}

export async function createTask(request: APIRequestContext, title: string) {
  const response = await request.post("/_agent-native/actions/create-task", {
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Native-Frontend": "1",
    },
    data: { title },
  });
  expect(response.ok()).toBeTruthy();
}

export async function gotoTasksPage(page: import("@playwright/test").Page) {
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await waitForTasksLoaded(page);
}
