import { appPath } from "./helpers";
import {
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type SavedNode,
} from "./rails";

test.use({ viewport: { width: 1440, height: 1000 } });

const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Screen</title></head>
<body style="margin:0;min-height:600px">
<main data-agent-native-node-id="main" style="position:relative;min-height:600px">
  <h1 data-agent-native-node-id="hero" style="position:absolute;left:24px;top:16px;margin:0">Hero</h1>
</main></body></html>`;

function added(before: Map<string, SavedNode>, after: Map<string, SavedNode>) {
  return [...after.values()].filter(
    (node) =>
      !before.has(node.id) && node.tag !== "html" && node.tag !== "body",
  );
}

test("Escape finishes a three-anchor Pen path drawn between two screens as one open board vector at the clicked points", async ({
  app,
}) => {
  const id = await app.seed(SCREEN_HTML, {
    files: { "second.html": SCREEN_HTML },
  });
  const { files } = await app.savedRecord(id);
  const screenId = (filename: string) =>
    files.find((file) => file.filename === filename)!.id;
  const response = await app.page.request.post(
    appPath("/_agent-native/actions/update-design"),
    {
      data: {
        id,
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", screenId("index.html")],
            value: { sourceType: "inline", width: 800, height: 600 },
          },
          {
            op: "set",
            path: ["canvasFrames", screenId("index.html")],
            value: { x: 0, y: 0, width: 800, height: 600, z: 0 },
          },
          {
            op: "set",
            path: ["screenMetadata", screenId("second.html")],
            value: { sourceType: "inline", width: 800, height: 600 },
          },
          {
            op: "set",
            path: ["canvasFrames", screenId("second.html")],
            value: { x: 1200, y: 0, width: 800, height: 600, z: 0 },
          },
        ],
      },
    },
  );
  expect(response.ok(), `update-design ${response.status()}`).toBe(true);
  await app.open(id);
  await app.zoomToFit();
  await app.zoomTo100();
  await app.settled();
  const screens = {
    first: await app.savedNodes(id),
    second: await app.savedNodes(id, "second.html"),
  };
  const board = await app.savedNodes(id, "__board__.html");

  await app.page.keyboard.press("p");
  await expect(
    app.page.getByRole("button", { name: "Pen", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const [x, y] of [
    [960, 120],
    [1020, 180],
    [980, 240],
  ] as const) {
    const point = await app.pagePoint(x, y, "index.html");
    await app.page.mouse.click(point.x, point.y);
  }
  await expect(
    app.page.locator("[data-pen-path-overlay] [data-pen-anchor]"),
  ).toHaveCount(3);
  await app.page.keyboard.press("Escape");

  await expect(app.page.locator("[data-pen-path-overlay]")).toHaveCount(0);
  await app.settled();
  const boardAfter = await app.savedNodes(id, "__board__.html");
  expect(
    added(board, boardAfter).map((node) => [
      node.tag,
      node.attrs["data-an-primitive"],
    ]),
  ).toEqual([["svg", "path"]]);
  const [vector] = added(board, boardAfter);
  const style = styleOf(vector);
  const box = [style.left, style.top, style.width, style.height].map((value) =>
    Math.round(Number.parseFloat(value)),
  );
  expect(box, "the vector's box spans the clicked anchors").toEqual([
    960, 120, 60, 120,
  ]);
  const [closed, ...anchors] = JSON.parse(
    vector.attrs["data-an-pen-nodes"]!,
  ) as [number, ...number[][]];
  expect(closed, "Escape leaves the path open").toBe(0);
  expect(
    anchors.map(([x, y]) => [Math.round(x!), Math.round(y!)]),
    "anchors in board coordinates",
  ).toEqual([
    [960, 120],
    [1020, 180],
    [980, 240],
  ]);
  expectOnlyChanged(screens.first, await app.savedNodes(id), []);
  expectOnlyChanged(
    screens.second,
    await app.savedNodes(id, "second.html"),
    [],
  );
});
