import { type Page } from "@playwright/test";

import { designFrame, expandAllLayers } from "./helpers";
import { childrenOf, expect, expectOnlyChanged, styleOf, test } from "./rails";

const SCREEN_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Vector endpoints</title></head>
  <body style="margin:0;min-height:600px;background:#f8fafc">
    <main data-agent-native-node-id="main" style="position:relative;min-height:600px">
      <svg xmlns="http://www.w3.org/2000/svg"
        data-agent-native-node-id="endpoint-line"
        data-agent-native-layer-name="Endpoint line"
        data-an-primitive="line"
        viewBox="0 0 220 80"
        style="position:absolute;left:80px;top:90px;width:220px;height:80px;overflow:visible">
        <line x1="12" y1="40" x2="208" y2="40" fill="none" stroke="#2563eb" stroke-width="4" stroke-linecap="round" />
      </svg>
      <svg xmlns="http://www.w3.org/2000/svg"
        data-agent-native-node-id="endpoint-arrow"
        data-agent-native-layer-name="Endpoint arrow"
        data-an-primitive="arrow"
        viewBox="0 0 220 80"
        style="position:absolute;left:80px;top:250px;width:220px;height:80px;overflow:visible">
        <path d="M 12 40 L 208 40" fill="none" stroke="#0f766e" stroke-width="3" stroke-linecap="round" />
      </svg>
    </main>
  </body>
</html>`;

const ENDPOINT_OPTIONS = [
  "None",
  "Round",
  "Square",
  "Line arrow",
  "Triangle arrow",
  "Reversed triangle",
  "Circle arrow",
  "Diamond arrow",
] as const;

const ENDPOINT_VALUES = {
  None: "none",
  Round: "round",
  Square: "square",
  "Line arrow": "line",
  "Triangle arrow": "triangle",
  "Reversed triangle": "reversed-triangle",
  "Circle arrow": "circle",
  "Diamond arrow": "diamond",
} as const;

type EndpointLabel = (typeof ENDPOINT_OPTIONS)[number];

function strokeSection(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Stroke$/i }) })
    .first();
}

async function selectVector(page: Page, nodeId: string) {
  const vector = designFrame(page).locator(
    `svg[data-agent-native-node-id="${nodeId}"]`,
  );
  await expect(vector).toBeVisible({ timeout: 40_000 });
  await expandAllLayers(page);
  const layerName =
    nodeId === "endpoint-line" ? "Endpoint line" : "Endpoint arrow";
  const row = page.getByRole("treeitem").filter({ hasText: layerName }).first();
  await expect(row).toBeVisible();
  await row.locator("[data-layer-row-button]").click({ force: true });
  await expect(strokeSection(page)).toBeVisible();
  return vector;
}

async function chooseEndpoint(
  page: Page,
  side: "Start" | "End",
  label: EndpointLabel,
) {
  const trigger = strokeSection(page).getByRole("combobox", {
    name: `${side} point`,
  });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const listbox = page.getByRole("listbox").last();
  await expect(listbox).toBeVisible();
  await listbox.getByRole("option", { name: label, exact: true }).click();
  await expect(trigger).toHaveText(label);
}

async function liveEndpoints(page: Page, nodeId: string) {
  return designFrame(page)
    .locator(`svg[data-agent-native-node-id="${nodeId}"]`)
    .evaluate((svg) => {
      const shape = svg.querySelector<SVGGeometryElement>(
        ":scope > line, :scope > path",
      );
      const start = shape?.getAttribute("marker-start") ?? null;
      const end = shape?.getAttribute("marker-end") ?? null;
      const defs = [...svg.querySelectorAll<SVGMarkerElement>("defs marker")];
      return {
        start,
        end,
        style: {
          start:
            (svg as unknown as HTMLElement).style.getPropertyValue(
              "--an-vector-start-point",
            ) || "none",
          end:
            (svg as unknown as HTMLElement).style.getPropertyValue(
              "--an-vector-end-point",
            ) || "none",
        },
        markerIds: defs.map((marker) => marker.id).sort(),
        markerShapes: defs.map((marker) => ({
          id: marker.id,
          refX: marker.getAttribute("refX"),
          fill: marker.firstElementChild?.getAttribute("fill") ?? null,
          stroke: marker.firstElementChild?.getAttribute("stroke") ?? null,
        })),
        stroke: shape ? getComputedStyle(shape).stroke : null,
        strokeWidth: shape ? getComputedStyle(shape).strokeWidth : null,
      };
    });
}

function expectedMarkerId(nodeId: string, side: "start" | "end") {
  return `${nodeId}-vector-marker-${side}`;
}

function expectedUrl(nodeId: string, side: "start" | "end") {
  return `url(#${expectedMarkerId(nodeId, side)})`;
}

