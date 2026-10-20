import { expect, expectOnlyChanged, styleOf, test } from "./rails";

const SCREEN = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Opacity</title></head>
<body data-agent-native-node-id="page" style="margin:0;min-height:900px;background:#0f1115;color:#f4f4f5">
  <h1 data-agent-native-node-id="heading" data-agent-native-layer-name="Heading" style="margin:40px;font-size:40px">Heading</h1>
</body></html>`;

test("Screen opacity number keys use the inspector's persisted body styles", async ({
  app,
  page,
}) => {
  const designId = await app.seed(SCREEN);
  await app.open(designId);
  await app.settled();
  const seeded = await app.savedNodes(designId);
  const body = app.node("page");
  const screenTitle = page.locator("[data-frame-title]").first();
  const opacity = page
    .getByRole("heading", { name: "Appearance", exact: true })
    .locator("xpath=ancestor::section")
    .getByRole("textbox", { name: "Opacity", exact: true });

  await screenTitle.click();
  await expect(opacity).toHaveValue("100%");
  await page.keyboard.press("5");
  await expect(opacity).toHaveValue("50%");
  await expect(body).toHaveCSS("opacity", "0.5");

  await opacity.fill("30");
  await opacity.press("Enter");
  await page.keyboard.press("0");
  await expect(opacity).toHaveValue("100%");
  await page.keyboard.press("0");
  await expect(opacity).toHaveValue("0%");
  await expect(body).toHaveCSS("opacity", "0");
  await app.settled();
  expect(
    styleOf((await app.savedNodes(designId)).get("page")).opacity,
    "the 00 keypress must save",
  ).toBe("0");

  await page.reload();
  await screenTitle.click();
  await expect(opacity).toHaveValue("0%");
  await page.keyboard.press("Escape");
  await page.keyboard.press("7");
  await screenTitle.click();
  await expect(opacity).toHaveValue("0%");
  await page.keyboard.press("4");
  await expect(opacity).toHaveValue("40%");
  await app.settled();

  const after = await app.savedNodes(designId);
  expect(styleOf(after.get("page"))).toEqual({
    ...styleOf(seeded.get("page")),
    opacity: "0.4",
  });
  expectOnlyChanged(seeded, after, ["page"]);
  await expect(body).toHaveCSS("opacity", "0.4");
});
