import { z } from "zod";

import { expect, test, uniqueName, type Daily } from "./fixtures";
import { createCollection, seedProject } from "./objects.helpers";

const membership = z.object({
  assignments: z.array(
    z.object({ projectId: z.string(), collectionIds: z.array(z.string()) }),
  ),
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

test("report 1795084861.733869 collection page lists the project columns and Display settings", async ({
  daily,
}) => {
  const identity = z
    .object({
      user: z.object({ email: z.literal("qa-fleet@builder.io") }),
      workspace: z.object({ id: z.string().min(1) }),
    })
    .parse(await daily.action("get-workspace-shell", {}, "GET"));
  console.log(
    `QA identity ${identity.user.email}, workspace ${identity.workspace.id}`,
  );
  const project = await seedProject(daily, uniqueName("Column project"));
  const collection = await createCollection(daily, uniqueName("Column coll"));
  const page = daily.page;
  const headers = page.locator("thead th");
  const row = page
    .locator("tbody tr")
    .filter({ has: page.getByRole("link", { name: project.title }) });
  try {
    await daily.action("add-project-to-collection", {
      projectId: project.id,
      collectionId: collection.id,
    });
    expect(await collectionIdsOf(daily, project.id)).toEqual([collection.id]);

    await daily.open(`/collection/${collection.id}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    for (const name of ["Title", "Status", "Owner"])
      await expect(headers.filter({ hasText: name }).first()).toBeVisible();
    await expect(headers.filter({ hasText: "Creator" })).toHaveCount(0);

    // Column choices live in component state only (as on the Projects page), so no reopen oracle.
    await page.getByRole("button", { name: "Display settings" }).click();
    const settings = page.getByRole("dialog", { name: "Display settings" });
    await expect(settings).toBeVisible();
    await settings.getByLabel("Creator").check();
    await expect(headers.filter({ hasText: "Creator" })).toHaveCount(1);
    const texts = await headers.allInnerTexts();
    const index = texts.findIndex((text) => text.trim() === "Creator");
    expect(index).toBeGreaterThan(0);
    await expect(
      row.locator("td").nth(index).locator(`[title="${identity.user.email}"]`),
    ).toBeVisible();

    // A second toggle: hiding a column removes its header.
    await settings.getByLabel("Owner", { exact: true }).uncheck();
    await expect(headers.filter({ hasText: "Owner" })).toHaveCount(0);
    await expect(headers.filter({ hasText: "Creator" })).toHaveCount(1);
    await page.keyboard.press("Escape");
    await daily.check();

    // Open the project through its row; the saved membership is unchanged.
    await row.getByRole("link", { name: project.title }).click();
    await expect(page).toHaveURL(new RegExp(`/project/${project.id}`), {
      timeout: 30_000,
    });
    expect(await collectionIdsOf(daily, project.id)).toEqual([collection.id]);

    // A full reload of the collection still shows the row.
    await daily.open(`/collection/${collection.id}`);
    await daily.reload();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row.getByText(collection.name)).toBeVisible();

    // Remove through the real picker: untick the collection in "Add to collection".
    await row.hover();
    await row.getByRole("button", { name: "View more actions" }).click();
    await page.getByRole("menuitem", { name: "Add to collection" }).click();
    const picker = page.getByRole("dialog", { name: "Add to collection" });
    await expect(picker).toBeVisible();
    await picker.getByLabel(collection.name).click();
    await expect.poll(() => collectionIdsOf(daily, project.id)).toEqual([]);
    await picker.getByRole("button", { name: "Done" }).click();
    await expect(row).toBeHidden({ timeout: 30_000 });
    await daily.check();
  } finally {
    const filed = await collectionIdsOf(daily, project.id);
    if (filed.includes(collection.id))
      await daily.action("remove-project-from-collection", {
        projectId: project.id,
        collectionId: collection.id,
      });
    await daily.cleanupProject(project.id);
    await daily.cleanupAction("delete-collection", {
      collectionId: collection.id,
    });
    const after = await daily.context.request.get(
      `${daily.server.base}/_agent-native/actions/get-project`,
      { params: { projectId: project.id } },
    );
    expect(after.status(), "project cleanup readback").toBe(404);
    const left = z
      .object({ collections: z.array(z.object({ id: z.string() })) })
      .parse(await daily.action("list-collections", {}, "GET"));
    expect(
      left.collections.some((item) => item.id === collection.id),
      "collection cleanup readback",
    ).toBe(false);
  }
});
