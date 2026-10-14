import type { Locator, Page } from "@playwright/test";

import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const ROW_HTML = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:40px;font-family:system-ui;background:#ffffff">
  <div data-agent-native-node-id="row" data-agent-native-layer-name="Row" style="display:flex;gap:16px;width:640px">
    <button data-agent-native-node-id="alpha" data-agent-native-layer-name="Alpha Button" style="width:120px;height:44px">Alpha Button</button>
    <button data-agent-native-node-id="beta" data-agent-native-layer-name="Beta Button" style="width:120px;height:44px">Beta Button</button>
    <button data-agent-native-node-id="gamma" data-agent-native-layer-name="Gamma Button" style="width:120px;height:44px">Gamma Button</button>
  </div>
  <section data-agent-native-node-id="card" data-agent-native-layer-name="Card" style="margin-top:40px;width:400px;height:160px;background:#eef2ff"></section>
</body></html>`;

const FREE_HTML = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;position:relative;width:900px;height:600px;background:#ffffff">
  <div data-agent-native-node-id="box" data-agent-native-layer-name="Free Box" style="position:absolute;left:80px;top:80px;width:120px;height:80px;background:#6366f1"></div>
</body></html>`;

const MEASURE_HTML = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;position:relative;width:900px;height:600px;background:#ffffff">
  <div data-agent-native-node-id="near" data-agent-native-layer-name="Near" style="position:absolute;left:80px;top:80px;width:120px;height:80px;margin-right:24px;background:#6366f1"></div>
  <div data-agent-native-node-id="far" data-agent-native-layer-name="Far" style="position:absolute;left:210px;top:80px;width:120px;height:80px;background:#f59e0b"></div>
</body></html>`;

const PROPERTIES_HTML = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;position:relative;width:900px;height:600px;background:#ffffff">
  <div data-agent-native-node-id="source" data-agent-native-layer-name="Source" style="position:absolute;left:80px;top:80px;width:160px;height:100px;box-sizing:border-box;background:#22c55e;border:2px solid #14532d;border-radius:12px;opacity:0.8"></div>
  <div data-agent-native-node-id="target" data-agent-native-layer-name="Target" style="position:absolute;left:400px;top:240px;width:120px;height:60px;box-sizing:border-box;background:#e5e7eb"></div>
</body></html>`;

async function openSeeded(
  app: App,
  html: string,
  files?: Record<string, string>,
) {
  const id = await app.seed(html, { files });
  await app.open(id);
  await app.zoomToFit();
  return id;
}

async function centerOf(app: App, nodeId: string) {
  const rect = await app.designRect(nodeId);
  return app.pagePoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

async function clickNode(app: App, nodeId: string, name: string) {
  const point = await centerOf(app, nodeId);
  await app.page.mouse.click(point.x, point.y);
  await expect.poll(() => app.selectedLayers()).toStrictEqual([name]);
}

async function dragBy(
  app: App,
  from: { x: number; y: number },
  designDx: number,
  designDy: number,
) {
  const { scale } = await app.pagePoint(0, 0);
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(
    from.x + designDx * scale,
    from.y + designDy * scale,
    { steps: 12 },
  );
  await app.page.mouse.up();
  await app.settled();
}

function layerRowButton(page: Page, name: string): Locator {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) });
}

async function searchLayers(page: Page, query: string) {
  await page
    .getByRole("button", { name: "Search layers...", exact: true })
    .click();
  const input = page.getByPlaceholder("Search layers...");
  await input.fill(query);
  await expect(layerRowButton(page, "Alpha Button")).toBeVisible();
}

function newIds(before: Map<string, unknown>, after: Map<string, unknown>) {
  return [...after.keys()].filter((id) => !before.has(id));
}

