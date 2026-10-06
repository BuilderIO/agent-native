import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { designFrame, gotoEditor } from "./helpers";

const PRIMARY = process.platform === "darwin" ? "Meta" : "Control";

const SOURCE_SCREEN = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Auto layout source</title></head>
  <body style="margin:0;position:relative;min-height:780px;width:1000px;height:780px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <section data-agent-native-node-id="source-flow" data-agent-native-layer-name="Source Flow" data-an-primitive="frame"
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
  <body style="margin:0;position:relative;min-height:780px;width:1000px;height:780px;background:#111827;color:#fff;font-family:system-ui,sans-serif">
    <section data-agent-native-node-id="destination-flow" data-agent-native-layer-name="Destination Flow" data-an-primitive="frame"
      style="position:absolute;left:80px;top:100px;width:360px;min-height:260px;box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:16px;background:#334155">
      <div data-agent-native-node-id="destination-anchor" data-agent-native-layer-name="Destination Anchor"
        style="box-sizing:border-box;flex:0 0 56px;width:180px;height:56px;background:#94a3b8;color:#0f172a">Anchor</div>
    </section>
  </body>
</html>`;

const REVERSE_DESTINATION_SCREEN = `<!doctype html>
<html lang="en">
  <body style="margin:0;position:relative;min-height:780px;width:1000px;height:780px;background:#111827;color:#fff">
    <section data-agent-native-node-id="destination-flow" data-agent-native-layer-name="Destination Flow" data-an-primitive="frame"
      style="position:absolute;left:80px;top:100px;width:360px;min-height:120px;box-sizing:border-box;display:flex;flex-direction:row-reverse;align-items:flex-start;gap:12px;padding:16px;background:#334155">
      <div data-agent-native-node-id="destination-anchor" data-agent-native-layer-name="Destination Anchor"
        style="box-sizing:border-box;flex:0 0 100px;width:100px;height:56px;background:#94a3b8;color:#0f172a">Anchor</div>
      <div data-agent-native-node-id="destination-tail" data-agent-native-layer-name="Destination Tail"
        style="box-sizing:border-box;flex:0 0 80px;width:80px;height:56px;background:#64748b;color:#f8fafc">Tail</div>
    </section>
  </body>
</html>`;

const WRAPPED_DESTINATION_SCREEN = `<!doctype html>
<html lang="en">
  <body style="margin:0;position:relative;min-height:780px;width:1000px;height:780px;background:#111827;color:#fff">
    <section data-agent-native-node-id="destination-flow" data-agent-native-layer-name="Wrapped Destination Flow" data-an-primitive="frame"
      style="position:absolute;left:80px;top:100px;width:360px;height:260px;box-sizing:border-box;display:flex;flex-direction:row;flex-wrap:wrap;align-content:flex-start;align-items:flex-start;gap:12px;padding:16px;background:#334155">
      <div data-agent-native-node-id="wrapped-first" data-agent-native-layer-name="Wrapped First"
        style="box-sizing:border-box;flex:0 0 140px;width:140px;height:56px;background:#94a3b8;color:#0f172a">First</div>
      <div data-agent-native-node-id="wrapped-second" data-agent-native-layer-name="Wrapped Second"
        style="box-sizing:border-box;flex:0 0 140px;width:140px;height:56px;background:#64748b;color:#f8fafc">Second</div>
      <div data-agent-native-node-id="wrapped-third" data-agent-native-layer-name="Wrapped Third"
        style="box-sizing:border-box;flex:0 0 140px;width:140px;height:56px;background:#64748b;color:#f8fafc">Third</div>
      <div data-agent-native-node-id="wrapped-fourth" data-agent-native-layer-name="Wrapped Fourth"
        style="box-sizing:border-box;flex:0 0 140px;width:140px;height:56px;background:#64748b;color:#f8fafc">Fourth</div>
    </section>
  </body>
</html>`;

const FREE_SOURCE_SCREEN = `<!doctype html>
<html lang="en">
  <body style="margin:0;position:relative;min-height:780px;width:1000px;height:780px;background:#0f1115;color:#fff">
    <div data-agent-native-node-id="free-source" data-agent-native-layer-name="Free Source"
      style="position:absolute;left:100px;top:420px;width:140px;height:60px;background:#38bdf8;color:#082f49">Free</div>
  </body>
</html>`;

const NESTED_DESTINATION_SCREEN = `<!doctype html>
<html lang="en">
  <body style="margin:0;position:relative;min-height:780px;width:1000px;height:780px;background:#111827;color:#fff">
    <section data-agent-native-node-id="destination-shell" data-agent-native-layer-name="Destination Shell"
      style="position:absolute;left:80px;top:100px;width:600px;min-height:240px;padding:20px;box-sizing:border-box;display:flex;flex-direction:row;align-items:flex-start;gap:12px;background:#334155">
      <section data-agent-native-node-id="nested-auto" data-agent-native-layer-name="Nested Auto"
        style="display:flex;flex-direction:column;gap:12px;padding:16px;background:#475569">
        <div data-agent-native-node-id="destination-first" data-agent-native-layer-name="Destination First"
          style="width:180px;height:40px;background:#94a3b8;color:#0f172a">First</div>
        <div data-agent-native-node-id="destination-second" data-agent-native-layer-name="Destination Second"
          style="width:180px;height:40px;background:#64748b;color:#f8fafc">Second</div>
      </section>
      <div data-agent-native-node-id="destination-outer-anchor" data-agent-native-layer-name="Destination Outer Anchor"
        style="width:90px;height:32px;background:#64748b;color:#f8fafc">Outer slot</div>
    </section>
  </body>
