import { expandAllLayers } from "./helpers";
import { expect, expectOnlyChanged, test } from "./rails";

const FRAME_FIXTURE = `<!doctype html><html><body style="margin:0">
<div data-agent-native-node-id="fill-probe" data-agent-native-layer-name="Fill probe" data-an-primitive="frame" style="position:absolute;left:20px;top:20px;width:180px;height:120px;background:#1a1d24"></div>
</body></html>`;

test("Fill Hex Enter applies and saves the colour, and one Escape closes the picker without undoing it", async ({
  app,
}) => {
  const id = await app.seed(FRAME_FIXTURE);
  await app.open(id);
  await app.settled();
  const page = app.page;
  const before = await app.savedNodes(id);
  await expandAllLayers(page);
  await page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name: "Fill probe", exact: true })
    .click();
  await expect.poll(() => app.selectedLayers()).toEqual(["Fill probe"]);

  await page
    .getByRole("heading", { name: "Fill", exact: true })
    .locator("xpath=ancestor::section")
    .getByRole("button", { name: "Open color picker" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Solid", exact: true }).hover();
  await expect(
    page
      .locator('[data-agent-native-tooltip="true"]')
      .filter({ hasText: "Solid" }),
  ).toBeVisible();
  const hex = page.getByRole("textbox", { name: "Hex", exact: true });
  await hex.fill("3B82F6");
  await hex.press("Enter");
  await page.keyboard.press("Escape");

  await expect(dialog).toBeHidden();
  const probe = app.node("fill-probe");
  await expect(probe).toHaveCSS("background-color", "rgb(59, 130, 246)");
  await app.settled();
  const after = await app.savedNodes(id);
  const savedColor = await page.evaluate((style) => {
    const declarations = document.createElement("div").style;
    declarations.cssText = style;
    return declarations.backgroundColor;
  }, after.get("fill-probe")!.attrs.style);
  expect(savedColor, "the saved fill").toBe("rgb(59, 130, 246)");
  expectOnlyChanged(before, after, ["fill-probe"]);
  await expect(probe, "Escape closed the picker without reverting").toHaveCSS(
    "background-color",
    "rgb(59, 130, 246)",
  );
});
