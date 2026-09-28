import { expect, test } from "@playwright/test";

import { gotoEditor, readSeedDesignId, selectByText } from "./helpers";

test("Cmd/Ctrl+R opens inline rename for the selected layer", async ({
  page,
}) => {
  const designId = await readSeedDesignId();
  await gotoEditor(page, designId);
  await selectByText(page, "Alpha Button");

  const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${primaryModifier}+r`);

  const renameInput = page.locator(
    '[role="treeitem"] input[aria-label="Rename layer"]',
  );
  await expect(renameInput).toBeVisible({ timeout: 2_000 });
  await expect(renameInput).toHaveValue("Alpha Button");
  await expect(renameInput).toBeFocused();

  await renameInput.press("Escape");
  await expect(renameInput).toHaveCount(0);
  await expect(
    page.getByRole("treeitem").filter({ hasText: "Alpha Button" }).first(),
  ).toBeVisible();
});
