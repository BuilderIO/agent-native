import { type Page } from "@playwright/test";

import { expandAllLayers } from "./helpers";
import { expect, expectOnlyChanged, test, type App } from "./rails";

const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Screen</title></head>
<body style="margin:0;min-height:600px">
<main data-agent-native-node-id="main" style="position:relative;min-height:600px">
  <div data-agent-native-node-id="frame" data-an-primitive="frame" data-agent-native-layer-name="Frame" style="position:absolute;left:40px;top:120px;width:600px;height:400px;border:1px solid #ccc"></div>
</main></body></html>`;
const AUTHORED_OPEN_SVG_HTML = SCREEN_HTML.replace(
  "</main>",
  `<svg data-agent-native-node-id="authored-open-svg" data-agent-native-layer-name="Pasted SVG" data-an-primitive="pasted-svg" data-an-pen-nodes='[0,[10,30,null,null,null,null,null],[70,30,null,null,null,null,null]]' viewBox="0 0 120 80" style="position:absolute;left:200px;top:200px;width:120px;height:80px;overflow:visible"><path d="M10 30L70 30" fill="none" stroke="#111827" stroke-width="2" /></svg>
</main>`,
);

type Point = { x: number; y: number };

async function openFixture(app: App, html: string) {
  const id = await app.seed(html);
  await app.open(id);
  await app.zoomToFit();
  await app.settled();
  return id;
}

/** Saved vectors in document order, as node id and path data. */
async function savedVectors(app: App, designId: string) {
  const html = await app.savedHtml(designId);
  return app.page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "text/html");
    return [...doc.querySelectorAll("svg")]
      .map((svg) => ({
        id: svg.getAttribute("data-agent-native-node-id"),
        pathData: svg.querySelector("path")?.getAttribute("d") ?? "",
      }))
      .filter((vector) => vector.id && vector.pathData);
  }, html);
}

async function liveVectorIds(app: App) {
  return app.page
    .frameLocator("iframe[data-screen-iframe-id]")
    .locator("svg[data-an-primitive]")
    .evaluateAll((svgs) =>
      svgs.map((svg) => svg.getAttribute("data-agent-native-node-id")),
    );
}

/** The vector's geometry and paint as written in a screen document's HTML. */
async function vectorIn(app: App, html: string, nodeId: string) {
  return app.page.evaluate(
    ({ source, id }) => {
      const element = new DOMParser()
        .parseFromString(source, "text/html")
        .querySelector(`[data-agent-native-node-id="${id}"]`)!;
      const path = element.querySelector("path");
      return {
        pen: element.getAttribute("data-an-pen-nodes"),
        viewBox: element.getAttribute("viewBox"),
        style: element.getAttribute("style"),
        d: path?.getAttribute("d") ?? null,
        fill: path?.getAttribute("fill") ?? null,
        stroke: path?.getAttribute("stroke") ?? null,
      };
    },
    { source: html, id: nodeId },
  );
}

async function expectSavedAsRendered(
  app: App,
  designId: string,
  nodeId: string,
) {
  const live = await app
    .node(nodeId)
    .evaluate((element) => element.ownerDocument.documentElement.outerHTML);
  expect(
    await vectorIn(app, await app.savedHtml(designId), nodeId),
    "the saved vector is the one rendered",
  ).toEqual(await vectorIn(app, live, nodeId));
}

/** Each Pen node's anchor and handles where they render, in screen-document px. */
async function renderedPen(app: App, nodeId: string) {
  return app.node(nodeId).evaluate((svg) => {
    const ctm = (svg as SVGSVGElement).getScreenCTM()!;
    const [, ...nodes] = JSON.parse(svg.getAttribute("data-an-pen-nodes")!) as (
      | number
      | null
    )[][];
    const place = (x: number | null, y: number | null) =>
      x === null || y === null
        ? null
        : {
            x: ctm.a * x + ctm.c * y + ctm.e,
            y: ctm.b * x + ctm.d * y + ctm.f,
          };
    return nodes.map(([x, y, inX, inY, outX, outY]) => ({
      anchor: place(x, y)!,
      in: place(inX, inY),
      out: place(outX, outY),
    }));
  });
}

function expectNear(actual: Point | null, expected: Point, label: string) {
  expect(actual, label).not.toBeNull();
  expect(
    Math.hypot(actual!.x - expected.x, actual!.y - expected.y),
    `${label}: at ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
  ).toBeLessThanOrEqual(1.5);
}

