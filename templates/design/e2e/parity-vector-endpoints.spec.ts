import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { appPath, designFrame, expandAllLayers, gotoEditor } from "./helpers";

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

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    appPath(`/_agent-native/actions/${name}`),
    {
      data: input,
    },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(request: APIRequestContext) {
  const created = await action(request, "create-design", {
    title: `Vector endpoints ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const file = await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: SCREEN_HTML,
    fileType: "html",
  });
  const fileId = file.id ?? file.data?.id;
  if (!fileId) throw new Error("create-file returned no id");
  await action(request, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: { sourceType: "inline", width: 820, height: 600 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 0, y: 0, width: 820, height: 600, z: 0 },
      },
    ],
  });
  return { designId: String(designId), fileId: String(fileId) };
}

async function readDesign(request: APIRequestContext, designId: string) {
  const response = await request.get(
    appPath(
      `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    ),
  );
  if (!response.ok()) {
    throw new Error(
      `get-design: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function source(
  request: APIRequestContext,
  designId: string,
  fileId: string,
): Promise<string> {
  const design = await readDesign(request, designId);
  const content = design.files?.find(
    (file: { id?: string }) => String(file.id) === fileId,
  )?.content;
  if (typeof content !== "string") {
    throw new Error(`index.html content missing for ${designId}`);
  }
  return content;
}

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

test("vector endpoint controls cover all styles, swap, paint inheritance, history, and reload", async ({
  page,
  request,
}) => {
  const { designId, fileId } = await createDesign(request);
  try {
    await gotoEditor(page, designId);
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
            shape.fill === "context-stroke" ||
            shape.stroke === "context-stroke",
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
      .poll(async () => source(request, designId, fileId), {
        timeout: 15_000,
        intervals: [250, 500, 1_000],
      })
      .toMatch(
        /--an-vector-start-point:\s*reversed-triangle[\s\S]*--an-vector-end-point:\s*reversed-triangle/,
      );
    const persistedReversed = await source(request, designId, fileId);
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
      .poll(async () => source(request, designId, fileId), {
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
      .poll(async () => source(request, designId, fileId), {
        timeout: 15_000,
        intervals: [250, 500, 1_000],
      })
      .toMatch(/stroke-width:\s*6px/);
    await persistedSource;
    const persisted = await source(request, designId, fileId);
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
    const removedSource = await source(request, designId, fileId);
    expect(removedSource).toMatch(/--an-vector-end-point:\s*none/);
    expect(removedSource).not.toContain(expectedUrl("endpoint-line", "end"));
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("duplicating an arrow keeps endpoint marker references unique", async ({
  page,
  request,
}) => {
  const { designId } = await createDesign(request);
  try {
    await gotoEditor(page, designId);
    await selectVector(page, "endpoint-arrow");
    await chooseEndpoint(page, "Start", "Circle arrow");
    await chooseEndpoint(page, "End", "Diamond arrow");
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+D" : "Control+D",
    );

    await expect
      .poll(
        async () => {
          const html = await source(
            request,
            designId,
            (await readDesign(request, designId)).files?.find(
              (file: { filename?: string }) => file.filename === "index.html",
            )?.id,
          );
          return (html.match(/data-an-primitive="arrow"/g) ?? []).length;
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThanOrEqual(2);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
