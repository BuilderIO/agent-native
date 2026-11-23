import { expect, type Page } from "@playwright/test";

import { withProject } from "./predicted-notebook-flows.js";

export async function checkAgentProjectView(
  page: Page,
  base: string,
  screenshot: string,
) {
  let screenshotBytes: Buffer | undefined;
  await withProject(page, base, async ({ id, read }) => {
    const views = page.getByRole("navigation", { name: "Project views" });
    const notebook = views.getByRole("button", {
      name: "Notebook",
      exact: true,
    });
    const agent = views.getByRole("button", { name: "Agent", exact: true });
    const pane = page.getByRole("complementary", { name: "Agent" });
    const prompt = pane.getByRole("textbox");
    await expect(notebook).toHaveAttribute("aria-current", "page");
    const before = await read();
    expect(before.id).toBe(id);
    await agent.click();
    await expect(page).toHaveURL(
      new RegExp(
        `/project/${encodeURIComponent(id)}/latest(?:/logic)?\\?.*notebookView=agent`,
      ),
    );
    await expect(agent).toHaveAttribute("aria-current", "page");
    await expect(pane).toBeVisible();
    await expect(pane).toHaveClass(/\bis-full-page\b/);
    await expect(prompt).toBeEditable();
    const dismissBanner = pane.getByRole("button", {
      name: "Hide context message",
    });
    if ((await dismissBanner.count()) > 0) {
      await dismissBanner.click();
      await expect(dismissBanner).toHaveCount(0);
    }
    await prompt.fill("QA draft question");
    await expect(prompt).toContainText("QA draft question");
    screenshotBytes = await page.screenshot({
      path: screenshot,
      fullPage: true,
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(
      new RegExp(
        `/project/${encodeURIComponent(id)}/latest(?:/logic)?\\?.*notebookView=agent`,
      ),
    );
    await expect(agent).toHaveAttribute("aria-current", "page");
    await expect(pane).toBeVisible();
    await expect(pane).toHaveClass(/\bis-full-page\b/);
    await expect(prompt).toBeEditable();
    await notebook.click();
    await expect(page).toHaveURL(
      new RegExp(
        `/project/${encodeURIComponent(id)}/latest/logic\\?.*notebookView=notebook`,
      ),
    );
    await expect(notebook).toHaveAttribute("aria-current", "page");
    await expect(pane).toBeHidden();
    const after = await read();
    expect({ id: after.id, title: after.title, cells: after.cells }).toEqual({
      id: before.id,
      title: before.title,
      cells: before.cells,
    });

    const rail = page.getByRole("navigation", { name: "Workspace tools" });
    await expect(rail.getByRole("button", { name: "Components" })).toHaveCount(
      0,
    );
    await page
      .getByRole("button", { name: "Query", exact: true })
      .first()
      .click();
    const cell = page.locator("[data-notebook-cell]").first();
    await expect(
      cell.getByRole("textbox", { name: /^Edit SQL/ }),
    ).toBeVisible();
    await cell.hover();
    await cell.getByRole("button", { name: /^More actions for / }).click();
    await expect(
      page.getByRole("menuitem", { name: "Delete cell" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "New component" }),
    ).toHaveCount(0);
    await page.screenshot({
      path: screenshot.replace("agent-full-page", "notebook-cell-menu"),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "More", exact: true })
      .last()
      .click();
    const addMenu = page.getByRole("menu", { name: /More|Add cell/ });
    await expect(addMenu).toBeVisible();
    await expect(
      addMenu.getByRole("menuitem", { name: "Component", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: screenshot.replace("agent-full-page", "notebook-add-menu"),
      fullPage: true,
    });
  });
  if (!screenshotBytes) throw new Error("Agent screenshot was not captured");
  return { screenshot: Buffer.from(screenshotBytes) };
}
