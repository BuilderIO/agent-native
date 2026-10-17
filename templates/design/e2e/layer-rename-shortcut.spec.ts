import { expect, expectOnlyChanged, test, type App } from "./rails";

const NESTED_BUTTONS = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:40px;font-family:system-ui;background:#ffffff">
  <main data-agent-native-node-id="main" data-agent-native-layer-name="Main">
    <section data-agent-native-node-id="hero" data-agent-native-layer-name="Hero" style="padding:24px;background:#f1f5f9">
      <div data-agent-native-node-id="row" data-agent-native-layer-name="Row" style="display:flex;gap:16px">
        <button data-agent-native-node-id="alpha" data-agent-native-layer-name="Alpha Button" style="width:160px;height:44px">Alpha Button</button>
        <button data-agent-native-node-id="beta" data-agent-native-layer-name="Beta Button" style="width:160px;height:44px">Beta Button</button>
      </div>
      <p data-agent-native-node-id="note" data-agent-native-layer-name="A supporting paragraph long enough to overflow the Layers panel" style="margin:16px 0 0">A supporting paragraph long enough to overflow the Layers panel</p>
    </section>
  </main>
</body></html>`;

async function openWithAlphaSelected(app: App) {
  const id = await app.seed(NESTED_BUTTONS);
  await app.open(id);
  await app.zoomToFit();
  const alpha = await app.designRect("alpha");
  const center = await app.pagePoint(
    alpha.x + alpha.width / 2,
    alpha.y + alpha.height / 2,
  );
  await app.page.mouse.click(center.x, center.y);
  await expect.poll(() => app.selectedLayers()).toEqual(["Alpha Button"]);
  return { id, before: await app.savedNodes(id) };
}

function layersScroll(app: App) {
  return app.page.getByRole("tree", { name: "Layers" }).evaluate((tree) => {
    const scroller = tree.parentElement!;
    return {
      left: scroller.scrollLeft,
      overflows: scroller.scrollWidth > scroller.clientWidth,
    };
  });
}

test("Cmd/Ctrl+R renames the canvas-selected layer inline and Enter saves only that layer's name", async ({
  app,
  page,
}) => {
  const { id, before } = await openWithAlphaSelected(app);

  await page.keyboard.press("ControlOrMeta+R");
  const rename = page.getByRole("textbox", { name: "Rename layer" });
  await expect(rename).toHaveValue("Alpha Button");
  await expect(rename).toBeFocused();
  await rename.fill("Primary CTA");
  await rename.press("Enter");

  await expect(rename).toHaveCount(0);
  await expect.poll(() => app.selectedLayers()).toEqual(["Primary CTA"]);
  await app.settled();
  const after = await app.savedNodes(id);
  expect(after.get("alpha")?.attrs).toEqual({
    ...before.get("alpha")?.attrs,
    "data-agent-native-layer-name": "Primary CTA",
  });
  expect(after.get("alpha")?.text).toBe("Alpha Button");
  expectOnlyChanged(before, after, ["alpha"]);
});

// fixme: product bug: After the rename field opens and closes, the Layers scroller is left at scrollLeft 136 (0 before): the Home, Main and Hero rows show
test.fixme("Escape in the Cmd/Ctrl+R rename field discards the typed name and leaves the Layers panel unscrolled", async ({
  app,
  page,
}) => {
  const { id, before } = await openWithAlphaSelected(app);
  expect(await layersScroll(app)).toEqual({ left: 0, overflows: true });

  await page.keyboard.press("ControlOrMeta+R");
  const rename = page.getByRole("textbox", { name: "Rename layer" });
  await expect(rename).toHaveValue("Alpha Button");
  await rename.fill("Discarded name");
  await rename.press("Escape");

  await expect(rename).toHaveCount(0);
  await expect.poll(() => app.selectedLayers()).toEqual(["Alpha Button"]);
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), []);
  await expect
    .poll(() => layersScroll(app))
    .toEqual({ left: 0, overflows: true });
});
