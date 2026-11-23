import { expect, type Page } from "@playwright/test";

export async function checkNotifications(
  page: Page,
  base: string,
): Promise<void> {
  await page.goto(`${base}/home`);
  const read = await page.request.get(
    `${base}/_agent-native/actions/list-workspace-notifications`,
  );
  expect(read.ok()).toBe(true);
  const payload = (await read.json()) as {
    unreadCount?: number;
    notifications?: unknown[];
  };
  const unreadCount =
    typeof payload.unreadCount === "number" ? payload.unreadCount : 0;
  await page.getByRole("button", { name: /^Notifications(?:,|$)/ }).click();
  const dialog = page.getByRole("dialog", { name: "Notifications" });
  await expect(
    dialog.getByText("Notifications are not connected."),
  ).toHaveCount(0);
  if (unreadCount === 0) {
    await expect(
      dialog.getByText("Your notifications", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Mark all as read" }),
    ).toBeDisabled();
  } else {
    await expect(
      dialog.getByRole("button", { name: "Mark all as read" }),
    ).toBeEnabled();
  }
  await dialog.getByRole("button", { name: "All notifications" }).click();
  await dialog.getByRole("menuitem", { name: "Unread only" }).click();
  if (unreadCount === 0) {
    await expect(dialog.getByText("No unread notifications.")).toBeVisible();
  } else {
    await expect(dialog.getByText("No unread notifications.")).toHaveCount(0);
  }
  await page.screenshot({
    path: ".tmp/analytics-owner/report-notifications.png",
  });
}
