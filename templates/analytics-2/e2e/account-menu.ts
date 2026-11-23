import { expect, type Page } from "@playwright/test";

export async function checkAccountMenu(page: Page, base: string) {
  await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  const identity = await page.request.get(
    `${base}/_agent-native/actions/get-workspace-shell`,
  );
  expect(identity.ok()).toBe(true);
  expect((await identity.json()).user.email).toBe("qa-fleet@builder.io");
  const trigger = page.getByRole("button", { name: /account menu/i });
  await trigger.click();
  const menu = page.getByRole("menu", { name: "Account menu", exact: true });
  const themeItem = menu.getByRole("menuitem", { name: "Theme", exact: true });
  await expect(themeItem).toBeVisible();
  await expect(menu.getByText("Theme family", { exact: true })).toHaveCount(0);
  await themeItem.click();
  const themeMenu = page.getByRole("menu", { name: "Theme", exact: true });
  await expect(themeMenu).toBeVisible();
  const lightItem = themeMenu.getByRole("menuitem", {
    name: "Light",
    exact: true,
  });
  await expect(lightItem).toBeVisible();
  await expect(
    themeMenu.getByRole("menuitem", { name: "Dark", exact: true }),
  ).toBeVisible();
  await lightItem.click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  await page.keyboard.press("Escape");
  await expect(themeMenu).toHaveCount(0);
  await expect(menu).toBeVisible();
  for (const [label, href] of [
    ["Documentation", "https://www.agent-native.com/docs/"],
    ["Changelog", "https://github.com/BuilderIO/agent-native/releases"],
    ["Agent-Native status", "https://status.builder.io/"],
    ["Email support", "mailto:support@builder.io"],
  ] as const) {
    const link = menu.getByRole("menuitem", { name: label, exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", href);
    await expect(
      link.locator('.ws-menu-trailing svg[aria-hidden="true"]'),
    ).toBeVisible();
    if (!href.startsWith("mailto:")) {
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  }
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
}
