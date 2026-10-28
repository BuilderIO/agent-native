import { enterDirectMode, expandAllLayers } from "./helpers";
import { expect, expectOnlyChanged, test, type App } from "./rails";

const CONSTRAINTS_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Constraint resize fixture</title></head>
  <body style="margin:0;padding:20px;font-family:Arial,sans-serif">
    <div data-agent-native-node-id="outer-frame" data-agent-native-layer-name="Outer frame" style="position:relative;width:720px;height:620px;padding:30px;background:#eee">
      <div data-agent-native-node-id="nested-frame" data-agent-native-layer-name="Nested frame" style="position:relative;width:400px;height:300px;background:#fff">
        <div data-agent-native-node-id="left-top" data-agent-native-layer-name="Left Top Frame" style="position:absolute;left:20px;top:20px;width:60px;height:30px;background:#fecaca">Left Top</div>
        <div data-agent-native-node-id="right-bottom" data-agent-native-layer-name="Right Bottom Frame" style="position:absolute;left:110px;top:60px;width:70px;height:35px;background:#fed7aa">Right Bottom</div>
        <div data-agent-native-node-id="stretch" data-agent-native-layer-name="Stretch Both Frame" style="position:absolute;left:40px;top:110px;width:120px;height:40px;background:#fef08a">Stretch Both</div>
        <div data-agent-native-node-id="center" data-agent-native-layer-name="Center Both Frame" style="position:absolute;left:180px;top:170px;width:80px;height:46px;background:#bbf7d0">Center Both</div>
        <div data-agent-native-node-id="scale" data-agent-native-layer-name="Scale Both Frame" style="position:absolute;left:80px;top:230px;width:100px;height:50px;background:#bfdbfe">Scale Both</div>
      </div>
      <div data-agent-native-node-id="auto-frame" data-agent-native-layer-name="Auto frame" style="position:relative;display:flex;width:400px;height:180px;margin-top:30px;gap:12px;background:#ddd6fe">
        <div data-agent-native-node-id="flow-child" data-agent-native-layer-name="Flow child">Flow child</div>
        <div data-agent-native-node-id="auto-absolute" data-agent-native-layer-name="Auto Absolute Frame" style="position:absolute;left:100px;top:60px;width:80px;height:40px;background:#f5d0fe">Auto Absolute</div>
      </div>
    </div>
  </body>
</html>`;

/** Each child's box relative to its parent, after Nested frame grows to 600x450 and Auto frame to 600x270. */
const EXPECTED_AFTER_RESIZE = {
  "left-top": { left: 20, top: 20, width: 60, height: 30 },
  "right-bottom": { left: 310, top: 210, width: 70, height: 35 },
  stretch: { left: 40, top: 110, width: 320, height: 190 },
  center: { left: 280, top: 245, width: 80, height: 46 },
  scale: { left: 120, top: 345, width: 150, height: 75 },
  "auto-absolute": { left: 150, top: 90, width: 120, height: 60 },
};

async function selectLayer(app: App, name: string) {
  await app.page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name, exact: true })
    .click();
  await expect.poll(() => app.selectedLayers()).toEqual([name]);
}

async function chooseConstraint(
  app: App,
  axis: "Horizontal" | "Vertical",
  option: string,
) {
  const trigger = app.page.getByRole("button", { name: "Constraints" });
  if ((await trigger.getAttribute("aria-pressed")) !== "true")
    await trigger.click();
  await app.page.getByRole("combobox", { name: axis }).click();
  await app.page.getByRole("option", { name: option, exact: true }).click();
}

async function resizeTo(app: App, width: number, height: number) {
  for (const [label, value] of [
    ["W size in pixels", width],
    ["H size in pixels", height],
  ] as const) {
    const input = app.page.getByRole("textbox", { name: label });
    await input.fill(String(value));
    await input.press("Enter");
  }
}

async function childBoxes(app: App) {
  const boxes: Record<
    string,
    { left: number; top: number; width: number; height: number }
  > = {};
  for (const id of Object.keys(EXPECTED_AFTER_RESIZE)) {
    boxes[id] = await app.node(id).evaluate((element) => {
      const child = element.getBoundingClientRect();
      const parent = element.parentElement!.getBoundingClientRect();
      return {
        left: Math.round(child.left - parent.left),
        top: Math.round(child.top - parent.top),
        width: Math.round(child.width),
        height: Math.round(child.height),
      };
    });
  }
  return boxes;
}

test("constraints set in the inspector keep each child's edges, centre or proportions when its frame is resized, and persist", async ({
  app,
}) => {
  const id = await app.seed(CONSTRAINTS_HTML);
  await app.open(id);
  await enterDirectMode(app.page);
  await expandAllLayers(app.page);
  await app.settled();
  const before = await app.savedNodes(id);

  for (const [layer, horizontal, vertical] of [
    ["Right Bottom Frame", "Right", "Bottom"],
    ["Stretch Both Frame", "Left and right", "Top and bottom"],
    ["Center Both Frame", "Center", "Center"],
    ["Scale Both Frame", "Scale", "Scale"],
    ["Auto Absolute Frame", "Scale", "Scale"],
  ] as const) {
    await selectLayer(app, layer);
    await chooseConstraint(app, "Horizontal", horizontal);
    await chooseConstraint(app, "Vertical", vertical);
  }
  await selectLayer(app, "Nested frame");
  await resizeTo(app, 600, 450);
  await selectLayer(app, "Auto frame");
  await resizeTo(app, 600, 270);

  await expect(app.node("nested-frame")).toHaveCSS("width", "600px");
  await expect(app.node("auto-frame")).toHaveCSS("height", "270px");
  await expect.poll(() => childBoxes(app)).toEqual(EXPECTED_AFTER_RESIZE);
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), [
    "nested-frame",
    "auto-frame",
    "right-bottom",
    "stretch",
    "center",
    "scale",
    "auto-absolute",
  ]);

  await app.page.reload();
  await expect(app.node("nested-frame")).toHaveCSS("width", "600px");
  await expect.poll(() => childBoxes(app)).toEqual(EXPECTED_AFTER_RESIZE);
});
