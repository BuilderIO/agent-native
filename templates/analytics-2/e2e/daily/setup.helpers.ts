import type { Locator, Page } from "@playwright/test";

import { expect, type Daily } from "./fixtures";

/** The add-a-data-connection dialog, wherever it was opened from. */
export function connectionDialog(page: Page): Locator {
  return page
    .getByRole("dialog")
    .filter({ has: page.getByRole("button", { name: "Close", exact: true }) })
    .last();
}

/** Data page connection entry → the type grid. */
export async function openAddConnection(daily: Daily) {
  await daily.open("/home/data");
  const add = daily.page.getByRole("button", {
    name: /^(Add data connection|Connect your data)/,
  });
  await expect(add).toBeVisible({ timeout: 30_000 });
  await add.focus();
  await daily.press("Enter");
  const dialog = connectionDialog(daily.page);
  await expect(
    dialog
      .getByRole("banner")
      .getByRole("heading", { name: "Add a data connection" }),
  ).toBeVisible({ timeout: 15_000 });
  return dialog;
}

/** Type grid → BigQuery form. */
export async function openBigQueryForm(daily: Daily) {
  const dialog = await openAddConnection(daily);
  await dialog.getByRole("button", { name: "Google BigQuery" }).focus();
  await daily.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Create connection" }),
  ).toBeVisible();
  return dialog;
}

export function field(dialog: Locator, label: RegExp): Locator {
  return dialog.getByLabel(label).first();
}

/** Fill the BigQuery basics the way a person does: click, type, paste the key. */
export async function fillBigQuery(
  daily: Daily,
  dialog: Locator,
  values: { name?: string; projectId?: string; key?: string },
) {
  if (values.name !== undefined) await field(dialog, /^Name/).fill(values.name);
  if (values.projectId !== undefined)
    await field(dialog, /^Project ID/).fill(values.projectId);
  if (values.key !== undefined)
    await field(dialog, /^Service account configuration/).fill(values.key);
}

type Connection = {
  id: string;
  name: string;
  type: string;
  isDraft: boolean;
  isDefault: boolean;
};

export async function connections(daily: Daily): Promise<Connection[]> {
  const response = await daily.context.request.get(
    `${daily.server.base}/_agent-native/actions/list-data-connections`,
    { headers: { "x-agent-native-frontend": "1" } },
  );
  expect(response.ok(), `list-data-connections HTTP ${response.status()}`).toBe(
    true,
  );
  const out = (await response.json()) as { connections: Connection[] };
  return out.connections;
}

/** Delete every connection this test created (matched by exact name). */
export async function deleteConnections(daily: Daily, names: string[]) {
  const targets = (await connections(daily)).filter((connection) =>
    names.includes(connection.name),
  );
  if (targets.length === 0) return;
  // Leave the tested view before deleting data it is still reading.
  if (!daily.page.isClosed()) await daily.open("/home");
  const page = await daily.context.newPage();
  try {
    await page.goto(`${daily.server.base}/settings/data-sources`, {
      waitUntil: "domcontentloaded",
    });
    for (const connection of targets) {
      const options = page.getByRole("button", {
        name: `${connection.name} options`,
        exact: true,
      });
      await expect(options).toBeVisible({ timeout: 30_000 });
      await options.click();
      await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
      const dialog = page
        .getByRole("alertdialog", { name: "Confirm delete" })
        .or(page.getByRole("dialog", { name: "Confirm delete" }));
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole("button", { name: "Confirm", exact: true })
        .click();
      await expect
        .poll(async () =>
          (await connections(daily)).some(
            (candidate) => candidate.id === connection.id,
          ),
        )
        .toBe(false);
      daily.createdConnections.delete(connection.name);
    }
  } finally {
    await page.close();
  }
}

/** Remove a secret value this test stored; an absent value is fine, any other failure is not. */
export async function deleteSecret(daily: Daily, key: string) {
  if (key !== "HUBSPOT_MCP_CLIENT_ID")
    throw new Error(`No fixture label for ${key}`);
  const page = await daily.context.newPage();
  try {
    await page.goto(`${daily.server.base}/settings/secrets#secrets:${key}`, {
      waitUntil: "domcontentloaded",
    });
    const row = page
      .locator("div.border-b")
      .filter({ hasText: "HubSpot MCP OAuth client ID" })
      .first();
    await expect(row).toBeVisible();
    const toggle = row.locator("button[aria-expanded]").first();
    if ((await toggle.getAttribute("aria-expanded")) !== "true")
      await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const remove = row.getByRole("button", { name: "Delete", exact: true });
    if ((await remove.count()) === 0) return;
    await remove.click();
    await row.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(
      row.getByLabel("HubSpot MCP OAuth client ID", { exact: true }),
    ).toBeVisible();
  } finally {
    await page.close();
  }
}

/**
 * A workspace BigQuery connection on the local fake that can read the whole project (no dataset
 * list), created the way the connection form sends it. Creation is not the path under test here.
 */
export async function createConnection(
  daily: Daily,
  name: string,
): Promise<string> {
  daily.createdConnections.add(name);
  const dialog = await openBigQueryForm(daily);
  await fillBigQuery(daily, dialog, {
    name,
    projectId: "local-fake-project",
    key: await daily.serviceAccountKey(),
  });
  const saved = daily.page.waitForResponse(
    (response) =>
      response
        .url()
        .includes("/_agent-native/actions/create-workspace-warehouse-form") &&
      response.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Create connection", exact: true })
    .click();
  const response = await saved;
  expect(
    response.ok(),
    `fixture connection returned ${response.status()}`,
  ).toBe(true);
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () =>
      (await connections(daily)).some((connection) => connection.name === name),
    )
    .toBe(true);
  const created = (await connections(daily)).find(
    (connection) => connection.name === name,
  );
  if (!created) throw new Error("Created fixture connection was not persisted");
  return created.id;
}
