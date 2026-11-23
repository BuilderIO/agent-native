import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { publishProject } from "./publish-project.js";
import { fetchUiAction } from "./ui-capability.js";

/** report 1794901508.878089: published projects expose their real list metadata. */
export async function checkProjectListColumns(
  page: Page,
  base: string,
): Promise<void> {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const title = `Columns fixture ${randomUUID()}`;
  const created = await page.request.post(
    `${base}/_agent-native/actions/create-project`,
    { headers, data: { title } },
  );
  expect(created.ok()).toBe(true);
  const { id } = z
    .object({ id: z.string().min(1) })
    .parse(await created.json());
  let draftId: string | undefined;
  try {
    const draftCreated = await page.request.post(
      `${base}/_agent-native/actions/create-project`,
      { headers, data: { title: `Draft ${title}` } },
    );
    expect(draftCreated.ok()).toBe(true);
    draftId = z
      .object({ id: z.string().min(1) })
      .parse(await draftCreated.json()).id;
    await publishProject(page, base, id); // oracle-change: shared helper asserts preview and publish success
    await page.clock.setFixedTime(new Date());
    await page.goto(`${base}/home/all`, { waitUntil: "domcontentloaded" });
    const row = page.locator(`tr[data-project-id="${id}"]`);
    await expect(row).toBeVisible({ timeout: 30000 });
    const listResponse = await page.request.get(
      `${base}/_agent-native/actions/list-projects?${new URLSearchParams({ search: title })}`,
      { headers },
    );
    expect(listResponse.ok()).toBe(true);
    const list = z
      .object({
        projects: z.array(
          z.object({ id: z.string(), creatorEmail: z.string().email() }),
        ),
      })
      .parse(await listResponse.json());
    const creator = list.projects.find(
      (project) => project.id === id,
    )?.creatorEmail;
    expect(creator).toBeTruthy();
    const showCreator = async () => {
      await page.getByRole("button", { name: "Display settings" }).click();
      await page
        .getByRole("checkbox", { name: "Creator", exact: true })
        .check();
      await page.getByRole("button", { name: "Display settings" }).click();
      const headings = await page.locator("table thead th").allTextContents();
      const creatorIndex = headings.findIndex(
        (name) => name.trim() === "Creator",
      );
      expect(creatorIndex).toBeGreaterThanOrEqual(0);
      await expect(
        row.locator("td").nth(creatorIndex).locator(`[title="${creator}"]`),
      ).toBeVisible();
    };
    await showCreator();
    const columns = await page.locator("table thead th").allTextContents();
    const publishIndex = columns.findIndex(
      (name) => name.trim() === "App last published",
    );
    expect(publishIndex).toBeGreaterThanOrEqual(0);
    const publishedCell = row.locator("td").nth(publishIndex);
    await expect(publishedCell).toHaveText(/^\d+ (?:sec|secs|min|mins) ago$/);
    const publishedText = await publishedCell.innerText();
    const draft = page.locator(`tr[data-project-id="${draftId}"]`);
    await expect(draft.locator("td").nth(publishIndex)).toHaveText("—");
    await page
      .getByRole("button", { name: "App last published", exact: true })
      .click();
    await expect(
      page.getByRole("columnheader", { name: /App last published/ }),
    ).toHaveAttribute("aria-sort", "descending");
    const fixtureOrder = await page
      .locator("tbody tr")
      .evaluateAll(
        (rows, ids) =>
          rows
            .map((item) => item.getAttribute("data-project-id"))
            .filter((id) => ids.includes(id ?? "")),
        [id, draftId],
      );
    expect(fixtureOrder).toEqual([id, draftId]);
    await page.getByRole("button", { name: "Creator", exact: true }).click();
    await expect(
      page.getByRole("columnheader", { name: /Creator/ }),
    ).toHaveAttribute("aria-sort", "ascending");
    await page
      .getByRole("button", { name: "Created by you", exact: true })
      .click();
    await expect(row).toBeVisible({ timeout: 30000 });
    await expect(draft).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await showCreator();
    await expect(publishedCell).toHaveText(publishedText);
    await expect(draft.locator("td").nth(publishIndex)).toHaveText("—");
    await page.screenshot({
      path: ".tmp/analytics-owner/report-project-list-columns.png",
      fullPage: true,
    });
  } finally {
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    for (const fixtureId of [id, ...(draftId ? [draftId] : [])]) {
      const trashed = await page.request.post(
        `${base}/_agent-native/actions/trash-project`,
        { headers, data: { projectId: fixtureId } },
      );
      if (!trashed.ok())
        throw new Error(
          `Could not trash columns fixture (${trashed.status()})`,
        );
      const deleted = await fetchUiAction(
        page.request,
        base,
        `${base}/_agent-native/actions/delete-project`,
        { method: "POST", data: { projectId: fixtureId } },
      );
      if (!deleted.ok())
        throw new Error(
          `Could not delete columns fixture (${deleted.status()})`,
        );
      const readback = await page.request.get(
        `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: fixtureId })}`,
        { headers },
      );
      expect(readback.status()).toBe(404);
    }
  }
}