</html>`;

const NESTED_SOURCE_SCREEN = `<!doctype html>
<html lang="en">
  <body style="margin:0;position:relative;min-height:780px;width:1000px;height:780px;background:#0f1115;color:#fff">
    <section data-agent-native-node-id="source-shell" data-agent-native-layer-name="Source Shell"
      style="position:absolute;left:80px;top:100px;width:420px;min-height:240px;padding:20px;box-sizing:border-box;background:#1f2937">
      <section data-agent-native-node-id="nested-source-auto" data-agent-native-layer-name="Nested Source Auto"
        style="display:flex;flex-direction:column;gap:12px;padding:16px;background:#334155">
        <div data-agent-native-node-id="nested-source" data-agent-native-layer-name="Nested Source"
          style="width:180px;height:40px;background:#38bdf8;color:#082f49">Source</div>
        <div data-agent-native-node-id="nested-source-anchor" data-agent-native-layer-name="Nested Source Anchor"
          style="width:180px;height:40px;background:#64748b;color:#f8fafc">Anchor</div>
      </section>
    </section>
  </body>
</html>`;

const EMPTY_DESTINATION_SCREEN = `<!doctype html>
<html lang="en">
  <body style="margin:0;position:relative;min-height:780px;width:1000px;height:780px;background:#111827;color:#fff"></body>
</html>`;

type DesignFile = { filename: string; id: string; content: string };

let baseURL = "";

async function action(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const actionURL = new URL(
    `/_agent-native/actions/${name}`,
    baseURL,
  ).toString();
  const response = await page.request.post(actionURL, {
    data: input,
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function files(page: Page, designId: string): Promise<DesignFile[]> {
  const actionURL = new URL(
    `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
    baseURL,
  ).toString();
  const response = await page.request.get(actionURL);
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  const record = await response.json();
  return (record.files ?? []) as DesignFile[];
}

