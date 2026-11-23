import { LABEL_COLORS } from "../../app/lib/model/label-colors";
import { expect, test, uniqueName } from "./fixtures";

test("organization catalog edits persist and deletions require confirmation", async ({
  daily,
}) => {
  const rows = [
    {
      type: "status",
      heading: "Asset status",
      name: uniqueName("QA status"),
      updated: uniqueName("Updated status"),
      action: "list-data-statuses",
      key: "statuses",
      remove: "delete-data-status",
    },
    {
      type: "category",
      heading: "Asset categories",
      name: uniqueName("QA category"),
      updated: uniqueName("Updated category"),
      action: "list-data-categories",
      key: "categories",
      remove: "delete-data-category",
    },
  ] as const;
  const secondStatus = uniqueName("Second status");
  const owned = new Map<string, string>();
  type Entry = { id: string; name: string; description?: string | null };
  const list = async (row: (typeof rows)[number]) => {
    const result = (
      await daily.action<Record<string, Entry[]>>(row.action, {}, "GET")
    )[row.key];
    if (!result) throw new Error(`Missing ${row.key} in ${row.action} result`);
    return result;
  };
  try {
    await daily.open("/settings/organization");
    // The reorder action submits the complete list, so never reorder shared records.
    expect(await list(rows[0])).toEqual([]);
    for (const row of rows) {
      await expect(
        daily.page.getByRole("heading", { name: row.heading, exact: true }),
      ).toBeVisible();
      await daily.page.getByRole("button", { name: `New ${row.type}` }).click();
      const create = daily.page.getByRole("dialog", {
        name: `New ${row.type}`,
      });
      await create.getByLabel("Name", { exact: true }).fill(row.name);
      await create
        .getByRole("radio", { name: `Use ${LABEL_COLORS[0]}` })
        .check();
      await create.getByRole("button", { name: `New ${row.type}` }).click();
      await expect(
        daily.page.getByText(row.name, { exact: true }),
      ).toBeVisible();
      const created = (await list(row)).find(
        (entry) => entry.name === row.name,
      );
      expect(created).toBeDefined();
      if (!created) throw new Error(`Missing created ${row.type}`);
      owned.set(row.type, created.id);

      await daily.page
        .getByRole("button", { name: `Actions for ${row.name}` })
        .click();
      await daily.page.getByRole("menuitem", { name: "Edit..." }).click();
      const edit = daily.page.getByRole("dialog", {
        name: `Update ${row.type}`,
      });
      await edit.getByLabel("Name", { exact: true }).fill(row.updated);
      await edit
        .getByLabel("Description", { exact: true })
        .fill(`QA edited ${row.type} description`);
      await edit.getByRole("button", { name: `Update ${row.type}` }).click();
      await expect(
        daily.page
          .getByRole("region", { name: row.heading })
          .getByText(row.updated, { exact: true }),
      ).toBeVisible();
      expect(
        (await list(row)).find((entry) => entry.id === created.id)?.name,
      ).toBe(row.updated);
      expect(
        (await list(row)).find((entry) => entry.id === created.id)?.description,
      ).toBe(`QA edited ${row.type} description`);
    }
    const statuses = rows[0];
    await daily.page.getByRole("button", { name: "New status" }).click();
    const createSecond = daily.page.getByRole("dialog", { name: "New status" });
    await createSecond.getByLabel("Name", { exact: true }).fill(secondStatus);
    await createSecond
      .getByRole("radio", { name: `Use ${LABEL_COLORS[0]}` })
      .check();
    await createSecond.getByRole("button", { name: "New status" }).click();
    await expect(
      daily.page.getByText(secondStatus, { exact: true }),
    ).toBeVisible();
    const second = (await list(statuses)).find(
      (entry) => entry.name === secondStatus,
    );
    expect(second).toBeDefined();
    if (!second) throw new Error("Missing second status");
    owned.set("secondStatus", second.id);
    await daily.page
      .getByLabel(`Reorder ${secondStatus}`)
      .dragTo(daily.page.getByLabel(`Reorder ${statuses.updated}`));
    await daily.page
      .getByRole("combobox", { name: "Set a default status for new projects" })
      .click();
    const [saveResponse] = await Promise.all([
      daily.page.waitForResponse(
        (response) =>
          response
            .url()
            .includes("/_agent-native/actions/set-default-data-status") &&
          response.request().method() === "POST",
      ),
      daily.page.getByRole("option", { name: statuses.updated }).click(),
    ]);
    expect(saveResponse.ok()).toBe(true);
    const selected = await daily.action<{ defaultStatusId: string | null }>(
      "list-data-statuses",
      {},
      "GET",
    );
    expect(selected.defaultStatusId).toBe(owned.get("status"));
    const project = await daily.createProject();
    const projectRead = await daily.action<{
      project: { statusId: string | null };
    }>("get-project", { projectId: project.id }, "GET");
    expect(projectRead.project.statusId).toBe(owned.get("status"));
    await daily.cleanupProject(project.id);
    await daily.reload();
    await expect(
      daily.page.getByRole("combobox", {
        name: "Set a default status for new projects",
      }),
    ).toContainText(statuses.updated);
    const order = (await list(statuses)).map((entry) => entry.id);
    const statusId = owned.get("status");
    expect(statusId).toBeDefined();
    if (!statusId) throw new Error("Missing owned status id");
    expect(order.indexOf(second.id)).toBeLessThan(order.indexOf(statusId));
    for (const row of rows) {
      await expect(
        daily.page
          .getByRole("region", { name: row.heading })
          .getByText(row.updated, { exact: true }),
      ).toBeVisible();
      await expect(
        daily.page.getByText(`QA edited ${row.type} description`, {
          exact: true,
        }),
      ).toBeVisible();
      await daily.page
        .getByRole("button", { name: `Actions for ${row.updated}` })
        .click();
      await daily.page.getByRole("menuitem", { name: "Delete..." }).click();
      const dialog = daily.page.getByRole("alertdialog", {
        name: "Confirm delete",
      });
      await expect(dialog).toContainText(
        `Delete ${row.type} ${row.updated}? The ${row.type} will be removed from all projects and this cannot be undone.`,
      );
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(
        daily.page
          .getByRole("region", { name: row.heading })
          .getByText(row.updated, { exact: true }),
      ).toBeVisible();
      await daily.page
        .getByRole("button", { name: `Actions for ${row.updated}` })
        .click();
      await daily.page.getByRole("menuitem", { name: "Delete..." }).click();
      await dialog.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(
        daily.page
          .getByRole("region", { name: row.heading })
          .getByText(row.updated, { exact: true }),
      ).toHaveCount(0);
      expect(
        (await list(row)).some((entry) => entry.id === owned.get(row.type)),
      ).toBe(false);
    }
  } catch (error) {
    console.error("Organization catalog flow failed before cleanup:", error);
    throw error;
  } finally {
    const secondId = owned.get("secondStatus");
    const second = (await list(rows[0])).find(
      (item) => item.id === secondId || item.name === secondStatus,
    );
    if (second) await daily.action(rows[0].remove, { id: second.id });
    expect(
      (await list(rows[0])).some(
        (item) => item.id === secondId || item.name === secondStatus,
      ),
    ).toBe(false);
    for (const row of rows) {
      const id = owned.get(row.type);
      // Also find a newly created record if a failure happened before its id was captured.
      const entries = await list(row);
      const entry = entries.find(
        (item) =>
          item.id === id || item.name === row.name || item.name === row.updated,
      );
      if (entry) await daily.action(row.remove, { id: entry.id });
      const remaining = await list(row);
      expect(
        remaining.filter(
          (item) =>
            item.id === id ||
            item.name === row.name ||
            item.name === row.updated,
        ),
        `Owned ${row.type} entries remaining after cleanup`,
      ).toEqual([]);
    }
  }
});

