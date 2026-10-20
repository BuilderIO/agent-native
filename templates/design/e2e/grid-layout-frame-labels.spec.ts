import { designFrame } from "./helpers";
import { childrenOf, expect, expectOnlyChanged, styleOf, test } from "./rails";

const GRID_FRAME_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Grid Frame</title>
  </head>
  <body style="margin:0;width:900px;height:700px;background:#ffffff">
    <div data-agent-native-node-id="gf-frame" data-agent-native-layer-name="Hero Frame" data-an-primitive="frame" style="position:absolute;left:80px;top:140px;width:480px;height:320px;background:#f4f4f5">
      <div data-agent-native-node-id="gf-a" data-agent-native-layer-name="Rect A" data-an-primitive="rectangle" style="position:absolute;left:16px;top:12px;width:120px;height:80px;background:#d4d4d8"></div>
      <div data-agent-native-node-id="gf-b" data-agent-native-layer-name="Rect B" data-an-primitive="rectangle" style="position:absolute;left:210px;top:26px;width:120px;height:80px;background:#d4d4d8"></div>
      <div data-agent-native-node-id="gf-c" data-agent-native-layer-name="Rect C" data-an-primitive="rectangle" style="position:absolute;left:28px;top:190px;width:120px;height:80px;background:#d4d4d8"></div>
      <div data-agent-native-node-id="gf-nested" data-agent-native-layer-name="Nested Frame" data-an-primitive="frame" style="position:absolute;left:260px;top:176px;width:140px;height:100px;background:#e4e4e7"></div>
    </div>
  </body>
</html>`;

test("picking Grid on a frame of absolute children saves a 2-column grid, flows the children into its cells in order, and paints the cells", async ({
  app,
}) => {
  const id = await app.seed(GRID_FRAME_HTML);
  await app.open(id);
  await app.zoomToFit();
  const frame = await app.designRect("gf-frame");
  const centre = await app.pagePoint(
    frame.x + frame.width / 2,
    frame.y + frame.height / 2,
  );
  await app.page.mouse.click(centre.x, centre.y);
  await expect.poll(() => app.selectedLayers()).toEqual(["Hero Frame"]);
  const before = await app.savedNodes(id);

  await app.page.getByRole("button", { name: "Grid", exact: true }).click();

  await expect(app.node("gf-frame")).toHaveCSS("display", "grid");
  await app.settled();
  const after = await app.savedNodes(id);
  expect(styleOf(after.get("gf-frame"))).toEqual({
    ...styleOf(before.get("gf-frame")),
    display: "grid",
    "grid-template-columns": "repeat(2, minmax(0, 1fr))",
    "grid-template-rows": "repeat(1, max-content)",
    "grid-auto-flow": "row",
  });
  expect(childrenOf(after, "gf-frame")).toStrictEqual([
    "gf-a",
    "gf-b",
    "gf-c",
    "gf-nested",
  ]);
  for (const rect of ["gf-a", "gf-b", "gf-c"]) {
    expect(styleOf(after.get(rect)), rect).toEqual({
      width: "120px",
      height: "80px",
      background: "#d4d4d8",
    });
  }
  expect(
    styleOf(after.get("gf-nested")),
    "a nested frame is forced into flow but stays a containing block",
  ).toEqual({
    width: "140px",
    height: "100px",
    background: "#e4e4e7",
    position: "relative !important",
    left: "auto !important",
    top: "auto !important",
    right: "auto !important",
    bottom: "auto !important",
  });
  expectOnlyChanged(before, after, [
    "gf-frame",
    "gf-a",
    "gf-b",
    "gf-c",
    "gf-nested",
  ]);

  expect(await app.designRect("gf-a")).toEqual({
    x: 80,
    y: 140,
    width: 120,
    height: 80,
  });
  expect(await app.designRect("gf-b")).toEqual({
    x: 320,
    y: 140,
    width: 120,
    height: 80,
  });
  expect(await app.designRect("gf-c")).toEqual({
    x: 80,
    y: 220,
    width: 120,
    height: 80,
  });
  expect(await app.designRect("gf-nested")).toEqual({
    x: 320,
    y: 220,
    width: 140,
    height: 100,
  });
  await expect
    .poll(() =>
      designFrame(app.page)
        .locator("[data-agent-native-grid-cell]")
        .evaluateAll((cells) =>
          cells.map((cell) => cell.getAttribute("data-agent-native-grid-cell")),
        ),
    )
    .toStrictEqual(["0:0", "1:0", "0:1", "1:1"]);
});