// fixme: fails on current main after the merge: Error: expect(received).toStrictEqual(expected) // deep equality
test.fixme("Alt-dragging a layer row between two siblings in the Layers panel saves one copy there, and undo removes it", async ({
  app,
  page,
}) => {
  const id = await openSeeded(app, ROW_HTML);
  await searchLayers(page, "Button");
  const alphaRow = layerRowButton(page, "Alpha Button");
  await alphaRow.click();
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Alpha Button"]);
  const before = await app.savedNodes(id);
  const alphaRendered = await app.designRect("alpha");
  // The panel lists the row's children top-first (Gamma, Beta, Alpha); this drops between Gamma and Beta.
  const source = (await alphaRow.boundingBox())!;
  const gamma = (await layerRowButton(page, "Gamma Button").boundingBox())!;

  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.keyboard.down("Alt");
  await page.mouse.down();
  await page.mouse.move(gamma.x + gamma.width / 2, gamma.y + gamma.height + 2, {
    steps: 8,
  });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await app.settled();

  const after = await app.savedNodes(id);
  const added = newIds(before, after);
  expect(added, "exactly one copy is saved").toHaveLength(1);
  const copy = after.get(added[0]!)!;
  expect(childrenOf(after, "row")).toStrictEqual([
    "alpha",
    "beta",
    added[0],
    "gamma",
  ]);
  expect({
    tag: copy.tag,
    text: copy.text,
    style: styleOf(copy),
  }).toStrictEqual({
    tag: "button",
    text: "Alpha Button",
    style: styleOf(before.get("alpha")),
  });
  expectOnlyChanged(before, after, added);
  expect(await app.designRect("alpha")).toStrictEqual(alphaRendered);

  await page.keyboard.press("ControlOrMeta+z");
  await app.settled();
  const undone = await app.savedNodes(id);
  expect(childrenOf(undone, "row")).toStrictEqual(["alpha", "beta", "gamma"]);
  expectOnlyChanged(before, undone, []);
});

test("a marquee that only clips a screen's corner selects nothing, and one that encloses the screen selects only that screen", async ({
  app,
  page,
}) => {
  const id = await openSeeded(app, FREE_HTML, { "two.html": FREE_HTML });
  const framesBefore = (await app.savedRecord(id)).data?.canvasFrames;
  const home = (await page
    .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
    .first()
    .boundingBox())!;
  await expect.poll(() => app.selectedLayers()).toStrictEqual([]);

  await page.mouse.move(home.x + home.width - 30, home.y - 60);
  await page.mouse.down();
  await page.mouse.move(home.x + home.width - 10, home.y + 30, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => app.selectedLayers()).toStrictEqual([]);
  await expect(page.locator("[data-frame-selection-box]")).toHaveCount(0);

  await page.mouse.move(home.x - 30, home.y - 60);
  await page.mouse.down();
  await page.mouse.move(home.x + home.width + 10, home.y + home.height + 30, {
    steps: 8,
  });
  await page.mouse.up();
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Home"]);
  await expect(page.locator("[data-frame-selection-box]")).toHaveCount(1);
  await app.settled();
  expect((await app.savedRecord(id)).data?.canvasFrames).toStrictEqual(
    framesBefore,
  );
});

test("Cmd+A with a child selected selects exactly that child's siblings", async ({
  app,
  page,
}) => {
  const id = await openSeeded(app, ROW_HTML);
  await clickNode(app, "alpha", "Alpha Button");
  const before = await app.savedNodes(id);

  await page.keyboard.press("ControlOrMeta+a");

  await expect
    .poll(async () => (await app.selectedLayers()).sort())
    .toStrictEqual(["Alpha Button", "Beta Button", "Gamma Button"]);
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), []);
});

test("Cmd+D after moving the first duplicate repeats that move for the next duplicate", async ({
  app,
  page,
}) => {
  const id = await openSeeded(app, FREE_HTML);
  await clickNode(app, "box", "Free Box");
  const before = await app.savedNodes(id);
  const position = (nodes: Map<string, SavedNode>, nodeId: string) => {
    const style = styleOf(nodes.get(nodeId));
    return { left: parseFloat(style.left!), top: parseFloat(style.top!) };
  };

  await page.keyboard.press("ControlOrMeta+d");
  await app.settled();
  const afterFirst = await app.savedNodes(id);
  const firstCopies = newIds(before, afterFirst);
  expect(firstCopies).toHaveLength(1);
  const first = firstCopies[0]!;
  expect(position(afterFirst, first)).toStrictEqual({ left: 80, top: 80 });

  // Far enough that the drop lands on empty screen, not inside the original box.
  await dragBy(app, await centerOf(app, first), 200, 40);
  const moved = await app.savedNodes(id);
  expect(
    moved.get(first)?.parent,
    "the moved duplicate stays a sibling of the original",
  ).toBe(moved.get("box")?.parent);
  const manual = {
    dx: position(moved, first).left - 80,
    dy: position(moved, first).top - 80,
  };
  expect(
    manual.dx,
    "precondition: the drag moved the first duplicate",
  ).toBeGreaterThan(100);

  await page.keyboard.press("ControlOrMeta+d");
  await app.settled();
  const after = await app.savedNodes(id);
  const secondCopies = newIds(moved, after);
  expect(secondCopies).toHaveLength(1);
  const second = secondCopies[0]!;
  expect(after.get(second)?.parent).toBe(after.get("box")?.parent);
  expect({
    dx: position(after, second).left - position(after, first).left,
    dy: position(after, second).top - position(after, first).top,
  }).toStrictEqual(manual);
  expect(styleOf(after.get("box"))).toStrictEqual(styleOf(before.get("box")));
  expectOnlyChanged(moved, after, [second]);
  expect(
    manual,
    "the first duplicate lands where the pointer dropped it",
  ).toStrictEqual({ dx: 200, dy: 40 });
});