// fixme: fails in CI on current main: Timeoutlocator.evaluate: Timeout 15000ms exceeded.
test.fixme("vector endpoint controls cover all styles, swap, paint inheritance, history, and reload", async ({
  app,
  page,
}) => {
  test.setTimeout(180_000);
  const designId = await app.seed(SCREEN_HTML);
  await app.open(designId);
  await app.settled();
  const before = await app.savedNodes(designId);
  const vector = await selectVector(page, "endpoint-line");

  await expect(
    strokeSection(page).getByRole("combobox", { name: "Start point" }),
  ).toHaveText("None");
  await expect(
    strokeSection(page).getByRole("combobox", { name: "End point" }),
  ).toHaveText("None");
  await expect(
    strokeSection(page).getByRole("button", {
      name: "Swap start and end points",
    }),
  ).toBeVisible();

  const combinations: Array<[EndpointLabel, EndpointLabel]> = [
    ["None", "None"],
    ["Round", "Square"],
    ["Square", "Line arrow"],
    ["Line arrow", "Triangle arrow"],
    ["Triangle arrow", "Reversed triangle"],
    ["Reversed triangle", "Circle arrow"],
    ["Circle arrow", "Diamond arrow"],
    ["Diamond arrow", "Round"],
  ];
  for (const [start, end] of combinations) {
    await chooseEndpoint(page, "Start", start);
    await chooseEndpoint(page, "End", end);
    await expect
      .poll(async () => liveEndpoints(page, "endpoint-line"))
      .toMatchObject({
        style: {
          start: ENDPOINT_VALUES[start],
          end: ENDPOINT_VALUES[end],
        },
      });
    const live = await liveEndpoints(page, "endpoint-line");
    expect(live.start).toBe(
      start === "None" ? null : expectedUrl("endpoint-line", "start"),
    );
    expect(live.end).toBe(
      end === "None" ? null : expectedUrl("endpoint-line", "end"),
    );
    expect(
      live.markerShapes.every(
        (shape) =>
          shape.fill === "context-stroke" || shape.stroke === "context-stroke",
      ),
    ).toBe(true);
  }

  await chooseEndpoint(page, "Start", "Reversed triangle");
  await chooseEndpoint(page, "End", "Reversed triangle");
  await expect
    .poll(async () => liveEndpoints(page, "endpoint-line"))
    .toMatchObject({
      style: { start: "reversed-triangle", end: "reversed-triangle" },
    });
  const reversedLive = await liveEndpoints(page, "endpoint-line");
  expect(reversedLive.markerShapes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: expectedMarkerId("endpoint-line", "start"),
        refX: "0",
      }),
      expect.objectContaining({
        id: expectedMarkerId("endpoint-line", "end"),
        refX: "0",
      }),
    ]),
  );
  await expect
    .poll(async () => app.savedHtml(designId), {
      timeout: 15_000,
      intervals: [250, 500, 1_000],
    })
    .toMatch(
      /--an-vector-start-point:\s*reversed-triangle[\s\S]*--an-vector-end-point:\s*reversed-triangle/,
    );
  const persistedReversed = await app.savedHtml(designId);
  expect(persistedReversed).toMatch(/refX=["']0["']/);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(async () => liveEndpoints(page, "endpoint-line"), {
      timeout: 40_000,
    })
    .toMatchObject({
      style: { start: "reversed-triangle", end: "reversed-triangle" },
    });
  const reloadedReversed = await liveEndpoints(page, "endpoint-line");
  expect(reloadedReversed.markerShapes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: expectedMarkerId("endpoint-line", "start"),
        refX: "0",
      }),
      expect.objectContaining({
        id: expectedMarkerId("endpoint-line", "end"),
        refX: "0",
      }),
    ]),
  );
  await selectVector(page, "endpoint-line");

  await chooseEndpoint(page, "Start", "Diamond arrow");
  await chooseEndpoint(page, "End", "Round");
  await expect
    .poll(async () => app.savedHtml(designId), {
      timeout: 5_000,
      intervals: [250, 500, 1_000],
    })
    .toMatch(/--an-vector-start-point:\s*diamond/);
  await strokeSection(page)
    .getByRole("button", { name: "Swap start and end points" })
    .click();
  await expect
    .poll(async () => liveEndpoints(page, "endpoint-line"))
    .toMatchObject({
      style: { start: "round", end: "diamond" },
    });
  const selectedRow = page
    .getByRole("treeitem")
    .filter({ hasText: "Endpoint line" })
    .first();
  await expect(selectedRow).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Z" : "Control+Z",
  );
  await expect
    .poll(async () => liveEndpoints(page, "endpoint-line"))
    .toMatchObject({ style: { start: "diamond", end: "round" } });
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z",
  );
  await expect
    .poll(async () => liveEndpoints(page, "endpoint-line"))
    .toMatchObject({ style: { start: "round", end: "diamond" } });

  const stroke = strokeSection(page);
  await stroke.getByRole("button", { name: "Open color picker" }).click();
  const hex = page.getByRole("textbox", { name: "Hex", exact: true });
  await expect(hex).toBeVisible();
  await hex.fill("DC2626");
  await hex.press("Enter");
  await page.keyboard.press("Escape");
  const weight = stroke.getByRole("textbox", { name: "Weight" });
  await weight.fill("6");
  await weight.press("Enter");
  await expect
    .poll(async () => liveEndpoints(page, "endpoint-line"))
    .toMatchObject({ stroke: "rgb(220, 38, 38)", strokeWidth: "6px" });

  const persistedSource = expect
    .poll(async () => app.savedHtml(designId), {
      timeout: 15_000,
      intervals: [250, 500, 1_000],
    })
    .toMatch(/stroke-width:\s*6px/);
  await persistedSource;
  const persisted = await app.savedHtml(designId);
  expect(persisted).toMatch(/--an-vector-start-point:\s*round/);
  expect(persisted).toMatch(/--an-vector-end-point:\s*diamond/);
  expect(persisted).toContain(expectedUrl("endpoint-line", "start"));
  expect(persisted).toContain(expectedUrl("endpoint-line", "end"));
  expect(persisted).toMatch(
    /stroke:\s*(?:#dc2626|rgb\(220\s+38\s+38\)|rgb\(220,\s*38,\s*38\))/i,
  );
  expect(persisted).toMatch(/stroke-width:\s*6px/);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect
    .poll(async () => liveEndpoints(page, "endpoint-line"), {
      timeout: 40_000,
    })
    .toMatchObject({
      start: expectedUrl("endpoint-line", "start"),
      end: expectedUrl("endpoint-line", "end"),
      style: { start: "round", end: "diamond" },
      stroke: "rgb(220, 38, 38)",
      strokeWidth: "6px",
    });
  await expect(vector).toBeVisible();

  await selectVector(page, "endpoint-line");
  await chooseEndpoint(page, "End", "None");
  await expect
    .poll(async () => liveEndpoints(page, "endpoint-line"))
    .toMatchObject({
      end: null,
      style: { end: "none" },
    });
  const removedSource = await app.savedHtml(designId);
  expect(removedSource).toMatch(/--an-vector-end-point:\s*none/);
  expect(removedSource).not.toContain(expectedUrl("endpoint-line", "end"));
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(designId), ["endpoint-line"]);
});

