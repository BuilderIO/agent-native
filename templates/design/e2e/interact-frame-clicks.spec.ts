import { expect, test } from "@playwright/test";

import { enterInteractView, gotoEditor, readSeedDesignId } from "./helpers";

test("a frame's Interact button opens the Interact view and hands clicks to the page", async ({
  page,
}) => {
  const renderErrors: string[] = [];
  page.on("pageerror", (error) => renderErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("ErrorBoundary"))
      renderErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await gotoEditor(page, await readSeedDesignId());

  await enterInteractView(page);
  await expect(
    page.getByRole("button", { name: "Exit responsive preview" }),
  ).toBeVisible();

  const input = page
    .frameLocator("[data-design-preview-iframe]")
    .last()
    .locator('input[placeholder="Email"]');
  await input.click();
  await page.keyboard.type("hi@example.com");
  await expect(input).toHaveValue("hi@example.com");
  expect(renderErrors).toEqual([]);
});