async function createDesign(
  page: Page,
  onCreated?: (designId: string) => void,
  options?: {
    sourceContent?: string;
    destinationContent?: string;
    title?: string;
  },
): Promise<{
  id: string;
  sourceId: string;
  destinationId: string;
}> {
  const created = await action(page, "create-design", {
    title: options?.title ?? "cross-screen auto-layout parity",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (typeof id !== "string") throw new Error("create-design returned no id");
  onCreated?.(id);
  await action(page, "create-file", {
    designId: id,
    filename: "index.html",
    content: options?.sourceContent ?? SOURCE_SCREEN,
    fileType: "html",
  });
  await action(page, "create-file", {
    designId: id,
    filename: "destination.html",
    content: options?.destinationContent ?? DESTINATION_SCREEN,
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
        value: { sourceType: "inline", width: 1000, height: 780 },
      },
      {
        op: "set",
        path: ["canvasFrames", sourceId],
        value: { x: 0, y: 0, width: 1000, height: 780, z: 0 },
      },
      {
        op: "set",
        path: ["screenMetadata", destinationId],
        value: { sourceType: "inline", width: 1000, height: 780 },
      },
      {
        op: "set",
        path: ["canvasFrames", destinationId],
        value: { x: 1120, y: 0, width: 1000, height: 780, z: 1 },
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
  nodes: { source?: string; destination?: string } = {
    source: "source-flow",
    destination: "destination-flow",
  },
): Promise<void> {
  await page.keyboard.press("Shift+1");
  if (!nodes.source || !nodes.destination) {
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2, {
      timeout: 5_000,
    });
    await Promise.all(
      [sourceId, destinationId].map(async (screenId) => {
        const frame = page.locator(
          `iframe[data-design-preview-iframe][data-screen-iframe-id="${screenId}"]`,
        );
        await expect(frame).toHaveCount(1, { timeout: 5_000 });
        await expect(frame.contentFrame().locator("body")).toBeVisible({
          timeout: 5_000,
        });
      }),
    );
    return;
  }
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const [source, destination] = await Promise.all([
          boxFor(page, sourceId, nodes.source!),
          boxFor(page, destinationId, nodes.destination!),
        ]);
        const current = JSON.stringify({
          source: { x: source.x, y: source.y },
          destination: { x: destination.x, y: destination.y },
        });
        const stable = current === previous;
        previous = current;
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

async function readPrimitiveMoveState(
  page: Page,
  designId: string,
  sourceFilename: string,
  destinationFilename: string,
  primitive: string,
): Promise<{ sourceHas: boolean; destinationHas: boolean }> {
  const record = await files(page, designId);
  const source = record.find(
    (file) => file.filename === sourceFilename,
  )?.content;
  const destination = record.find(
    (file) => file.filename === destinationFilename,
  )?.content;
  const marker = `data-an-primitive="${primitive}"`;
  return {
    sourceHas: source?.includes(marker) ?? false,
    destinationHas: destination?.includes(marker) ?? false,
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
  onHeld?: () => Promise<void>,
  grabFraction = { x: 0.5, y: 0.5 },
): Promise<{
  guide: number;
  ghost: number;
  sourceVisible: boolean;
  pointer: { x: number; y: number };
  grabFraction: { x: number; y: number };
  sourceBox: { x: number; y: number; width: number; height: number };
  guideBox: { x: number; y: number; width: number; height: number } | null;
  ghostBox: { x: number; y: number; width: number; height: number } | null;
}> {
  await selectScreenNode(page, screenId, nodeId);
  const source = await boxFor(page, screenId, nodeId);
  const grab = {
    x: source.x + source.width * grabFraction.x,
    y: source.y + source.height * grabFraction.y,
  };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 20, grab.y, { steps: 5 });
  await page.mouse.move(destination.x, destination.y, { steps: 30 });
  await expect
    .poll(() => page.locator("[data-cross-screen-drag-ghost]").count(), {
      timeout: 5_000,
    })
    .toBeGreaterThan(0);
  const guide = page.locator("[data-cross-screen-drop-guide]");
  const guideCount = await guide.count();
  const evidence = {
    guide: guideCount,
    ghost: await page.locator("[data-cross-screen-drag-ghost]").count(),
    sourceVisible: await designFrame(page, screenId)
      .locator(`[data-agent-native-node-id="${nodeId}"]`)
      .isVisible(),
    pointer: destination,
    grabFraction,
    sourceBox: source,
    guideBox: guideCount ? await guide.first().boundingBox() : null,
    ghostBox: await page
      .locator("[data-cross-screen-drag-ghost]")
      .boundingBox(),
  };
  await onHeld?.();
  await page.mouse.up();
  return evidence;
}

function expectGhostToPreserveGrabOffset(held: {
  pointer: { x: number; y: number };
  grabFraction: { x: number; y: number };
  sourceBox: { x: number; y: number; width: number; height: number };
  ghostBox: { x: number; y: number; width: number; height: number } | null;
}): void {
  expect(held.ghostBox).not.toBeNull();
  const ghost = held.ghostBox!;
  expect(Math.abs(ghost.width - held.sourceBox.width)).toBeLessThan(5);
  expect(Math.abs(ghost.height - held.sourceBox.height)).toBeLessThan(5);
  expect(
    Math.abs(ghost.x + ghost.width * held.grabFraction.x - held.pointer.x),
  ).toBeLessThan(5);
  expect(
    Math.abs(ghost.y + ghost.height * held.grabFraction.y - held.pointer.y),
  ).toBeLessThan(5);
}

function expectGuideToContainPointer(held: {
  pointer: { x: number; y: number };
  guideBox: { x: number; y: number; width: number; height: number } | null;
}): void {
  expect(held.guideBox).not.toBeNull();
  const guide = held.guideBox!;
  expect(held.pointer.x).toBeGreaterThanOrEqual(guide.x - 5);
  expect(held.pointer.x).toBeLessThanOrEqual(guide.x + guide.width + 5);
  expect(held.pointer.y).toBeGreaterThanOrEqual(guide.y - 5);
  expect(held.pointer.y).toBeLessThanOrEqual(guide.y + guide.height + 5);
}

function expectGuideAfterChild(
  held: {
    pointer: { x: number; y: number };
    guideBox: { x: number; y: number; width: number; height: number } | null;
  },
  child: { x: number; y: number; width: number; height: number },
): void {
  expect(held.guideBox).not.toBeNull();
  const guide = held.guideBox!;
  expect(guide.height).toBeLessThan(5);
  expect(held.pointer.y).toBeGreaterThan(child.y + child.height / 2);
  expect(guide.width).toBeGreaterThan(guide.height);
  expect(Math.abs(guide.x - child.x)).toBeLessThan(5);
  expect(Math.abs(guide.width - child.width)).toBeLessThan(5);
  expect(
    Math.abs(guide.y + guide.height / 2 - (child.y + child.height)),
  ).toBeLessThan(5);
}

function expectGuideAfterChildAlongX(
  held: {
    pointer: { x: number; y: number };
    guideBox: { x: number; y: number; width: number; height: number } | null;
  },
  child: { x: number; y: number; width: number; height: number },
): void {
  expect(held.guideBox).not.toBeNull();
  const guide = held.guideBox!;
  expect(guide.width).toBeLessThan(5);
  expect(held.pointer.x).toBeGreaterThan(child.x + child.width / 2);
  expect(
    Math.abs(guide.x + guide.width / 2 - (child.x + child.width)),
  ).toBeLessThan(5);
  expect(Math.abs(guide.y - child.y)).toBeLessThan(5);
  expect(Math.abs(guide.height - child.height)).toBeLessThan(5);
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
    const design = await createDesign(page, (id) =>
      test.info().annotations.push({ type: "design-id", description: id }),
    );
    await gotoEditor(page, design.id);
    await settleScreens(page, design.sourceId, design.destinationId);

    const boardPoint = await emptyBoardPoint(page);
    await page
      .locator('[data-design-bottom-toolbar] button[aria-label="Rectangle"]')
      .click();
    await page.waitForTimeout(300);
    await page.mouse.move(boardPoint.x, boardPoint.y);
    await page.mouse.down();
    await page.mouse.move(boardPoint.x + 100, boardPoint.y + 64, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(() => fileContent(page, design.id, "__board__.html"))
      .toMatch(/data-an-primitive="rectangle"/);
    await page
      .locator('[data-design-bottom-toolbar] button[aria-label="Move"]')
      .click();
    const source = page
      .locator("[data-board-surface-layer] iframe[data-design-preview-iframe]")
      .first()
      .contentFrame()
      .locator('[data-an-primitive="rectangle"]')
      .first();
    await expect(source).toHaveCount(1);
    const sourceBox = (await source.boundingBox())!;
    const destination = await boxFor(
      page,
      design.destinationId,
      "destination-flow",
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
    await expect
      .poll(() => page.locator("[data-cross-screen-drop-guide]").count(), {
        timeout: 5_000,
      })
      .toBeGreaterThan(0);
    const held = {
      guide: await page.locator("[data-cross-screen-drop-guide]").count(),
      sourceStillPersisted: (
        await fileContent(page, design.id, "__board__.html")
      ).includes('data-an-primitive="rectangle"'),
    };
    expect(held.guide).toBeGreaterThan(0);
    expect(held.sourceStillPersisted).toBe(true);
    await page.mouse.up();
    await expect
      .poll(() =>
        readPrimitiveMoveState(
          page,
          design.id,
          "__board__.html",
          "destination.html",
          "rectangle",
        ),
      )
      .toEqual({ sourceHas: false, destinationHas: true });
    const movedRectangle = designFrame(page, design.destinationId)
      .locator('[data-an-primitive="rectangle"]')
      .first();
    await expect(movedRectangle).toHaveCount(1);
    expect(
      await movedRectangle.evaluate((node) => getComputedStyle(node).position),
    ).not.toBe("absolute");
    await page.keyboard.press(`${PRIMARY}+z`);
    await expect
      .poll(() =>
        readPrimitiveMoveState(
          page,
          design.id,
          "__board__.html",
          "destination.html",
          "rectangle",
        ),
      )
      .toEqual({
        sourceHas: true,
        destinationHas: false,
      });
    await page.keyboard.press(`${PRIMARY}+Shift+z`);
    await expect
      .poll(() =>
        readPrimitiveMoveState(
          page,
          design.id,
          "__board__.html",
          "destination.html",
          "rectangle",
        ),
      )
      .toEqual({ sourceHas: false, destinationHas: true });
    await settleReload(page);
    await expect
      .poll(() =>
        designFrame(page, design.destinationId)
          .locator('[data-an-primitive="rectangle"]')
          .evaluate((node) =>
            node.parentElement?.getAttribute("data-agent-native-node-id"),
          ),
      )
      .toBe("destination-flow");
  });

  test("Screen to board preserves the auto-layout source boundary and undo-redo publication", async ({
    page,
  }) => {
    const design = await createDesign(page, (id) =>
      test.info().annotations.push({ type: "design-id", description: id }),
    );
    await gotoEditor(page, design.id);
    await settleScreens(page, design.sourceId, design.destinationId);
    const boardPoint = await emptyBoardPoint(page);
    const held = await dragScreenNode(
      page,
      design.sourceId,
      "screen-source",
      boardPoint,
    );
    expect(held.ghost).toBeGreaterThan(0);
    expect(held.sourceVisible).toBe(true);
    expectGhostToPreserveGrabOffset(held);
    await waitForMove(
      page,
      design.id,
      "index.html",
      "__board__.html",
      "screen-source",
    );
    await page.keyboard.press(`${PRIMARY}+z`);
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
    await page.keyboard.press(`${PRIMARY}+Shift+z`);
    await waitForMove(
      page,
      design.id,
      "index.html",
      "__board__.html",
      "screen-source",
    );
    await settleReload(page);
  });

  test("Screen to Screen inserts into the destination auto-layout root with held ghost and undo-redo publication", async ({
    page,
  }) => {
    const design = await createDesign(page, (id) =>
      test.info().annotations.push({ type: "design-id", description: id }),
    );
    await gotoEditor(page, design.id);
    await settleScreens(page, design.sourceId, design.destinationId);
    const destination = await boxFor(
      page,
      design.destinationId,
      "destination-flow",
    );
    const anchor = await boxFor(
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
    expect(held.sourceVisible).toBe(true);
    expectGhostToPreserveGrabOffset(held);
    expectGuideAfterChild(held, anchor);
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
    await page.keyboard.press(`${PRIMARY}+z`);
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
    await page.keyboard.press(`${PRIMARY}+Shift+z`);
    await waitForMove(
      page,
      design.id,
      "index.html",
      "destination.html",
      "screen-source",
    );
    await settleReload(page);
  });

  test("Screen to Screen keeps reverse-flex DOM order and draws the guide on the physical edge", async ({
    page,
  }) => {
    const design = await createDesign(
      page,
      (id) =>
        test.info().annotations.push({ type: "design-id", description: id }),
      { destinationContent: REVERSE_DESTINATION_SCREEN },
    );
    await gotoEditor(page, design.id);
    await settleScreens(page, design.sourceId, design.destinationId);

    const destination = await boxFor(
      page,
      design.destinationId,
      "destination-flow",
    );
    const anchor = await boxFor(
      page,
      design.destinationId,
      "destination-anchor",
    );
    const release = {
      x: anchor.x + anchor.width + 6,
      y: anchor.y + anchor.height / 2,
    };
    expect(release.x).toBeLessThan(destination.x + destination.width);
    const sourceBefore = await fileContent(page, design.id, "index.html");
    const destinationBefore = await fileContent(
      page,
      design.id,
      "destination.html",
    );
    const held = await dragScreenNode(
      page,
      design.sourceId,
      "screen-source",
      release,
      async () => {
        expect(await fileContent(page, design.id, "index.html")).toBe(
          sourceBefore,
        );
        expect(await fileContent(page, design.id, "destination.html")).toBe(
          destinationBefore,
        );
      },
    );
    expect(held.sourceVisible).toBe(true);
    expectGhostToPreserveGrabOffset(held);
    expectGuideAfterChildAlongX(held, anchor);

    await waitForMove(
      page,
      design.id,
      "index.html",
      "destination.html",
      "screen-source",
    );
    const order = () =>
      designFrame(page, design.destinationId)
        .locator('[data-agent-native-node-id="destination-flow"]')
        .evaluate((node) =>
          Array.from(node.children).map((child) =>
            child.getAttribute("data-agent-native-node-id"),
          ),
        );
    await expect
      .poll(order)
      .toEqual(["screen-source", "destination-anchor", "destination-tail"]);
    await page.keyboard.press(`${PRIMARY}+z`);
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
      .toEqual({ sourceHas: true, destinationHas: false });
    await page.keyboard.press(`${PRIMARY}+Shift+z`);
    await waitForMove(
      page,
      design.id,
      "index.html",
      "destination.html",
      "screen-source",
    );
    await settleReload(page);
    await expect
      .poll(order)
      .toEqual(["screen-source", "destination-anchor", "destination-tail"]);
  });

  test("Screen to Screen inserts after the hovered item on a wrapped second row and persists through history", async ({
    page,
  }) => {
    const design = await createDesign(
      page,
      (id) =>
        test.info().annotations.push({ type: "design-id", description: id }),
      { destinationContent: WRAPPED_DESTINATION_SCREEN },
    );
    await gotoEditor(page, design.id);
    await settleScreens(page, design.sourceId, design.destinationId);

    const destinationFrame = designFrame(page, design.destinationId);
    const first = await boxFor(page, design.destinationId, "wrapped-first");
    const second = await boxFor(page, design.destinationId, "wrapped-second");
    const third = await boxFor(page, design.destinationId, "wrapped-third");
    const fourth = await boxFor(page, design.destinationId, "wrapped-fourth");
    expect(Math.abs(first.y - second.y)).toBeLessThan(1);
    expect(third.y).toBeGreaterThan(first.y + first.height);
    expect(Math.abs(third.y - fourth.y)).toBeLessThan(1);
    expect(
      await destinationFrame
        .locator('[data-agent-native-node-id="destination-flow"]')
        .evaluate((node) => getComputedStyle(node).flexWrap),
    ).toBe("wrap");

    const sourceBefore = await fileContent(page, design.id, "index.html");
    const destinationBefore = await fileContent(
      page,
      design.id,
      "destination.html",
    );
    const sourceBeforeBox = await boxFor(
      page,
      design.sourceId,
      "screen-source",
    );
    const release = {
      x: fourth.x + fourth.width + 6,
      y: fourth.y + fourth.height / 2,
    };
    const held = await dragScreenNode(
      page,
      design.sourceId,
      "screen-source",
      release,
      async () => {
        expect(await fileContent(page, design.id, "index.html")).toBe(
          sourceBefore,
        );
        expect(await fileContent(page, design.id, "destination.html")).toBe(
          destinationBefore,
        );
      },
    );
    expect(held.guide).toBeGreaterThan(0);
    expect(held.ghost).toBeGreaterThan(0);
    expect(held.sourceVisible).toBe(true);
    expectGhostToPreserveGrabOffset(held);
    expectGuideAfterChildAlongX(held, fourth);

    const destinationOrder = () =>
      destinationFrame
        .locator('[data-agent-native-node-id="destination-flow"]')
        .evaluate((node) =>
          Array.from(node.children).map((child) =>
            child.getAttribute("data-agent-native-node-id"),
          ),
        );
    await waitForMove(
      page,
      design.id,
      "index.html",
      "destination.html",
      "screen-source",
    );
    await expect
      .poll(destinationOrder)
      .toEqual([
        "wrapped-first",
        "wrapped-second",
        "wrapped-third",
        "wrapped-fourth",
        "screen-source",
      ]);
    await expect
      .poll(() =>
        destinationFrame
          .locator('[data-agent-native-node-id="screen-source"]')
          .evaluate((node) => ({
            position: getComputedStyle(node).position,
            parent: node.parentElement?.getAttribute(
              "data-agent-native-node-id",
            ),
          })),
      )
      .toEqual({ position: "static", parent: "destination-flow" });

    const expectSourceOnWrappedThirdRow = async () => {
      await expect
        .poll(async () => {
          const [firstBox, sourceBox] = await Promise.all([
            boxFor(page, design.destinationId, "wrapped-first"),
            boxFor(page, design.destinationId, "screen-source"),
          ]);
          return Math.abs(sourceBox.x - firstBox.x);
        })
        .toBeLessThan(2);
      await expect
        .poll(async () => {
          const [firstBox, thirdBox, sourceBox] = await Promise.all([
            boxFor(page, design.destinationId, "wrapped-first"),
            boxFor(page, design.destinationId, "wrapped-third"),
            boxFor(page, design.destinationId, "screen-source"),
          ]);
          const rowStep = thirdBox.y - firstBox.y;
          return Math.abs(sourceBox.y - (thirdBox.y + rowStep));
        })
        .toBeLessThan(2);
    };
    await expectSourceOnWrappedThirdRow();

    await page.keyboard.press(`${PRIMARY}+z`);
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
      .toEqual({ sourceHas: true, destinationHas: false });
    await expect
      .poll(async () => {
        const sourceBox = await boxFor(page, design.sourceId, "screen-source");
        return Math.abs(sourceBox.x - sourceBeforeBox.x);
      })
      .toBeLessThan(2);
    await expect
      .poll(async () => {
        const sourceBox = await boxFor(page, design.sourceId, "screen-source");
        return Math.abs(sourceBox.y - sourceBeforeBox.y);
      })
      .toBeLessThan(2);
    await page.keyboard.press(`${PRIMARY}+Shift+z`);
    await waitForMove(
      page,
      design.id,
      "index.html",
      "destination.html",
      "screen-source",
    );
    await expectSourceOnWrappedThirdRow();
    await settleReload(page);
    await expect
      .poll(destinationOrder)
      .toEqual([
        "wrapped-first",
        "wrapped-second",
        "wrapped-third",
        "wrapped-fourth",
        "screen-source",
      ]);
    await expectSourceOnWrappedThirdRow();
  });

  test("G1: physical drop selects the eligible inner auto-layout frame and its held insertion slot", async ({
    page,
  }) => {
    const design = await createDesign(
      page,
      (id) =>
        test.info().annotations.push({ type: "design-id", description: id }),
      {
        sourceContent: FREE_SOURCE_SCREEN,
        destinationContent: NESTED_DESTINATION_SCREEN,
        title: "cross-screen nested auto-layout report",
      },
    );
    await gotoEditor(page, design.id);
    await settleScreens(page, design.sourceId, design.destinationId, {});

    const outer = await boxFor(page, design.destinationId, "destination-shell");
    const inner = await boxFor(page, design.destinationId, "nested-auto");
    const first = await boxFor(page, design.destinationId, "destination-first");
    expect(
      await designFrame(page, design.destinationId)
        .locator('[data-agent-native-node-id="destination-shell"]')
        .evaluate((node) => getComputedStyle(node).display),
    ).toBe("flex");
    expect(
      await designFrame(page, design.destinationId)
        .locator('[data-agent-native-node-id="nested-auto"]')
        .evaluate((node) => getComputedStyle(node).display),
    ).toBe("flex");
    const release = {
      x: first.x + first.width / 2,
      y: first.y + first.height * 0.75,
    };
    expect(release.x).toBeGreaterThan(inner.x);
    expect(release.x).toBeLessThan(inner.x + inner.width);
    expect(release.y).toBeGreaterThan(inner.y);
    expect(release.y).toBeLessThan(inner.y + inner.height);
    expect(release.x).toBeGreaterThan(outer.x);
    expect(release.x).toBeLessThan(outer.x + outer.width);
    const sourceBefore = await fileContent(page, design.id, "index.html");
    const destinationBefore = await fileContent(
      page,
      design.id,
      "destination.html",
    );
    const held = await dragScreenNode(
      page,
      design.sourceId,
      "free-source",
      release,
      async () => {
        expect(await fileContent(page, design.id, "index.html")).toBe(
          sourceBefore,
        );
        expect(await fileContent(page, design.id, "destination.html")).toBe(
          destinationBefore,
        );
        await expect(
          designFrame(page, design.sourceId).locator(
            '[data-agent-native-node-id="free-source"]',
          ),
        ).toHaveCount(1);
      },
      { x: 0.31, y: 0.68 },
    );
    expect(held.guide).toBeGreaterThan(0);
    expect(held.ghost).toBeGreaterThan(0);
    expect(held.sourceVisible).toBe(true);
    expectGhostToPreserveGrabOffset(held);
    expectGuideAfterChild(held, first);

    await expect
      .poll(() =>
        readMoveState(
          page,
          design.id,
          "index.html",
          "destination.html",
          "free-source",
        ),
      )
      .toEqual({ sourceHas: false, destinationHas: true });
    await expect
      .poll(() =>
        designFrame(page, design.destinationId)
          .locator('[data-agent-native-node-id="free-source"]')
          .evaluate((node) => {
            const parent = node.parentElement;
            const rect = node.getBoundingClientRect();
            const parentRect = parent?.getBoundingClientRect();
            return {
              parent: parent?.getAttribute("data-agent-native-node-id"),
              order: parent
                ? Array.from(parent.children).map((child) =>
                    child.getAttribute("data-agent-native-node-id"),
                  )
                : [],
              position: getComputedStyle(node).position,
              left: Math.round(rect.left - (parentRect?.left ?? 0)),
              top: Math.round(rect.top - (parentRect?.top ?? 0)),
            };
          }),
      )
      .toEqual({
        parent: "nested-auto",
        order: ["destination-first", "free-source", "destination-second"],
        position: "static",
        left: 16,
        top: 68,
      });

    await page.keyboard.press(`${PRIMARY}+z`);
    await expect
      .poll(() =>
        readMoveState(
          page,
          design.id,
          "index.html",
          "destination.html",
          "free-source",
        ),
      )
      .toEqual({ sourceHas: true, destinationHas: false });
    await page.keyboard.press(`${PRIMARY}+Shift+z`);
    await expect
      .poll(() =>
        readMoveState(
          page,
          design.id,
          "index.html",
          "destination.html",
          "free-source",
        ),
      )
      .toEqual({ sourceHas: false, destinationHas: true });
    await settleReload(page);
    await expect(
      designFrame(page, design.destinationId).locator(
        '[data-agent-native-node-id="free-source"]',
      ),
    ).toBeVisible();
    await expect
      .poll(() =>
        designFrame(page, design.destinationId)
          .locator('[data-agent-native-node-id="free-source"]')
          .evaluate((node) =>
            node.parentElement?.getAttribute("data-agent-native-node-id"),
          ),
      )
      .toBe("nested-auto");
    await expect
      .poll(() =>
        designFrame(page, design.destinationId)
          .locator('[data-agent-native-node-id="free-source"]')
          .evaluate((node) => {
            const parent = node.parentElement;
            const rect = node.getBoundingClientRect();
            const parentRect = parent?.getBoundingClientRect();
            return {
              parent: parent?.getAttribute("data-agent-native-node-id"),
              order: parent
                ? Array.from(parent.children).map((child) =>
                    child.getAttribute("data-agent-native-node-id"),
                  )
                : [],
              position: getComputedStyle(node).position,
              left: Math.round(rect.left - (parentRect?.left ?? 0)),
              top: Math.round(rect.top - (parentRect?.top ?? 0)),
            };
          }),
      )
      .toEqual({
        parent: "nested-auto",
        order: ["destination-first", "free-source", "destination-second"],
        position: "static",
        left: 16,
        top: 68,
      });
  });

  test("G4: blank space in an auto-layout receiver uses the pointer insertion slot", async ({
    page,
  }) => {
    const design = await createDesign(
      page,
      (id) =>
        test.info().annotations.push({ type: "design-id", description: id }),
      {
        sourceContent: NESTED_SOURCE_SCREEN,
        destinationContent: NESTED_DESTINATION_SCREEN,
        title: "cross-screen nested flow to auto-layout receiver",
      },
    );
    await gotoEditor(page, design.id);
    await settleScreens(page, design.sourceId, design.destinationId, {});

    const receiver = await boxFor(
      page,
      design.destinationId,
      "destination-shell",
    );
    const marker = await boxFor(
      page,
      design.destinationId,
      "destination-outer-anchor",
    );
    const release = {
      x: receiver.x + receiver.width - 24,
      y: receiver.y + receiver.height / 2,
    };
    expect(release.x).toBeGreaterThan(marker.x + marker.width);
    expect(release.x).toBeLessThan(receiver.x + receiver.width);
    const sourceBefore = await fileContent(page, design.id, "index.html");
    const destinationBefore = await fileContent(
      page,
      design.id,
      "destination.html",
    );
    const held = await dragScreenNode(
      page,
      design.sourceId,
      "nested-source",
      release,
      async () => {
        expect(await fileContent(page, design.id, "index.html")).toBe(
          sourceBefore,
        );
        expect(await fileContent(page, design.id, "destination.html")).toBe(
          destinationBefore,
        );
      },
    );
    expect(held.sourceVisible).toBe(true);
    expectGhostToPreserveGrabOffset(held);
    expectGuideAfterChildAlongX(held, marker);

    await expect
      .poll(() =>
        readMoveState(
          page,
          design.id,
          "index.html",
          "destination.html",
          "nested-source",
        ),
      )
      .toEqual({ sourceHas: false, destinationHas: true });
    await expect
      .poll(() =>
        designFrame(page, design.destinationId)
          .locator('[data-agent-native-node-id="nested-source"]')
          .evaluate((node) => ({
            parent: node.parentElement?.getAttribute(
              "data-agent-native-node-id",
            ),
            order: node.parentElement
              ? Array.from(node.parentElement.children).map((child) =>
                  child.getAttribute("data-agent-native-node-id"),
                )
              : [],
            position: getComputedStyle(node).position,
          })),
      )
      .toEqual({
        parent: "destination-shell",
        order: ["nested-auto", "destination-outer-anchor", "nested-source"],
        position: "static",
      });
  });

  test("report path: free source drops at an empty Screen root with exact pointer position, undo, and reload", async ({
    page,
  }) => {
    const design = await createDesign(
      page,
      (id) =>
        test.info().annotations.push({ type: "design-id", description: id }),
      {
        sourceContent: FREE_SOURCE_SCREEN,
        destinationContent: EMPTY_DESTINATION_SCREEN,
        title: "cross-screen empty root report",
      },
    );
    await gotoEditor(page, design.id);
    await settleScreens(page, design.sourceId, design.destinationId, {});

    const destinationFrame = page.locator(
      `iframe[data-design-preview-iframe][data-screen-iframe-id="${design.destinationId}"]`,
    );
    const destinationBody = destinationFrame.contentFrame().locator("body");
    const destinationBox = (await destinationBody.boundingBox())!;
    const release = {
      x: destinationBox.x + destinationBox.width * 0.3,
      y: destinationBox.y + destinationBox.height * 0.28,
    };
    const sourceBefore = await fileContent(page, design.id, "index.html");
    const destinationBefore = await fileContent(
      page,
      design.id,
      "destination.html",
    );
    const held = await dragScreenNode(
      page,
      design.sourceId,
      "free-source",
      release,
      async () => {
        expect(await fileContent(page, design.id, "index.html")).toBe(
          sourceBefore,
        );
        expect(await fileContent(page, design.id, "destination.html")).toBe(
          destinationBefore,
        );
      },
    );
    expect(held.guide).toBeGreaterThan(0);
    expect(held.ghost).toBeGreaterThan(0);
    expect(held.sourceVisible).toBe(true);
    expectGhostToPreserveGrabOffset(held);
    expectGuideToContainPointer(held);

    await expect
      .poll(() =>
        readMoveState(
          page,
          design.id,
          "index.html",
          "destination.html",
          "free-source",
        ),
      )
      .toEqual({ sourceHas: false, destinationHas: true });
    const moved = designFrame(page, design.destinationId).locator(
      '[data-agent-native-node-id="free-source"]',
    );
    await expect(moved).toBeVisible();
    await expect
      .poll(async () => {
        const box = await moved.boundingBox();
        return box ? Math.abs(box.x + box.width / 2 - release.x) : Infinity;
      })
      .toBeLessThan(5);
    await expect
      .poll(async () => {
        const box = await moved.boundingBox();
        return box ? Math.abs(box.y + box.height / 2 - release.y) : Infinity;
      })
      .toBeLessThan(5);
    await expect
      .poll(() =>
        moved.evaluate((node) => ({
          parent: node.parentElement?.tagName,
          position: getComputedStyle(node).position,
          left: getComputedStyle(node).left,
          top: getComputedStyle(node).top,
        })),
      )
      .toMatchObject({ parent: "BODY", position: "absolute" });
    const movedPosition = await moved.evaluate((node) => {
      const style = getComputedStyle(node);
      return { left: style.left, top: style.top };
    });

    await page.keyboard.press(`${PRIMARY}+z`);
    await expect
      .poll(() =>
        readMoveState(
          page,
          design.id,
          "index.html",
          "destination.html",
          "free-source",
        ),
      )
      .toEqual({ sourceHas: true, destinationHas: false });
    await page.keyboard.press(`${PRIMARY}+Shift+z`);
    await expect
      .poll(() =>
        readMoveState(
          page,
          design.id,
          "index.html",
          "destination.html",
          "free-source",
        ),
      )
      .toEqual({ sourceHas: false, destinationHas: true });
    await settleReload(page);
    await expect(
      designFrame(page, design.destinationId).locator(
        '[data-agent-native-node-id="free-source"]',
      ),
    ).toBeVisible();
    const reloadedMoved = designFrame(page, design.destinationId).locator(
      '[data-agent-native-node-id="free-source"]',
    );
    await expect
      .poll(() =>
        reloadedMoved.evaluate((node) => ({
          parent: node.parentElement?.tagName,
          position: getComputedStyle(node).position,
          left: getComputedStyle(node).left,
          top: getComputedStyle(node).top,
        })),
      )
      .toMatchObject({
        parent: "BODY",
        position: "absolute",
        ...movedPosition,
      });
  });

  test("report path: nested flow source drops at an empty Screen root with exact pointer position, undo, and reload", async ({
    page,
  }) => {
    const design = await createDesign(
      page,
      (id) =>
        test.info().annotations.push({ type: "design-id", description: id }),
      {
        sourceContent: NESTED_SOURCE_SCREEN,
        destinationContent: EMPTY_DESTINATION_SCREEN,
        title: "cross-screen nested source empty root report",
      },
    );
    await gotoEditor(page, design.id);
    await settleScreens(page, design.sourceId, design.destinationId, {});

    const destinationFrame = page.locator(
      `iframe[data-design-preview-iframe][data-screen-iframe-id="${design.destinationId}"]`,
    );
    const destinationBody = destinationFrame.contentFrame().locator("body");
    const destinationBox = (await destinationBody.boundingBox())!;
    const release = {
      x: destinationBox.x + destinationBox.width * 0.64,
      y: destinationBox.y + destinationBox.height * 0.34,
    };
    const sourceBefore = await fileContent(page, design.id, "index.html");
    const destinationBefore = await fileContent(
      page,
      design.id,
      "destination.html",
    );
    const held = await dragScreenNode(
      page,
      design.sourceId,
      "nested-source",
      release,
      async () => {
        expect(await fileContent(page, design.id, "index.html")).toBe(
          sourceBefore,
        );
        expect(await fileContent(page, design.id, "destination.html")).toBe(
          destinationBefore,
        );
      },
    );
    expect(held.guide).toBeGreaterThan(0);
    expect(held.ghost).toBeGreaterThan(0);
    expect(held.sourceVisible).toBe(true);
    expectGhostToPreserveGrabOffset(held);
    expectGuideToContainPointer(held);

    await expect
      .poll(() =>
        readMoveState(
          page,
          design.id,
          "index.html",
          "destination.html",
          "nested-source",
        ),
      )
      .toEqual({ sourceHas: false, destinationHas: true });
    const moved = designFrame(page, design.destinationId).locator(
      '[data-agent-native-node-id="nested-source"]',
    );
    await expect(moved).toBeVisible();
    await expect
      .poll(async () => {
        const box = await moved.boundingBox();
        return box ? Math.abs(box.x + box.width / 2 - release.x) : Infinity;
      })
      .toBeLessThan(5);
    await expect
      .poll(async () => {
        const box = await moved.boundingBox();
        return box ? Math.abs(box.y + box.height / 2 - release.y) : Infinity;
      })
      .toBeLessThan(5);
    await expect
      .poll(() =>
        moved.evaluate((node) => ({
          parent: node.parentElement?.tagName,
          position: getComputedStyle(node).position,
        })),
      )
      .toEqual({ parent: "BODY", position: "absolute" });

    await page.keyboard.press(`${PRIMARY}+z`);
    await expect
      .poll(() =>
        readMoveState(
          page,
          design.id,
          "index.html",
          "destination.html",
          "nested-source",
        ),
      )
      .toEqual({ sourceHas: true, destinationHas: false });
    await page.keyboard.press(`${PRIMARY}+Shift+z`);
    await expect
      .poll(() =>
        readMoveState(
          page,
          design.id,
          "index.html",
          "destination.html",
          "nested-source",
        ),
      )
      .toEqual({ sourceHas: false, destinationHas: true });
    const movedPosition = await moved.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        parent: node.parentElement?.tagName,
        position: style.position,
        left: style.left,
        top: style.top,
      };
    });
    expect(movedPosition).toMatchObject({
      parent: "BODY",
      position: "absolute",
    });
    await settleReload(page);
    const reloaded = designFrame(page, design.destinationId).locator(
      '[data-agent-native-node-id="nested-source"]',
    );
    await expect(reloaded).toBeVisible();
    await expect
      .poll(() =>
        reloaded.evaluate((node) => {
          const style = getComputedStyle(node);
          return {
            parent: node.parentElement?.tagName,
            position: style.position,
            left: style.left,
            top: style.top,
          };
        }),
      )
      .toEqual(movedPosition);
  });
});
