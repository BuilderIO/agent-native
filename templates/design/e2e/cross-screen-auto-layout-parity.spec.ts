import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { designFrame, gotoEditor } from "./helpers";

const PRIMARY = process.platform === "darwin" ? "Meta" : "Control";

const SOURCE_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Auto layout source</title></head>
  <body style="margin:0;position:relative;min-height:900px;width:900px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <section data-agent-native-node-id="source-flow" data-agent-native-layer-name="Source Flow"
      style="position:absolute;left:80px;top:100px;width:360px;min-height:180px;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:16px;background:#1f2937">
      <div data-agent-native-node-id="screen-source" data-agent-native-layer-name="Screen Source"
        style="box-sizing:border-box;flex:0 0 56px;width:180px;height:56px;background:#38bdf8;color:#082f49">Source</div>
      <div data-agent-native-node-id="source-anchor" data-agent-native-layer-name="Source Anchor"
        style="box-sizing:border-box;flex:0 0 48px;width:180px;height:48px;background:#64748b;color:#f8fafc">Anchor</div>
    </section>
  </body>
</html>`;

const DESTINATION_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Auto layout destination</title></head>
  <body style="margin:0;position:relative;min-height:900px;width:900px;background:#111827;color:#fff;font-family:system-ui,sans-serif">
    <section data-agent-native-node-id="destination-flow" data-agent-native-layer-name="Destination Flow"
      style="position:absolute;left:80px;top:100px;width:360px;min-height:180px;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:16px;background:#334155">
      <div data-agent-native-node-id="destination-anchor" data-agent-native-layer-name="Destination Anchor"
        style="box-sizing:border-box;flex:0 0 56px;width:180px;height:56px;background:#94a3b8;color:#0f172a">Anchor</div>
    </section>
  </body>
</html>`;

type DesignFile = { filename: string; id: string; content: string };

let baseURL = "";

async function action(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function files(page: Page, designId: string): Promise<DesignFile[]> {
  const response = await page.request.get(
    `${baseURL}/_agent-native/actions/get-design?id=${designId}`,
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  const record = await response.json();
  return (record.files ?? []) as DesignFile[];
}

async function createDesign(page: Page): Promise<{
  id: string;
  sourceId: string;
  destinationId: string;
}> {
  const created = await action(page, "create-design", {
    title: "cross-screen auto-layout parity",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (typeof id !== "string") throw new Error("create-design returned no id");
  await action(page, "create-file", {
    designId: id,
    filename: "index.html",
    content: SOURCE_SCREEN,
    fileType: "html",
  });
  await action(page, "create-file", {
    designId: id,
    filename: "destination.html",
    content: DESTINATION_SCREEN,
    fileType: "html",
  });
  const createdFiles = await files(page, id);
  const sourceId = createdFiles.find(
    (file) => file.filename === "index.html",
  )?.id;
  const destinationId = createdFiles.find(
    (file) => file.filename === "destination.html",
  )?.id;
  if (!sourceId || !destinationId) throw new Error("created screens missing");
  await action(page, "update-design", {
    id,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", sourceId],
        value: { sourceType: "inline", width: 900, height: 900 },
      },
      {
        op: "set",
        path: ["canvasFrames", sourceId],
        value: { x: 0, y: 0, width: 900, height: 900, z: 0 },
      },
      {
        op: "set",
        path: ["screenMetadata", destinationId],
        value: { sourceType: "inline", width: 900, height: 900 },
      },
      {
        op: "set",
        path: ["canvasFrames", destinationId],
        value: { x: 1040, y: 0, width: 900, height: 900, z: 1 },
      },
    ],
  });
  return { id, sourceId, destinationId };
}

async function deleteDesign(page: Page, designId: string): Promise<void> {
  await action(page, "delete-design", { id: designId }).catch(() => {});
}

async function fileContent(
  page: Page,
  designId: string,
  filename: string,
): Promise<string> {
  return (
    (await files(page, designId)).find((file) => file.filename === filename)
      ?.content ?? ""
  );
}

async function boxFor(page: Page, screenId: string, nodeId: string) {
  const box = await designFrame(page, screenId)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .boundingBox();
  if (!box) throw new Error(`missing ${nodeId} on ${screenId}`);
  return box;
}

async function probeNode(page: Page, screenId: string, nodeId: string) {
  return designFrame(page, screenId)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return {
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        hit: hit?.getAttribute("data-agent-native-node-id") ?? hit?.tagName,
      };
    });
}

