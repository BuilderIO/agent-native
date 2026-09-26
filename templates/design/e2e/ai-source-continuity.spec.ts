import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { stripEditorOnlyAttributes } from "../shared/code-layer.js";
import {
  appPath,
  cdpScreenshot,
  designFrame,
  dragCanvasByText,
  enterDirectMode,
  expandAllLayers,
  gotoEditor,
  installBridge,
  selectByText,
  waitForBridge,
} from "./helpers";

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

async function createDesign(page: Page, content: string): Promise<string> {
  const createdResponse = await action(page, "create-design", {
    title: `AI source continuity ${Date.now()}`,
    projectType: "prototype",
    designSystemId: null,
  });
  if (!createdResponse.ok()) {
    throw new Error(`create-design: ${await createdResponse.text()}`);
  }
  const created = await createdResponse.json();
  const designId = created.id ?? created.data?.id;
  if (typeof designId !== "string") throw new Error("create-design has no id");

  const fileResponse = await action(page, "create-file", {
    designId,
    filename: "index.html",
    content,
    fileType: "html",
  });
  if (!fileResponse.ok()) {
    throw new Error(`create-file: ${await fileResponse.text()}`);
  }
  return designId;
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

async function readIndexFileId(page: Page, designId: string): Promise<string> {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  const design = await response.json();
  const fileId = design.files?.find(
    (file: { filename?: string }) => file.filename === "index.html",
  )?.id;
  if (typeof fileId !== "string") throw new Error("index.html id is missing");
  return fileId;
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

async function readLayerSourceState(
  page: Page,
  designId: string,
  selector: string,
) {
  const source = await readSource(page, designId);
  return page.evaluate(
    ({ html, selector: nodeSelector }) => {
      const document = new DOMParser().parseFromString(html, "text/html");
      const node = document.querySelector<HTMLElement>(nodeSelector);
      if (!node) throw new Error(`missing source layer ${nodeSelector}`);
      return {
        id: node.getAttribute("data-agent-native-node-id"),
        parentId:
          node.parentElement?.getAttribute("data-agent-native-node-id") ?? null,
        style: node.getAttribute("style") ?? "",
      };
    },
    { html: source, selector },
  );
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

async function deleteDesign(page: Page, designId: string): Promise<void> {
  const response = await action(page, "delete-design", { id: designId });
  if (!response.ok()) {
    throw new Error(`delete-design: ${await response.text()}`);
  }
}

test("Layers-first editing preserves identity in the AI-generated Orbit source", async ({
  page,
}) => {
  const sourceWithoutEditorIds = stripEditorOnlyAttributes(AI_SOURCE);
  expect(sourceWithoutEditorIds).not.toContain("data-agent-native-node-id=");
  const designId = await createDesign(page, sourceWithoutEditorIds);

  try {
    const initialSource = await readSource(page, designId);
    const initialHeading = await readHeadingSourceState(page, designId);
    expect(initialHeading.nodeId).toMatch(/^an-/);
    expect(initialHeading.fontSize).toBe("36px");
    expect(initialSource).toContain(
      `data-agent-native-node-id="${initialHeading.nodeId}"`,
    );

    await gotoEditor(page, designId);
    await expandAllLayers(page);
    const layers = page.getByRole("tree", { name: "Layers" });
    const topbar = layers
      .locator('[role="treeitem"]')
      .filter({ has: page.locator('span[title="Topbar"]') })
      .first();
    const expandTopbar = topbar.getByRole("button", {
      name: "Expand layer",
      exact: true,
    });
    if ((await expandTopbar.count()) > 0) {
      await expandTopbar.click({ modifiers: ["Alt"] });
    }
    const titleLayer = layers
      .locator("[data-layer-row-button][data-layer-node-id]")
      .filter({ has: page.locator('span[title="Launch overview"]') })
      .first()
      .locator('xpath=ancestor::*[@role="treeitem"][1]');
    await expect(titleLayer).toBeVisible();
    await titleLayer.click();
    await expect(titleLayer).toHaveAttribute("aria-selected", "true");

    const size = page.locator('input[aria-label="Size" i]').first();
    await expect(size).toBeVisible();
    await size.fill("38");
    await size.press("Enter");

    await expect
      .poll(() => readHeadingSourceState(page, designId))
      .toMatchObject({
        nodeId: initialHeading.nodeId,
        fontSize: "38px",
      });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        designFrame(page)
          .locator("h1.title")
          .evaluate((node) => getComputedStyle(node).fontSize),
      )
      .toBe("38px");
    await expect
      .poll(() => readHeadingSourceState(page, designId))
      .toMatchObject({
        nodeId: initialHeading.nodeId,
        fontSize: "38px",
      });
  } finally {
    await deleteDesign(page, designId);
  }
});

test("AI-generated sidebar source keeps node IDs through bridge move, reparent, and reload", async ({
  page,
}) => {
  const surfacedErrors: string[] = [];
  page.on("pageerror", (error) => surfacedErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Outdated Optimize Dep|favicon|React DevTools/i.test(text)) return;
    surfacedErrors.push(text);
  });

  const createdResponse = await action(page, "create-design", {
    title: `AI bridge replay ${Date.now()}`,
    projectType: "prototype",
    designSystemId: null,
  });
  if (!createdResponse.ok()) {
    throw new Error(`create-design: ${await createdResponse.text()}`);
  }
  const created = await createdResponse.json();
  const designId = created.id ?? created.data?.id;
  if (typeof designId !== "string") throw new Error("create-design has no id");

  try {
    const generatedResponse = await action(page, "generate-design", {
      designId,
      prompt: "Generate a dashboard with a movable hero card.",
      files: [
        { filename: "index.html", content: AI_BRIDGE_SOURCE, fileType: "html" },
      ],
      devices: ["desktop"],
    });
    if (!generatedResponse.ok()) {
      throw new Error(`generate-design: ${await generatedResponse.text()}`);
    }
    const generated = await generatedResponse.json();
    expect(generated.savedFiles).toHaveLength(1);

    const initialSource = await readSource(page, designId);
    expect(initialSource).not.toContain('data-agent-native-node-id="runtime-');
    const moveSelector = '[data-agent-native-layer-name="Move me"]';
    const dropSelector = '[data-agent-native-layer-name="Drop me"]';
    const heroSelector = '[data-agent-native-layer-name="Hero Panel"]';
    const moveBefore = await readLayerSourceState(page, designId, moveSelector);
    const dropBefore = await readLayerSourceState(page, designId, dropSelector);
    const heroBefore = await readLayerSourceState(page, designId, heroSelector);
    expect(moveBefore.id).toMatch(/^an-/);
    expect(dropBefore.id).toMatch(/^an-/);
    expect(heroBefore.id).toMatch(/^an-/);
    expect(dropBefore.parentId).not.toBe(heroBefore.id);

    await gotoEditor(page, designId);
    await expandAllLayers(page);
    await installBridge(page);

    const moveMessages = await dragCanvasByText(page, "Move me", 80, 40);
    expect(moveMessages).toContain("visual-structure-change");
    await expect
      .poll(() => readLayerSourceState(page, designId, moveSelector))
      .toMatchObject({ id: moveBefore.id });
    await expect
      .poll(
        async () =>
          (await readLayerSourceState(page, designId, moveSelector)).style,
      )
      .not.toBe(moveBefore.style);

    await page.evaluate(() => ((window as any).__bridge = []));
    const frame = designFrame(page);
    const dropNode = frame.locator(
      `[data-agent-native-node-id="${dropBefore.id}"]`,
    );
    const heroNode = frame.locator(
      `[data-agent-native-node-id="${heroBefore.id}"]`,
    );
    const dropBox = await dropNode.boundingBox();
    const heroBox = await heroNode.boundingBox();
    if (!dropBox || !heroBox) {
      throw new Error("bridge replay layers have no canvas bounds");
    }
    await page.mouse.move(
      dropBox.x + dropBox.width / 2,
      dropBox.y + dropBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      dropBox.x + dropBox.width / 2 + 12,
      dropBox.y + dropBox.height / 2,
      { steps: 5 },
    );
    await page.mouse.move(
      heroBox.x + heroBox.width / 2,
      heroBox.y + heroBox.height / 2,
      { steps: 20 },
    );
    await page.waitForTimeout(300);
    await page.mouse.up();

    const reparentMessage = await waitForBridge(
      page,
      "visual-structure-change",
    );
    expect(reparentMessage.sourceId).toBe(dropBefore.id);
    expect(reparentMessage.anchorSourceId).toBe(heroBefore.id);
    expect(reparentMessage.placement).toBe("inside");
    await expect
      .poll(() => readLayerSourceState(page, designId, dropSelector))
      .toMatchObject({ id: dropBefore.id, parentId: heroBefore.id });
    await expect
      .poll(async () =>
        frame
          .locator(`[data-agent-native-node-id="${dropBefore.id}"]`)
          .evaluate((node) =>
            node.parentElement?.getAttribute("data-agent-native-node-id"),
          ),
      )
      .toBe(heroBefore.id);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => readLayerSourceState(page, designId, moveSelector))
      .toMatchObject({ id: moveBefore.id });
    await expect
      .poll(() => readLayerSourceState(page, designId, dropSelector))
      .toMatchObject({ id: dropBefore.id, parentId: heroBefore.id });

    const surfaced = [
      ...surfacedErrors,
      ...(await page
        .locator("[data-sonner-toast], [role='alert']")
        .allTextContents()),
    ].filter(Boolean);
    expect(surfaced).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /Could not move that layer|not found in sourceHtml|runtime-[a-z0-9-]+/i,
        ),
      ]),
    );
    const finalSource = await readSource(page, designId);
    expect(finalSource).not.toMatch(
      /data-agent-native-node-id=["']runtime-[a-z0-9-]+/i,
    );
  } finally {
    await deleteDesign(page, designId);
  }
});

test("duplicate authored IDs are repaired before Layers-first edits and persist after reload", async ({
  page,
}) => {
  const designId = await createDesign(page, "<html><body></body></html>");
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

  try {
    const fileId = await readIndexFileId(page, designId);
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
  } finally {
    await deleteDesign(page, designId);
  }
});

test("stylesheet-backed Fill stays editable after Layers reselection and undo", async ({
  page,
}) => {
  const designId = await createDesign(page, AI_SOURCE);

  try {
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
    await expect(fill).toContainText("0F766E");
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
  } finally {
    await deleteDesign(page, designId);
  }
});

test("edit-design rejects malformed AI CSS without changing the styled canvas", async ({
  page,
}, testInfo) => {
  const designId = await createDesign(page, AI_SOURCE);

  try {
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
    await cdpScreenshot(
      page,
      testInfo.outputPath("orbit-after-rejected-css-edit.png"),
    );

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
  } finally {
    await deleteDesign(page, designId);
  }
});
