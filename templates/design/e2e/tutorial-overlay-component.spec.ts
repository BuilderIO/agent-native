import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath, cdpScreenshot, expandAllLayers } from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const SCREEN_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Play control</title></head>
  <body style="margin:0;min-height:600px">
    <main data-agent-native-node-id="main" style="position:relative;min-height:600px"></main>
  </body>
</html>`;

let baseURL = "";

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(request: APIRequestContext) {
  const created = await action(request, "create-design", {
    title: `Overlay component tutorial ${Date.now()}`,
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
        value: { sourceType: "inline", width: 800, height: 600 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: 0, y: 0, width: 800, height: 600, z: 0 },
      },
    ],
  });
  return designId;
}

async function indexHtml(request: APIRequestContext, designId: string) {
  const response = await request.get(
    `${baseURL}/_agent-native/actions/get-design?id=${designId}`,
  );
  if (!response.ok()) {
    throw new Error(
      `get-design: ${response.status()} ${await response.text()}`,
    );
  }
  const design = await response.json();
  return (design.files?.find(
    (file: { filename?: string }) => file.filename === "index.html",
  )?.content ?? "") as string;
}

function layerRow(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .getByRole("treeitem")
    .filter({ hasText: name })
    .first();
}

function inspectorSection(page: Page, title: RegExp) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: title }) })
    .first();
}

async function setFillColor(page: Page, layerName: string, hex: string) {
  await layerRow(page, layerName).click();
  const fill = inspectorSection(page, /^Fill$/i);
  await expect(fill).toBeVisible();
  let swatch = fill.getByRole("button", { name: "Open color picker" });
  // A closed pen path starts stroke-only, like Figma. Add fill on a vector
  // element (fill-properties.tsx addFill()'s isVectorFillElement branch)
  // commits the default shape fill directly and does not open the picker,
  // so open the swatch it creates afterward instead of assuming a popover.
  // An empty Fill section also renders "Add fill" twice — the header's own
  // click-to-add title and the action-rail "+" icon — so scope to the
  // action rail (present in every state) instead of the ambiguous name.
  if ((await swatch.count()) === 0) {
    await fill
      .locator("[data-inspector-action-rail]")
      .getByRole("button", { name: "Add fill" })
      .click();
    swatch = fill.getByRole("button", { name: "Open color picker" });
    await expect(swatch).toBeVisible();
  }
  await swatch.click();
  const input = page.getByRole("textbox", { name: "Hex", exact: true });
  await expect(input).toBeVisible();
  await input.fill(hex);
  await input.press("Enter");
}

async function draw(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

async function sourceIdentity(page: Page, html: string) {
  return page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "text/html");
    const component = doc.querySelector<HTMLElement>(
      "[data-agent-native-component]",
    );
    if (!component) return null;
    const ids = Array.from(
      doc.querySelectorAll<HTMLElement>("[data-agent-native-node-id]"),
    )
      .map((node) => node.dataset.agentNativeNodeId ?? "")
      .filter(Boolean);
    const childIds = Array.from(
      component.querySelectorAll<HTMLElement>("[data-agent-native-node-id]"),
    )
      .map((node) => node.dataset.agentNativeNodeId ?? "")
      .filter(Boolean);
    return {
      componentId: component.dataset.agentNativeNodeId ?? "",
      componentName: component.dataset.agentNativeComponent ?? "",
      childIds,
      childLayerNames: Array.from(
        component.querySelectorAll<HTMLElement>(
          "[data-agent-native-layer-name]",
        ),
      ).map((node) => node.dataset.agentNativeLayerName ?? ""),
      allIdsUnique: new Set(ids).size === ids.length,
    };
  }, html);
}

async function sourceLayers(page: Page, html: string) {
  return page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "text/html");
    return Array.from(
      doc.querySelectorAll<HTMLElement>("[data-agent-native-layer-name]"),
    ).map((node) => ({
      id: node.dataset.agentNativeNodeId ?? "",
      name: node.dataset.agentNativeLayerName ?? "",
      rect: {
        x: Number.parseFloat(node.style.left) || 0,
        y: Number.parseFloat(node.style.top) || 0,
        width: Number.parseFloat(node.style.width) || 0,
        height: Number.parseFloat(node.style.height) || 0,
      },
    }));
  }, html);
}

test.beforeAll(async ({}, testInfo) => {
  baseURL =
    (testInfo.project.use as { baseURL?: string }).baseURL ??
    process.env.E2E_BASE_URL ??
    e2eBaseURL();
});

test.use({ viewport: { width: 1600, height: 1000 } });

test("draws an overlaid play triangle and converts the grouped layers to a component", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await page.goto(appPath(`/design/${designId}?view=overview`), {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(async () => page.locator("[data-screen-card]").count(), {
        timeout: 40_000,
      })
      .toBeGreaterThan(0);
    await expect(
      page.locator('[data-design-bottom-toolbar] button[aria-label="Move"]'),
    ).toBeVisible({ timeout: 30_000 });
    const screen = (await page
      .locator("[data-screen-card]")
      .first()
      .boundingBox())!;

    // Use the Shape menu and drag on the screen to create the circle behind the icon.
    const toolbar = page.locator("[data-design-bottom-toolbar]");
    await toolbar.getByRole("button", { name: "Rectangle options" }).click();
    await page.getByRole("menuitem", { name: "Ellipse" }).click();
    const readDrawnLayers = async () =>
      sourceLayers(page, await indexHtml(request, designId));
    await draw(
      page,
      { x: screen.x + 70, y: screen.y + 210 },
      { x: screen.x + 150, y: screen.y + 290 },
    );
    await expect
      .poll(async () => (await readDrawnLayers()).map((layer) => layer.name), {
        timeout: 20_000,
      })
      .toContain("Ellipse");

    // Pen clicks close a filled triangle that visually overlaps the ellipse.
    await page.keyboard.press("p");
    await page.waitForTimeout(300);
    const points = [
      { x: screen.x + 98, y: screen.y + 226 },
      { x: screen.x + 132, y: screen.y + 250 },
      { x: screen.x + 98, y: screen.y + 274 },
      { x: screen.x + 98, y: screen.y + 226 },
    ];
    for (const point of points) {
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(250);
    }
    await expect
      .poll(async () => (await readDrawnLayers()).map((layer) => layer.name))
      .toEqual(expect.arrayContaining(["Ellipse", "Vector"]));
    const drawnLayers = await readDrawnLayers();
    const ellipse = drawnLayers.find((layer) => layer.name === "Ellipse")!;
    const vector = drawnLayers.find((layer) => layer.name === "Vector")!;
    expect(ellipse.id).toBeTruthy();
    expect(vector.id).toBeTruthy();
    expect(ellipse.id).not.toBe(vector.id);
    expect(
      Math.min(
        ellipse.rect.x + ellipse.rect.width,
        vector.rect.x + vector.rect.width,
      ),
    ).toBeGreaterThan(Math.max(ellipse.rect.x, vector.rect.x));
    expect(
      Math.min(
        ellipse.rect.y + ellipse.rect.height,
        vector.rect.y + vector.rect.height,
      ),
    ).toBeGreaterThan(Math.max(ellipse.rect.y, vector.rect.y));

    await expandAllLayers(page);
    await expect(layerRow(page, "Ellipse")).toBeVisible();
    await expect(layerRow(page, "Vector")).toBeVisible();
    await setFillColor(page, "Ellipse", "2563EB");
    await setFillColor(page, "Vector", "FFFFFF");
    await layerRow(page, "Ellipse").click();
    await layerRow(page, "Vector").click({ modifiers: ["Shift"] });
    await expect
      .poll(() =>
        page.locator('[role="treeitem"][aria-selected="true"]').count(),
      )
      .toBe(2);

    // Group and promote through the same keyboard path users invoke in Design.
    await page.keyboard.press(`${MOD}+g`);
    await expect(layerRow(page, "Group")).toBeVisible({ timeout: 15_000 });
    await layerRow(page, "Group").click();

    const readGroupId = async () => {
      const groupSource = await indexHtml(request, designId);
      return page.evaluate((source) => {
        const doc = new DOMParser().parseFromString(source, "text/html");
        return doc.querySelector<HTMLElement>(
          '[data-agent-native-layer-name="Group"]',
        )?.dataset.agentNativeNodeId;
      }, groupSource);
    };
    await expect.poll(readGroupId, { timeout: 15_000 }).toBeTruthy();
    const groupId = await readGroupId();

    // Use the Figma component shortcut from the selected Layers row. Keyboard
    // focus stays on the host editor, matching the documented interaction.
    await page.keyboard.press(`${MOD}+Alt+k`);
    await expect(
      page.getByRole("dialog", { name: "Type a command or ask AI..." }),
    ).toHaveCount(0);

    await expect
      .poll(
        async () => sourceIdentity(page, await indexHtml(request, designId)),
        {
          timeout: 20_000,
        },
      )
      .toMatchObject({
        componentName: "Group",
        childLayerNames: expect.arrayContaining(["Ellipse", "Vector"]),
        childIds: expect.arrayContaining([
          expect.any(String),
          expect.any(String),
        ]),
        allIdsUnique: true,
      });

    const beforeReload = await sourceIdentity(
      page,
      await indexHtml(request, designId),
    );
    expect(beforeReload?.componentId).toBeTruthy();
    expect(beforeReload?.componentId).toBe(groupId);
    expect(beforeReload?.childLayerNames).toEqual(
      expect.arrayContaining(["Ellipse", "Vector"]),
    );
    await cdpScreenshot(
      page,
      test.info().outputPath("overlay-component-ui-proof.png"),
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.locator('[data-design-bottom-toolbar] button[aria-label="Move"]'),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () =>
        sourceIdentity(page, await indexHtml(request, designId)),
      )
      .toEqual(beforeReload);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
