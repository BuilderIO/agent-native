import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  appPath,
  createFixtureDesign,
  gotoEditor,
  pickFrameMode,
} from "./helpers";

type DesignRecord = {
  data?: unknown;
  files?: Array<{ id: string; filename?: string; content?: string }>;
};

function designData(record: DesignRecord): Record<string, any> {
  return typeof record.data === "string"
    ? JSON.parse(record.data || "{}")
    : ((record.data ?? {}) as Record<string, any>);
}

async function readDesign(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()) as DesignRecord;
}

async function emptyBoardPoint(page: Page) {
  const point = await page.evaluate(() => {
    const world = document.querySelector("[data-multi-screen-canvas-world]");
    const surface = (world?.parentElement ?? world) as HTMLElement | null;
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    const cards = Array.from(
      document.querySelectorAll("[data-screen-card]"),
    ).map((element) => element.getBoundingClientRect());
    for (let y = rect.top + 60; y < rect.bottom - 60; y += 40) {
      for (let x = rect.left + 60; x < rect.right - 60; x += 40) {
        if (
          cards.some(
            (card) =>
              x >= card.left - 24 &&
              x <= card.right + 24 &&
              y >= card.top - 24 &&
              y <= card.bottom + 24,
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
  if (!point) throw new Error("no empty canvas point found");
  return point;
}

test.beforeEach(async ({ page }) => {
  const updates: string[] = [];
  const targetHost = new URL(e2eBaseURL()).host;
  page.on("websocket", (socket) => {
    if (!socket.url().includes(targetHost)) return;
    socket.on("framereceived", (event) => {
      try {
        const message = JSON.parse(String(event.payload));
        if (["update", "full-reload"].includes(message.type)) {
          updates.push(message.type);
        }
      } catch {
        // Vite also sends non-JSON frames for heartbeat and connection control.
      }
    });
  });
  (page as typeof page & { hmrUpdates: string[] }).hmrUpdates = updates;
});

test.afterEach(async ({ page }) => {
  expect(
    (page as typeof page & { hmrUpdates: string[] }).hmrUpdates,
    "No Vite HMR during the geometry repro",
  ).toEqual([]);
});

test("new Screen W/H commits keep frame and metadata geometry in sync", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const designId = await createFixtureDesign(
    page,
    `Screen geometry operation order ${Date.now()}`,
  );
  await test.info().attach("geometry-design-identity", {
    body: JSON.stringify({ designId }, null, 2),
    contentType: "application/json",
  });
  const updateTrace: Array<Record<string, unknown>> = [];
  const captureUpdate = (phase: "request" | "response", fields: object) => {
    updateTrace.push({
      sequence: updateTrace.length,
      phase,
      at: Date.now(),
      ...fields,
    });
  };
  page.on("request", (request) => {
    const actionName = new URL(request.url()).pathname.split("/").pop() ?? "";
    if (
      !/^(update-design|create-file|create-screen|add-screen)$/.test(actionName)
    ) {
      return;
    }
    let payload: Record<string, any> = {};
    try {
      payload = request.postDataJSON() as Record<string, any>;
    } catch {
      payload = { raw: request.postData() };
    }
    captureUpdate("request", {
      actionName,
      method: request.method(),
      url: request.url(),
      designId: payload.id,
      operationSource: payload.operationSource,
      operationRevision: payload.operationRevision,
      dataOperations: payload.dataOperations,
      snapshotKeys:
        typeof payload.data === "string"
          ? Object.keys(JSON.parse(payload.data))
          : undefined,
    });
  });
  page.on("response", (response) => {
    const actionName = new URL(response.url()).pathname.split("/").pop() ?? "";
    if (
      !/^(update-design|create-file|create-screen|add-screen)$/.test(actionName)
    ) {
      return;
    }
    captureUpdate("response", {
      actionName,
      status: response.status(),
      url: response.url(),
    });
  });

  await gotoEditor(page, designId);
  const initial = await readDesign(page, designId);
  const initialFileIds = new Set(initial.files?.map((file) => file.id));
  await pickFrameMode(page, "Screen");
  const start = await emptyBoardPoint(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 190, start.y + 150, { steps: 16 });
  await page.mouse.up();

  let screenId = "";
  await expect
    .poll(async () => {
      const record = await readDesign(page, designId);
      const file = record.files?.find(
        (candidate) =>
          !initialFileIds.has(candidate.id) &&
          candidate.filename !== "__board__.html",
      );
      if (!file) return null;
      screenId = file.id;
      return file.id;
    })
    .not.toBeNull();
  const screenShell = page.locator(
    `[data-screen-shell][data-frame-id="${screenId}"]`,
  );
  await expect(screenShell).toHaveCount(1);
  const screenIframe = screenShell.locator(
    `[data-screen-iframe-id="${screenId}"]`,
  );
  await expect(screenIframe).toHaveCount(1);
  const layerTree = page.getByRole("tree", { name: "Layers" });
  const selectedScreenButton = layerTree.locator(
    `[data-layer-row-button][data-layer-node-id="${screenId}"]`,
  );
  await expect(selectedScreenButton).toHaveCount(1);
  const selectedState = () =>
    selectedScreenButton.evaluate((button) =>
      button.closest('[role="treeitem"]')?.getAttribute("aria-selected"),
    );
  if ((await selectedState()) !== "true") {
    await selectedScreenButton.click();
  }
  await expect.poll(selectedState).toBe("true");
  await expect
    .poll(() => page.evaluate(() => (window as any).__designSelection ?? null))
    .toMatchObject({
      designId,
      selectedScreenIds: expect.arrayContaining([screenId]),
    });
  const beforeBurstData = designData(await readDesign(page, designId));
  const initialCanvasFrame = beforeBurstData.canvasFrames?.[screenId];
  const initialRenderedBounds = await screenShell
    .locator("[data-screen-card]")
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const shell = element.closest<HTMLElement>("[data-screen-shell]");
      const shellStyle = shell ? getComputedStyle(shell) : null;
      return {
        width: rect.width,
        height: rect.height,
        localWidth: shellStyle?.width ?? null,
        localHeight: shellStyle?.height ?? null,
      };
    });
  const iframeSourceIdentity = await screenIframe
    .contentFrame()
    .locator("body")
    .evaluate((body) => ({
      nodeId: body.getAttribute("data-agent-native-node-id"),
      layerName: body.getAttribute("data-agent-native-layer-name"),
    }));
  const selection = await page.evaluate(
    () => (window as any).__designSelection ?? null,
  );
  const width = page.getByRole("textbox", {
    name: /^W(?: size in pixels)?$/,
  });
  const height = page.getByRole("textbox", {
    name: /^H(?: size in pixels)?$/,
  });
  const inspectorBeforeBurst = {
    width: await width.inputValue(),
    height: await height.inputValue(),
  };
  const identity = {
    designId,
    screenId,
    shellFrameId: await screenShell.getAttribute("data-frame-id"),
    layerNodeId: await selectedScreenButton.getAttribute("data-layer-node-id"),
    iframeId: await screenIframe.getAttribute("data-screen-iframe-id"),
    iframeSourceIdentity,
    selection,
    inspectorBeforeBurst,
    creationGeometry: beforeBurstData.canvasFrames?.[screenId],
    creationMetadata: beforeBurstData.screenMetadata?.[screenId],
  };
  await test.info().attach("screen-geometry-target-identity", {
    body: JSON.stringify(identity, null, 2),
    contentType: "application/json",
  });
  expect(identity.shellFrameId).toBe(screenId);
  expect(identity.layerNodeId).toBe(screenId);
  expect(identity.iframeId).toBe(screenId);
  expect(selection?.designId).toBe(designId);
  expect(selection?.selectedScreenIds).toContain(screenId);
  expect(initialCanvasFrame).toBeTruthy();

  // Keep these commits adjacent. A create/resize race can be hidden by waiting
  await width.fill("360");
  await width.press("Enter");
  await height.fill("315");
  await height.press("Enter");
  const immediateAfterBurstRecord = await readDesign(page, designId);
  const immediateAfterBurstData = designData(immediateAfterBurstRecord);
  let finalRecord: DesignRecord | null = null;
  let persistenceError: string | null = null;
  try {
    await expect
      .poll(async () => {
        finalRecord = await readDesign(page, designId);
        const data = designData(finalRecord);
        const frame = data.canvasFrames?.[screenId];
        const metadata = data.screenMetadata?.[screenId];
        return [frame?.width, frame?.height, metadata?.width, metadata?.height];
      })
      .toEqual([360, 315, 360, 315]);
  } catch (error) {
    persistenceError = String(error);
  }
  finalRecord ??= await readDesign(page, designId).catch(() => null);
  const afterHeightData = finalRecord ? designData(finalRecord) : {};
  const shellBounds = await screenShell
    .locator("[data-screen-card]")
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
  const final = {
    screenId,
    canvasFrame: afterHeightData.canvasFrames?.[screenId],
    metadata: afterHeightData.screenMetadata?.[screenId],
    widthInput: await width.inputValue(),
    heightInput: await height.inputValue(),
    shellBounds,
  };
  console.log(
    JSON.stringify(
      {
        designId,
        screenId,
        identity,
        initialCanvasFrame,
        initialRenderedBounds,
        immediateAfterBurst: {
          canvasFrame: immediateAfterBurstData.canvasFrames?.[screenId],
          metadata: immediateAfterBurstData.screenMetadata?.[screenId],
          widthInput: await width.inputValue(),
          heightInput: await height.inputValue(),
        },
        final,
        persistenceError,
        updateTrace,
        preservedOnFailure: true,
      },
      null,
      2,
    ),
  );
  await test.info().attach("screen-geometry-request-order", {
    body: JSON.stringify(
      {
        identity,
        initialCanvasFrame,
        initialRenderedBounds,
        immediateAfterBurst: {
          canvasFrame: immediateAfterBurstData.canvasFrames?.[screenId],
          metadata: immediateAfterBurstData.screenMetadata?.[screenId],
        },
        final,
        persistenceError,
        updateTrace,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });

  if (persistenceError) throw new Error(persistenceError);

  const inSync =
    final.canvasFrame?.width === 360 &&
    final.canvasFrame?.height === 315 &&
    final.metadata?.width === 360 &&
    final.metadata?.height === 315;
  if (!inSync) {
    console.error(`Preserved failing screen geometry design ${designId}`);
  } else {
    const response = await page.request.post(
      appPath("/_agent-native/actions/delete-design"),
      { data: { id: designId } },
    );
    if (!response.ok()) throw new Error(await response.text());
  }
  expect(final, `screen geometry mismatch (design ${designId})`).toMatchObject({
    canvasFrame: {
      x: initialCanvasFrame.x,
      y: initialCanvasFrame.y,
      width: 360,
      height: 315,
    },
    metadata: { width: 360, height: 315 },
  });
  expect(final.shellBounds.width).toBeCloseTo(
    (initialRenderedBounds.width * 360) /
      Number.parseFloat(initialRenderedBounds.localWidth ?? "0"),
    1,
  );
});
