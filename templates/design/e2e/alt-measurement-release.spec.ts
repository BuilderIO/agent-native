import { FIXTURE_HTML } from "./global-setup";
import { designFrame, selectByText } from "./helpers";
import { expect, test } from "./rails";

test("Alt distance labels clear on key release and lost-focus recovery without pointer movement", async ({
  app,
  page,
}) => {
  await app.open(
    await app.seed(FIXTURE_HTML, { title: "Alt measurement release" }),
  );
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