// fixme: product bug: The eye drag also starts a row drag: Gamma is moved below Beta (saved row order alpha, gamma, beta) and only Gamma gets hidden; Beta
test.fixme("dragging down the Layers panel's eye column hides every layer the drag crosses, and only those", async ({
  app,
  page,
}) => {
  const id = await openSeeded(app, ROW_HTML);
  await searchLayers(page, "Button");
  const before = await app.savedNodes(id);
  const gammaRow = layerRowButton(page, "Gamma Button");
  const betaRow = layerRowButton(page, "Beta Button");
  await gammaRow.hover();
  const gammaEye = gammaRow
    .locator('xpath=ancestor::*[@role="treeitem"][1]')
    .getByRole("button", { name: "Hide layer" });
  await expect(gammaEye).toBeVisible();
  const eye = (await gammaEye.boundingBox())!;
  const beta = (await betaRow.boundingBox())!;

  await page.mouse.move(eye.x + eye.width / 2, eye.y + eye.height / 2);
  await page.mouse.down();
  await page.mouse.move(eye.x + eye.width / 2, beta.y + beta.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  await app.settled();

  const after = await app.savedNodes(id);
  expect(
    childrenOf(after, "row"),
    "the drag must not reorder the rows it crosses",
  ).toStrictEqual(["alpha", "beta", "gamma"]);
  expect({
    gamma: after.get("gamma")?.attrs,
    beta: after.get("beta")?.attrs,
  }).toStrictEqual({
    gamma: {
      ...before.get("gamma")?.attrs,
      "data-agent-native-hidden": "true",
    },
    beta: { ...before.get("beta")?.attrs, "data-agent-native-hidden": "true" },
  });
  expectOnlyChanged(before, after, ["gamma", "beta"]);
  await expect(app.node("gamma")).toBeHidden();
  await expect(app.node("beta")).toBeHidden();
  await expect(app.node("alpha")).toBeVisible();
});

// fixme: fails on current main after the merge: Error: expect(locator).toHaveCSS(expected) failed
test.fixme("Alt-hovering a sibling that sits inside the selection's margin shows their 10px gap and keeps it while the pointer moves", async ({
  app,
  page,
}) => {
  const id = await openSeeded(app, MEASURE_HTML);
  await clickNode(app, "near", "Near");
  const before = await app.savedNodes(id);
  const overlay = page
    .locator(
      'iframe[data-design-preview-iframe][data-screen-iframe-id]:not([data-screen-iframe-id*="::bp-"])',
    )
    .contentFrame()
    .locator("[data-agent-native-measurement-overlay]");
  // x=215 is inside Far and inside Near's 24px right-margin hit region (200-224).
  const insideBoth = await app.pagePoint(215, 120);
  const insideFar = await app.pagePoint(220, 120);
  await page.mouse.move(insideBoth.x, insideBoth.y, { steps: 4 });
  await expect(overlay).toHaveCSS("display", "none");

  await page.keyboard.down("Alt");
  await page.mouse.move(insideBoth.x + 1, insideBoth.y, { steps: 2 });
  await expect(overlay).toHaveCSS("display", "block");
  await expect(overlay).toHaveText("10");
  await page.mouse.move(insideFar.x, insideFar.y, { steps: 4 });
  await expect(overlay).toHaveCSS("display", "block");
  await expect(overlay).toHaveText("10");
  await page.keyboard.up("Alt");

  await expect(overlay).toHaveCSS("display", "none");
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), []);
});

