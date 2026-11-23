import { randomUUID } from "node:crypto";

import { expect, type Page, type Route } from "@playwright/test";
import { z } from "zod";

import { readSqlEditor, sqlEditor } from "./sql-editor.js";
import { fetchUiAction } from "./ui-capability.js";

export async function checkAutosaveRun(
  page: Page,
  base: string,
): Promise<void> {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const created = await page.request.post(
    `${base}/_agent-native/actions/create-project`,
    {
      headers,
      data: { title: `Autosave run ${randomUUID()}`, sampleDataset: "orders" },
    },
  );
  expect(created.ok()).toBe(true);
  const { id } = z
    .object({ id: z.string().min(1) })
    .parse(await created.json());
  const release = deferredValue<void>();
  const finished = deferredValue<void>();
  const intercept = { held: false };
  let runs = 0;
  let stage = "open";
  const handler = async (route: Route) => {
    if (!intercept.held) {
      intercept.held = true;
      await release.promise;
      try {
        await route.continue();
      } finally {
        finished.resolve();
      }
      return;
    }
    await route.continue();
  };
  const countRun = (request: { url(): string }) => {
    if (new URL(request.url()).pathname.endsWith("/start-notebook-run")) runs++;
  };
  page.on("request", countRun);
  try {
    await page.goto(`${base}/project/${encodeURIComponent(id)}/latest`, {
      waitUntil: "domcontentloaded",
    });
    const editor = sqlEditor(page).first();
    await expect(editor).toBeVisible();
    await page.route("**/_agent-native/actions/save-project-cell", handler);
    await editor.fill("SELECT * FROM orders LIMIT 2");
    await expect.poll(() => intercept.held, { timeout: 10000 }).toBe(true);
    await editor.fill("SELECT * FROM orders LIMIT 3");
    await editor.press("ControlOrMeta+Enter");
    expect(runs).toBe(0);
    release.resolve();
    await expect.poll(() => runs, { timeout: 30000 }).toBeGreaterThan(0);
    await expect(page.locator("tbody tr")).toHaveCount(3, { timeout: 30000 });
    expect(runs).toBe(1);
    await page.screenshot({
      path: ".tmp/analytics-owner/report-autosave-run.png",
    });
    stage = "reload";
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(() => readSqlEditor(editor))
      .toBe("SELECT * FROM orders LIMIT 3");
    await expect(page.locator("tbody tr")).toHaveCount(3, { timeout: 30000 });
  } catch (error) {
    try {
      const response = await page.request.get(
        `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: id })}`,
        { headers },
      );
      const data: unknown = response.ok() ? await response.json() : null;
      const parsed = z
        .object({
          project: z.object({
            cells: z.array(
              z.object({
                contents: z
                  .object({ kind: z.string(), source: z.string().optional() })
                  .passthrough(),
              }),
            ),
          }),
        })
        .safeParse(data);
      const source = parsed.success
        ? parsed.data.project.cells.find((cell) => cell.contents.kind === "sql")
            ?.contents.source
        : undefined;
      const classify = (value: string | undefined) =>
        value === "SELECT * FROM orders LIMIT 3"
          ? "limit3"
          : value === "SELECT * FROM orders LIMIT 2"
            ? "limit2"
            : value === undefined
              ? "absent"
              : "other";
      const editors = sqlEditor(page);
      const count = await editors.count();
      const visible = count > 0 && (await editors.first().isVisible());
      const value =
        count > 0 ? await readSqlEditor(editors.first()) : undefined;
      console.error(
        "AUTOSAVE DIAGNOSTIC",
        JSON.stringify({
          stage,
          http: response.status(),
          canonical:
            response.ok() && parsed.success ? classify(source) : "unreadable",
          count,
          visible,
          editor: classify(value),
        }),
      );
      await page.screenshot({
        path: ".tmp/analytics-owner/autosave-run-failure.png",
      });
    } catch {
      console.error("AUTOSAVE DIAGNOSTIC unavailable");
    }
    throw error;
  } finally {
    release.resolve();
    if (intercept.held) await finished.promise;
    await page.unrouteAll({ behavior: "wait" });
    page.off("request", countRun);
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    for (const action of ["trash-project", "delete-project"]) {
      const response = await fetchUiAction(
        page.request,
        base,
        `${base}/_agent-native/actions/${action}`,
        { method: "POST", data: { projectId: id } },
      );
      if (!response.ok())
        throw new Error(`${action}: HTTP ${response.status()}`);
    }
    const readback = await page.request.get(
      `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: id })}`,
      { headers },
    );
    expect(readback.status()).toBe(404);
  }
}

function deferredValue<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred not initialized");
  };
  let reject: (reason?: unknown) => void = () => {
    throw new Error("Deferred not initialized");
  };
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
