import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { LABEL_COLORS } from "../app/lib/model/label-colors.js";
import { withProject } from "./predicted-notebook-flows.js";
import { safeRequest } from "./safe-request.js";

const headers = {
  "x-agent-native-frontend": "1",
  "x-agent-native-csrf": "1",
};

export async function checkProjectMetaPickers(page: Page, base: string) {
  const call = async (
    name: string,
    data: Record<string, unknown>,
    method = "POST",
  ) => {
    const url = `${base}/_agent-native/actions/${name}`;
    const response = await safeRequest(
      `${method} /_agent-native/actions/${name}`,
      () =>
        page.request.fetch(
          method === "GET"
            ? `${url}?${new URLSearchParams(data as Record<string, string>)}`
            : url,
          { method, headers, ...(method === "POST" ? { data } : {}) },
        ),
    );
    if (!response.ok()) throw new Error(`${name}: HTTP ${response.status()}`);
    return response.json();
  };
  const createdStatus = z.object({ status: z.object({ id: z.string() }) });
  const createdCategory = z.object({ category: z.object({ id: z.string() }) });
  const suffix = randomUUID().slice(0, 8);
  const statusName = `QA status ${suffix}`;
  const categoryName = `QA category ${suffix}`;
  const description = `QA description ${suffix}`;
  let statusId: string | undefined;
  let categoryId: string | undefined;
  const failures: unknown[] = [];
  try {
    statusId = createdStatus.parse(
      await call("create-data-status", {
        name: statusName,
        color: LABEL_COLORS[0],
      }),
    ).status.id;
    categoryId = createdCategory.parse(
      await call("create-data-category", {
        name: categoryName,
        color: LABEL_COLORS[0],
      }),
    ).category.id;
    const status = { id: statusId };
    const category = { id: categoryId };
    await withProject(page, base, async ({ id, read }) => {
      await call("update-project", { projectId: id, description });
      await page.reload({ waitUntil: "domcontentloaded" });
      const body = page.locator(".nb-project-metadata");
      await expect(body.getByText(description, { exact: true })).toHaveCount(1);
      await expect(
        page.locator(".nb-header").getByText(description, { exact: true }),
      ).toHaveCount(0);

      await body.getByRole("button", { name: "Add status" }).click();
      await page
        .getByRole("menuitemradio", { name: statusName, exact: true })
        .click();
      await expect(
        body.getByRole("button", { name: statusName, exact: true }),
      ).toBeVisible();
      await expect.poll(async () => (await read()).statusId).toBe(status.id);
      await page.reload({ waitUntil: "domcontentloaded" });
      const applied = page
        .locator(".nb-project-metadata")
        .getByRole("button", { name: statusName, exact: true });
      await expect(applied).toBeVisible();
      await applied.click();
      await expect(
        page.getByRole("menuitemradio", { name: statusName, exact: true }),
      ).toHaveAttribute("aria-checked", "true");
      await page.getByRole("menuitem", { name: "Clear status" }).click();
      await expect.poll(async () => (await read()).statusId).toBeNull();
      await expect(
        page
          .locator(".nb-project-metadata")
          .getByRole("button", { name: "Add status" }),
      ).toBeVisible();

      const shell = z
        .object({ features: z.object({ isAdmin: z.boolean() }) })
        .parse(await call("get-workspace-shell", {}, "GET"));
      if (shell.features.isAdmin) {
        await page
          .locator(".nb-project-metadata")
          .getByRole("button", { name: "Add status" })
          .click();
        await page
          .getByRole("menuitem", { name: "New status...", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect
          .poll(() =>
            dialog.evaluate((node) => node.contains(document.activeElement)),
          )
          .toBe(true);
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
      }

      await page
        .locator(".nb-project-metadata")
        .getByRole("button", { name: "Add categories" })
        .click();
      await page
        .getByRole("menuitemcheckbox", { name: categoryName, exact: true })
        .click();
      const assigned = async () =>
        z
          .object({
            assignments: z.array(
              z.object({
                projectId: z.string(),
                categoryIds: z.array(z.string()),
              }),
            ),
          })
          .parse(await call("list-project-categories", {}, "GET"))
          .assignments.find((entry) => entry.projectId === id)?.categoryIds ??
        [];
      await expect.poll(assigned).toEqual([category.id]);
      await page.reload({ waitUntil: "domcontentloaded" });
      const picker = page
        .locator(".nb-project-metadata")
        .getByRole("button", { name: categoryName, exact: true });
      await expect(picker).toBeVisible();
      await picker.click();
      await expect(
        page.getByRole("menuitemcheckbox", { name: categoryName, exact: true }),
      ).toHaveAttribute("aria-checked", "true");
      await page.screenshot({
        path: ".tmp/analytics-owner/empty-state-meta.png",
      });
      await page
        .getByRole("menuitemcheckbox", { name: categoryName, exact: true })
        .click();
      await expect.poll(assigned).toEqual([]);
    });
  } catch (error) {
    failures.push(error);
  }
  // Each fixture is removed independently so one failed delete is still
  // reported alongside the others.
  for (const [name, id] of [
    ["delete-data-status", statusId],
    ["delete-data-category", categoryId],
  ] as const) {
    if (id == null) continue;
    try {
      await call(name, { id });
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      failures
        .map((failure) =>
          failure instanceof Error ? failure.message : String(failure),
        )
        .join("\n---\n"),
    );
}