/** Page pixels are whole numbers; this returns the design point the pointer really reached. */
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

async function penClick(page: Page, x: number, y: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(250);
}

async function newVectorId(
  app: App,
  designId: string,
  before: Map<string, unknown>,
) {
  let id: string | undefined;
  await expect
    .poll(async () => {
      const nodes = await app.savedNodes(designId);
      id = [...nodes.values()].find(
        (node) => node.tag === "svg" && !before.has(node.id),
      )?.id;
      return id;
    }, "the committed path is saved as a new vector")
    .toBeTruthy();
  return id!;
}

async function penPreview(page: Page) {
  const preview = await page.evaluate(() => {
    const overlays = Array.from(
      document.querySelectorAll<HTMLElement>("[data-pen-path-overlay]"),
    ).filter((overlay) => {
      const style = getComputedStyle(overlay);
      return style.display !== "none" && style.visibility !== "hidden";
    });
    const overlay = overlays.sort(
      (left, right) =>
        right.querySelectorAll("[data-pen-anchor]").length -
        left.querySelectorAll("[data-pen-anchor]").length,
    )[0];
    if (!overlay) return null;
    const rects = Array.from(
      overlay.querySelectorAll<HTMLElement>("[data-pen-anchor]"),
    ).map((anchor) => {
      const rect = anchor.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    const handles = Array.from(
      overlay.querySelectorAll<HTMLElement>("[data-pen-handle]"),
    ).map((handle) => {
      const rect = handle.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    return {
      anchors: rects,
      handles,
      pathData: overlay.querySelector("svg path")?.getAttribute("d") ?? "",
    };
  });
  if (!preview) throw new Error("Pen path preview is not visible");
  return preview;
}

async function terminalPenPoint(page: Page) {
  const point = await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>(
      "iframe[data-screen-iframe-id]",
    );
    const svg = iframe?.contentDocument?.querySelector<SVGSVGElement>(
      "svg[data-an-primitive='path']",
    );
    const path = svg?.querySelector("path");
    const matrix = svg?.getScreenCTM();
    const frameBox = iframe?.getBoundingClientRect();
    if (!iframe || !svg || !path || !matrix || !frameBox) return null;
    const endpoint = path.getPointAtLength(path.getTotalLength());
    const local = new DOMPoint(endpoint.x, endpoint.y).matrixTransform(matrix);
    return {
      x: frameBox.left + (local.x / iframe.clientWidth) * frameBox.width,
      y: frameBox.top + (local.y / iframe.clientHeight) * frameBox.height,
      right: frameBox.right,
      bottom: frameBox.bottom,
    };
  });
  if (!point) throw new Error("committed path has no rendered terminal point");
  return point;
}

test.use({ viewport: { width: 1440, height: 1000 } });

// fixme: product bug: The drag now moves every anchor by the full delta, but after it the saved vector's style keeps its compact text ("position: absolute;left: 130px;...") while the live node's is re-serialized ("position: absolute; left: 130px; ..."), so the saved-equals-rendered check fails on spacing alone.
test.fixme("a Pen path drawn in a frame is saved inside it where it was clicked, and dragging it moves every anchor by the drag", async ({
  app,
}) => {
  const id = await openFixture(app, SCREEN_HTML);
  const page = app.page;
  await page.locator("[data-frame-title]").first().click();
  const before = await app.savedNodes(id);
  // The Frame spans 40,120 to 640,520.
  const clicks = [
    await snappedPagePoint(app, { x: 112, y: 184 }),
    await snappedPagePoint(app, { x: 238, y: 202 }),
    await snappedPagePoint(app, { x: 178, y: 326 }),
  ];

  await page.keyboard.press("p");
  await expect(
    page.getByRole("button", { name: "Pen", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const click of clicks) await penClick(page, click.page.x, click.page.y);
  await expect
    .poll(async () => (await penPreview(page)).anchors.length)
    .toBe(3);
  await page.keyboard.press("Enter");

  const vectorId = await newVectorId(app, id, before);
  await app.settled();
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect((await app.savedNodes(id)).get(vectorId)?.parent).toBe("frame");
  const drawn = await renderedPen(app, vectorId);
  expect(drawn).toHaveLength(3);
  clicks.forEach((click, index) =>
    expectNear(drawn[index]!.anchor, click.design, `anchor ${index}`),
  );
  await expectSavedAsRendered(app, id, vectorId);
  expect(
    (await vectorIn(app, await app.savedHtml(id), vectorId)).d,
    "an open path",
  ).not.toMatch(/Z\s*$/i);

  // Mid-stroke of the second segment, clear of the selection box's resize edges.
  const grab = await snappedPagePoint(app, { x: 208.5, y: 264.5 });
  const release = await snappedPagePoint(app, { x: 268.5, y: 304.5 });
  await page.mouse.move(grab.page.x, grab.page.y);
  await page.mouse.down();
  await page.mouse.move(release.page.x, release.page.y, { steps: 10 });
  await page.mouse.up();

  await expect
    .poll(async () => (await renderedPen(app, vectorId))[0]!.anchor.x)
    .toBeGreaterThan(drawn[0]!.anchor.x + 30);
  await app.settled();
  const delta = {
    x: release.design.x - grab.design.x,
    y: release.design.y - grab.design.y,
  };
  const moved = await renderedPen(app, vectorId);
  drawn.forEach((node, index) =>
    expectNear(
      moved[index]!.anchor,
      { x: node.anchor.x + delta.x, y: node.anchor.y + delta.y },
      `anchor ${index} after the drag`,
    ),
  );
  await expectSavedAsRendered(app, id, vectorId);
  const after = await app.savedNodes(id);
  expect(after.get(vectorId)?.parent).toBe("frame");
  expectOnlyChanged(before, after, [vectorId]);
});

// fixme: product bug, fails in CI on both attempts: the first 11 px handle pull after the second anchor still previews a straight segment ("M … L …"), not a curve
test.fixme("a new Pen path previews every pointer step in the selected frame and closes without fill", async ({
  app,
}) => {
  const id = await openFixture(app, SCREEN_HTML);
  const page = app.page;
  await page.locator("[data-frame-title]").first().click();
  const before = await app.savedNodes(id);
  const points = [
    await snappedPagePoint(app, { x: 112, y: 184 }),
    await snappedPagePoint(app, { x: 238, y: 202 }),
    await snappedPagePoint(app, { x: 178, y: 326 }),
  ].map((point) => point.page);
  const handlePull = { x: 28, y: 34 };

  await page.keyboard.press("p");
  await expect(
    page.getByRole("button", { name: "Pen", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  await expect
    .poll(async () => (await penPreview(page)).anchors.length)
    .toBe(1);
  expect((await penPreview(page)).pathData).toMatch(/^M\s/);
  await page.mouse.up();

  await page.mouse.move(points[1]!.x, points[1]!.y);
  await page.mouse.down();
  await expect
    .poll(async () => (await penPreview(page)).anchors.length)
    .toBe(2);
  for (const t of [0.25, 0.5, 0.75, 1]) {
    const pointer = {
      x: points[1]!.x + handlePull.x * t,
      y: points[1]!.y + handlePull.y * t,
    };
    await page.mouse.move(pointer.x, pointer.y);
    const preview = await penPreview(page);
    expect(preview.anchors).toHaveLength(2);
    expect(preview.pathData).toMatch(/[CQ]/);
    expect(Math.abs(preview.anchors[1]!.x - points[1]!.x)).toBeLessThan(3);
    expect(Math.abs(preview.anchors[1]!.y - points[1]!.y)).toBeLessThan(3);
    await expect
      .poll(async () => {
        const handles = (await penPreview(page)).handles;
        const last = handles[handles.length - 1];
        return last ? Math.hypot(last.x - pointer.x, last.y - pointer.y) : null;
      }, "the dragged handle follows the pointer")
      .toBeLessThan(3);
  }
  await page.mouse.up();

  await page.mouse.move(points[2]!.x, points[2]!.y);
  await page.mouse.down();
  await expect
    .poll(async () => (await penPreview(page)).anchors.length)
    .toBe(3);
  expect((await penPreview(page)).pathData).not.toMatch(/Z\s*$/i);
  await page.mouse.up();

  const firstAnchor = (await penPreview(page)).anchors[0]!;
  await page.mouse.move(firstAnchor.x, firstAnchor.y);
  await page.mouse.down();
  await expect
    .poll(async () => (await penPreview(page)).pathData)
    .toMatch(/Z\s*$/i);
  expectOnlyChanged(before, await app.savedNodes(id), []);
  await page.mouse.up();

  const vectorId = await newVectorId(app, id, before);
  await app.settled();
  const after = await app.savedNodes(id);
  expect(after.get(vectorId)?.parent).toBe("frame");
  expectOnlyChanged(before, after, [vectorId]);
  await expectSavedAsRendered(app, id, vectorId);
  const saved = await vectorIn(app, await app.savedHtml(id), vectorId);
  expect(JSON.parse(saved.pen!)[0], "saved as a closed path").toBe(1);
  expect(saved.d).toMatch(/Z\s*$/i);
  await expect(app.node(vectorId).locator("path")).toHaveCSS("fill", "none");
  await expect(app.node(vectorId).locator("path")).toHaveCSS(
    "stroke",
    "rgb(0, 0, 0)",
  );

  const origin = await app.pagePoint(0, 0);
  const toDesign = (point: Point) => ({
    x: (point.x - origin.x) / origin.scale,
    y: (point.y - origin.y) / origin.scale,
  });
  const pull = {
    x: handlePull.x / origin.scale,
    y: handlePull.y / origin.scale,
  };
  const curved = toDesign(points[1]!);
  const nodes = await renderedPen(app, vectorId);
  expect(nodes).toHaveLength(3);
  expectNear(nodes[0]!.anchor, toDesign(points[0]!), "first anchor");
  expectNear(nodes[1]!.anchor, curved, "curved anchor");
  expectNear(nodes[2]!.anchor, toDesign(points[2]!), "third anchor");
  expectNear(
    nodes[1]!.out,
    { x: curved.x + pull.x, y: curved.y + pull.y },
    "the curved anchor's outgoing handle is where it was pulled",
  );
  expectNear(
    nodes[1]!.in,
    { x: curved.x - pull.x, y: curved.y - pull.y },
    "its incoming handle mirrors it",
  );
});

test("Pen continues a selected open path in place and persists undo/redo", async ({
  app,
}) => {
  const page = app.page;
  const designId = await openFixture(app, SCREEN_HTML);
  await page.locator("[data-frame-title]").first().click();
  const start = await app.pagePoint(140, 260);
  const end = await app.pagePoint(440, 260);
  await page.keyboard.press("p");
  await penClick(page, start.x, start.y);
  await penClick(page, end.x, end.y);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await savedVectors(app, designId)).length)
    .toBe(1);
  const before = (await savedVectors(app, designId))[0]!;

  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.locator('[role="treeitem"][aria-selected="true"]'),
  ).toContainText("Vector");
  await page.keyboard.press("p");
  await expect(
    page.getByRole("button", { name: "Pen", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const terminal = await terminalPenPoint(page);
  await page.mouse.click(terminal.x, terminal.y);
  await expect
    .poll(async () => (await penPreview(page)).anchors.length)
    .toBe(2);

  const appended = {
    x: Math.min(terminal.x + 36, terminal.right - 12),
    y: Math.min(terminal.y + 36, terminal.bottom - 12),
  };
  await page.mouse.move(appended.x, appended.y);
  await page.mouse.down();
  await expect
    .poll(async () => (await penPreview(page)).anchors.length)
    .toBe(3);
  expect((await penPreview(page)).pathData).not.toBe(before.pathData);
  await page.mouse.up();
  await page.keyboard.press("Enter");

  await expect
    .poll(async () => {
      const paths = await savedVectors(app, designId);
      return paths.length === 1 && paths[0]?.pathData !== before.pathData;
    })
    .toBe(true);
  const firstExtension = (await savedVectors(app, designId))[0]!;
  expect(firstExtension.id).toBe(before.id);
  expect(firstExtension.pathData).toContain("L");

  const undoShortcut = "ControlOrMeta+Z";
  const redoShortcut = "ControlOrMeta+Shift+Z";
  await page.keyboard.press(undoShortcut);
  await expect
    .poll(async () => (await savedVectors(app, designId))[0]?.pathData)
    .toBe(before.pathData);
  expect((await savedVectors(app, designId))[0]?.id).toBe(before.id);

  await page.keyboard.press(redoShortcut);
  await expect
    .poll(async () => (await savedVectors(app, designId))[0]?.pathData)
    .toBe(firstExtension.pathData);
  expect((await savedVectors(app, designId))[0]?.id).toBe(before.id);

  const committedTerminal = await terminalPenPoint(page);
  await page.keyboard.press(undoShortcut);
  await expect
    .poll(async () => (await savedVectors(app, designId))[0]?.pathData)
    .toBe(before.pathData);
  await page.keyboard.press(undoShortcut);
  await expect.poll(async () => savedVectors(app, designId)).toEqual([]);
  await expect.poll(async () => liveVectorIds(app)).toEqual([]);
  const selectedBeforeRestart = await page
    .locator(
      '[role="treeitem"][aria-selected="true"] [data-layer-row-button][data-layer-node-id]',
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-layer-node-id")),
    );
  expect(selectedBeforeRestart).not.toContain(firstExtension.id);

  await page.keyboard.press("p");
  await expect(
    page.getByRole("button", { name: "Pen", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await penClick(page, committedTerminal.x, committedTerminal.y);
  await expect
    .poll(async () => (await penPreview(page)).anchors.length)
    .toBe(1);
  await penClick(
    page,
    Math.min(committedTerminal.x + 40, committedTerminal.right - 12),
    Math.min(committedTerminal.y + 40, committedTerminal.bottom - 12),
  );
  await expect
    .poll(async () => (await penPreview(page)).anchors.length)
    .toBe(2);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => (await savedVectors(app, designId)).length)
    .toBe(1);
  const restarted = (await savedVectors(app, designId))[0]!;
  expect(restarted.id).not.toBe(firstExtension.id);
  expect(restarted.pathData).not.toBe(firstExtension.pathData);
  await expect(
    page.locator('[role="treeitem"][aria-selected="true"]'),
  ).toContainText("Vector");

  await page.reload();
  await expect.poll(async () => (await liveVectorIds(app)).length).toBe(1);
  expect((await savedVectors(app, designId))[0]).toEqual(restarted);
});

// fixme: product bug: After Enter the extended authored SVG teleports by +200,+200: its start anchor renders at (410,430) instead of (210,230); the authored
test.fixme("Pen continues a selected authored open SVG in place", async ({
  app,
}) => {
  const id = await openFixture(app, AUTHORED_OPEN_SVG_HTML);
  const page = app.page;
  await expandAllLayers(page);
  await page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name: "Pasted SVG", exact: true })
    .click();
  await expect.poll(() => app.selectedLayers()).toEqual(["Pasted SVG"]);
  const before = await app.savedNodes(id);
  // viewBox 0 0 120 80 at left 200, top 200: nodes 10,30 and 70,30.
  const authored = await renderedPen(app, "authored-open-svg");
  expectNear(authored[0]!.anchor, { x: 210, y: 230 }, "precondition: start");
  expectNear(authored[1]!.anchor, { x: 270, y: 230 }, "precondition: end");

  await page.keyboard.press("p");
  await expect(
    page.getByRole("button", { name: "Pen", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const terminal = await snappedPagePoint(app, { x: 270, y: 230 });
  await page.mouse.click(terminal.page.x, terminal.page.y);
  await expect
    .poll(async () => (await penPreview(page)).anchors.length)
    .toBe(2);
  const resumed = await penPreview(page);
  const startOnPage = await app.pagePoint(210, 230);
  expect(
    Math.hypot(
      resumed.anchors[0]!.x - startOnPage.x,
      resumed.anchors[0]!.y - startOnPage.y,
    ),
  ).toBeLessThan(3);
  expect(
    Math.hypot(
      resumed.anchors[1]!.x - terminal.page.x,
      resumed.anchors[1]!.y - terminal.page.y,
    ),
  ).toBeLessThan(3);

  const appended = await snappedPagePoint(app, { x: 306, y: 266 });
  await penClick(page, appended.page.x, appended.page.y);
  await expect
    .poll(async () => (await penPreview(page)).anchors.length)
    .toBe(3);
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), []);

  await page.keyboard.press("Enter");
  await expect
    .poll(
      async () =>
        (await app.savedNodes(id)).get("authored-open-svg")?.attrs[
          "data-an-pen-nodes"
        ],
    )
    .not.toBe(before.get("authored-open-svg")!.attrs["data-an-pen-nodes"]);
  await app.settled();
  const extended = await renderedPen(app, "authored-open-svg");
  expect(extended).toHaveLength(3);
  expectNear(extended[0]!.anchor, { x: 210, y: 230 }, "start stays in place");
  expectNear(extended[1]!.anchor, { x: 270, y: 230 }, "end stays in place");
  expectNear(extended[2]!.anchor, appended.design, "appended anchor");
  await expectSavedAsRendered(app, id, "authored-open-svg");
  expectOnlyChanged(before, await app.savedNodes(id), ["authored-open-svg"]);
});
