import { expect, test } from "@playwright/test";

import {
  appPath,
  createFixtureDesign,
  designFrame,
  gotoEditor,
} from "./helpers";

test("Screen opacity number keys use the inspector's persisted body styles", async ({
  page,
}) => {
  const designId = await createFixtureDesign(
    page,
    `Screen opacity keys ${Date.now()}`,
  );
  try {
    await gotoEditor(page, designId);
    const screenTitle = page.locator("[data-frame-title]").first();
    await screenTitle.click();
    const appearance = page
      .getByRole("heading", { name: "Appearance", exact: true })
      .locator("xpath=ancestor::section");
    const opacity = appearance.getByRole("textbox", {
      name: "Opacity",
      exact: true,
    });
    await expect(opacity).toHaveValue("100%");
    await page.keyboard.press("5");
    await expect(opacity).toHaveValue("50%");
    await expect(designFrame(page).locator("body")).toHaveCSS("opacity", "0.5");

    await opacity.fill("30");
    await opacity.press("Enter");
    await page.keyboard.press("0");
    await expect(opacity).toHaveValue("100%");
    await page.keyboard.press("0");
    await expect(opacity).toHaveValue("0%");
    await expect(designFrame(page).locator("body")).toHaveCSS("opacity", "0");

    await page.reload();
    await screenTitle.click();
    await expect(opacity).toHaveValue("0%");
    await page.keyboard.press("Escape");
    await page.keyboard.press("7");
    await screenTitle.click();
    await expect(opacity).toHaveValue("0%");
    await page.keyboard.press("4");
    await expect(opacity).toHaveValue("40%");
    await expect
      .poll(async () => {
        const response = await page.request.get(
          appPath(`/_agent-native/actions/get-design?id=${designId}`),
        );
        if (!response.ok()) throw new Error(await response.text());
        const design = await response.json();
        return design.files[0].content;
      })
      .toMatch(/opacity:\s*0\.4/);
  } finally {
    const response = await page.request.post(
      appPath("/_agent-native/actions/delete-design"),
      { data: { id: designId } },
    );
    if (!response.ok()) throw new Error(await response.text());
  }
});
