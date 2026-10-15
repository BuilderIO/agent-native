import { type Page } from "@playwright/test";

import { expandAllLayers } from "./helpers";
import {
  childrenOf,
  expect,
  expectOnlyChanged,
  test,
  type App,
  type SavedNode,
} from "./rails";

const SCREEN_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Play control</title></head>
  <body style="margin:0;min-height:600px">
    <main data-agent-native-node-id="main" style="position:relative;min-height:600px"></main>
  </body>
</html>`;

type Point = { x: number; y: number };

test.use({ viewport: { width: 1600, height: 1000 } });

function layerRow(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem")
    .filter({ hasText: name })
    .first();
}

/** Page pixels are whole numbers; this returns the design point the pointer really reaches. */
async function snappedPagePoint(app: App, point: Point) {
  const page = await app.pagePoint(point.x, point.y);
  const origin = await app.pagePoint(0, 0);
  const x = Math.round(page.x);
  const y = Math.round(page.y);
  return {
    page: { x, y },
    design: { x: (x - origin.x) / page.scale, y: (y - origin.y) / page.scale },
  };
}

async function setFillColor(page: Page, layerName: string, hex: string) {
  await layerRow(page, layerName).click();
  const fill = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Fill$/i }) })
    .first();
  let swatch = fill.getByRole("button", { name: "Open color picker" });
  if ((await swatch.count()) === 0) {
    await fill
      .locator("[data-inspector-action-rail]")
      .getByRole("button", { name: "Add fill" })
      .click();
    swatch = fill.getByRole("button", { name: "Open color picker" });
  }
  await swatch.click();
  const input = page.getByRole("textbox", { name: "Hex", exact: true });
  await input.fill(hex);
  await input.press("Enter");
  await page.keyboard.press("Escape");
}

function byLayerName(nodes: Map<string, SavedNode>, name: string) {
  return [...nodes.values()].find(
    (node) => node.attrs["data-agent-native-layer-name"] === name,
  );
}

/** Effective saved fills: the ellipse's background colour and the vector path's fill. */
async function savedFills(
  app: App,
  designId: string,
  ellipseId: string,
  vectorId: string,
) {
  return app.page.evaluate(
    ({ html, ellipse, vector }) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const probe = document.createElement("div").style;
      const ellipseNode = doc.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${ellipse}"]`,
      )!;
      probe.cssText = ellipseNode.getAttribute("style") ?? "";
      const path = doc.querySelector<SVGPathElement>(
        `[data-agent-native-node-id="${vector}"] path`,
      )!;
      const pathFill = path.style.fill || path.getAttribute("fill") || "";
      probe.color = pathFill;
      return { ellipse: probe.backgroundColor, vector: probe.color };
    },
    {
      html: await app.savedHtml(designId),
      ellipse: ellipseId,
      vector: vectorId,
    },
  );
}

/** Each Pen anchor where it renders, in screen-document px. */
async function renderedAnchors(app: App, nodeId: string) {
  return app.node(nodeId).evaluate((svg) => {
    const ctm = (svg as SVGSVGElement).getScreenCTM()!;
    const [, ...nodes] = JSON.parse(
      svg.getAttribute("data-an-pen-nodes")!,
    ) as number[][];
    return nodes.map(([x, y]) => ({
      x: ctm.a * x! + ctm.c * y! + ctm.e,
      y: ctm.b * x! + ctm.d * y! + ctm.f,
    }));
  });
}

