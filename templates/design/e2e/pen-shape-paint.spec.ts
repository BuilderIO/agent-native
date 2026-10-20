import { type Locator, type Page } from "@playwright/test";

import { appPath } from "./helpers";
import { expect, styleOf, test, type App } from "./rails";

const SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Screen</title></head>
<body style="margin:0;min-height:600px">
<main data-agent-native-node-id="main" style="position:relative;min-height:600px"></main></body></html>`;
const EDGE_SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Edge stroke</title><style>svg[data-agent-native-node-id="edge-path"]{overflow:hidden!important}</style></head>
<body style="margin:0;min-height:600px">
<main data-agent-native-node-id="main" style="position:relative;min-height:600px">
<svg xmlns="http://www.w3.org/2000/svg" data-agent-native-node-id="edge-path" data-an-primitive="path" viewBox="0 0 100 100" style="position:absolute;left:200px;top:200px;width:100px;height:100px;overflow:hidden">
<path d="M 0 0 L 0 100 L 100 100 L 100 0 Z" fill="none" stroke="none" pointer-events="all"/>
</svg></main></body></html>`;
const SVG_WRAPPER_SCREEN_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>SVG stroke alignment</title></head>
<body style="margin:0;min-height:600px"><main data-agent-native-node-id="main" style="position:relative;min-height:600px">
<svg xmlns="http://www.w3.org/2000/svg" data-agent-native-node-id="svg-rect" data-an-primitive="rectangle" viewBox="0 0 100 100" style="position:absolute;left:20px;top:60px;width:100px;height:100px"><rect x="5" y="7" width="90" height="86" rx="8" ry="10" fill="#dadada" stroke="none"/></svg>
<svg xmlns="http://www.w3.org/2000/svg" data-agent-native-node-id="svg-ellipse" data-an-primitive="ellipse" viewBox="0 0 100 100" style="position:absolute;left:150px;top:60px;width:100px;height:100px"><circle cx="50" cy="50" r="38" fill="#dadada" stroke="none"/></svg>
<svg xmlns="http://www.w3.org/2000/svg" data-agent-native-node-id="svg-circle" data-an-primitive="circle" viewBox="0 0 100 100" style="position:absolute;left:280px;top:60px;width:100px;height:100px"><ellipse cx="50" cy="50" rx="45" ry="45" fill="#dadada" stroke="none"/></svg>
<svg xmlns="http://www.w3.org/2000/svg" data-agent-native-node-id="svg-polygon" data-an-primitive="polygon" viewBox="0 0 100 100" style="position:absolute;left:410px;top:60px;width:100px;height:100px"><path d="M 50 5 L 95 95 L 5 95 Z" fill="#dadada" stroke="none" style="opacity:0.5"/></svg>
<svg xmlns="http://www.w3.org/2000/svg" data-agent-native-node-id="svg-line" data-an-primitive="line" viewBox="0 0 100 100" style="position:absolute;left:540px;top:60px;width:100px;height:100px"><line x1="5" y1="50" x2="95" y2="50" fill="none" stroke="none"/></svg>
<svg xmlns="http://www.w3.org/2000/svg" data-agent-native-node-id="svg-arrow" data-an-primitive="arrow" viewBox="0 0 100 100" style="position:absolute;left:670px;top:60px;width:100px;height:100px"><path d="M 5 50 L 95 50" fill="none" stroke="none"/></svg>
<svg xmlns="http://www.w3.org/2000/svg" data-agent-native-node-id="svg-polygon-open-path" data-an-primitive="polygon" viewBox="0 0 100 100" style="position:absolute;left:20px;top:200px;width:100px;height:100px"><path d="M 5 5 L 95 95" fill="none" stroke="none"/></svg>
</main></body></html>`;

async function createDesign(app: App, screenHtml = SCREEN_HTML) {
  const designId = await app.seed(screenHtml);
  const { files } = await app.savedRecord(designId);
  const fileId = files.find((file) => file.filename === "index.html")!.id;
  const response = await app.page.request.post(
    appPath("/_agent-native/actions/update-design"),
    {
      data: {
        id: designId,
        dataOperations: [
          {
            op: "set",
            path: ["screenMetadata", fileId],
            value: { sourceType: "inline", width: 800, height: 600 },
          },
          {
            op: "set",
            path: ["canvasFrames", fileId],
            value: { x: 0, y: 0, width: 800, height: 600, z: 0 },
          },
        ],
      },
    },
  );
  expect(response.ok(), `update-design ${response.status()}`).toBe(true);
  return designId;
}

/** The first saved vector's path and wrapper paint, resolved by mounting the saved SVG in the host page. */
async function savedPathPaint(app: App, designId: string) {
  return app.page.evaluate(
    (source) => {
      const svg = new DOMParser()
        .parseFromString(source, "text/html")
        .querySelector("svg[data-an-primitive]");
      if (!svg) return null;
      const host = document.createElement("div");
      host.style.cssText = "position:absolute;left:-10000px;top:0";
      host.innerHTML = svg.outerHTML;
      document.body.append(host);
      const path = getComputedStyle(host.querySelector("path")!);
      const wrapper = getComputedStyle(host.querySelector("svg")!);
      const paint = {
        fill: path.fill,
        stroke: path.stroke,
        strokeWidth: path.strokeWidth,
        wrapperBackground: wrapper.backgroundColor,
        wrapperBorderWidth: wrapper.borderTopWidth,
      };
      host.remove();
      return paint;
    },
    await app.savedHtml(designId),
  );
}

async function vectorPaint(page: Page) {
  return page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>(
      "iframe[data-screen-iframe-id]",
    )?.contentDocument;
    const svg = doc?.querySelector<SVGElement>("svg[data-an-primitive]");
    const path = svg?.querySelector("path");
    if (!svg || !path) return null;
    const svgStyle = (svg as unknown as HTMLElement).style;
    const strokeTarget =
      svg.querySelector<SVGUseElement>(
        ":scope > use[data-an-vector-stroke-overlay]",
      ) ?? path;
    const shape = getComputedStyle(strokeTarget);
    return {
      fillAttribute: path.getAttribute("fill"),
      strokeAttribute: path.getAttribute("stroke"),
      shapeFill: shape.fill,
      shapeStroke: shape.stroke,
      pathD: path.getAttribute("d"),
      geometryPathD: svg
        .querySelector("[data-an-vector-stroke-geometry]")
        ?.getAttribute("d"),
      shapeStrokeWidth:
        strokeTarget.getAttribute("data-an-vector-logical-width") ||
        shape.strokeWidth,
      renderedStrokeWidth: shape.strokeWidth,
      strokePosition: svg.getAttribute("data-an-vector-stroke-position"),
      strokeClipPath: shape.clipPath,
      strokeMask: shape.mask,
      strokeOverlayCount: svg.querySelectorAll(
        ":scope > use[data-an-vector-stroke-overlay]",
      ).length,
      strokeDefsCount: svg.querySelectorAll(
        ":scope > defs[data-an-vector-stroke-defs]",
      ).length,
      outsideMaskWidth: svg
        .querySelector(":scope > defs[data-an-vector-stroke-defs] mask")
        ?.getAttribute("width"),
      wrapperBackground: svgStyle.background || svgStyle.backgroundColor,
      wrapperBorderWidth: svgStyle.borderWidth,
      wrapperOverflow: getComputedStyle(svg).overflow,
      wrapperOverflowValue: svgStyle.getPropertyValue("overflow"),
      wrapperOverflowPriority: svgStyle.getPropertyPriority("overflow"),
      originalOverflow: svg.getAttribute(
        "data-an-vector-stroke-original-overflow",
      ),
      strokeOverlayStyle: strokeTarget.getAttribute("style"),
      shapeOpacity: shape.opacity,
    };
  });
}

async function vectorStrokeEdgeSamples(
  page: Page,
  fractions = [0.13, 0.17, 0.21],
  insideDistance = 1.25,
  outsideDistance = insideDistance,
) {
  const screenshot = await page
    .frameLocator("iframe[data-screen-iframe-id]")
    .locator("body")
    .screenshot();

  return page.evaluate(
    async ({
      screenshotBase64,
      fractions,
      insideDistance,
      outsideDistance,
    }) => {
      const frame = document.querySelector<HTMLIFrameElement>(
        "iframe[data-screen-iframe-id]",
      );
      const frameDocument = frame?.contentDocument;
      const svg = frameDocument?.querySelector<SVGSVGElement>(
        "svg[data-an-primitive]",
      );
      const path = svg?.querySelector<SVGPathElement>(":scope > path");
      if (!frameDocument || !svg || !path) return null;

      const image = new Image();
      image.src = `data:image/png;base64,${screenshotBase64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(image, 0, 0);

      const length = path.getTotalLength();
      const bounds = frameDocument.body.getBoundingClientRect();
      const matrix = path.getScreenCTM();
      if (!matrix) return null;
      const samples = fractions.map((fraction) => {
        const at = length * fraction;
        const point = path.getPointAtLength(at);
        const before = path.getPointAtLength(at - 1);
        const after = path.getPointAtLength(at + 1);
        const tangentLength = Math.hypot(
          after.x - before.x,
          after.y - before.y,
        );
        const normal = {
          x: -(after.y - before.y) / tangentLength,
          y: (after.x - before.x) / tangentLength,
        };
        const sideIsInside = path.isPointInFill({
          x: point.x + normal.x * 4,
          y: point.y + normal.y * 4,
        });
        const sign = sideIsInside ? 1 : -1;
        const sample = (side: number) => {
          const userPoint = new DOMPoint(
            point.x + normal.x * sign * side,
            point.y + normal.y * sign * side,
          ).matrixTransform(matrix);
          const x = Math.floor(
            ((userPoint.x - bounds.x) / bounds.width) * canvas.width,
          );
          const y = Math.floor(
            ((userPoint.y - bounds.y) / bounds.height) * canvas.height,
          );
          return Array.from(context.getImageData(x, y, 1, 1).data);
        };
        return {
          inside: sample(insideDistance),
          outside: sample(-outsideDistance),
        };
      });
      const isBlack = (rgba: number[]) =>
        rgba[3]! > 180 && rgba[0]! < 150 && rgba[1]! < 150 && rgba[2]! < 150;
      const inside = samples.map(({ inside }) => inside);
      const outside = samples.map(({ outside }) => outside);
      return {
        insideBlack: inside.filter(isBlack).length,
        outsideBlack: outside.filter(isBlack).length,
        inside,
        outside,
      };
    },
    {
      screenshotBase64: screenshot.toString("base64"),
      fractions,
      insideDistance,
      outsideDistance,
    },
  );
}

