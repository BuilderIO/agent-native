import { expect, type Page } from "@playwright/test";

export async function checkHomeRecovery(page: Page, base: string) {
  await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
  const identity = await page.evaluate(async () => {
    const response = await fetch(
      `${location.pathname.split("/home")[0]}/_agent-native/auth/session`,
    );
    const session = await response.json();
    return session.email ?? session.user?.email;
  });
  expect(identity).toBe("qa-fleet@builder.io");
  await page
    .getByRole("heading", { name: "Get started", exact: true })
    .waitFor({ timeout: 60_000 });
  const checklist = page.locator(".ws-home-checklist");
  const restore = page.getByRole("button", {
    name: "Show setup checklist",
    exact: true,
  });
  await expect(
    page.getByRole("heading", { name: "Get started", exact: true }),
  ).toBeVisible();
  await expect(checklist.or(restore)).toBeVisible();
  const originallyDismissed = (await restore.count()) > 0;
  const update = async (dismissed: boolean) => {
    const response = page.waitForResponse(
      (response) =>
        response.url().includes("/_agent-native/application-state") &&
        ["PUT", "POST"].includes(response.request().method()) &&
        (decodeURIComponent(response.url()).includes(
          "get-started-dismissed:",
        ) ||
          (response.request().postData() ?? "").includes(
            "get-started-dismissed:",
          )) &&
        response.ok(),
    );
    await (
      dismissed
        ? checklist.getByRole("button", { name: "Dismiss", exact: true })
        : restore
    ).click();
    await response;
  };
  try {
    if (originallyDismissed) await update(false);
    await expect(checklist.getByRole("progressbar")).toBeVisible();
    await update(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(restore).toBeEnabled();
    await expect(checklist).toHaveCount(0);
    await update(false);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(checklist.getByRole("progressbar")).toBeVisible();
    await expect(restore).toHaveCount(0);
    for (const name of [
      "Context management",
      "Your favorites",
      "Popular projects",
    ]) {
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
    }
    await expect(
      page.getByText("Context suggestions are unavailable in this workspace.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Open Context Studio", exact: true })
      .click();
    await expect(page).toHaveURL(`${base}/context-studio`);
    await expect(page.locator(".context-rail-group").first()).toBeVisible();
  } finally {
    await page.goto(`${base}/home`, { waitUntil: "domcontentloaded" });
    await expect(checklist.or(restore)).toBeVisible();
    const dismissed = (await restore.count()) > 0;
    if (dismissed !== originallyDismissed) await update(originallyDismissed);
  }
}
