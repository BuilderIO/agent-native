import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { projectDocumentSchema } from "../../lib/model/contracts.js";

export async function checkSqlEditorHeight(
  page: Page,
  base: string,
  screenshotPath?: string,
) {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const post = async (name: string, data: unknown) => {
    const response = await page.request.post(
      `${base}/_agent-native/actions/${name}`,
      { headers, data },
    );
    if (!response.ok()) throw new Error(`${name}: HTTP ${response.status()}`);
    return response.json();
  };
  const { id } = z
    .object({ id: z.string().min(1) })
    .parse(
      await post("create-project", { title: `SQL height ${randomUUID()}` }),
    );
  let primaryError: Error | undefined;
  try {
    await page.goto(`${base}/project/${encodeURIComponent(id)}/latest`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("button", { name: "Query", exact: true }).click();
    const cell = page.locator("[data-notebook-cell]").last();
    const editor = cell.getByRole("textbox", { name: /^Edit / });
    const box = cell.locator(".cm-editor");
    await expect(editor).toBeVisible();
    const emptyHeight = await box.evaluate(
      (e) => e.getBoundingClientRect().height,
    );
    console.log(`SQL EMPTY HEIGHT ${emptyHeight}`);
    if (screenshotPath) await page.screenshot({ path: screenshotPath });
    expect(emptyHeight).toBeGreaterThanOrEqual(70);

    const query = Array.from({ length: 10 }, (_, i) => `-- line ${i + 1}`).join(
      "\n",
    );
    await editor.fill(query);
    await expect
      .poll(() => box.evaluate((e) => e.getBoundingClientRect().height))
      .toBeGreaterThan(emptyHeight);
    await expect
      .poll(async () => {
        const response = await page.request.get(
          `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: id })}`,
          { headers },
        );
        if (!response.ok())
          throw new Error(`get-project: HTTP ${response.status()}`);
        const { project } = z
          .object({ project: projectDocumentSchema })
          .parse(await response.json());
        const contents = project.cells.at(-1)?.contents;
        if (contents?.kind !== "sql")
          throw new Error("Expected the saved cell to contain SQL");
        return contents.source;
      })
      .toBe(query);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(cell.locator(".cm-line")).toHaveCount(10);
    await expect
      .poll(() =>
        cell
          .locator(".cm-line")
          .allTextContents()
          .then((lines) => lines.join("\n")),
      )
      .toBe(query);
    console.log(
      `SQL MULTILINE HEIGHT ${await box.evaluate((e) => e.getBoundingClientRect().height)}`,
    );
  } catch (error) {
    primaryError =
      error instanceof Error
        ? error
        : new Error("SQL height check failed", { cause: error });
  } finally {
    try {
      await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
      await post("trash-project", { projectId: id });
      await post("delete-project", { projectId: id });
      const response = await page.request.get(
        `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: id })}`,
        { headers },
      );
      expect(response.status()).toBe(404);
    } catch (cleanupError) {
      if (primaryError)
        throw new AggregateError(
          [primaryError, cleanupError],
          "SQL height check and cleanup failed",
        );
      throw cleanupError;
    }
  }
  if (primaryError) throw primaryError;
}
