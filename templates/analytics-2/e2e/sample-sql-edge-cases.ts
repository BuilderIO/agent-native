import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { sqlEditor, writeSqlEditor } from "./sql-editor.js";

export async function checkSampleSqlEdgeCases(page: Page, base: string) {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const action = async (name: string, data: Record<string, string>) => {
    const response = await page.request.fetch(
      `${base}/_agent-native/actions/${name}`,
      { method: "POST", headers, data },
    );
    if (!response.ok()) throw new Error(`${name}: HTTP ${response.status()}`);
    return response.json();
  };
  const project = z.object({ id: z.string(), href: z.string() }).parse(
    await action("create-project", {
      title: `QA sample SQL edge cases ${randomUUID()}`,
      sampleDataset: "orders",
    }),
  );
  try {
    await page.goto(`${base}${project.href}`, {
      waitUntil: "domcontentloaded",
    });
    const editor = sqlEditor(page).first();
    await expect(editor).toBeVisible({ timeout: 60000 });
    const run = async (source: string) => {
      await expect(page.getByRole("button", { name: /^Stop / })).toHaveCount(
        0,
        {
          timeout: 30000,
        },
      );
      await writeSqlEditor(editor, source);
      await editor.press("ControlOrMeta+Enter");
    };

    await run("SELECT 9223372036854775807::bigint AS big");
    await expect(
      page.locator("tbody td", { hasText: "9223372036854775807" }).first(),
    ).toBeVisible({ timeout: 30000 });

    await run("SELECT 'a;b' AS s -- one; two");
    await expect(
      page.locator("tbody td", { hasText: /^a;b$/ }).first(),
    ).toBeVisible({ timeout: 30000 });

    await run("SELECT 1; SELECT 2");
    await expect(
      page.getByText("Only one SQL statement can run at a time."),
    ).toBeVisible({ timeout: 30000 });

    await run("SELECT 'abc");
    await expect(page.getByText(/unterminated quoted string/)).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText(/sample_result/)).toHaveCount(0);

    await run("SELECT pg_sleep(30) FROM orders LIMIT 1");
    const stop = page.getByRole("button", { name: /^Stop / });
    await expect(stop).toBeVisible({ timeout: 30000 });
    await stop.click();
    await expect(page.getByText("Your query was interrupted")).toBeVisible({
      timeout: 10000,
    });
  } catch (error) {
    await page.screenshot({
      path: ".tmp/analytics-owner/sample-sql-edge-cases.png",
    });
    throw error;
  } finally {
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    await action("trash-project", { projectId: project.id });
    await action("delete-project", { projectId: project.id });
  }
}
