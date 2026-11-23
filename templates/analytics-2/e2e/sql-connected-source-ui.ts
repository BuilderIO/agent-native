import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { sqlEditor, writeSqlEditor } from "./sql-editor.js";

export async function checkSqlConnectedSourceUi(page: Page, base: string) {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const action = async (name: string, data: Record<string, unknown>) => {
    const response = await page.request.fetch(
      `${base}/_agent-native/actions/${name}`,
      { method: "POST", headers, data },
    );
    if (!response.ok()) throw new Error(`${name}: HTTP ${response.status()}`);
    return response.json();
  };

  const project = z.object({ id: z.string(), href: z.string() }).parse(
    await action("create-project", {
      title: `QA SQL connected source UI ${randomUUID()}`,
      sampleDataset: "orders",
    }),
  );

  try {
    await page.goto(`${base}${project.href}`, {
      waitUntil: "domcontentloaded",
    });
    const editor = sqlEditor(page).first();
    await expect(editor).toBeVisible({ timeout: 60000 });

    const picker = page.locator(".nb-connection").first();
    await expect(picker).toBeVisible();
    await expect(picker.locator(".nb-connection-chevron")).toHaveCount(0);

    await picker.click();
    await page.getByRole("menuitemradio", { name: "Dataframes" }).click();
    await expect(picker).toContainText("Dataframes");
    await expect(picker.locator("svg")).toHaveCount(0);

    await picker.click();
    const demoOption = page
      .getByRole("menuitemradio")
      .filter({ hasNotText: "Dataframes" })
      .first();
    await demoOption.click();
    await expect(picker).not.toContainText("Dataframes");
    await expect(picker.locator("svg")).toHaveCount(1);

    await writeSqlEditor(editor, "   \n  ");
    await editor.press("ControlOrMeta+Enter");
    await expect(
      page.getByText(/SELECT \* FROM \(\s*\) AS sample_result/),
    ).toHaveCount(0);

    await writeSqlEditor(
      editor,
      "SELECT NULL AS missing_val, 'null' AS literal_null",
    );
    await editor.press("ControlOrMeta+Enter");

    const nullCell = page.locator("tbody td.nb-result-null").first();
    await expect(nullCell).toBeVisible({ timeout: 30000 });
    await expect(nullCell).toHaveText("null");

    const literalCell = page
      .locator("tbody td:not(.nb-result-null)", { hasText: /^null$/ })
      .first();
    await expect(literalCell).toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("tbody td.nb-result-null").first()).toBeVisible({
      timeout: 30000,
    });
  } finally {
    await action("trash-project", { projectId: project.id });
    await action("delete-project", { projectId: project.id });
  }
}
