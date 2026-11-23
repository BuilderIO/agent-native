import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { withProject } from "./predicted-notebook-flows.js";
import { readSqlEditor, writeSqlEditor } from "./sql-editor.js";

export async function checkVersionHistoryRestore(page: Page, base: string) {
  await withProject(page, base, async ({ id, read, readPublished }) => {
    await page
      .getByRole("button", { name: "Query", exact: true })
      .first()
      .click();
    const cell = page.locator("[data-notebook-cell]").first();
    const picker = cell.getByRole("button", { name: /^Data connection:/ });
    await picker.click();
    await page
      .getByRole("menu", { name: "Data connections" })
      .getByRole("menuitemradio", { name: /\[Demo\] Public Data/ })
      .click();
    const editor = cell.getByRole("textbox", { name: /^Edit SQL/ });
    const oldSql = "SELECT 'old' AS value FROM orders LIMIT 1";
    const newSql = "SELECT 'new' AS value FROM orders LIMIT 1";
    await writeSqlEditor(editor, oldSql);
    await editor.press("ControlOrMeta+Enter");
    await expect(cell.locator("tbody tr").first().locator("td")).toHaveText(
      ["old"],
      { timeout: 30000 },
    );

    await page
      .getByRole("button", { name: "Publish app", exact: true })
      .click();
    const publish = page.getByRole("dialog", { name: "Publish app" });
    await publish.getByLabel("Version details").fill("QA history original");
    await publish
      .getByRole("button", { name: "Publish app", exact: true })
      .click();
    await expect(publish).not.toBeVisible({ timeout: 30000 });
    const publishedVersionId = (await read()).publishedVersionId;
    expect(publishedVersionId).not.toBeNull();
    await writeSqlEditor(editor, newSql);
    await editor.press("ControlOrMeta+Enter");
    await expect(cell.locator("tbody tr").first().locator("td")).toHaveText(
      ["new"],
      { timeout: 30000 },
    );
    await expect
      .poll(async () => (await read()).cells[0]?.contents)
      .toMatchObject({ kind: "sql", source: newSql });

    await page
      .getByRole("button", { name: "History & versions", exact: true })
      .click();
    const history = page.getByRole("complementary", {
      name: "History & versions",
    });
    await expect(
      history.getByText("QA history original", { exact: true }),
    ).toBeVisible();
    await history.getByText("QA history original", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Restore this version" }),
    ).toBeVisible();
    await expect(page.getByText("old", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Restore this version" }).click();
    const confirmation = page.getByRole("dialog", { name: /confirm restore/i });
    await confirmation
      .getByRole("button", { name: "Restore", exact: true })
      .click();
    await expect(confirmation).not.toBeVisible({ timeout: 30000 });
    await expect
      .poll(async () => (await read()).cells[0]?.contents)
      .toMatchObject({ kind: "sql", source: oldSql });
    const restored = await read();
    expect(restored.publishedVersionId).toBe(publishedVersionId);
    expect(restored.workingVersionId).not.toBe(publishedVersionId);
    expect((await readPublished()).cells[0]?.contents).toMatchObject({
      kind: "sql",
      source: oldSql,
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(() =>
        readSqlEditor(page.getByRole("textbox", { name: /^Edit SQL/ }).first()),
      )
      .toBe(oldSql);
    await expect(
      page
        .locator("[data-notebook-cell]")
        .first()
        .locator("tbody tr")
        .first()
        .locator("td"),
    ).toHaveText(["old"], { timeout: 30000 });
    const response = await page.request.get(
      `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: id })}`,
      {
        headers: { "x-agent-native-frontend": "1", "x-agent-native-csrf": "1" },
      },
    );
    expect(response.ok()).toBe(true);
    const saved = z
      .object({
        outputs: z.record(
          z.string(),
          z.object({ status: z.string(), output: z.unknown() }),
        ),
      })
      .parse(await response.json());
    const cellId = (await read()).cells[0]?.id;
    if (!cellId) throw new Error("Restored SQL cell is missing");
    expect(saved.outputs[cellId]).toMatchObject({
      status: "complete",
      output: { type: "table", rows: [["old"]] },
    });
    await page.screenshot({
      path: ".tmp/analytics-owner/version-history-restored.png",
    });
  });
}
