import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { publishProject } from "./publish-project.js";
import { fetchUiAction } from "./ui-capability.js";

/** report 1794899792.156109: search can open a project's published reader. */
export async function checkPublishedAppSearch(
  page: Page,
  base: string,
): Promise<void> {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const title = `Published search ${randomUUID()}`;
  const created = await page.request.post(
    `${base}/_agent-native/actions/create-project`,
    {
      headers,
      data: { title },
    },
  );
  expect(created.ok()).toBe(true);
  const { id } = z
    .object({ id: z.string().min(1) })
    .parse(await created.json());
  try {
    await publishProject(page, base, id); // oracle-change: shared helper asserts preview and publish success
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Search your workspace" });
    await dialog
      .getByRole("textbox", { name: "Search your workspace" })
      .fill(title);
    const row = dialog.getByRole("menuitem").filter({
      hasText: title,
      has: page.getByRole("link", { name: "View app" }),
    });
    await expect(row).toBeVisible({ timeout: 30000 });
    const viewApp = row.getByRole("link", { name: "View app" });
    await expect(viewApp).toBeVisible();
    await expect(viewApp).toHaveAttribute(
      "href",
      `${new URL(base).pathname.replace(/\/$/, "")}/app/${encodeURIComponent(id)}/latest`,
    );
    await viewApp.click();
    await expect(page).toHaveURL(
      `${base}/app/${encodeURIComponent(id)}/latest`,
      { timeout: 30000 },
    );
    await expect(
      page
        .locator('[data-published-app="true"]')
        .getByRole("heading", { name: title }),
    ).toBeVisible();
    await page.screenshot({
      path: ".tmp/analytics-owner/report-search-published-app.png",
    });
  } finally {
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    const trashed = await page.request.post(
      `${base}/_agent-native/actions/trash-project`,
      { headers, data: { projectId: id } },
    );
    if (!trashed.ok())
      throw new Error(`Could not trash search fixture (${trashed.status()})`);
    const deleted = await fetchUiAction(
      page.request,
      base,
      `${base}/_agent-native/actions/delete-project`,
      { method: "POST", data: { projectId: id } },
    );
    if (!deleted.ok())
      throw new Error(`Could not delete search fixture (${deleted.status()})`);
    const readback = await page.request.get(
      `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: id })}`,
      { headers },
    );
    expect(readback.status()).toBe(404);
  }
}
