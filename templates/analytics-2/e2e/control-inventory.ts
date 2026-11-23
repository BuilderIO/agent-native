import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, type Locator, type Page } from "@playwright/test";

import { withProject } from "./predicted-notebook-flows.js";

// See scope/notebook-control-inventory.md for the original source and scope.
export async function checkControlInventory(page: Page, base: string) {
  await withProject(page, base, async ({ read }) => {
    const missing: string[] = [];
    const check = async (name: string, control: Locator) => {
      if (!(await control.isVisible())) missing.push(name);
    };
    const views = page.getByRole("navigation", { name: "Project views" });
    await expect(views).toBeVisible();
    for (const name of ["Notebook", "App builder"]) {
      await check(
        `view: ${name}`,
        views.getByRole("button", { name, exact: true }),
      );
    }
    const tools = page.getByRole("navigation", { name: "Workspace tools" });
    for (const name of [
      "Data browser",
      "Environment",
      "Variables",
      "History & versions",
      "Help & support",
    ]) {
      await check(
        `tool: ${name}`,
        tools.getByRole("button", { name, exact: true }),
      );
    }
    await page.getByRole("button", { name: "Project options" }).click();
    const menu = page.getByRole("menu", { name: "Project options" });
    for (const name of [
      "Rename",
      "Favorite this project",
      "Duplicate",
      "Export as",
      "Transfer project owner",
      "Add to collection",
      "Archive",
      "Move to trash",
      "New project",
    ]) {
      await check(
        `project menu: ${name}`,
        menu.getByRole("menuitem", { name, exact: true }),
      );
    }
    const exportMenu = menu.getByRole("menuitem", {
      name: "Export as",
      exact: true,
    });
    if (await exportMenu.isVisible()) {
      await exportMenu.hover();
      const yamlItem = page.getByRole("menuitem", {
        name: /project.*\(\.yaml\)/i,
      });
      await yamlItem
        .waitFor({ state: "visible", timeout: 2000 })
        .catch(() => {});
      await check("project menu: project YAML export", yamlItem);
    } else {
      missing.push("project menu: project YAML export");
    }
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Query", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Query", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Query", exact: true })
      .first()
      .click();
    const cell = page.locator("[data-notebook-cell]").nth(1);
    const sql = "SELECT 1";
    const editor = cell.getByRole("textbox", { name: /^Edit SQL/ });
    await editor.fill(sql);
    await editor.blur();
    await expect
      .poll(async () => (await read()).cells[1]?.contents)
      .toMatchObject({
        kind: "sql",
        source: sql,
      });
    await check(
      "toolbar: Run all",
      page.getByRole("button", { name: "Run all", exact: true }),
    );
    await cell.hover();
    const moreActions = cell.getByRole("button", {
      name: /^More actions for /,
    });
    await expect(moreActions).toBeEnabled();
    await moreActions.click();
    const cellMenu = page.getByRole("menu").first();
    await cellMenu.waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
    if ((await cellMenu.getByRole("separator").count()) < 4) {
      missing.push("cell menu: section dividers");
    }
    for (const name of [
      "Add above",
      "Add below",
      "Move up",
      "Move down",
      "Add to section",
      "Duplicate",
      "Select cell and...",
      "Copy cell",
      "Copy link",
      "Embed",
      "Full screen",
      "Delete cell",
    ]) {
      await check(
        `cell menu: ${name}`,
        cellMenu.getByRole("menuitem", { name, exact: true }),
      );
    }
    for (const [parent, children] of [
      [
        "Select cell and...",
        ["all upstream", "all downstream", "all upstream + downstream"],
      ],
      ["Copy link", ["in Notebook view", "in the latest Published App"]],
    ] as const) {
      const item = cellMenu.getByRole("menuitem", {
        name: parent,
        exact: true,
      });
      if (await item.isVisible()) {
        await item.hover();
        for (const name of children) {
          const childItem = page.getByRole("menuitem", { name, exact: true });
          await childItem
            .waitFor({ state: "visible", timeout: 2000 })
            .catch(() => {});
          await check(`cell menu: ${parent} → ${name}`, childItem);
        }
      } else {
        missing.push(
          ...children.map((name) => `cell menu: ${parent} → ${name}`),
        );
      }
    }
    await page.keyboard.press("Escape");
    await expect(cellMenu).toBeHidden();
    await expect(moreActions).toBeFocused();
    await moreActions.click();
    await expect(cellMenu).toBeVisible();
    await page.mouse.click(16, 16);
    await expect(cellMenu).toBeHidden();
    const outputDir = resolve(".tmp/analytics-owner");
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      resolve(outputDir, "notebook-control-missing.json"),
      JSON.stringify(missing, null, 2) + "\n",
    );
    expect(
      missing,
      `Missing original notebook controls: ${missing.join(", ")}`,
    ).toEqual([]);
  });
}
