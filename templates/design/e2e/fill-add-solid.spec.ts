import { expect, expectOnlyChanged, styleOf, test, type App } from "./rails";

const LAYERED_FILL = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;width:900px;height:700px">
  <div data-agent-native-node-id="fill-shape" data-agent-native-layer-name="Shape" style="position:absolute;left:64px;top:64px;width:320px;height:180px;background-color:#123456;background-image:linear-gradient(90deg,rgba(204,51,102,.2) 0%,rgba(51,102,204,.2) 100%),radial-gradient(circle at center,#00ff00 0%,#ff00ff 100%);background-size:24px 24px,cover;background-repeat:no-repeat,repeat-x;background-position:10% 20%,30% 40%"></div>
  <div data-agent-native-node-id="bystander" data-agent-native-layer-name="Bystander" style="position:absolute;left:480px;top:64px;width:160px;height:120px;background-color:#eeeeee"></div>
</body></html>`;

const UNFILLED = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;width:900px;height:700px">
  <div data-agent-native-node-id="empty-fill-shape" data-agent-native-layer-name="Unfilled shape" style="position:absolute;left:64px;top:64px;width:320px;height:180px"></div>
  <div data-agent-native-node-id="bystander" data-agent-native-layer-name="Bystander" style="position:absolute;left:480px;top:64px;width:160px;height:120px;background-color:#eeeeee"></div>
</body></html>`;

const TWO_VECTORS = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;width:900px;height:700px">
  <svg xmlns="http://www.w3.org/2000/svg" data-agent-native-node-id="vector-path" data-agent-native-layer-name="Path shape" data-an-primitive="path" viewBox="0 0 100 100" style="position:absolute;left:64px;top:64px;width:100px;height:100px;fill:#123456"><path d="M 10 10 L 90 10 L 50 90 Z" /></svg>
  <svg xmlns="http://www.w3.org/2000/svg" data-agent-native-node-id="vector-rect" data-agent-native-layer-name="Rectangle shape" data-an-primitive="rectangle" viewBox="0 0 100 100" style="position:absolute;left:184px;top:64px;width:100px;height:100px;fill:#abcdef"><rect x="10" y="10" width="80" height="80" /></svg>
  <div data-agent-native-node-id="bystander" data-agent-native-layer-name="Bystander" style="position:absolute;left:480px;top:64px;width:160px;height:120px;background-color:#eeeeee"></div>
</body></html>`;

const UNSTROKED = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;width:800px;height:600px">
  <div data-agent-native-node-id="stroke-target" data-agent-native-layer-name="Stroke target" style="position:absolute;left:40px;top:40px;width:200px;height:120px;background:#fff"></div>
  <div data-agent-native-node-id="bystander" data-agent-native-layer-name="Bystander" style="position:absolute;left:400px;top:40px;width:160px;height:120px;background-color:#eeeeee"></div>
</body></html>`;

async function clickCentre(
  app: App,
  nodeId: string,
  modifiers: "Shift"[] = [],
) {
  const rect = await app.designRect(nodeId);
  const point = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  for (const key of modifiers) await app.page.keyboard.down(key);
  await app.page.mouse.click(point.x, point.y);
  for (const key of modifiers) await app.page.keyboard.up(key);
}

function inspectorSection(app: App, heading: "Fill" | "Stroke") {
  return app.page
    .getByRole("heading", { name: heading, exact: true })
    .locator("xpath=ancestor::section[1]");
}

/** Resolves a saved inline style the way the canvas renders it, so saved and rendered values compare literally. */
async function computedFromSaved(
  app: App,
  style: string | undefined,
  properties: string[],
) {
  return app.page.evaluate(
    ({ style, properties }) => {
      const probe = document.createElement("div");
      probe.style.cssText = style ?? "";
      document.body.append(probe);
      const computed = getComputedStyle(probe);
      const values = Object.fromEntries(
        properties.map((name) => [name, computed.getPropertyValue(name)]),
      );
      probe.remove();
      return values;
    },
    { style, properties },
  );
}

