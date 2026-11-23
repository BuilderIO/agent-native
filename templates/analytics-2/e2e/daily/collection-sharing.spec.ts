import { z } from "zod";

import { expect, test, uniqueName, type Daily } from "./fixtures";

const summary = z.object({
  collections: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      isPrivate: z.boolean(),
      sharedWithWorkspace: z.boolean(),
    }),
  ),
});
const shares = z.object({
  visibility: z.string(),
  shares: z.array(z.object({ principalType: z.string(), role: z.string() })),
});

async function readback(daily: Daily, id: string) {
  const list = summary.parse(await daily.action("list-collections", {}, "GET"));
  const shared = shares.parse(
    await daily.action(
      "list-resource-shares",
      { resourceType: "analytics-collection", resourceId: id },
      "GET",
    ),
  );
  return { row: list.collections.find((item) => item.id === id), shared };
}

async function idOf(daily: Daily, name: string) {
  const list = summary.parse(await daily.action("list-collections", {}, "GET"));
  return list.collections.find((item) => item.name === name)?.id;
}

test("report 1795084559.059689 a collection can be shared with the workspace when it is created", async ({
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
  const page = daily.page;
  const privateName = uniqueName("Private coll");
  const sharedName = uniqueName("Shared coll");
  const made: string[] = [];
  let primary: { error: unknown } | undefined;

  async function create(name: string, share: boolean) {
    await daily.open("/home/collections");
    await page
      .getByRole("button", { name: "New collection", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Create new collection" });
    await expect(dialog).toBeVisible();
    await dialog.locator("#analytics-collection-name").fill(name);
    if (share) {
      await dialog.getByRole("switch").click();
      await dialog.getByLabel("Workspace role").click();
      await page.getByRole("option", { name: "Manager" }).click();
    }
    await dialog
      .getByRole("button", { name: "Create collection", exact: true })
      .click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await daily.check();
    const id = await idOf(daily, name);
    expect(id).toBeTruthy();
    made.push(String(id));
    return String(id);
  }

  try {
    const privateId = await create(privateName, false);
    await daily.reload();
    const privateRead = await readback(daily, privateId);
    expect(privateRead.row).toMatchObject({
      isPrivate: true,
      sharedWithWorkspace: false,
    });
    expect(privateRead.shared.shares).toEqual([]);

    const sharedId = await create(sharedName, true);
    await daily.reload();
    const sharedRead = await readback(daily, sharedId);
    expect(sharedRead.row).toMatchObject({
      isPrivate: false,
      sharedWithWorkspace: true,
    });
    expect(sharedRead.shared.shares).toEqual([
      expect.objectContaining({ principalType: "org", role: "admin" }),
    ]);
    await expect(page.getByText(sharedName)).toBeVisible();
  } catch (error) {
    primary = { error };
    throw error;
  } finally {
    // A collection whose create call succeeded but whose id was never read back
    // is still found by its unique name, so a half-finished run cannot leak it.
    const cleanupErrors: unknown[] = [];
    const ids = new Set(made);
    for (const name of [privateName, sharedName]) {
      try {
        const id = await idOf(daily, name);
        if (id !== undefined) ids.add(id);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    for (const id of ids) {
      try {
        await daily.action("delete-collection", { collectionId: id });
        const list = summary.parse(
          await daily.action("list-collections", {}, "GET"),
        );
        if (list.collections.some((item) => item.id === id))
          throw new Error(`Collection ${id} is still listed after delete.`);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0)
      throw new AggregateError(
        primary === undefined
          ? cleanupErrors
          : [primary.error, ...cleanupErrors],
        "Collection sharing cleanup failed; created collections may remain.",
      );
  }
});
