import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { sampleTable } from "../app/lib/model/sample-data.js";

export async function checkSampleRerun(page: Page, base: string) {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const action = async (
    name: string,
    data: Record<string, string>,
    method = "POST",
  ) => {
    const query = method === "GET" ? `?${new URLSearchParams(data)}` : "";
    const response = await page.request.fetch(
      `${base}/_agent-native/actions/${name}${query}`,
      {
        method,
        headers,
        ...(method === "POST" ? { data } : {}),
      },
    );
    if (!response.ok()) throw new Error(`${name}: HTTP ${response.status()}`);
    return response.json();
  };
  const project = z.object({ id: z.string(), href: z.string() }).parse(
    await action("create-project", {
      title: `QA sample rerun ${randomUUID()}`,
      sampleDataset: "orders",
    }),
  );
  try {
    const read = async () =>
      z
        .object({
          project: z.object({ cells: z.array(z.object({ id: z.string() })) }),
          outputs: z.record(
            z.string(),
            z.object({ status: z.string(), output: z.unknown() }),
          ),
        })
        .parse(await action("get-project", { projectId: project.id }, "GET"));
    // Draft run results live in the notebook execution store, not in get-project outputs.
    const draftRows = async () => {
      const execution = z
        .object({
          cells: z
            .record(z.string(), z.object({ resultId: z.string().nullable() }))
            .optional(),
        })
        .parse(
          await action(
            "get-notebook-execution",
            { projectId: project.id },
            "GET",
          ),
        );
      const resultId = execution.cells?.[cell.id]?.resultId;
      if (!resultId) return null;
      const result = z
        .object({
          status: z.string(),
          manifest: z.object({ rowCount: z.string() }).optional(),
        })
        .parse(await action("get-notebook-result-page", { resultId }, "GET"));
      return result.status === "ready"
        ? Number(result.manifest?.rowCount ?? 0)
        : null;
    };
    const cell = (await read()).project.cells.at(0);
    if (!cell) throw new Error("Sample SQL cell missing");
    const orders = sampleTable("orders");
    if (!orders) throw new Error("Sample orders missing");
    await page.goto(`${base}${project.href}`, {
      waitUntil: "domcontentloaded",
    });
    await page.evaluate(() => {
      (
        window as Window & { cancellationToastSeen?: boolean }
      ).cancellationToastSeen = false;
      new MutationObserver(() => {
        if (
          document.body.innerText.includes(
            "Could not confirm query cancellation.",
          )
        )
          (
            window as Window & { cancellationToastSeen?: boolean }
          ).cancellationToastSeen = true;
      }).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });
    for (let run = 0; run < 3; run++) {
      await page.locator("[data-notebook-cell]").first().hover();
      const button = page.getByRole("button", {
        name: /^Run Orders(?: · Stale output)?$/,
      });
      await expect(button).toBeEnabled();
      const response = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          new URL(r.url()).pathname.endsWith("/start-notebook-run"),
        { timeout: 30000 },
      );
      await button.click();
      expect((await response).ok()).toBe(true);
      await expect(button).toBeEnabled({ timeout: 30000 });
      await expect
        .poll(async () => draftRows(), { timeout: 30000 })
        .toBe(orders.rows.slice(0, 100).length);
      expect(
        await page.evaluate(
          () =>
            (window as Window & { cancellationToastSeen?: boolean })
              .cancellationToastSeen,
        ),
      ).toBe(false);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(async () => draftRows(), { timeout: 30000 })
      .toBe(orders.rows.slice(0, 100).length);
    await expect(
      page.getByText(String(orders.rows[0]?.[0]), { exact: true }).first(),
    ).toBeVisible({ timeout: 30000 });
    await page.screenshot({
      path: ".tmp/analytics-owner/turn-1103-verification/sample-rerun.png",
    });
    console.log(
      `Sample rerun persisted ${orders.rows.slice(0, 100).length} rows after reload`,
    );
  } finally {
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    await action("trash-project", { projectId: project.id });
    await action("delete-project", { projectId: project.id });
  }
}
