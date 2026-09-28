import { expect, test } from "@playwright/test";

import {
  appPath,
  createFixtureDesign,
  designFrame,
  gotoEditor,
  selectByText,
} from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

test("primary Enter commits text and returns to layer duplication", async ({
  page,
}) => {
  const designId = await createFixtureDesign(page, "Text keyboard workflow");
  try {
    await gotoEditor(page, designId);
    await selectByText(page, "E2E Hero Heading");
    await expect(
      page.getByRole("button", { name: "Font", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    const editable = designFrame(page).locator('[contenteditable="true"]');
    await expect(editable).toBeVisible();
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.insertText("First title");
    await page.keyboard.press(`${MOD}+Enter`);
    await expect(editable).toHaveCount(0);
    await expect(designFrame(page).locator("h1")).toHaveText("First title");

    await page.keyboard.press(`${MOD}+d`);
    await expect(designFrame(page).locator("h1")).toHaveCount(2);
    await page.keyboard.press("Enter");
    await expect(editable).toBeVisible();
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.insertText("Second title");
    await page.keyboard.press(`${MOD}+Enter`);
    await expect(editable).toHaveCount(0);
    await expect(designFrame(page).locator("h1")).toHaveText([
      "First title",
      "Second title",
    ]);
    await page.reload();
    await expect(designFrame(page).locator("h1")).toHaveText([
      "First title",
      "Second title",
    ]);
  } finally {
    const response = await page.request.post(
      appPath("/_agent-native/actions/delete-design"),
      {
        data: { id: designId },
      },
    );
    if (!response.ok())
      throw new Error(`delete-design: ${await response.text()}`);
  }
});
