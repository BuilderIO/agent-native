import { expandAllLayers } from "./helpers";
import { expect, test } from "./rails";

const STAMPED_BODY_HTML = `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Screen 1</title></head>
  <body data-agent-native-layer-name="Screen 1" style="margin:0;background:#0f1115">
    <div data-agent-native-node-id="rect-1" data-an-primitive="rectangle" data-agent-native-layer-name="Rectangle" style="position:absolute;left:40px;top:40px;width:120px;height:80px;background:#dadada"></div>
  </body>
</html>`;

test("a screen and its document are one object", async ({ app }) => {
  const id = await app.seed(STAMPED_BODY_HTML);
  await app.open(id);
  const rows = app.page
    .getByRole("tree", { name: "Layers" })
    .locator('[role="treeitem"] [data-layer-row-button]');
  await expect
    .poll(async () => {
      await expandAllLayers(app.page);
      return rows.count();
    }, "the screen expands to show its layers")
    .toBeGreaterThan(1);
  await expect(
    rows,
    "the screen row is the body: no separate Body layer",
  ).toHaveText(["Home", "Rectangle"]);

  await rows.first().click();
  await expect.poll(() => app.selectedLayers()).toEqual(["Home"]);
  await expect(
    app.page.getByRole("heading", { name: "Screen", exact: true, level: 3 }),
  ).toBeVisible();
  await expect
    .poll(() =>
      app.page
        .getByRole("textbox", { name: "Color" })
        .evaluateAll((inputs) =>
          inputs.map((input) => (input as HTMLInputElement).value),
        ),
    )
    .toEqual(["0F1115"]);
});
