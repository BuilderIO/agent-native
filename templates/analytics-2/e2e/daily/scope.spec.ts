import { expect, test } from "./fixtures";

test("report A2-CORE-LABS-SCOPE SCOPE-01 secondary navigation and routes are hidden by default", async ({
  daily,
}) => {
  const page = daily.page;
  await daily.open("/home");
  await expect(
    page.getByRole("link", { name: "Data", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Tasks", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "More", exact: true }).click();
  for (const name of ["Components", "Explorations", "Agent Dev Tools"])
    await expect(page.getByRole("menuitem", { name, exact: true })).toHaveCount(
      0,
    );
  for (const path of [
    "/home/tasks",
    "/home/components",
    "/home/explorations",
    "/settings/directory-sync",
    "/settings/sso",
  ]) {
    await daily.open(path);
    await expect(page).toHaveURL(/\/home$/);
  }
  await daily.open("/settings/profile");
  await expect(
    page.getByRole("link", { name: "Directory sync", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "SSO", exact: true }),
  ).toHaveCount(0);
});
