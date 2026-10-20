import { expect, expectOnlyChanged, test, type App } from "./rails";

function paddingFrame(padding: string) {
  return `<!doctype html><html><body style="margin:0;width:320px;height:220px">
  <section data-agent-native-node-id="padding-frame" data-agent-native-layer-name="Padding Frame" data-an-primitive="frame" style="display:flex;flex-direction:row;padding:${padding};gap:8px;background:#e2e8f0">
    <div data-agent-native-node-id="padding-child" data-agent-native-layer-name="Padding child" style="width:60px;height:40px;background:#94a3b8">Child</div>
  </section>
</body></html>`;
}

/** Saved padding per side; the editor may write either the shorthand or longhands. */
async function savedPadding(app: App, id: string) {
  const style =
    (await app.savedNodes(id)).get("padding-frame")?.attrs.style ?? "";
  return app.page.evaluate((css) => {
    const probe = document.createElement("div");
    probe.setAttribute("style", css);
    const {
      paddingTop: top,
      paddingRight: right,
      paddingBottom: bottom,
      paddingLeft: left,
    } = probe.style;
    return { top, right, bottom, left };
  }, style);
}

async function openAndSelectFrame(app: App, padding: string) {
  const id = await app.seed(paddingFrame(padding));
  await app.open(id);
  await app.zoomToFit();
  await app.settled();
  const besideChild = await app.pagePoint(250, 30);
  await app.page.mouse.click(besideChild.x, besideChild.y);
  await expect.poll(() => app.selectedLayers()).toEqual(["Padding Frame"]);
  const layout = app.page
    .getByRole("heading", { name: "Auto layout", exact: true })
    .locator("xpath=ancestor::section");
  await expect(layout).toBeVisible();
  return { id, layout };
}

test("padding with four different sides opens as four side fields showing each value", async ({
  app,
}) => {
  const { layout } = await openAndSelectFrame(app, "10px 20px 30px 40px");

  await expect(layout.getByLabel("Top", { exact: true })).toHaveValue("10px");
  await expect(layout.getByLabel("Right", { exact: true })).toHaveValue("20px");
  await expect(layout.getByLabel("Bottom", { exact: true })).toHaveValue(
    "30px",
  );
  await expect(layout.getByLabel("Left", { exact: true })).toHaveValue("40px");
});

test("Alt-scrubbing an unlinked padding side mirrors its opposite side", async ({
  app,
}) => {
  const { id, layout } = await openAndSelectFrame(app, "10px");
  await layout.getByRole("button", { name: "Unlink padding" }).click();
  const top = layout.getByLabel("Top", { exact: true });
  for (const side of ["Top", "Right", "Bottom", "Left"]) {
    await expect(layout.getByLabel(side, { exact: true })).toHaveValue("10px");
  }
  const before = await app.savedNodes(id);
  const box = (await top.boundingBox())!;

  await app.page.keyboard.down("Alt");
  await app.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await app.page.mouse.down();
  await app.page.mouse.move(
    box.x + box.width / 2 + 10,
    box.y + box.height / 2,
    { steps: 4 },
  );
  await app.page.mouse.up();
  await app.page.keyboard.up("Alt");

  await expect
    .poll(async () => (await savedPadding(app, id)).top)
    .not.toBe("10px");
  await app.settled();
  const scrubbed = (await savedPadding(app, id)).top;
  expect(
    await savedPadding(app, id),
    "bottom mirrors top; left and right stay put",
  ).toEqual({
    top: scrubbed,
    right: "10px",
    bottom: scrubbed,
    left: "10px",
  });
  const after = await app.savedNodes(id);
  expectOnlyChanged(before, after, ["padding-frame"]);
  await expect(layout.getByLabel("Bottom", { exact: true })).toHaveValue(
    scrubbed,
  );
  const child = await app.designRect("padding-child");
  expect(
    { x: child.x, y: child.y },
    "the child sits inside the new top padding",
  ).toEqual({ x: 10, y: parseFloat(scrubbed) });
});
