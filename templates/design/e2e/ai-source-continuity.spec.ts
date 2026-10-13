import { readFileSync } from "node:fs";

import { type Page } from "@playwright/test";

import { stripEditorOnlyAttributes } from "../shared/code-layer.js";
import {
  appPath,
  designFrame,
  enterDirectMode,
  expandAllLayers,
  gotoEditor,
  installBridge,
  selectByText,
} from "./helpers";
import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

const AI_SOURCE = readFileSync(
  new URL("./fixtures/luna-orbit-after-ai.html", import.meta.url),
  "utf8",
);
const PRIMARY_DECLARATION = "--primary: #0f766e;";

const AI_BRIDGE_SOURCE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>AI bridge replay</title></head>
  <body style="margin:0;min-height:900px;background:#0f1115;color:#fff">
    <main data-agent-native-layer-name="AI Dashboard" style="position:relative;width:900px;height:700px;padding:40px">
      <section data-agent-native-layer-name="Hero Panel" style="position:absolute;left:80px;top:80px;width:360px;height:240px;padding:16px;background:#1f2937">
        <div data-agent-native-layer-name="Move me" style="position:absolute;left:24px;top:64px;width:160px;height:56px;padding:8px;background:#0ea5e9">Move me</div>
      </section>
      <div data-agent-native-layer-name="Drop me" style="position:absolute;left:560px;top:100px;width:160px;height:56px;padding:8px;background:#f97316">Drop me</div>
      <div id="untitled-card" style="position:absolute;left:560px;top:220px;width:160px;height:56px;padding:8px;background:#22c55e">Untitled</div>
    </main>
  </body>
