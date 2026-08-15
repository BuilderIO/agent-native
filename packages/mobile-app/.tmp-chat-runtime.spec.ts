import { expect, test } from "@playwright/test";

test("launches into Chat and exposes optional computer mode", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("http://127.0.0.1:8086/", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/chat/);
  await expect(page.getByText("Chat", { exact: true }).first()).toBeVisible();

  await page.goto("http://127.0.0.1:8086/chat?preview=chat-empty", {
    waitUntil: "networkidle",
  });
  await expect(page.getByText("Start a chat", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Ask across your workspace.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Native Chat", { exact: true })).toHaveCount(0);

  await page.getByRole("radio", { name: "Use a computer" }).click();
  await expect(
    page.getByRole("button", { name: "Connect a computer" }).last(),
  ).toBeVisible();
  await page.screenshot({
    path: "/Users/steve/.codex/visualizations/2026/08/15/mobile-chat-latest/chat-computer.png",
    fullPage: true,
  });

  expect(pageErrors).toEqual([]);
});