function expectNear(actual: Point, expected: Point, label: string) {
  expect(
    Math.hypot(actual.x - expected.x, actual.y - expected.y),
    `${label}: at ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
  ).toBeLessThanOrEqual(1.5);
}

// oracle: none — only the toolbar tool selection changed in this test; its own claim is unmeasured against Figma.
test("draws an overlaid play triangle, fills both, and converts the grouped layers to a component", async ({
  app,
}) => {
  const id = await app.seed(SCREEN_HTML);
  await app.open(id);
  await app.zoomToFit();
  await app.settled();
  const page = app.page;
  const before = await app.savedNodes(id);

  const ellipseFrom = await snappedPagePoint(app, { x: 70, y: 210 });
  const ellipseTo = await snappedPagePoint(app, { x: 150, y: 290 });
  await page
    .locator("[data-design-bottom-toolbar]")
    .getByRole("button", { name: "Shapes options" })
    .click();
  await page.getByRole("menuitem", { name: "Ellipse" }).click();
  await page.mouse.move(ellipseFrom.page.x, ellipseFrom.page.y);
  await page.mouse.down();
  await page.mouse.move(ellipseTo.page.x, ellipseTo.page.y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => byLayerName(await app.savedNodes(id), "Ellipse")?.id)
    .toBeTruthy();

  const triangle = [
    await snappedPagePoint(app, { x: 98, y: 226 }),
    await snappedPagePoint(app, { x: 132, y: 250 }),
    await snappedPagePoint(app, { x: 98, y: 274 }),
  ];
  await page.keyboard.press("p");
  await expect(
    page.getByRole("button", { name: "Pen", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const point of [...triangle, triangle[0]!]) {
    await page.mouse.click(point.page.x, point.page.y);
  }
  await expect
    .poll(async () => byLayerName(await app.savedNodes(id), "Vector")?.id)
    .toBeTruthy();
  await app.settled();
  const drawn = await app.savedNodes(id);
  const ellipseId = byLayerName(drawn, "Ellipse")!.id;
  const vectorId = byLayerName(drawn, "Vector")!.id;

  await expandAllLayers(page);
  await setFillColor(page, "Ellipse", "2563EB");
  await setFillColor(page, "Vector", "FFFFFF");
  await expect
    .poll(() => savedFills(app, id, ellipseId, vectorId))
    .toEqual({ ellipse: "rgb(37, 99, 235)", vector: "rgb(255, 255, 255)" });

  await layerRow(page, "Ellipse").click();
  await layerRow(page, "Vector").click({ modifiers: ["Shift"] });
  await expect
    .poll(async () => (await app.selectedLayers()).sort())
    .toEqual(["Ellipse", "Vector"]);
  await page.keyboard.press("ControlOrMeta+g");
  await expect(layerRow(page, "Group")).toBeVisible();
  await layerRow(page, "Group").click();
  let groupId = "";
  await expect
    .poll(async () => {
      groupId = byLayerName(await app.savedNodes(id), "Group")?.id ?? "";
      return groupId;
    })
    .toBeTruthy();

  await page.keyboard.press("ControlOrMeta+Alt+k");
  await expect(
    page.getByRole("dialog", { name: "Type a command or ask AI..." }),
  ).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await app.savedNodes(id)).get(groupId)?.attrs[
          "data-agent-native-component"
        ],
    )
    .toBe("Group");
  await app.settled();

  const after = await app.savedNodes(id);
  expect(childrenOf(after, groupId), "the component holds both layers").toEqual(
    [ellipseId, vectorId],
  );
  expect(
    after.get(groupId)?.parent,
    "drawn on the screen body, where the shapes were",
  ).toBe([...after.values()].find((node) => node.tag === "body")!.id);
  expect(await savedFills(app, id, ellipseId, vectorId)).toEqual({
    ellipse: "rgb(37, 99, 235)",
    vector: "rgb(255, 255, 255)",
  });
  const ellipseBox = await app.designRect(ellipseId);
  expect(
    [
      ellipseBox.x - ellipseFrom.design.x,
      ellipseBox.y - ellipseFrom.design.y,
      ellipseBox.width - (ellipseTo.design.x - ellipseFrom.design.x),
      ellipseBox.height - (ellipseTo.design.y - ellipseFrom.design.y),
    ].every((delta) => Math.abs(delta) <= 1.5),
    `the ellipse stays where it was drawn: ${JSON.stringify(ellipseBox)}`,
  ).toBe(true);
  const anchors = await renderedAnchors(app, vectorId);
  expect(anchors).toHaveLength(3);
  triangle.forEach((point, index) =>
    expectNear(anchors[index]!, point.design, `triangle anchor ${index}`),
  );
  expectOnlyChanged(before, after, [groupId, ellipseId, vectorId]);
});
