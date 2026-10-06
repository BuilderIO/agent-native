import { expect, test } from "@playwright/test";

import {
  createFixtureDesign,
  designFrame,
  gotoEditor,
  selectByText,
} from "./helpers";

test("Alt distance labels clear on key release and lost-focus recovery without pointer movement", async ({
  page,
}) => {
  const designId = await createFixtureDesign(page, "Alt measurement release");
  await gotoEditor(page, designId);
  await selectByText(page, "Alpha Button");

  const beta = designFrame(page).getByText("Beta Button", { exact: true });
  const betaBox = (await beta.boundingBox())!;
  const overlay = designFrame(page).locator(
    "[data-agent-native-measurement-overlay]",
  );

  await page.mouse.move(betaBox.x - 20, betaBox.y - 20);
  await page.keyboard.down("Alt");
  await page.mouse.move(
    betaBox.x + betaBox.width / 2,
    betaBox.y + betaBox.height / 2,
  );
  await expect(overlay).toHaveCSS("display", "block");

  await page.keyboard.up("Alt");
  await expect(overlay).toHaveCSS("display", "none");

  await page.keyboard.down("Alt");
  await page.mouse.move(
    betaBox.x + betaBox.width / 2 + 1,
    betaBox.y + betaBox.height / 2,
  );
  await expect(overlay).toHaveCSS("display", "block");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(overlay).toHaveCSS("display", "none");
  await page.keyboard.up("Alt");
  await expect(overlay).toHaveCSS("display", "none");
});
