import { expect, test } from "@playwright/test";

import {
  appPath,
  createFixtureDesign,
  designFrame,
  gotoEditor,
} from "./helpers";

test("a transparent Screen fill reveals the board without fading child layers", async ({
  page,
}) => {
  const designId = await createFixtureDesign(
    page,
    `Screen fill transparency ${Date.now()}`,
  );
  try {
    await gotoEditor(page, designId);
    await page.locator("[data-frame-title]").first().click();
    const fill = page
      .getByRole("heading", { name: "Fill", exact: true })
      .locator("xpath=ancestor::section");
    await fill.getByRole("button", { name: "Open color picker" }).click();
    const pickerOpacity = page.getByRole("spinbutton", {
      name: "Opacity",
      exact: true,
    });
    await pickerOpacity.fill("50");
    await pickerOpacity.press("Enter");
    await page.keyboard.press("Escape");
    await expect(designFrame(page).locator("body")).toHaveCSS(
      "background-color",
      "rgba(15, 17, 21, 0.5)",
    );
    await fill.getByRole("button", { name: "Hide layer", exact: true }).click();
    await expect(designFrame(page).locator("body")).toHaveCSS(
      "background-color",
      "color(srgb 0 0 0 / 0)",
    );
    await expect(designFrame(page).locator("body")).toHaveCSS("opacity", "1");
    await expect(
      designFrame(page).locator(
        '[data-agent-native-node-id="e2e-alpha-button"]',
      ),
    ).toHaveCSS("background-color", "rgb(99, 102, 241)");
    for (const selector of ["[data-screen-card]", "[data-screen-content]"]) {
      await expect(page.locator(selector).first()).toHaveCSS(
        "background-color",
        "rgba(0, 0, 0, 0)",
      );
    }
    await fill.getByRole("button", { name: "Open color picker" }).click();
    await expect(pickerOpacity).toHaveValue("50");
    await pickerOpacity.fill("25");
    await pickerOpacity.press("Enter");
    await page.keyboard.press("Escape");
    await expect(designFrame(page).locator("body")).toHaveCSS(
      "background-color",
      "color(srgb 0 0 0 / 0)",
    );
    await page.reload();
    await page.locator("[data-frame-title]").first().click();
    await expect(
      fill.getByRole("button", { name: "Show layer", exact: true }),
    ).toBeVisible();
    await expect(page.locator("[data-screen-content]").first()).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await fill.getByRole("button", { name: "Show layer", exact: true }).click();
    await expect(designFrame(page).locator("body")).toHaveCSS(
      "background-color",
      "rgba(15, 17, 21, 0.25)",
    );
    await fill.getByRole("button", { name: "Open color picker" }).click();
    await pickerOpacity.fill("0");
    await pickerOpacity.press("Enter");
    await page.keyboard.press("Escape");
    await expect(
      fill.getByRole("button", { name: "Hide layer", exact: true }),
    ).toBeVisible();
    await fill.getByRole("button", { name: "Hide layer", exact: true }).click();
    await page.reload();
    await page.locator("[data-frame-title]").first().click();
    await fill.getByRole("button", { name: "Show layer", exact: true }).click();
    await expect(designFrame(page).locator("body")).toHaveCSS(
      "background-color",
      "rgba(15, 17, 21, 0)",
    );
  } finally {
    const response = await page.request.post(
      appPath("/_agent-native/actions/delete-design"),
      { data: { id: designId } },
    );
    if (!response.ok()) throw new Error(await response.text());
  }
});

for (const interruptWithUndo of [false, true]) {
  test(
    interruptWithUndo
      ? "Undo during a Screen scrub does not reuse its stale history baseline"
      : "a Screen opacity scrub preserves its original value as one undo step",
    async ({ page }) => {
      const designId = await createFixtureDesign(
        page,
        `Screen scrub history ${Date.now()}`,
      );
      try {
        await gotoEditor(page, designId);
        await page.locator("[data-frame-title]").first().click();
        const appearance = page
          .getByRole("heading", { name: "Appearance", exact: true })
          .locator("xpath=ancestor::section");
        const opacity = appearance.getByRole("textbox", {
          name: "Opacity",
          exact: true,
        });
        await expect(opacity).toHaveValue("100%");
        if (interruptWithUndo) {
          await opacity.fill("80");
          await opacity.press("Enter");
          await expect(designFrame(page).locator("body")).toHaveCSS(
            "opacity",
            "0.8",
          );
        }
        const inputId = await opacity.getAttribute("id");
        if (!inputId) throw new Error("Screen opacity input has no label id");
        const label = appearance.locator(
          `label[for=${JSON.stringify(inputId)}]`,
        );
        const box = await label.boundingBox();
        if (!box) throw new Error("Screen opacity scrub label is not visible");
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x - 16, y, { steps: 4 });
        await expect(opacity).not.toHaveValue("100%");
        await page.mouse.move(x - 32, y, { steps: 4 });
        if (interruptWithUndo) {
          await page.keyboard.press("ControlOrMeta+z");
          await expect(designFrame(page).locator("body")).toHaveCSS(
            "opacity",
            "1",
          );
        }
        await page.mouse.up();
        const committed = await opacity.inputValue();
        await expect(designFrame(page).locator("body")).toHaveCSS(
          "opacity",
          String(parseFloat(committed) / 100),
        );

        await page.keyboard.press("ControlOrMeta+z");
        await expect(opacity).toHaveValue("100%");
        await expect(designFrame(page).locator("body")).toHaveCSS(
          "opacity",
          "1",
        );
        await page.keyboard.press("ControlOrMeta+Shift+z");
        await expect(opacity).toHaveValue(committed);
        await page.reload();
        await page.locator("[data-frame-title]").first().click();
        await expect(opacity).toHaveValue(committed);
      } finally {
        const response = await page.request.post(
          appPath("/_agent-native/actions/delete-design"),
          { data: { id: designId } },
        );
        if (!response.ok()) throw new Error(await response.text());
      }
    },
  );
}
