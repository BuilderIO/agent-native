import { expect, test } from "@playwright/test";
import {
  createTask,
  gotoTasksPage,
  resetTasks,
  waitForTasksLoaded,
} from "./helpers/tasks";

test.describe("Tasks reorder and layout", () => {
  test.beforeEach(async ({ page, request }) => {
    await resetTasks(request);
    await gotoTasksPage(page);
  });

  test("keeps heading and add task controls visible while tasks scroll", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 900, height: 560 });
    const baseTitle = `E2E scroll ${Date.now()}`;

    for (let index = 0; index < 24; index += 1) {
      await createTask(request, `${baseTitle} ${index + 1}`);
    }

    await page.reload();
    await waitForTasksLoaded(page);

    const heading = page.getByRole("heading", { name: "Tasks" });
    const input = page.getByLabel("New task title");
    const listRegion = page.getByRole("region", { name: "Tasks list" });
    const main = page.locator("main");
    const headingTopBefore = (await heading.boundingBox())?.y;
    const listBox = await listRegion.boundingBox();
    expect(listBox).toBeTruthy();

    await page.mouse.move(
      listBox!.x + listBox!.width / 2,
      listBox!.y + listBox!.height / 2,
    );
    await page.mouse.wheel(0, 900);

    await expect(heading).toBeVisible();
    await expect(input).toBeVisible();
    await expect
      .poll(() => listRegion.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    await expect
      .poll(() => main.evaluate((element) => element.scrollTop))
      .toBe(0);
    await expect
      .poll(async () => (await heading.boundingBox())?.y)
      .toBe(headingTopBefore);

    await listRegion.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const bottomListBox = await listRegion.boundingBox();
    const lastTaskBox = await page.locator("[data-task-id]").last().boundingBox();
    expect(bottomListBox).toBeTruthy();
    expect(lastTaskBox).toBeTruthy();
    expect(bottomListBox!.y + bottomListBox!.height - (lastTaskBox!.y + lastTaskBox!.height))
      .toBeGreaterThanOrEqual(20);
  });

  test("reorders tasks via the reorder action", async ({ page, request }) => {
    const titles = [`E2E reorder A ${Date.now()}`, `E2E reorder B ${Date.now()}`];
    const ids: string[] = [];

    for (const title of titles) {
      const response = await request.post("/_agent-native/actions/create-task", {
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Native-Frontend": "1",
        },
        data: { title },
      });
      expect(response.ok()).toBeTruthy();
      const task = (await response.json()) as { id: string };
      ids.push(task.id);
    }

    await page.reload();
    await waitForTasksLoaded(page);

    const reorderResponse = await request.post(
      "/_agent-native/actions/reorder-tasks",
      {
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Native-Frontend": "1",
        },
        data: { taskIds: ids.slice().reverse() },
      },
    );
    expect(reorderResponse.ok()).toBeTruthy();
    await waitForTasksLoaded(page);

    const rows = page.locator("[data-task-id]");
    await expect(
      rows.first().getByRole("button", { name: titles[1], exact: true }),
    ).toBeVisible();
    await expect(
      rows.nth(1).getByRole("button", { name: titles[0], exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel(`Reorder ${titles[1]}`)).toBeVisible();
  });

  test("drags a task by the row surface", async ({ page, request }) => {
    const titles = [
      `E2E row drag A ${Date.now()}`,
      `E2E row drag B ${Date.now()}`,
    ];

    for (const title of titles) {
      await createTask(request, title);
    }

    await page.reload();
    await waitForTasksLoaded(page);

    const rows = page.locator("[data-task-id]");
    await expect(
      rows.first().getByRole("button", { name: titles[1], exact: true }),
    ).toBeVisible();
    await expect(
      rows.nth(1).getByRole("button", { name: titles[0], exact: true }),
    ).toBeVisible();

    const firstRowBox = await rows.first().boundingBox();
    const secondRowBox = await rows.nth(1).boundingBox();
    expect(firstRowBox).toBeTruthy();
    expect(secondRowBox).toBeTruthy();

    const dragX = secondRowBox!.x + secondRowBox!.width / 2;
    const dragStartY = secondRowBox!.y + secondRowBox!.height / 2;
    const dragEndY = firstRowBox!.y + firstRowBox!.height / 2;

    await page.mouse.move(dragX, dragStartY);
    await page.mouse.down();
    await page.mouse.move(dragX, dragStartY - 12);
    await page.mouse.move(dragX, dragEndY, { steps: 8 });
    await page.mouse.up();

    await expect(
      rows.first().getByRole("button", { name: titles[0], exact: true }),
    ).toBeVisible();
    await expect(
      rows.nth(1).getByRole("button", { name: titles[1], exact: true }),
    ).toBeVisible();
  });

  test("keeps the drag preview visible outside the task list", async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: 900, height: 420 });
    const baseTitle = `E2E drag overlay ${Date.now()}`;

    for (let index = 0; index < 8; index += 1) {
      await createTask(request, `${baseTitle} ${index + 1}`);
    }

    await page.reload();
    await waitForTasksLoaded(page);

    const listRegion = page.getByRole("region", { name: "Tasks list" });
    const firstRow = page.locator("[data-task-id]").first();
    const listBox = await listRegion.boundingBox();
    const rowBox = await firstRow.boundingBox();
    expect(listBox).toBeTruthy();
    expect(rowBox).toBeTruthy();

    const dragX = rowBox!.x + rowBox!.width / 2;
    const dragStartY = rowBox!.y + rowBox!.height / 2;
    const dragOutsideY = listBox!.y - 70;

    await page.mouse.move(dragX, dragStartY);
    await page.mouse.down();
    await page.mouse.move(dragX, dragStartY - 12);
    await page.mouse.move(dragX, dragOutsideY, { steps: 8 });
    await page.evaluate(() => new Promise(requestAnimationFrame));

    const overlay = page.locator("[data-dnd-overlay-task-id]");
    await expect(overlay).toBeVisible();
    await expect
      .poll(() =>
        overlay.evaluate(
          (element) =>
            element.closest('[role="region"][aria-label="Tasks list"]') !==
            null,
        ),
      )
      .toBe(false);

    const overlayBox = await overlay.boundingBox();
    expect(overlayBox).toBeTruthy();
    expect(overlayBox!.y + overlayBox!.height).toBeLessThan(listBox!.y);

    await page.mouse.up();
    await expect(overlay).toHaveCount(0);
  });
});
