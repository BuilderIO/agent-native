import { expect, type Page, type Locator } from "@playwright/test";

export async function checkRecentProjectControls({
  page,
  base,
  project: p,
  savedFavorite,
  toast,
}: {
  page: Page;
  base: string;
  project: { id: string; title: string };
  savedFavorite: () => Promise<boolean | undefined>;
  toast: (text: string) => Locator;
}) {
  const row = page.locator(`[data-project-id="${p.id}"]`);
  await expect(row).toBeVisible();
  await row.hover();
  const dashboard = row.getByRole("link", { name: p.title, exact: true });
  await expect(dashboard).toHaveAttribute(
    "href",
    `${new URL(base).pathname.replace(/\/$/, "")}/app/${p.id}/latest`,
  );
  await expect(
    row.getByRole("button", { name: "Add to favorites", exact: true }),
  ).toHaveCSS("opacity", "1");
  await row
    .getByRole("button", { name: "Add to favorites", exact: true })
    .click();
  await expect.poll(savedFavorite).toBe(true);
  await expect(toast("Project added to favorites")).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await row.hover();
  await expect(
    row.getByRole("button", { name: "Remove from favorites", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await row
    .getByRole("button", { name: "Remove from favorites", exact: true })
    .click();
  await expect.poll(savedFavorite).toBe(false);
  await expect(toast("Project removed from favorites")).toBeVisible();
  const edit = row.getByRole("button", { name: "Edit draft", exact: true });
  await expect(edit).toBeVisible();
  await expect(edit).toHaveCSS("opacity", "1");
  const readerPromise = page.context().waitForEvent("page");
  await dashboard.click({ modifiers: ["Meta"] });
  const reader = await readerPromise;
  try {
    await expect(reader).toHaveURL(new RegExp(`/app/${p.id}/latest$`));
    await expect(page).toHaveURL(/\/home$/);
  } finally {
    await reader.close();
  }
  const popupPromise = page.context().waitForEvent("page");
  await edit.click({ modifiers: ["Meta"] });
  const popup = await popupPromise;
  try {
    await expect(popup).toHaveURL(new RegExp(`/project/${p.id}/latest$`));
    await expect(page).toHaveURL(/\/home$/);
  } finally {
    await popup.close();
  }
  await edit.click();
  await expect(page).toHaveURL(new RegExp(`/project/${p.id}/latest$`));
}