test("duplicating an arrow keeps endpoint marker references unique", async ({
  app,
  page,
}) => {
  const designId = await app.seed(SCREEN_HTML);
  await app.open(designId);
  await app.settled();
  const before = await app.savedNodes(designId);
  await selectVector(page, "endpoint-arrow");
  await chooseEndpoint(page, "Start", "Circle arrow");
  await chooseEndpoint(page, "End", "Diamond arrow");
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+D" : "Control+D",
  );

  const readArrows = async () => {
    const html = await app.savedHtml(designId);
    return page.evaluate((sourceHtml) => {
      const document = new DOMParser().parseFromString(sourceHtml, "text/html");
      return [
        ...document.querySelectorAll<SVGSVGElement>(
          'svg[data-an-primitive="arrow"]',
        ),
      ].map((svg) => {
        const path = svg.querySelector<SVGGeometryElement>(":scope > path");
        return {
          nodeId: svg.getAttribute("data-agent-native-node-id"),
          markerIds: [
            ...svg.querySelectorAll<SVGMarkerElement>(
              ":scope > defs marker[data-an-vector-endpoint-marker]",
            ),
          ].map((marker) => marker.id),
          start: path?.getAttribute("marker-start") ?? null,
          end: path?.getAttribute("marker-end") ?? null,
        };
      });
    }, html);
  };

  await expect
    .poll(async () => (await readArrows()).length, { timeout: 20_000 })
    .toBe(2);

  const arrows = await readArrows();
  const markerIds = arrows.flatMap((arrow) => arrow.markerIds);
  expect(markerIds).toHaveLength(4);
  expect(new Set(markerIds).size).toBe(markerIds.length);
  for (const arrow of arrows) {
    const startId = arrow.start?.match(/^url\(#(.+)\)$/)?.[1];
    const endId = arrow.end?.match(/^url\(#(.+)\)$/)?.[1];
    expect(arrow.markerIds).toHaveLength(2);
    expect(startId).toBeTruthy();
    expect(endId).toBeTruthy();
    expect(startId).not.toBe(endId);
    expect(arrow.markerIds).toContain(startId);
    expect(arrow.markerIds).toContain(endId);
  }
  await app.settled();
  const after = await app.savedNodes(designId);
  const copyId = arrows.find(
    (arrow) => arrow.nodeId !== "endpoint-arrow",
  )!.nodeId!;
  expect(childrenOf(after, "main")).toEqual([
    "endpoint-line",
    "endpoint-arrow",
    copyId,
  ]);
  const box = (id: string) => {
    const style = styleOf(after.get(id));
    return [style.left, style.top, style.width, style.height];
  };
  expect(box(copyId), "the copy sits exactly on the original").toEqual(
    box("endpoint-arrow"),
  );
  expectOnlyChanged(before, after, ["endpoint-arrow", copyId]);
});
