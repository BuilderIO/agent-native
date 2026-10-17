import {
  expect,
  expectOnlyChanged,
  test,
  type App,
  type SavedNode,
} from "./rails";

const FIXTURE = `<!doctype html><html><body style="margin:0">
<main data-agent-native-node-id="paint-owner" data-agent-native-layer-name="Paint owner" data-an-primitive="frame" style="position:relative;width:500px;height:300px">
<div data-agent-native-node-id="paint-shape" style="position:absolute;left:20px;top:20px;width:120px;height:80px;background-color:#f97316;border:8px solid #f97316"></div>
<p data-agent-native-node-id="paint-text" data-an-primitive="text" style="position:absolute;left:20px;top:140px;margin:0;color:#f97316;font:24px sans-serif">Paint</p>
</main></body></html>`;

const ORANGE = "rgb(249, 115, 22)";
const BLUE = "rgb(59, 130, 246)";

/** Shape fill, shape stroke and text colour, resolved the way the canvas renders them. */
async function savedPaints(app: App, nodes: Map<string, SavedNode>) {
  return app.page.evaluate(
    ({ shape, text }) => {
      const resolve = (style: string, property: string) => {
        const probe = document.createElement("div");
        probe.style.cssText = style;
        document.body.append(probe);
        const value = getComputedStyle(probe).getPropertyValue(property);
        probe.remove();
        return value;
      };
      return [
        resolve(shape, "background-color"),
        resolve(shape, "border-top-color"),
        resolve(text, "color"),
      ];
    },
    {
      shape: nodes.get("paint-shape")?.attrs.style ?? "",
      text: nodes.get("paint-text")?.attrs.style ?? "",
    },
  );
}

async function livePaints(app: App) {
  return [
    await app
      .node("paint-shape")
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    await app
      .node("paint-shape")
      .evaluate((element) => getComputedStyle(element).borderTopColor),
    await app
      .node("paint-text")
      .evaluate((element) => getComputedStyle(element).color),
  ];
}

test("a Selection Colors edit saves to every paint, survives the picker's Escape, and one undo restores all three", async ({
  app,
}) => {
  const id = await app.seed(FIXTURE);
  await app.open(id);
  await app.zoomToFit();
  const empty = await app.pagePoint(400, 250);
  await app.page.mouse.click(empty.x, empty.y);
  await expect.poll(() => app.selectedLayers()).toEqual(["Paint owner"]);
  await app.settled();
  const before = await app.savedNodes(id);

  await app.page.getByRole("button", { name: "Show selection colors" }).click();
  await app.page.getByRole("button", { name: /^#f97316$/i }).click();
  const hex = app.page.getByRole("textbox", { name: "Hex", exact: true });
  await hex.fill("3B82F6");
  await hex.press("Enter");
  await app.page.keyboard.press("Escape");

  await expect(hex).toBeHidden();
  await expect.poll(() => app.selectedLayers()).toEqual(["Paint owner"]);
  await expect.poll(() => livePaints(app)).toEqual([BLUE, BLUE, BLUE]);
  await app.settled();
  const edited = await app.savedNodes(id);
  expect(await savedPaints(app, edited)).toEqual([BLUE, BLUE, BLUE]);
  expectOnlyChanged(before, edited, ["paint-shape", "paint-text"]);

  await app.page.keyboard.press("ControlOrMeta+z");

  await expect.poll(() => livePaints(app)).toEqual([ORANGE, ORANGE, ORANGE]);
  await app.settled();
  const undone = await app.savedNodes(id);
  expect(await savedPaints(app, undone)).toEqual([ORANGE, ORANGE, ORANGE]);
  expectOnlyChanged(before, undone, []);
});