test("organization auto-archive settings, settings search, and Archive rules notice work end to end", async ({
  daily,
}) => {
  type ArchiveSettings = {
    noEditArchiveCadence: number | null;
    noViewArchiveCadence: number | null;
  };
  const original = await daily.action<ArchiveSettings>(
    "get-organization-archive-settings",
    {},
    "GET",
  );
  try {
    await daily.open("/settings/organization");
    const autoArchiveSection = daily.page.locator(
      "#settings-organization-auto-archive",
    );
    await expect(autoArchiveSection).toBeVisible();
    await expect(autoArchiveSection).toContainText(
      "Projects in Collections won't be auto-archived.",
    );
    await expect(
      daily.page.locator("#settings-organization-statuses"),
    ).toBeVisible();
    await expect(
      daily.page.locator("#settings-organization-categories"),
    ).toBeVisible();

    for (const [query, label] of [
      ["auto-archive", "Organization > Auto-archive"],
      ["asset status", "Organization > Asset statuses"],
      ["asset categories", "Organization > Asset categories"],
    ] as const) {
      await daily.page.getByRole("button", { name: "Search settings" }).click();
      const dialog = daily.page.getByRole("dialog");
      await dialog.locator("input").fill(query);
      const option = dialog.getByRole("option", { name: label });
      await expect(option).toBeVisible();
      await option.click();
      await expect(daily.page).toHaveURL(/\/settings\/organization$/);
    }

    const editedSwitch = autoArchiveSection.getByRole("switch", {
      name: /have not been edited for/i,
    });
    const wasChecked =
      (await editedSwitch.getAttribute("aria-checked")) === "true";
    if (!wasChecked) {
      const [saveResponse] = await Promise.all([
        daily.page.waitForResponse(
          (response) =>
            response
              .url()
              .includes(
                "/_agent-native/actions/save-organization-archive-settings",
              ) && response.request().method() === "POST",
        ),
        editedSwitch.click(),
      ]);
      expect(saveResponse.ok()).toBe(true);
    }
    await expect(editedSwitch).toHaveAttribute("aria-checked", "true");
    const daysInput = autoArchiveSection
      .locator('input[type="number"]')
      .first();
    await expect(daysInput).toHaveValue("365");

    await daily.reload();
    await expect(
      daily.page
        .locator("#settings-organization-auto-archive")
        .getByRole("switch", { name: /have not been edited for/i }),
    ).toHaveAttribute("aria-checked", "true");

    await daily.open("/home/archive");
    await expect(
      daily.page.getByText(
        "Your workspace has been configured to automatically archive projects after 365 days with no edits.",
      ),
    ).toBeVisible();
    await expect(
      daily.page.getByText(
        "Configure auto-archive rules in workspace settings.",
      ),
    ).toBeVisible();
    await daily.page
      .getByRole("link", { name: "workspace settings", exact: true })
      .click();
    await expect(daily.page).toHaveURL(/\/settings\/organization/);
  } finally {
    await daily.action("save-organization-archive-settings", original);
  }
});