</html>`;

async function action(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  return page.request.post(appPath(`/_agent-native/actions/${name}`), {
    data: input,
  });
}

async function readSource(page: Page, designId: string): Promise<string> {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  const design = await response.json();
  const source = design.files?.find(
    (file: { filename?: string }) => file.filename === "index.html",
  )?.content;
  if (typeof source !== "string")
    throw new Error("index.html source is missing");
  return source;
}

async function readTaskSourceState(page: Page, designId: string) {
  const source = await readSource(page, designId);
  return page.evaluate((html) => {
    const document = new DOMParser().parseFromString(html, "text/html");
    return Array.from(document.querySelectorAll<HTMLElement>(".task-name"))
      .slice(0, 2)
      .map((node) => ({
        id: node.getAttribute("data-agent-native-node-id"),
        text: node.textContent?.trim() ?? "",
        fontSize: node.style.fontSize || null,
      }));
  }, source);
}

async function readHeadingSourceState(page: Page, designId: string) {
  const source = await readSource(page, designId);
  return page.evaluate((html) => {
    const document = new DOMParser().parseFromString(html, "text/html");
    const heading = document.querySelector("h1.title");
    return {
      nodeId: heading?.getAttribute("data-agent-native-node-id") ?? null,
      fontSize: (heading as HTMLElement | null)?.style.fontSize ?? null,
    };
  }, source);
}

async function readPrimaryPaintSourceState(page: Page, designId: string) {
  const source = await readSource(page, designId);
  return page.evaluate((html) => {
    const document = new DOMParser().parseFromString(html, "text/html");
    const style = document.querySelector("style")?.textContent ?? "";
    const primary = document.querySelector<HTMLElement>("#addTask");
    if (!primary) throw new Error("Orbit primary button is missing");
    return {
      nodeId: primary.getAttribute("data-agent-native-node-id"),
      inlineBackgroundColor: primary.style.backgroundColor || null,
      style,
    };
  }, source);
}

function layerRow(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first()
    .locator('xpath=ancestor::*[@role="treeitem"][1]');
}

function idByLayerName(nodes: Map<string, SavedNode>, name: string) {
  const node = [...nodes.values()].find(
    (candidate) => candidate.attrs["data-agent-native-layer-name"] === name,
  );
  if (!node) throw new Error(`no saved layer named ${name}`);
  return node.id;
}

// fixme: fails in CI on current main: expect(locator).toHaveAttribute(expected) failed
test.fixme("Layers-first editing preserves identity in the AI-generated Orbit source", async ({
  app,
}) => {
  const sourceWithoutEditorIds = stripEditorOnlyAttributes(AI_SOURCE);
  expect(sourceWithoutEditorIds).not.toContain("data-agent-native-node-id=");
  const designId = await app.seed(sourceWithoutEditorIds);
  const before = await app.savedNodes(designId);
  const heading = [...before.values()].find(
    (node) => node.tag === "h1" && node.attrs.class === "title",
  );
  expect(heading?.id).toMatch(/^an-/);
  expect(styleOf(heading)).toEqual({ "font-size": "36px" });
  const headingId = heading!.id;

  await app.open(designId);
  await expandAllLayers(app.page);
  const titleLayer = layerRow(app.page, "Launch overview");
  await titleLayer.click();
  await expect(titleLayer).toHaveAttribute("aria-selected", "true");
  const size = app.page.locator('input[aria-label="Size" i]').first();
  await size.fill("38");
  await size.press("Enter");
  await app.settled();

  const after = await app.savedNodes(designId);
  expect(styleOf(after.get(headingId))).toEqual({ "font-size": "38px" });
  expectOnlyChanged(before, after, [headingId]);

  await app.page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    app.page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      app.node(headingId).evaluate((node) => getComputedStyle(node).fontSize),
    )
    .toBe("38px");
  await app.settled();
  expectOnlyChanged(after, await app.savedNodes(designId), []);
});

async function openGeneratedDashboard(app: App) {
  const created = await action(app.page, "create-design", {
    title: `AI bridge replay ${Date.now()}`,
    projectType: "prototype",
    designSystemId: null,
  });
  expect(created.ok(), await created.text()).toBe(true);
  const createdBody = await created.json();
  const designId: string = createdBody.id ?? createdBody.data?.id;
  app.adopt(designId);
  const generated = await action(app.page, "generate-design", {
    designId,
    prompt: "Generate a dashboard with a movable hero card.",
    files: [
      { filename: "index.html", content: AI_BRIDGE_SOURCE, fileType: "html" },
    ],
    devices: ["desktop"],
  });
  expect(generated.ok(), await generated.text()).toBe(true);

  const before = await app.savedNodes(designId);
  const ids = {
    main: idByLayerName(before, "AI Dashboard"),
    hero: idByLayerName(before, "Hero Panel"),
    move: idByLayerName(before, "Move me"),
    drop: idByLayerName(before, "Drop me"),
  };
  expect(Object.values(ids)).toEqual([
    expect.stringMatching(/^an-/),
    expect.stringMatching(/^an-/),
    expect.stringMatching(/^an-/),
    expect.stringMatching(/^an-/),
  ]);
  expect(before.get(ids.move)?.parent).toBe(ids.hero);
  expect(before.get(ids.drop)?.parent).toBe(ids.main);

  await app.open(designId);
  await app.zoomToFit();
  return { designId, before, ids };
}

async function dragByCenter(
  app: App,
  nodeId: string,
  toX: number,
  toY: number,
) {
  const rect = await app.designRect(nodeId);
  const from = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await app.page.mouse.click(from.x, from.y);
  const to = await app.pagePoint(toX, toY);
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(to.x, to.y, { steps: 12 });
  await app.page.mouse.up();
  await app.settled();
}

test("moving a layer in AI-generated source keeps its node ID and lands where it was dropped", async ({
  app,
}) => {
  const { designId, before, ids } = await openGeneratedDashboard(app);
  const rect = await app.designRect(ids.move);
  expect(rect).toEqual({ x: 104, y: 144, width: 176, height: 72 });

  await dragByCenter(app, ids.move, 218, 276);

  const after = await app.savedNodes(designId);
  expect(after.get(ids.move)?.parent).toBe(ids.hero);
  expect(styleOf(after.get(ids.move))).toEqual({
    ...styleOf(before.get(ids.move)),
    left: "50px",
    top: "160px",
  });
  expectOnlyChanged(before, after, [ids.move]);
  expect(await app.designRect(ids.move)).toEqual({
    x: 130,
    y: 240,
    width: 176,
    height: 72,
  });
});

// fixme: product bug: The reparent and the drop position are right (left 160px, top 156px), but the save rewrites the dropped layer's background #f97316 as rgb(249, 115, 22).
test.fixme("dropping a layer from AI-generated source into a panel keeps its node ID and its drop position", async ({
  app,
}) => {
  const { designId, before, ids } = await openGeneratedDashboard(app);
  expect(await app.designRect(ids.drop)).toEqual({
    x: 560,
    y: 100,
    width: 176,
    height: 72,
  });

  await dragByCenter(app, ids.drop, 328, 272);

  const after = await app.savedNodes(designId);
  expect(childrenOf(after, ids.hero)).toStrictEqual([ids.move, ids.drop]);
  expect(styleOf(after.get(ids.drop))).toEqual({
    ...styleOf(before.get(ids.drop)),
    left: "160px",
    top: "156px",
  });
  expectOnlyChanged(before, after, [ids.drop]);
  expect(await app.designRect(ids.drop)).toEqual({
    x: 240,
    y: 236,
    width: 176,
    height: 72,
  });

  await app.page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    app.page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible();
  await expect(app.node(ids.drop)).toBeVisible();
  await app.settled();
  const reloaded = await app.savedHtml(designId);
  expect(reloaded).not.toMatch(/data-agent-native-node-id=["']runtime-/);
  expectOnlyChanged(after, await app.savedNodes(designId), []);
});

// fixme: fails in CI on current main: expect(locator).toHaveAttribute(expected) failed
test.fixme("duplicate authored IDs are repaired before Layers-first edits and persist after reload", async ({
  app,
  page,
}) => {
  const designId = await app.seed("<html><body></body></html>");
  const duplicateId = "duplicate-ai-task-name";
  const sourceWithoutEditorIds = stripEditorOnlyAttributes(AI_SOURCE);
  const duplicatedSource = sourceWithoutEditorIds
    .replace(
      /(<div\s+class="task-name"[^>]*)(>\s*Refine onboarding flow\s*<\/div>)/,
      `$1 data-agent-native-node-id="${duplicateId}"$2`,
    )
    .replace(
      /(<div\s+class="task-name"[^>]*)(>\s*Prepare launch brief\s*<\/div>)/,
      `$1 data-agent-native-node-id="${duplicateId}"$2`,
    );
  expect(duplicatedSource).not.toBe(sourceWithoutEditorIds);

  const fileId = (await app.savedRecord(designId)).files.find(
    (file) => file.filename === "index.html",
  )!.id;
  const update = await action(page, "update-file", {
    id: fileId,
    content: duplicatedSource,
  });
  if (!update.ok()) {
    throw new Error(`update-file: ${await update.text()}`);
  }
  expect(await readTaskSourceState(page, designId)).toEqual([
    { id: duplicateId, text: "Refine onboarding flow", fontSize: null },
    { id: duplicateId, text: "Prepare launch brief", fontSize: null },
  ]);

  await gotoEditor(page, designId);
  await expandAllLayers(page);
  const layers = page.getByRole("tree", { name: "Layers" });
  const taskLayer = (name: string) =>
    layers
      .locator("[data-layer-row-button][data-layer-node-id]")
      .filter({ has: page.locator(`span[title="${name}"]`) })
      .first()
      .locator('xpath=ancestor::*[@role="treeitem"][1]');
  const firstTaskLayer = taskLayer("Refine onboarding flow");
  const secondTaskLayer = taskLayer("Prepare launch brief");
  await expect(firstTaskLayer).toBeVisible();
  await expect(secondTaskLayer).toBeVisible();
  await secondTaskLayer.click();
  await expect(secondTaskLayer).toHaveAttribute("aria-selected", "true");

  await expect
    .poll(() => readTaskSourceState(page, designId))
    .toMatchObject([
      { id: duplicateId, text: "Refine onboarding flow", fontSize: null },
      {
        id: expect.stringMatching(/^an-/),
        text: "Prepare launch brief",
        fontSize: null,
      },
    ]);

  const size = page.locator('input[aria-label="Size" i]').first();
  await expect(size).toBeVisible();
  await size.fill("19");
  await size.press("Enter");

  await expect
    .poll(() => readTaskSourceState(page, designId))
    .toEqual([
      { id: duplicateId, text: "Refine onboarding flow", fontSize: null },
      {
        id: expect.stringMatching(/^an-/),
        text: "Prepare launch brief",
        fontSize: "19px",
      },
    ]);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      designFrame(page)
        .locator(".task-name")
        .filter({ hasText: "Prepare launch brief" })
        .evaluate((node) => getComputedStyle(node).fontSize),
    )
    .toBe("19px");
  await expect
    .poll(() => readTaskSourceState(page, designId))
    .toEqual([
      { id: duplicateId, text: "Refine onboarding flow", fontSize: null },
      {
        id: expect.stringMatching(/^an-/),
        text: "Prepare launch brief",
        fontSize: "19px",
      },
    ]);
  await expect(
    page.getByText(/not found in sourceHtml|ambiguous/i),
  ).toHaveCount(0);
});

test("stylesheet-backed Fill stays editable after Layers reselection and undo", async ({
  app,
  page,
}) => {
  const designId = await app.seed(AI_SOURCE);

  await gotoEditor(page, designId);
  const initial = await readPrimaryPaintSourceState(page, designId);
  expect(initial.nodeId).toBeTruthy();
  expect(initial.inlineBackgroundColor).toBeNull();
  expect(initial.style).toContain(PRIMARY_DECLARATION);

  const frame = designFrame(page);
  const primary = frame.locator("#addTask");
  await expect
    .poll(() =>
      primary.evaluate((node) => getComputedStyle(node).backgroundColor),
    )
    .toBe("rgb(15, 118, 110)");
  await enterDirectMode(page);
  await installBridge(page);
  await page.evaluate(() => {
    (window as Window & { __bridge?: unknown[] }).__bridge = [];
  });
  const canvasSelection = await selectByText(page, "＋ Add task");
  expect(canvasSelection.tagName).toBe("button");
  expect(canvasSelection.sourceId).toBe(initial.nodeId);
  expect(canvasSelection.computedStyles?.backgroundColor).toBe(
    "rgb(15, 118, 110)",
  );

  const layers = page.getByRole("tree", { name: "Layers" });
  const selected = layers.locator('[role="treeitem"][aria-selected="true"]');
  await expect(selected).toBeVisible();
  const fillHeading = page.getByRole("heading", { name: /^Fill$/i });
  const fill = page.locator("section").filter({ has: fillHeading }).first();
  await expect(
    fill.getByRole("textbox", { name: "Color", exact: true }),
  ).toHaveValue("0F766E");
  await fill.getByRole("button", { name: "Open color picker" }).click();
  const hex = page.getByRole("textbox", { name: "Hex", exact: true });
  await expect(hex).toHaveValue("0F766E");
  await page.keyboard.press("Escape");

  await selected.click();
  await expect(selected).toHaveAttribute("aria-selected", "true");

  await expect(
    fill.getByRole("button", { name: "Open color picker" }),
  ).toBeVisible();
  await fill.getByRole("button", { name: "Open color picker" }).click();
  await expect(hex).toHaveValue("0F766E");
  await hex.fill("4338CA");
  await hex.press("Enter");
  await page.keyboard.press("Escape");

  await expect
    .poll(() =>
      primary.evaluate((node) => getComputedStyle(node).backgroundColor),
    )
    .toBe("rgb(67, 56, 202)");
  await expect
    .poll(() => readPrimaryPaintSourceState(page, designId))
    .toMatchObject({
      inlineBackgroundColor: expect.stringMatching(
        /4338ca|rgb\(67,\s*56,\s*202\)/i,
      ),
      style: initial.style,
    });

  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(() => readPrimaryPaintSourceState(page, designId))
    .toMatchObject({ inlineBackgroundColor: null, style: initial.style });
  await expect
    .poll(() =>
      primary.evaluate((node) => getComputedStyle(node).backgroundColor),
    )
    .toBe("rgb(15, 118, 110)");

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect
    .poll(() => readPrimaryPaintSourceState(page, designId))
    .toMatchObject({
      inlineBackgroundColor: expect.stringMatching(
        /4338ca|rgb\(67,\s*56,\s*202\)/i,
      ),
      style: initial.style,
    });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      designFrame(page)
        .locator("#addTask")
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    )
    .toBe("rgb(67, 56, 202)");
  await expect
    .poll(() => readPrimaryPaintSourceState(page, designId))
    .toMatchObject({
      inlineBackgroundColor: expect.stringMatching(
        /4338ca|rgb\(67,\s*56,\s*202\)/i,
      ),
      style: initial.style,
    });
});

// fixme: fails in CI on current main: expect(locator).toHaveAttribute(expected) failed
test.fixme("edit-design rejects malformed AI CSS without changing the styled canvas", async ({
  app,
  page,
}) => {
  const designId = await app.seed(AI_SOURCE);

  await gotoEditor(page, designId);
  const sourceBefore = await readSource(page, designId);
  expect(sourceBefore).toContain(PRIMARY_DECLARATION);

  const primaryBackground = () =>
    designFrame(page)
      .locator(".primary")
      .first()
      .evaluate((node) => getComputedStyle(node).backgroundColor);
  await expect.poll(primaryBackground).toBe("rgb(15, 118, 110)");

  const malformed = await action(page, "edit-design", {
    designId,
    filename: "index.html",
    edits: [
      {
        search: PRIMARY_DECLARATION,
        replace: `${PRIMARY_DECLARATION}\"}]`,
      },
    ],
  });
  const malformedBody = await malformed.text();
  expect(malformed.status()).toBe(422);
  expect(malformedBody).toContain("DESIGN_HTML_INTEGRITY");
  expect(await readSource(page, designId)).toBe(sourceBefore);
  await expect.poll(primaryBackground).toBe("rgb(15, 118, 110)");

  const repaired = await action(page, "edit-design", {
    designId,
    filename: "index.html",
    edits: [
      {
        search: "<style>",
        replace: "<style><!--",
      },
      {
        search: PRIMARY_DECLARATION,
        replace: "--primary: #0f766d;",
      },
      {
        search: "</style>",
        replace: "--></style>",
      },
    ],
  });
  expect(repaired.status()).toBe(200);
  await expect
    .poll(() => readSource(page, designId))
    .toContain("--primary: #0f766d;");
  const repairedSource = await readSource(page, designId);
  expect(repairedSource).toContain("<style><!--");
  expect(repairedSource).toContain("--></style>");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible();
  await expect.poll(primaryBackground).toBe("rgb(15, 118, 109)");

  await expandAllLayers(page);
  const layers = page.getByRole("tree", { name: "Layers" });
  const titleLayer = layers
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator('span[title="Launch overview"]') })
    .first()
    .locator('xpath=ancestor::*[@role="treeitem"][1]');
  await expect(titleLayer).toBeVisible();
  await titleLayer.click();
  await expect(titleLayer).toHaveAttribute("aria-selected", "true");

  const titleSize = page.locator('input[aria-label="Size" i]').first();
  await expect(titleSize).toBeVisible();
  await titleSize.fill("34");
  await titleSize.press("Enter");

  await expect
    .poll(() => readHeadingSourceState(page, designId))
    .toMatchObject({ fontSize: "34px" });
  await expect(
    designFrame(page)
      .locator("h1.title")
      .evaluate((node) => getComputedStyle(node).fontSize),
  ).resolves.toBe("34px");
  const manuallyEditedSource = await readSource(page, designId);
  expect(manuallyEditedSource).toContain("<style><!--");
  expect(manuallyEditedSource).toContain("--></style>");
  expect(manuallyEditedSource).toContain('style="font-size: 34px');

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible();
  await expect.poll(primaryBackground).toBe("rgb(15, 118, 109)");
  await expect
    .poll(() =>
      designFrame(page)
        .locator("h1.title")
        .evaluate((node) => getComputedStyle(node).fontSize),
    )
    .toBe("34px");
  const reloadedSource = await readSource(page, designId);
  expect(reloadedSource).toContain("<style><!--");
  expect(reloadedSource).toContain("--></style>");
  expect(reloadedSource).toContain('style="font-size: 34px');
});