function inspectorSection(page: Page, title: RegExp) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: title }) })
    .first();
}

function addStrokeButton(section: Locator) {
  return section
    .locator("[data-design-inspector-section-header]")
    .getByRole("button", { name: "Add stroke" })
    .last();
}

async function drawClosedTriangle(app: App, designId: string) {
  await app.open(designId);
  await app.zoomToFit();
  await app.page.keyboard.press("p");
  await expect(
    app.page.getByRole("button", { name: "Pen", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  for (const [x, y] of [
    [100, 300],
    [300, 240],
    [240, 420],
    [100, 300],
  ] as const) {
    const point = await app.pagePoint(x, y);
    await app.page.mouse.click(point.x, point.y);
  }
  await app.settled();
  return { centroid: await app.pagePoint(213, 320) };
}

test("a closed pen path starts with a stroke and no fill", async ({
  app,
  page,
}) => {
  const designId = await createDesign(app);
  const { centroid } = await drawClosedTriangle(app, designId);

  const paint = await vectorPaint(page);
  expect(paint).not.toBeNull();
  expect(paint!.fillAttribute).toBe("none");
  expect(paint!.strokeAttribute).toBe("#000000");
  expect(paint!.shapeStroke).toBe("rgb(0, 0, 0)");
  expect(await savedPathPaint(app, designId)).toEqual({
    fill: "none",
    stroke: "rgb(0, 0, 0)",
    strokeWidth: "1px",
    wrapperBackground: "rgba(0, 0, 0, 0)",
    wrapperBorderWidth: "0px",
  });

  await page.keyboard.press("v");
  await page.waitForTimeout(400);
  await page.mouse.click(centroid.x, centroid.y);
  const fillSection = inspectorSection(page, /^Fill$/i);
  await expect(fillSection).toBeVisible();
  await fillSection.getByRole("button", { name: "Add fill" }).last().click();
  await expect
    .poll(async () => (await vectorPaint(page))?.shapeFill)
    .toBe("rgb(217, 217, 217)");
  await app.settled();
  expect(await savedPathPaint(app, designId)).toMatchObject({
    fill: "rgb(217, 217, 217)",
    stroke: "rgb(0, 0, 0)",
    wrapperBackground: "rgba(0, 0, 0, 0)",
  });
});

test("fill and stroke edits paint the pen shape, not its selection bounds", async ({
  app,
  page,
}) => {
  const designId = await createDesign(app);
  const { centroid } = await drawClosedTriangle(app, designId);

  await page.keyboard.press("v");
  await page.waitForTimeout(400);
  await page.mouse.click(centroid.x, centroid.y);

  const fillSection = inspectorSection(page, /^Fill$/i);
  await expect(fillSection).toBeVisible();
  await fillSection.getByRole("button", { name: "Add fill" }).last().click();
  await fillSection.locator('button[aria-label="Hide layer"]').click();
  await expect
    .poll(async () => (await vectorPaint(page))?.shapeFill)
    .toMatch(/(?:\/|,)\s*0(?:\.0+)?\s*\)$/);

  const strokeColor = inspectorSection(page, /^Stroke$/i).getByRole("textbox", {
    name: "Color",
    exact: true,
  });
  await strokeColor.fill("EF4444");
  await strokeColor.press("Enter");
  await expect
    .poll(async () => (await vectorPaint(page))?.shapeStroke)
    .toBe("rgb(239, 68, 68)");

  const paint = (await vectorPaint(page))!;
  expect(paint.wrapperBackground).toBe("");
  expect(paint.wrapperBorderWidth).toBe("");
  expect(paint.shapeStrokeWidth).toBe("1px");
  await app.settled();
  const saved = (await savedPathPaint(app, designId))!;
  expect(
    saved.fill,
    "the hidden fill is saved fully transparent on the path",
  ).toMatch(/(?:\/|,)\s*0(?:\.0+)?\s*\)$/);
  expect({ ...saved, fill: undefined }).toEqual({
    fill: undefined,
    stroke: "rgb(239, 68, 68)",
    strokeWidth: "1px",
    wrapperBackground: "rgba(0, 0, 0, 0)",
    wrapperBorderWidth: "0px",
  });
});

test("closed vector strokes render inside, center, and outside", async ({
  app,
  page,
}) => {
  const designId = await createDesign(app);
  const { centroid } = await drawClosedTriangle(app, designId);
  await page.keyboard.press("v");
  await page.waitForTimeout(400);
  await page.mouse.click(centroid.x, centroid.y);

  const strokeSection = inspectorSection(page, /^Stroke$/i);
  const addStroke = addStrokeButton(strokeSection);
  await expect(addStroke).toBeVisible();
  await addStroke.click();
  const position = strokeSection.getByRole("combobox", {
    name: "Position",
  });
  await expect(position).toBeVisible();
  await expect(position).toHaveAccessibleName("Position");

  await position.click();
  await page.getByRole("option", { name: "Inside" }).click();
  await expect
    .poll(async () => (await vectorPaint(page))?.strokePosition)
    .toBe("inside");
  let paint = (await vectorPaint(page))!;
  expect(paint.shapeStroke).toBe("rgb(0, 0, 0)");
  expect(paint.shapeStrokeWidth).toBe("1px");
  expect(paint.renderedStrokeWidth).toBe("2px");
  expect(paint.geometryPathD).toBe(paint.pathD);
  expect(paint.strokeClipPath).not.toBe("none");
  expect(paint.strokeOverlayCount).toBe(1);
  expect(paint.strokeDefsCount).toBe(1);
  const insideSamples = await vectorStrokeEdgeSamples(
    page,
    undefined,
    1.25,
    2.5,
  );
  expect(insideSamples?.insideBlack).toBeGreaterThan(0);
  expect(insideSamples?.outsideBlack, JSON.stringify(insideSamples)).toBe(0);

  await position.click();
  await page.getByRole("option", { name: "Outside" }).click();
  await expect
    .poll(async () => (await vectorPaint(page))?.strokePosition)
    .toBe("outside");
  paint = (await vectorPaint(page))!;
  expect(paint.renderedStrokeWidth).toBe("2px");
  expect(paint.strokeMask).not.toBe("none");
  expect(paint.strokeOverlayCount).toBe(1);
  expect(paint.strokeDefsCount).toBe(1);
  const outsideSamples = await vectorStrokeEdgeSamples(
    page,
    undefined,
    2.5,
    0.5,
  );
  expect(outsideSamples?.insideBlack, JSON.stringify(outsideSamples)).toBe(0);
  expect(
    outsideSamples?.outsideBlack,
    JSON.stringify(outsideSamples),
  ).toBeGreaterThan(0);

  await position.click();
  await page.getByRole("option", { name: "Center" }).click();
  await expect
    .poll(async () => (await vectorPaint(page))?.strokePosition)
    .toBe("center");
  paint = (await vectorPaint(page))!;
  expect(paint.renderedStrokeWidth).toBe("1px");
  expect(paint.strokeClipPath).toBe("none");
  expect(paint.strokeMask).toBe("none");
  expect(paint.strokeOverlayCount).toBe(1);
  expect(paint.strokeDefsCount).toBe(1);
  const centerSamples = await vectorStrokeEdgeSamples(page, undefined, 0.25);
  expect(
    (centerSamples?.insideBlack ?? 0) + (centerSamples?.outsideBlack ?? 0),
  ).toBeGreaterThan(0);
});

test("outside vector strokes clear the SVG viewport and restore overflow", async ({
  app,
  page,
}) => {
  const designId = await createDesign(app, EDGE_SCREEN_HTML);
  await page.goto(appPath(`/design/${designId}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  const vector = page
    .frameLocator("iframe[data-screen-iframe-id]")
    .locator('svg[data-agent-native-node-id="edge-path"]');
  await expect(vector).toBeVisible({ timeout: 40_000 });
  await page.keyboard.press("v");
  const bounds = (await vector.boundingBox())!;
  await page.mouse.click(bounds.x + 50, bounds.y + 50);
  const strokeSection = inspectorSection(page, /^Stroke$/i);
  await addStrokeButton(strokeSection).click();
  const position = strokeSection.getByRole("combobox", {
    name: "Position",
  });
  await expect(position).toHaveAccessibleName("Position");
  await position.click();
  await page.getByRole("option", { name: "Outside" }).click();

  await expect
    .poll(async () => (await vectorPaint(page))?.strokePosition)
    .toBe("outside");
  const paint = (await vectorPaint(page))!;
  expect(paint.wrapperOverflow).toBe("visible");
  expect(paint.wrapperOverflowValue).toBe("visible");
  expect(paint.wrapperOverflowPriority).toBe("important");
  expect(paint.originalOverflow).toBe("hidden");
  const initialMaskWidth = Number(paint.outsideMaskWidth);
  await page.evaluate(() => {
    document
      .querySelector<HTMLIFrameElement>("iframe[data-screen-iframe-id]")
      ?.contentDocument?.querySelector(
        '[data-agent-native-edit-overlay="selection"]',
      )
      ?.remove();
  });
  const edgeSamples = await vectorStrokeEdgeSamples(page, [0.125], 0.75);
  expect(
    edgeSamples?.outsideBlack,
    JSON.stringify(edgeSamples),
  ).toBeGreaterThan(0);

  const weight = strokeSection.getByRole("textbox", { name: "Weight" });
  await weight.fill("6");
  await weight.press("Enter");
  await expect
    .poll(async () => {
      const updated = await vectorPaint(page);
      return {
        logicalWidth: updated?.shapeStrokeWidth,
        renderedWidth: updated?.renderedStrokeWidth,
      };
    })
    .toEqual({ logicalWidth: "6px", renderedWidth: "12px" });
  expect(Number((await vectorPaint(page))?.outsideMaskWidth)).toBeGreaterThan(
    initialMaskWidth,
  );

  await position.click();
  await page.getByRole("option", { name: "Center" }).click();
  await expect
    .poll(async () => (await vectorPaint(page))?.strokePosition)
    .toBe("center");
  const centered = (await vectorPaint(page))!;
  expect(centered.wrapperOverflow).toBe("hidden");
  expect(centered.wrapperOverflowValue).toBe("hidden");
  expect(centered.wrapperOverflowPriority).toBe("");
  expect(centered.originalOverflow).toBeNull();
  await app.settled();
  const savedEdge = (await app.savedNodes(designId)).get("edge-path")!;
  expect(styleOf(savedEdge).overflow).toBe("hidden");
  expect(
    savedEdge.attrs["data-an-vector-stroke-original-overflow"],
  ).toBeUndefined();
  expect(savedEdge.attrs["data-an-vector-stroke-position"]).toBe("center");
  const savedOverlayWidth = await page.evaluate(
    (source) =>
      new DOMParser()
        .parseFromString(source, "text/html")
        .querySelector(
          '[data-agent-native-node-id="edge-path"] > use[data-an-vector-stroke-overlay]',
        )
        ?.getAttribute("data-an-vector-logical-width"),
    await app.savedHtml(designId),
  );
  expect(
    savedOverlayWidth,
    "the 6px weight is saved on the stroke overlay",
  ).toBe("6px");
});

test("closed SVG shapes enable Position while open vectors keep it disabled", async ({
  app,
  page,
}) => {
  const designId = await createDesign(app, SVG_WRAPPER_SCREEN_HTML);
  await page.goto(appPath(`/design/${designId}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  const frame = page.frameLocator("iframe[data-screen-iframe-id]");
  const cases = [
    {
      id: "svg-rect",
      position: true,
      attrs: { x: "5", y: "7", width: "90", height: "86", rx: "8", ry: "10" },
    },
    {
      id: "svg-ellipse",
      position: true,
      attrs: { cx: "50", cy: "50", r: "38" },
    },
    {
      id: "svg-circle",
      position: true,
      attrs: { cx: "50", cy: "50", rx: "45", ry: "45" },
    },
    {
      id: "svg-polygon",
      position: true,
      attrs: { d: "M 50 5 L 95 95 L 5 95 Z" },
      opacity: "0.5",
    },
    { id: "svg-polygon-open-path", position: false, attrs: {} },
    { id: "svg-line", position: false, attrs: {} },
    { id: "svg-arrow", position: false, attrs: {} },
  ] as const;

  for (const item of cases) {
    const vector = frame.locator(`svg[data-agent-native-node-id="${item.id}"]`);
    await expect(vector).toBeVisible({ timeout: 40_000 });
    const bounds = (await vector.boundingBox())!;
    await page.mouse.click(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    const strokeSection = inspectorSection(page, /^Stroke$/i);
    const addStroke = addStrokeButton(strokeSection);
    await expect(addStroke).toBeVisible();
    await addStroke.click();
    const position = strokeSection.getByRole("combobox", {
      name: "Position",
    });
    if (!item.position) {
      await expect(position).toBeVisible();
      await expect(position).toBeDisabled();
      continue;
    }

    await expect(position).toBeVisible();
    await expect(position).toBeEnabled();
    await position.click();
    await page.getByRole("option", { name: "Outside" }).click();
    await expect
      .poll(() => vector.getAttribute("data-an-vector-stroke-position"))
      .toBe("outside");
    const geometryAttributes = await vector.evaluate((svg) => {
      const geometry = svg.querySelector("[data-an-vector-stroke-geometry]");
      return Object.fromEntries(
        Array.from(geometry?.attributes ?? []).map(({ name, value }) => [
          name,
          value,
        ]),
      );
    });
    for (const [name, value] of Object.entries(item.attrs)) {
      expect(geometryAttributes[name]).toBe(value);
    }
    await expect
      .poll(() =>
        vector.locator(":scope > use[data-an-vector-stroke-overlay]").count(),
      )
      .toBe(1);
    if ("opacity" in item) {
      const overlay = vector.locator(
        ":scope > use[data-an-vector-stroke-overlay]",
      );
      await expect(overlay).toHaveAttribute("style", /opacity: 0.5/);
      await position.click();
      await page.getByRole("option", { name: "Center" }).click();
      await expect
        .poll(() => vector.getAttribute("data-an-vector-stroke-position"))
        .toBe("center");
      await expect(overlay).toHaveAttribute("style", /opacity: 0.5/);
    }
  }
});
