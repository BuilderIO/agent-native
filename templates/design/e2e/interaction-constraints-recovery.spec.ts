import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

const CARD_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Constraint recovery</title></head>
  <body style="margin:0;min-height:100vh;background:#fff">
    <div data-agent-native-node-id="card" data-agent-native-layer-name="Card"
         style="position:absolute;left:24px;top:24px;width:384px;height:339px;padding:12px;box-sizing:border-box;background:#f3f4f6">
      <div data-agent-native-node-id="album-art" data-agent-native-layer-name="Album art"
           style="position:relative;width:360px;height:240px;background:#e6a26b">
        <div data-agent-native-node-id="play" data-agent-native-layer-name="Play button"
             style="position:absolute;left:308px;top:188px;width:40px;height:40px;border-radius:50%;background:#fff;color:#111">Play</div>
      </div>
    </div>
  </body>
</html>`;

async function selectPlay(app: App) {
  await app.zoomToFit();
  const rect = await app.designRect("play");
  const center = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(center.x, center.y);
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Play button"]);
}

// fixme: fails in CI on current main: the canvas never settled after zoom to fit
test.fixme("absolute-position constraint controls survive close, reopen, and reload", async ({
  app,
}) => {
  const id = await app.seed(CARD_HTML);
  await app.open(id);
  await selectPlay(app);
  await expect(
    app.page.getByRole("button", { name: "Absolute position" }),
  ).toHaveAttribute("aria-pressed", "true");
  const before = await app.savedNodes(id);
  const constraints = app.page.getByRole("button", {
    name: "Constraints",
    exact: true,
  });
  const horizontal = app.page.getByRole("combobox", { name: "Horizontal" });
  const vertical = app.page.getByRole("combobox", { name: "Vertical" });

  await constraints.click();
  await horizontal.click();
  await app.page.getByRole("option", { name: "Right", exact: true }).click();
  await vertical.click();
  await app.page.getByRole("option", { name: "Bottom", exact: true }).click();
  await app.settled();

  const after = await app.savedNodes(id);
  expect(styleOf(after.get("play"))).toEqual({
    ...styleOf(before.get("play")),
    left: "auto",
    top: "auto",
    right: "12px",
    bottom: "12px",
    transform: "none",
  });
  expectOnlyChanged(before, after, ["play"]);
  expect(await app.designRect("play")).toEqual({
    x: 344,
    y: 224,
    width: 40,
    height: 40,
  });

  await constraints.click();
  await expect(horizontal).toBeHidden();
  await constraints.click();
  await expect(horizontal).toHaveText("Right");
  await expect(vertical).toHaveText("Bottom");

  await app.page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    app.page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible();
  await selectPlay(app);
  await constraints.click();
  await expect(horizontal).toHaveText("Right");
  await expect(vertical).toHaveText("Bottom");
  await app.settled();
  expectOnlyChanged(after, await app.savedNodes(id), []);
});