// oracle: none — app fill-layer behavior with no native Figma counterpart; only how the added row is located changed.
// fixme: product bug: The in-iframe gradient overlay ([data-agent-native-edit-overlay=gradient]) stays visible, with green/magenta stop handles, while the
test.fixme("Add fill puts a #123456 Solid layer on top, keeps the gradient layers' size, repeat and position aligned, and saves it", async ({
  app,
}) => {
  const id = await app.seed(LAYERED_FILL);
  await app.open(id);
  await app.zoomToFit();
  await clickCentre(app, "fill-shape");
  await expect.poll(() => app.selectedLayers()).toEqual(["Shape"]);
  const fill = inspectorSection(app, "Fill");
  const paintRows = fill.locator('[data-inspector-layout="drag-paint-row"]');
  await expect(paintRows, "two gradient layers before adding").toHaveCount(2);
  const before = await app.savedNodes(id);

  await fill.getByRole("button", { name: "Add fill" }).click();

  await expect(paintRows).toHaveCount(3);
  await expect(
    paintRows.first().getByRole("button").filter({ hasText: "123456" }),
  ).toBeVisible();
  await expect(paintRows.first()).not.toContainText(/Linear|Radial/);
  const picker = app.page.getByRole("dialog");
  await expect(
    picker.getByRole("button", { name: "Solid", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    picker.getByRole("textbox", { name: "Hex", exact: true }),
  ).toHaveValue("123456");
  const layered = {
    "background-image":
      "linear-gradient(rgb(18, 52, 86) 0px, rgb(18, 52, 86) 0px), linear-gradient(90deg, rgba(204, 51, 102, 0.2) 0%, rgba(51, 102, 204, 0.2) 100%), radial-gradient(circle, rgb(0, 255, 0) 0%, rgb(255, 0, 255) 100%)",
    "background-size": "auto, 24px 24px, cover",
    "background-repeat": "no-repeat, no-repeat, repeat-x",
    "background-position": "0% 0%, 10% 20%, 30% 40%",
  };
  await expect(app.node("fill-shape")).toHaveCSS(
    "background-image",
    layered["background-image"],
  );
  await expect(app.node("fill-shape")).toHaveCSS(
    "background-size",
    layered["background-size"],
  );
  await expect(app.node("fill-shape")).toHaveCSS(
    "background-repeat",
    layered["background-repeat"],
  );
  await expect(app.node("fill-shape")).toHaveCSS(
    "background-position",
    layered["background-position"],
  );

  await app.settled();
  const after = await app.savedNodes(id);
  expect(
    await computedFromSaved(
      app,
      after.get("fill-shape")?.attrs.style,
      Object.keys(layered),
    ),
  ).toEqual(layered);
  expectOnlyChanged(before, after, ["fill-shape"]);
  await expect(
    app.page
      .locator(
        'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])',
      )
      .contentFrame()
      .locator('[data-agent-native-edit-overlay="gradient"]'),
    "no gradient handles while the Solid picker is open",
  ).toBeHidden();
});

test("the + on an empty Fill heading adds one #D9D9D9 fill and saves it", async ({
  app,
}) => {
  const id = await app.seed(UNFILLED);
  await app.open(id);
  await app.zoomToFit();
  await clickCentre(app, "empty-fill-shape");
  await expect.poll(() => app.selectedLayers()).toEqual(["Unfilled shape"]);
  const fill = inspectorSection(app, "Fill");
  await expect(
    fill.locator('[data-inspector-layout="paint-row"]'),
    "no fill before adding",
  ).toHaveCount(0);
  const before = await app.savedNodes(id);

  await fill
    .getByRole("heading", { name: "Fill", exact: true })
    .getByRole("button", { name: "Add fill" })
    .click();

  await expect(fill.locator('[data-inspector-layout="paint-row"]')).toHaveCount(
    1,
  );
  await expect(
    fill
      .locator('[data-inspector-layout="paint-row"]')
      .getByRole("textbox", { name: "Color", exact: true }),
  ).toHaveValue("D9D9D9");
  await expect(app.node("empty-fill-shape")).toHaveCSS(
    "background-color",
    "rgb(217, 217, 217)",
  );
  await app.settled();
  const after = await app.savedNodes(id);
  expect(
    await computedFromSaved(app, after.get("empty-fill-shape")?.attrs.style, [
      "background-color",
    ]),
  ).toEqual({
    "background-color": "rgb(217, 217, 217)",
  });
  expectOnlyChanged(before, after, ["empty-fill-shape"]);
});

test("Add fill and Add stroke on a path and a rectangle paint both as SVG fill and stroke, not CSS background or border, and save", async ({
  app,
}) => {
  const id = await app.seed(TWO_VECTORS);
  await app.open(id);
  await app.zoomToFit();
  await clickCentre(app, "vector-path");
  await expect.poll(() => app.selectedLayers()).toEqual(["Path shape"]);
  await clickCentre(app, "vector-rect", ["Shift"]);
  await expect
    .poll(() => app.selectedLayers())
    .toEqual(["Rectangle shape", "Path shape"]);
  const before = await app.savedNodes(id);
  const path = app.node("vector-path").locator("path");
  const rect = app.node("vector-rect").locator("rect");

  await inspectorSection(app, "Fill")
    .getByRole("button", { name: "Add fill" })
    .first()
    .click();
  await expect(path).toHaveCSS("fill", "rgb(217, 217, 217)");
  await expect(rect).toHaveCSS("fill", "rgb(217, 217, 217)");
  await inspectorSection(app, "Stroke")
    .getByRole("button", { name: "Add stroke" })
    .first()
    .click();
  await expect(path).toHaveCSS("stroke", "rgb(0, 0, 0)");
  await expect(rect).toHaveCSS("stroke", "rgb(0, 0, 0)");
  await expect(path).toHaveCSS("stroke-width", "1px");
  await expect(rect).toHaveCSS("stroke-width", "1px");
  for (const nodeId of ["vector-path", "vector-rect"]) {
    await expect(app.node(nodeId)).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
    await expect(app.node(nodeId)).toHaveCSS("border-top-width", "0px");
  }

  await app.settled();
  const after = await app.savedNodes(id);
  const savedHtml = await app.savedHtml(id);
  for (const [nodeId, geometry] of [
    ["vector-path", "path"],
    ["vector-rect", "rect"],
  ]) {
    const geometryStyle = await app.page.evaluate(
      ({ html, selector }) =>
        new DOMParser()
          .parseFromString(html, "text/html")
          .querySelector(selector)
          ?.getAttribute("style") ?? "",
      {
        html: savedHtml,
        selector: `[data-agent-native-node-id="${nodeId}"] > ${geometry}`,
      },
    );
    expect(
      await computedFromSaved(app, geometryStyle, [
        "fill",
        "stroke",
        "stroke-width",
      ]),
      `saved ${nodeId} ${geometry}`,
    ).toEqual({
      fill: "rgb(217, 217, 217)",
      stroke: "rgb(0, 0, 0)",
      "stroke-width": "1px",
    });
    expect(
      await computedFromSaved(app, after.get(nodeId)?.attrs.style, [
        "background-color",
        "border-top-width",
      ]),
      `saved ${nodeId}`,
    ).toEqual({
      "background-color": "rgba(0, 0, 0, 0)",
      "border-top-width": "0px",
    });
  }
  expectOnlyChanged(before, after, ["vector-path", "vector-rect"]);
});

// fixme: product bug: The 'Inside' stroke is a plain content-box border, so the element renders 202x122 while the inspector W/H still says 200x120. Every other
test.fixme("the + on an empty Stroke heading adds one 1px black Inside stroke that saves and keeps the box 200×120", async ({
  app,
}) => {
  const id = await app.seed(UNSTROKED);
  await app.open(id);
  await app.zoomToFit();
  await clickCentre(app, "stroke-target");
  await expect.poll(() => app.selectedLayers()).toEqual(["Stroke target"]);
  const stroke = inspectorSection(app, "Stroke");
  await expect(
    stroke.locator('[data-inspector-layout="paint-row"]'),
    "no stroke before adding",
  ).toHaveCount(0);
  const before = await app.savedNodes(id);

  await stroke
    .getByRole("heading", { name: "Stroke", exact: true })
    .getByRole("button", { name: "Add stroke" })
    .click();

  await expect(
    stroke.locator('[data-inspector-layout="paint-row"]'),
  ).toHaveCount(1);
  await expect(
    stroke
      .locator('[data-inspector-layout="paint-row"]')
      .getByRole("textbox", { name: "Color", exact: true }),
  ).toHaveValue("000000");
  await expect(
    stroke
      .getByRole("heading", { name: "Stroke", exact: true })
      .getByRole("button"),
  ).toHaveCount(0);
  await expect(stroke.getByRole("combobox").first()).toHaveText("Inside");
  await expect(app.node("stroke-target")).toHaveCSS("border-top-width", "1px");
  await expect(app.node("stroke-target")).toHaveCSS(
    "border-top-color",
    "rgb(0, 0, 0)",
  );
  await app.settled();
  const after = await app.savedNodes(id);
  expect(
    await computedFromSaved(app, after.get("stroke-target")?.attrs.style, [
      "border-top-width",
      "border-top-style",
      "border-top-color",
    ]),
  ).toEqual({
    "border-top-width": "1px",
    "border-top-style": "solid",
    "border-top-color": "rgb(0, 0, 0)",
  });
  expectOnlyChanged(before, after, ["stroke-target"]);
  expect(
    await app.designRect("stroke-target"),
    "an Inside stroke must not grow the box",
  ).toEqual({
    x: 40,
    y: 40,
    width: 200,
    height: 120,
  });
});
