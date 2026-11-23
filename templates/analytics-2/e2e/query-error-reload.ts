import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

export type ExpectedQueryFailure = {
  projectId: string;
  cellId: string;
  method: "POST";
  path: "/_agent-native/actions/start-notebook-run";
  status: 200;
  errorCode: "admitted";
};

export type RegisterExpectedQueryFailure = (failure: ExpectedQueryFailure) => {
  verify: () => Promise<void>;
  dispose: () => void;
};

export async function checkQueryErrorReload(
  page: Page,
  base: string,
  registerExpectedFailure: RegisterExpectedQueryFailure,
) {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const create = await page.request.post(
    `${base}/_agent-native/actions/create-project`,
    {
      headers,
      data: { title: `Query error ${randomUUID()}` },
    },
  );
  expect(create.ok()).toBe(true);
  const { id } = z.object({ id: z.string().min(1) }).parse(await create.json());
  let expectedFailure: ReturnType<RegisterExpectedQueryFailure> | undefined;
  try {
    const add = await page.request.post(
      `${base}/_agent-native/actions/add-project-cell`,
      {
        headers,
        data: { projectId: id, kind: "sql" },
      },
    );
    expect(add.ok()).toBe(true);
    const { createdCellId } = z
      .object({ createdCellId: z.string().min(1) })
      .parse(await add.json());
    await page.goto(`${base}/project/${encodeURIComponent(id)}/latest`, {
      waitUntil: "domcontentloaded",
    });
    const editor = page.locator("[data-notebook-cell] .cm-content").first();
    await expect(editor).toBeVisible();
    await editor.fill("SELECT * FROM unknown_table");
    expectedFailure = registerExpectedFailure({
      projectId: id,
      cellId: createdCellId,
      method: "POST",
      path: "/_agent-native/actions/start-notebook-run",
      status: 200,
      errorCode: "admitted",
    });
    await editor.press("ControlOrMeta+Enter");
    const assertError = async () => {
      await expect(
        page.getByText("Your query could not be executed"),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        page.getByText(
          "We received the following error when executing this query:",
        ),
      ).toBeVisible();
      await expect(
        page.getByRole("alert").filter({ hasText: "unknown_table" }),
      ).toBeVisible(); // oracle-change: the new cell uses the demo connection, so the fixture asserts its SQL error
      await expect(
        page.getByText(/Action start-notebook-run failed/),
      ).toHaveCount(0);
    };
    await assertError();
    await expectedFailure.verify();
    await page.screenshot({
      path: ".tmp/analytics-owner/report-query-error.png",
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertError();
  } finally {
    expectedFailure?.dispose();
    let navigationError: unknown;
    try {
      await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    } catch (error) {
      navigationError = error;
    }
    for (const action of ["trash-project", "delete-project"]) {
      const response = await page.request.post(
        `${base}/_agent-native/actions/${action}`,
        { headers, data: { projectId: id } },
      );
      if (!response.ok())
        throw new Error(`${action}: HTTP ${response.status()}`);
    }
    const readback = await page.request.get(
      `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: id })}`,
      { headers },
    );
    expect(readback.status()).toBe(404);
    if (navigationError !== undefined)
      throw new Error("Could not return to home during query error cleanup", {
        cause: navigationError,
      });
  }
}