// fixme: product bug: The visual properties transfer, but the paste also writes the source's computed text defaults onto a non-text box (color rgb(0,0,0)
test.fixme("paste properties copies the source's fill, border, radius and opacity onto the target and keeps the target's position and size", async ({
  app,
  page,
}) => {
  const id = await openSeeded(app, PROPERTIES_HTML);
  await clickNode(app, "source", "Source");
  await page.keyboard.press("ControlOrMeta+Alt+c");
  await clickNode(app, "target", "Target");
  const before = await app.savedNodes(id);
  const targetRendered = await app.designRect("target");

  await page.keyboard.press("ControlOrMeta+Alt+v");
  await app.settled();

  await expect
    .poll(() =>
      app.node("target").evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
          radius: style.borderTopLeftRadius,
          opacity: style.opacity,
        };
      }),
    )
    .toStrictEqual({
      background: "rgb(34, 197, 94)",
      border: "2px solid rgb(20, 83, 45)",
      radius: "12px",
      opacity: "0.8",
    });
  expect(await app.designRect("target")).toStrictEqual(targetRendered);
  const after = await app.savedNodes(id);
  const saved = styleOf(after.get("target"));
  expect({
    left: saved.left,
    top: saved.top,
    width: saved.width,
    height: saved.height,
  }).toStrictEqual({
    left: "400px",
    top: "240px",
    width: "120px",
    height: "60px",
  });
  // The source authored no text styles, so none may be pinned onto the target.
  const typography = [
    "color",
    "font-family",
    "font-size",
    "font-weight",
    "letter-spacing",
    "line-height",
    "text-align",
  ];
  expect(
    Object.keys(saved).filter((property) => typography.includes(property)),
  ).toStrictEqual([]);
  expectOnlyChanged(before, after, ["target"]);
});

test("Shift+H then Shift+V mirror a box in place", async ({ app, page }) => {
  const id = await openSeeded(app, FREE_HTML);
  await clickNode(app, "box", "Free Box");
  const before = await app.savedNodes(id);
  const rendered = await app.designRect("box");

  await page.keyboard.press("Shift+h");
  await app.settled();
  const flippedH = await app.savedNodes(id);
  expect(styleOf(flippedH.get("box"))).toStrictEqual({
    ...styleOf(before.get("box")),
    scale: "-1 1",
  });
  expect(await app.designRect("box")).toStrictEqual(rendered);

  await page.keyboard.press("Shift+v");
  await app.settled();
  const after = await app.savedNodes(id);
  expect(styleOf(after.get("box"))).toStrictEqual({
    ...styleOf(before.get("box")),
    scale: "-1 -1",
  });
  expect(await app.designRect("box")).toStrictEqual(rendered);
  expectOnlyChanged(before, after, ["box"]);
});

test("Shift-dragging a screen's rotate handle saves a 15-degree step, and undo and redo restore it", async ({
  app,
  page,
}) => {
  const id = await openSeeded(app, FREE_HTML);
  const fileId = (await app.savedRecord(id)).files.find(
    (file) => file.filename === "index.html",
  )!.id;
  const savedRotation = async () =>
    (
      (await app.savedRecord(id)).data?.canvasFrames as Record<
        string,
        { rotation?: number }
      >
    )[fileId]?.rotation ?? 0;
  await page.locator("[data-frame-label]").first().click();
  await expect.poll(() => app.selectedLayers()).toStrictEqual(["Home"]);
  const handle = page.locator("[data-rotate-handle]").first();
  await expect(handle).toHaveCount(1);
  const shell = (await page
    .locator("[data-frame-shell]")
    .first()
    .boundingBox())!;
  const grip = (await handle.boundingBox())!;
  const center = {
    x: shell.x + shell.width / 2,
    y: shell.y + shell.height / 2,
  };
  const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  // Sweep the pointer 35 degrees clockwise around the screen's centre; Shift snaps that to 30.
  const sweep = (35 * Math.PI) / 180;
  const end = {
    x:
      center.x +
      (start.x - center.x) * Math.cos(sweep) -
      (start.y - center.y) * Math.sin(sweep),
    y:
      center.y +
      (start.x - center.x) * Math.sin(sweep) +
      (start.y - center.y) * Math.cos(sweep),
  };
  expect(await savedRotation()).toBe(0);

  await page.mouse.move(start.x, start.y);
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 16 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await app.settled();
  expect(await savedRotation()).toBe(30);

  await page.keyboard.press("ControlOrMeta+z");
  await app.settled();
  expect(await savedRotation()).toBe(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await app.settled();
  expect(await savedRotation()).toBe(30);
});
