import { expect, type Page } from "@playwright/test";

export async function checkHomeRecents(page: Page, base: string) {
  await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  const recents = page.locator(".ws-home-recents");
  await recents
    .getByRole("tab", { name: "Projects", exact: true })
    .waitFor({ state: "visible" });
  const explorations = recents.getByRole("tab", {
    name: "Explorations",
    exact: true,
  });
  await expect(explorations).toBeVisible();
  await explorations.click();
  await expect(explorations).toHaveAttribute("aria-selected", "true");
  await expect(recents.getByRole("tabpanel")).toHaveText(
    "No recent explorations",
  );
  await expect(
    recents.getByRole("button", { name: "New exploration", exact: true }),
  ).toHaveCount(0);
  await recents.getByRole("tab", { name: "Threads", exact: true }).click();
  const create = recents.getByRole("button", {
    name: "New thread",
    exact: true,
  });
  await expect(create).toBeVisible();
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page).toHaveURL(`${base}/thread`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".ws-sidebar")).toBeVisible();
  await expect(page).toHaveURL(`${base}/thread`);
}