async function emptyBoardPoint(page: Page) {
  const point = await page.evaluate(() => {
    const world = document.querySelector("[data-multi-screen-canvas-world]");
    const surface = (world?.parentElement ?? world) as HTMLElement | null;
    if (!surface) return null;
    const bounds = surface.getBoundingClientRect();
    const screens = Array.from(
      document.querySelectorAll("[data-screen-iframe-id]"),
    ).map((element) => element.getBoundingClientRect());
    for (let y = bounds.top + 60; y < bounds.bottom - 60; y += 40) {
      for (let x = bounds.left + 60; x < bounds.right - 60; x += 40) {
        if (
          screens.some(
            (screen) =>
              x >= screen.left - 24 &&
              x <= screen.right + 24 &&
              y >= screen.top - 24 &&
              y <= screen.bottom + 24,
          )
        ) {
          continue;
        }
        const hit = document.elementFromPoint(x, y);
        if (hit && surface.contains(hit)) return { x, y };
      }
    }
    return null;
  });
  if (!point) throw new Error("no empty board point found");
  return point;
}

async function settleScreens(
  page: Page,
  sourceId: string,
  destinationId: string,
): Promise<void> {
  await page.keyboard.press("Shift+1");
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const [source, destination] = await Promise.all([
          boxFor(page, sourceId, "source-flow"),
          boxFor(page, destinationId, "destination-flow"),
        ]);
        const current = JSON.stringify({
          source: { x: source.x, y: source.y },
          destination: { x: destination.x, y: destination.y },
        });
        const stable = current === previous;
        previous = current;
        if (stable) console.log("[cross-screen-auto-layout] settled", current);
        return stable;
      },
      { timeout: 5_000, message: "auto-layout screen positions never settled" },
    )
    .toBe(true);
}

async function readMoveState(
  page: Page,
  designId: string,
  sourceFilename: string,
  destinationFilename: string,
  nodeId: string,
): Promise<{ sourceHas: boolean; destinationHas: boolean }> {
  const record = await files(page, designId);
  const source = record.find(
    (file) => file.filename === sourceFilename,
  )?.content;
  const destination = record.find(
    (file) => file.filename === destinationFilename,
  )?.content;
  return {
    sourceHas:
      source?.includes(`data-agent-native-node-id="${nodeId}"`) ?? false,
    destinationHas:
      destination?.includes(`data-agent-native-node-id="${nodeId}"`) ?? false,
  };
}

async function selectScreenNode(
  page: Page,
  screenId: string,
  nodeId: string,
): Promise<void> {
  const box = await boxFor(page, screenId, nodeId);
  await page.keyboard.down(PRIMARY);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.up(PRIMARY);
}

async function dragScreenNode(
  page: Page,
  screenId: string,
  nodeId: string,
  destination: { x: number; y: number },
): Promise<{ guide: number; ghost: number; sourceVisible: number }> {
  await selectScreenNode(page, screenId, nodeId);
  const source = await boxFor(page, screenId, nodeId);
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    source.x + source.width / 2 + 20,
    source.y + source.height / 2,
    {
      steps: 5,
    },
  );
  await page.mouse.move(destination.x, destination.y, { steps: 30 });
  await page.waitForTimeout(500);
  console.log(
    "[cross-screen-auto-layout] held drag",
    JSON.stringify(
      await page.evaluate(() => ({
        frames: Array.from(
          document.querySelectorAll("iframe[data-design-preview-iframe]"),
        ).map((frame) => {
          const rect = frame.getBoundingClientRect();
          return {
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            pointerEvents: getComputedStyle(frame).pointerEvents,
          };
        }),
        trace: (window as any).__designTrace?.dump?.() ?? "(no trace)",
      })),
    ),
  );
  await expect(page.locator("[data-cross-screen-drop-guide]")).toHaveCount(1, {
    timeout: 5_000,
  });
  const evidence = {
    guide: await page.locator("[data-cross-screen-drop-guide]").count(),
    ghost: await page.locator("[data-cross-screen-drag-ghost]").count(),
    sourceVisible: await designFrame(page, screenId)
      .locator(`[data-agent-native-node-id="${nodeId}"]`)
      .count(),
  };
  await page.mouse.up();
  return evidence;
}

