import { z } from "zod";

import { expect, test, uniqueName, type Daily } from "./fixtures";
import { seedProject } from "./objects.helpers";

const membership = z.object({
  assignments: z.array(
    z.object({ projectId: z.string(), collectionIds: z.array(z.string()) }),
  ),
});
const collections = z.object({
  collections: z.array(z.object({ id: z.string(), name: z.string() })),
});

async function collectionIdsOf(daily: Daily, projectId: string) {
  const result = membership.parse(
    await daily.action("list-project-collections", {}, "GET"),
  );
  return (
    result.assignments.find((item) => item.projectId === projectId)
      ?.collectionIds ?? []
  );
}

test("QA-COL-1 creating a collection opens its page, and a project row can be removed with a confirm", async ({
  daily,
}) => {
  const project = await seedProject(daily, uniqueName("Remove project"));
  const name = uniqueName("Create coll");
  const page = daily.page;
  let createdId: string | undefined;
  try {
    await daily.open("/home/collections");
    await page.getByRole("button", { name: "New collection" }).click();
    const dialog = page.getByRole("dialog", { name: "Create new collection" });
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await dialog.getByRole("button", { name: "Create collection" }).click();

    await expect(page).toHaveURL(/\/collection\/[^/]+/, { timeout: 30_000 });
    createdId = new URL(page.url()).pathname.split("/")[2];
    expect(createdId).toBeTruthy();
    const listed = collections.parse(
      await daily.action("list-collections", {}, "GET"),
    );
    expect(listed.collections.some((item) => item.id === createdId)).toBe(true);
    await daily.check();

    await daily.action("add-project-to-collection", {
      projectId: project.id,
      collectionId: createdId,
    });
    await daily.reload();
    const row = page
      .locator("tbody tr")
      .filter({ has: page.getByRole("link", { name: project.title }) });
    await expect(row).toBeVisible({ timeout: 30_000 });

    await row.hover();
    await row.getByRole("button", { name: "View more actions" }).click();
    await page
      .getByRole("menuitem", { name: "Remove from collection" })
      .click();
    const confirm = page.getByRole("dialog", {
      name: "Confirm remove from Collection",
    });
    await expect(confirm).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(confirm).toBeHidden();
    expect(await collectionIdsOf(daily, project.id)).toEqual([createdId]);

    await row.hover();
    await row.getByRole("button", { name: "View more actions" }).click();
    await page
      .getByRole("menuitem", { name: "Remove from collection" })
      .click();
    await confirm
      .getByRole("button", { name: "Remove from Collection" })
      .dblclick();
    await expect(row).toBeHidden({ timeout: 30_000 });
    await expect.poll(() => collectionIdsOf(daily, project.id)).toEqual([]);
    await daily.check();
  } finally {
    await daily.cleanupProject(project.id);
    if (createdId !== undefined)
      await daily.cleanupAction("delete-collection", {
        collectionId: createdId,
      });
  }
});
