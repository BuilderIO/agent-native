import { expect, test } from "@playwright/test";

import { gotoEditor, readSeedDesignId } from "./helpers";

test("guided design questions stay clear of the left workspace panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const designId = await readSeedDesignId();
  await gotoEditor(page, designId);

  const response = await page.request.post(
    `${new URL(page.url()).origin}/_agent-native/actions/show-design-questions`,
    {
      data: {
        designId,
        title: "Question panel layout regression",
        questions: [
          {
            id: "layout",
            type: "freeform",
            question: "What should the first screen show?",
          },
        ],
      },
    },
  );
  expect(response.ok()).toBe(true);

  const title = page.getByRole("heading", {
    name: "Question panel layout regression",
  });
  await expect(title).toBeVisible();
  const leftPanel = await page
    .locator('[data-design-chrome-region="left-shell"]')
    .boundingBox();
  const titleBox = await title.boundingBox();

  expect(leftPanel).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(titleBox!.x).toBeGreaterThanOrEqual(leftPanel!.x + leftPanel!.width);

  await page.getByRole("button", { name: "Decide for me" }).click();
  await expect(title).toHaveCount(0);
});