async function waitForMove(
  page: Page,
  designId: string,
  sourceFilename: string,
  destinationFilename: string,
  nodeId: string,
): Promise<void> {
  await expect
    .poll(
      () =>
        readMoveState(
          page,
          designId,
          sourceFilename,
          destinationFilename,
          nodeId,
        ),
      { timeout: 15_000 },
    )
    .toEqual({ sourceHas: false, destinationHas: true });
}

async function settleReload(page: Page): Promise<void> {
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeAll(async ({}, testInfo) => {
  baseURL =
    (testInfo.project.use as { baseURL?: string }).baseURL ??
    process.env.E2E_BASE_URL ??
    e2eBaseURL();
});

test.describe("physical cross-screen auto-layout parity", () => {
  test.afterEach(async ({ page }, testInfo) => {
    const designId = testInfo.annotations.find(
      (annotation) => annotation.type === "design-id",
    )?.description;
    if (designId) await deleteDesign(page, designId);
  });

  test("board to Screen auto-layout keeps held target/source evidence and full undo-redo publication", async ({
    page,
  }) => {
    const design = await createDesign(page);
    test.info().annotations.push({ type: "design-id", description: design.id });
    await gotoEditor(page, design.id);
    await settleScreens(page, design.sourceId, design.destinationId);

    const boardPoint = await emptyBoardPoint(page);
    await page
      .locator('[data-design-bottom-toolbar] button[aria-label="Rectangle"]')
      .click();
    await page.mouse.move(boardPoint.x, boardPoint.y);
    await page.mouse.down();
    await page.mouse.move(boardPoint.x + 100, boardPoint.y + 64, { steps: 8 });
    await page.mouse.up();
    const beforeBoard = await fileContent(page, design.id, "__board__.html");
    const nodeId = [
      ...beforeBoard.matchAll(/data-agent-native-node-id="([^"]+)"/g),
    ]
      .map((match) => match[1])
      .slice(-1)[0];
    if (!nodeId) throw new Error("rectangle did not create a board node");
    await page
      .locator('[data-design-bottom-toolbar] button[aria-label="Move"]')
      .click();
    const source = page
      .locator("[data-board-surface-layer] iframe[data-design-preview-iframe]")
      .contentFrame()
      .locator(`[data-agent-native-node-id="${nodeId}"]`);
    await expect(source).toHaveCount(1);
    const sourceBox = (await source.boundingBox())!;
    const destination = await boxFor(
      page,
      design.destinationId,
      "destination-anchor",
    );
    console.log(
      "[cross-screen-auto-layout] screen-to-screen target",
      JSON.stringify({
        destination,
        anchor: await probeNode(
          page,
          design.destinationId,
          "destination-anchor",
        ),
        frames: await page
          .locator("iframe[data-design-preview-iframe]")
          .evaluateAll((iframes) =>
            iframes.map((iframe) => {
              const rect = iframe.getBoundingClientRect();
              return {
                id: iframe.getAttribute("data-screen-iframe-id"),
                rect: {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                },
              };
            }),
          ),
      }),
    );
    console.log(
      "[cross-screen-auto-layout] destination probe",
      JSON.stringify({
        destination,
        anchor: await probeNode(
          page,
          design.destinationId,
          "destination-anchor",
        ),
        frame: await page
          .locator(`[data-screen-iframe-id="${design.destinationId}"]`)
          .boundingBox(),
      }),
    );
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2 + 20,
      sourceBox.y + sourceBox.height / 2,
      {
        steps: 5,
      },
    );
    await page.mouse.move(
      destination.x + destination.width / 2,
      destination.y + destination.height / 2,
      {
        steps: 30,
      },
    );
    await page.waitForTimeout(500);
    console.log(
      "[cross-screen-auto-layout] board held drag",
      await page.evaluate(() => ({
        frames: Array.from(
          document.querySelectorAll("iframe[data-design-preview-iframe]"),
        ).map((frame) => {
          const rect = frame.getBoundingClientRect();
          return {
            rect: {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            },
            pointerEvents: getComputedStyle(frame).pointerEvents,
          };
        }),
        trace: (window as any).__designTrace?.dump?.() ?? "(no trace)",
      })),
    );
    const held = {
      guide: await page.locator("[data-cross-screen-drop-guide]").count(),
      sourceStillPersisted: (
        await fileContent(page, design.id, "__board__.html")
      ).includes(`data-agent-native-node-id="${nodeId}"`),
    };
    expect(held.guide).toBeGreaterThan(0);
    expect(held.sourceStillPersisted).toBe(true);
    await page.mouse.up();
    await waitForMove(
      page,
      design.id,
      "__board__.html",
      "destination.html",
      nodeId,
    );
    expect(
      await designFrame(page, design.destinationId)
        .locator(`[data-agent-native-node-id="${nodeId}"]`)
        .evaluate((node) => getComputedStyle(node).position),
    ).not.toBe("absolute");
    await settleReload(page);
    await expect
      .poll(() =>
        designFrame(page, design.destinationId)
          .locator(`[data-agent-native-node-id="${nodeId}"]`)
          .evaluate((node) =>
            node.parentElement?.getAttribute("data-agent-native-node-id"),
          ),
      )
      .toBe("destination-flow");
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(() =>
        readMoveState(
          page,
          design.id,
          "__board__.html",
          "destination.html",
          nodeId,
        ),
      )
      .toEqual({
        sourceHas: true,
        destinationHas: false,
      });
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await waitForMove(
      page,
      design.id,
      "__board__.html",
      "destination.html",
      nodeId,
    );
  });

  test("Screen to board preserves the auto-layout source boundary and undo-redo publication", async ({
    page,
  }) => {
    const design = await createDesign(page);
    test.info().annotations.push({ type: "design-id", description: design.id });
    await gotoEditor(page, design.id);
    await settleScreens(page, design.sourceId, design.destinationId);
    const boardPoint = await emptyBoardPoint(page);
    console.log("[cross-screen-auto-layout] board point", boardPoint);
    const held = await dragScreenNode(
      page,
      design.sourceId,
      "screen-source",
      boardPoint,
    );
    expect(held.guide).toBeGreaterThan(0);
    expect(held.ghost).toBeGreaterThan(0);
    expect(held.sourceVisible).toBe(1);
    await waitForMove(
      page,
      design.id,
      "index.html",
      "__board__.html",
      "screen-source",
    );
    await settleReload(page);
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(() =>
        readMoveState(
          page,
          design.id,
          "index.html",
          "__board__.html",
          "screen-source",
        ),
      )
      .toEqual({
        sourceHas: true,
        destinationHas: false,
      });
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await waitForMove(
      page,
      design.id,
      "index.html",
      "__board__.html",
      "screen-source",
    );
  });

  test("Screen to Screen inserts into the destination auto-layout root with held ghost and undo-redo publication", async ({
    page,
  }) => {
    const design = await createDesign(page);
    test.info().annotations.push({ type: "design-id", description: design.id });
    await gotoEditor(page, design.id);
    await settleScreens(page, design.sourceId, design.destinationId);
    const destination = await boxFor(
      page,
      design.destinationId,
      "destination-anchor",
    );
    const held = await dragScreenNode(page, design.sourceId, "screen-source", {
      x: destination.x + destination.width / 2,
      y: destination.y + destination.height / 2,
    });
    expect(held.guide).toBeGreaterThan(0);
    expect(held.ghost).toBeGreaterThan(0);
    expect(held.sourceVisible).toBe(1);
    await waitForMove(
      page,
      design.id,
      "index.html",
      "destination.html",
      "screen-source",
    );
    await expect
      .poll(() =>
        designFrame(page, design.destinationId)
          .locator('[data-agent-native-node-id="screen-source"]')
          .evaluate((node) => ({
            parent: node.parentElement?.getAttribute(
              "data-agent-native-node-id",
            ),
            position: getComputedStyle(node).position,
          })),
      )
      .toEqual({ parent: "destination-flow", position: "static" });
    await settleReload(page);
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(() =>
        readMoveState(
          page,
          design.id,
          "index.html",
          "destination.html",
          "screen-source",
        ),
      )
      .toEqual({
        sourceHas: true,
        destinationHas: false,
      });
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await waitForMove(
      page,
      design.id,
      "index.html",
      "destination.html",
      "screen-source",
    );
  });
});
