import { expect, test } from "@playwright/test";

import { appPath, createDesignSystemFromTemplate } from "./helpers";

/**
 * A Brand Kit's detail sheet must show the source system's own token names.
 * Showing the seven color roles alone renamed Carbon's `cds-interactive-01`
 * to "Secondary", so the label disagreed with the system the user imported.
 */
test("brand kit detail shows the imported system's own token names", async ({
  page,
}) => {
  await page.goto(appPath("/design-systems"));
  const title = await createDesignSystemFromTemplate(page, "carbon-white");

  await page.goto(appPath("/design-systems"), { waitUntil: "load" });
  await page.getByText(title, { exact: false }).first().click();

  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Design system tokens")).toBeVisible();

  // Real Carbon names, not the seven-role summary.
  await expect(
    sheet.getByText("cds-background-brand", { exact: true }),
  ).toBeVisible();
  await expect(
    sheet.getByText("cds-text-helper", { exact: true }),
  ).toBeVisible();
  await expect(
    sheet.getByText("cds-spacing-13", { exact: true }),
  ).toBeVisible();

  // Each name is paired with the CSS variable that carries it.
  await expect(
    sheet.getByText("--cds-background-brand", { exact: true }),
  ).toBeVisible();

  // The roles remain, under a heading that no longer claims to be the whole set.
  await expect(sheet.getByText("Color roles", { exact: true })).toBeVisible();
});
