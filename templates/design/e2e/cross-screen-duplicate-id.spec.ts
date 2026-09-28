import { expect, test, type Page } from "@playwright/test";

import { buildCodeLayerProjection } from "../shared/code-layer";
import {
  appPath,
  designFrame,
  expandAllLayers,
  gotoEditor,
  resetPersistedCanvasState,
} from "./helpers";

const SHARED_NODE_ID = "cross-screen-shared-button";
const SCREEN_A_HTML = `<!doctype html><html lang="en"><head><title>Screen A</title></head><body style="margin:0;background:#fff"><button data-agent-native-node-id="${SHARED_NODE_ID}" data-agent-native-layer-name="Screen A Button" style="box-sizing:border-box;position:absolute;left:30px;top:50px;width:100px;height:48px;background:#dc2626;color:white">Screen A Button</button></body></html>`;
const SCREEN_B_HTML = `<!doctype html><html lang="en"><head><title>Screen B</title></head><body style="margin:0;background:#fff"><button data-agent-native-node-id="${SHARED_NODE_ID}" data-agent-native-layer-name="Screen B Button" style="box-sizing:border-box;position:absolute;left:30px;top:50px;width:140px;height:48px;background:#16a34a;color:white">Screen B Button</button></body></html>`;
const COMMAND_COMPANION_ID = "cross-screen-shared-companion";
const SCREEN_A_COMMANDS_HTML = `<!doctype html><html lang="en"><head><title>Screen A</title></head><body style="margin:0;background:#fff"><div class="primary" data-agent-native-node-id="${SHARED_NODE_ID}" data-agent-native-layer-name="Screen A Button" style="box-sizing:border-box;position:absolute;left:30px;top:50px;width:100px;height:48px;background:#dc2626"></div><div class="companion" data-agent-native-node-id="${COMMAND_COMPANION_ID}" data-agent-native-layer-name="Screen A Companion" style="box-sizing:border-box;position:absolute;left:160px;top:50px;width:80px;height:48px;background:#dc2626"></div></body></html>`;
const SCREEN_B_COMMANDS_HTML = `<!doctype html><html lang="en"><head><title>Screen B</title></head><body style="margin:0;background:#fff"><div class="primary" data-agent-native-node-id="${SHARED_NODE_ID}" data-agent-native-layer-name="Screen B Button" style="box-sizing:border-box;position:absolute;left:30px;top:50px;width:140px;height:48px;background:#16a34a"></div><div class="companion" data-agent-native-node-id="${COMMAND_COMPANION_ID}" data-agent-native-layer-name="Screen B Companion" style="box-sizing:border-box;position:absolute;left:160px;top:50px;width:80px;height:48px;background:#dc2626"></div></body></html>`;
const MOD = process.platform === "darwin" ? "Meta" : "Control";

type DesignRecord = {
  files?: Array<{ id: string; filename: string; content?: string }>;
};

async function action(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function readDesign(page: Page, designId: string): Promise<DesignRecord> {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()) as DesignRecord;
}

function widthFor(html: string): string | undefined {
  const tag = new RegExp(
    `<button\\b(?=[^>]*data-agent-native-node-id="${SHARED_NODE_ID}")([^>]*)>`,
    "i",
  ).exec(html)?.[1];
  const style = /\bstyle="([^"]*)"/i.exec(tag ?? "")?.[1] ?? "";
  return style
    .split(";")
    .map((declaration) => declaration.trim())
    .find((declaration) => declaration.toLowerCase().startsWith("width:"))
    ?.slice("width:".length)
    .trim();
}

async function screenWidths(
  page: Page,
  designId: string,
  screenAId: string,
  screenBId: string,
): Promise<[string | undefined, string | undefined]> {
  const record = await readDesign(page, designId);
  const screenA = record.files?.find((file) => file.id === screenAId);
  const screenB = record.files?.find((file) => file.id === screenBId);
  if (!screenA?.content || !screenB?.content) {
    throw new Error("Could not read both Screen source documents");
  }
  return [widthFor(screenA.content), widthFor(screenB.content)];
}

async function commandLayerState(
  page: Page,
  designId: string,
  screenAId: string,
  screenBId: string,
) {
  const record = await readDesign(page, designId);
  const screenA = record.files?.find((file) => file.id === screenAId);
  const screenB = record.files?.find((file) => file.id === screenBId);
  if (!screenA?.content || !screenB?.content) {
    throw new Error("Could not read both Screen source documents");
  }

  return page.evaluate(
    ({ screenAHtml, screenBHtml }) => {
      const inspect = (html: string) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const read = (selector: string) =>
          Array.from(doc.querySelectorAll<HTMLElement>(selector)).map(
            (node) => ({
              id: node.getAttribute("data-agent-native-node-id"),
              name: node.getAttribute("data-agent-native-layer-name"),
              left: node.style.left,
              backgroundColor: node.style.backgroundColor,
              group: Boolean(node.closest('[data-agent-native-group="true"]')),
            }),
          );
        return {
          primary: read(".primary"),
          companion: read(".companion"),
          groupCount: doc.querySelectorAll('[data-agent-native-group="true"]')
            .length,
        };
      };
      return {
        screenA: inspect(screenAHtml),
        screenB: inspect(screenBHtml),
      };
    },
    { screenAHtml: screenA.content, screenBHtml: screenB.content },
  );
}

async function editSelectedWidth(page: Page, width: string) {
  const input = page.getByRole("textbox", {
    name: /^W(?: size in pixels)?$/,
  });
  await expect(input).toBeVisible();
  await input.fill(width);
  await input.press("Enter");
  await expect(input).toHaveValue(`${width}px`);
}

test("identical authored node IDs stay scoped to their Screen", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const design = await action(page, "create-design", {
    title: `Cross-Screen duplicate node ID ${Date.now()}`,
    projectType: "prototype",
    designSystemId: null,
  });
  const designId = design.id ?? design.data?.id;
  if (typeof designId !== "string") {
    throw new Error("create-design returned no id");
  }

  let deleteDesign = true;
  try {
    const screenA = await action(page, "create-file", {
      designId,
      filename: "screen-a.html",
      content: SCREEN_A_HTML,
      fileType: "html",
    });
    const screenB = await action(page, "create-file", {
      designId,
      filename: "screen-b.html",
      content: SCREEN_B_HTML,
      fileType: "html",
    });
    const screenAId = screenA.id ?? screenA.data?.id;
    const screenBId = screenB.id ?? screenB.data?.id;
    if (typeof screenAId !== "string" || typeof screenBId !== "string") {
      throw new Error("create-file did not return both Screen IDs");
    }

    await action(page, "update-design", {
      id: designId,
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", screenAId],
          value: { x: 0, y: 0, width: 500, height: 320 },
        },
        {
          op: "set",
          path: ["canvasFrames", screenBId],
          value: { x: 600, y: 0, width: 500, height: 320 },
        },
        {
          op: "set",
          path: ["screenMetadata", screenAId],
          value: {
            width: 500,
            height: 320,
            heightMode: "fixed",
            heightPinned: true,
          },
        },
        {
          op: "set",
          path: ["screenMetadata", screenBId],
          value: {
            width: 500,
            height: 320,
            heightMode: "fixed",
            heightPinned: true,
          },
        },
      ],
    });

    const legacySelectionId = buildCodeLayerProjection(
      SCREEN_A_HTML,
    ).nodes.find(
      (node) =>
        node.dataAttributes["data-agent-native-node-id"] === SHARED_NODE_ID,
    )?.id;
    if (!legacySelectionId) {
      throw new Error("Could not build the legacy unscoped selection id");
    }

    await resetPersistedCanvasState(page);
    await page.goto(
      appPath(
        `/design/${designId}?view=overview&screen=${encodeURIComponent(screenAId)}&selection=${encodeURIComponent(legacySelectionId)}`,
      ),
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await expect(
      page.getByRole("textbox", { name: /^W(?: size in pixels)?$/ }),
    ).toHaveValue("100px");

    await resetPersistedCanvasState(page);
    await page.goto(
      appPath(
        `/design/${designId}?view=overview&selection=${encodeURIComponent(legacySelectionId)}`,
      ),
      { waitUntil: "domcontentloaded" },
    );
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await expect(
      page.locator(
        '[role="treeitem"][aria-selected="true"] [data-layer-row-button]',
      ),
    ).toHaveCount(0);

    await gotoEditor(page, designId);
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await expandAllLayers(page);
    const layerRows = page.locator(
      '[role="treeitem"][aria-level="2"] [data-layer-row-button]',
    );
    await expect(layerRows).toHaveCount(2);
    const rowIds = await layerRows.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("data-layer-node-id")),
    );
    expect(new Set(rowIds).size).toBe(2);

    const screenAButton = designFrame(page, screenAId).getByRole("button", {
      name: "Screen A Button",
    });
    await screenAButton.scrollIntoViewIfNeeded();
    await screenAButton.click({ force: true });
    const widthInput = page.getByRole("textbox", {
      name: /^W(?: size in pixels)?$/,
    });
    await expect(widthInput).toHaveValue("100px");
    await editSelectedWidth(page, "105");
    await expect
      .poll(() => screenWidths(page, designId, screenAId, screenBId))
      .toEqual(["105px", "140px"]);

    const screenALayer = layerRows.filter({ hasText: "Screen A Button" });
    await expect(screenALayer).toHaveCount(1);
    await screenALayer.click();
    await expect(widthInput).toHaveValue("105px");
    await editSelectedWidth(page, "111");
    await expect
      .poll(() => screenWidths(page, designId, screenAId, screenBId))
      .toEqual(["111px", "140px"]);

    const screenBButton = designFrame(page, screenBId).getByRole("button", {
      name: "Screen B Button",
    });
    await screenBButton.scrollIntoViewIfNeeded();
    await screenBButton.click({ force: true });
    await expect(widthInput).toHaveValue("140px");
    await editSelectedWidth(page, "222");
    await expect
      .poll(() => screenWidths(page, designId, screenAId, screenBId))
      .toEqual(["111px", "222px"]);

    const screenBLayer = layerRows.filter({ hasText: "Screen B Button" });
    await expect(screenBLayer).toHaveCount(1);
    await screenBLayer.click();
    await expect(widthInput).toHaveValue("222px");
    await editSelectedWidth(page, "233");
    await expect
      .poll(() => screenWidths(page, designId, screenAId, screenBId))
      .toEqual(["111px", "233px"]);

    await page.reload();
    await expect(
      page.getByRole("button", { name: "Move", exact: true }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await expandAllLayers(page);
    await expect
      .poll(() => screenWidths(page, designId, screenAId, screenBId))
      .toEqual(["111px", "233px"]);
    await page
      .locator('[role="treeitem"][aria-level="2"] [data-layer-row-button]')
      .filter({ hasText: "Screen A Button" })
      .click();
    await expect(widthInput).toHaveValue("111px");
    await page
      .locator('[role="treeitem"][aria-level="2"] [data-layer-row-button]')
      .filter({ hasText: "Screen B Button" })
      .click();
    await expect(widthInput).toHaveValue("233px");
  } catch (error) {
    deleteDesign = false;
    throw error;
  } finally {
    if (deleteDesign) {
      await action(page, "delete-design", { id: designId }).catch(() => {});
    }
  }
});

test("structural commands stay in the selected Screen with duplicate authored IDs", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const design = await action(page, "create-design", {
    title: `Cross-Screen command target ${Date.now()}`,
    projectType: "prototype",
    designSystemId: null,
  });
  const designId = design.id ?? design.data?.id;
  if (typeof designId !== "string") {
    throw new Error("create-design returned no id");
  }

  let deleteDesign = true;
  try {
    const screenA = await action(page, "create-file", {
      designId,
      filename: "screen-a.html",
      content: SCREEN_A_COMMANDS_HTML,
      fileType: "html",
    });
    const screenB = await action(page, "create-file", {
      designId,
      filename: "screen-b.html",
      content: SCREEN_B_COMMANDS_HTML,
      fileType: "html",
    });
    const screenAId = screenA.id ?? screenA.data?.id;
    const screenBId = screenB.id ?? screenB.data?.id;
    if (typeof screenAId !== "string" || typeof screenBId !== "string") {
      throw new Error("create-file did not return both Screen IDs");
    }

    await action(page, "update-design", {
      id: designId,
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", screenAId],
          value: { x: 0, y: 0, width: 500, height: 320 },
        },
        {
          op: "set",
          path: ["canvasFrames", screenBId],
          value: { x: 600, y: 0, width: 500, height: 320 },
        },
        {
          op: "set",
          path: ["screenMetadata", screenAId],
          value: {
            width: 500,
            height: 320,
            heightMode: "fixed",
            heightPinned: true,
          },
        },
        {
          op: "set",
          path: ["screenMetadata", screenBId],
          value: {
            width: 500,
            height: 320,
            heightMode: "fixed",
            heightPinned: true,
          },
        },
      ],
    });

    await gotoEditor(page, designId);
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await expandAllLayers(page);

    const readState = () =>
      commandLayerState(page, designId, screenAId, screenBId);
    const initial = await readState();
    expect(initial.screenA.primary).toHaveLength(1);
    expect(initial.screenB.primary).toHaveLength(1);
    expect(initial.screenA.companion).toHaveLength(1);
    expect(initial.screenB.companion).toHaveLength(1);

    const frameA = designFrame(page, screenAId);
    await frameA.locator(".primary").click({ force: true });
    const widthInput = page.getByRole("textbox", {
      name: /^W(?: size in pixels)?$/,
    });
    await expect(widthInput).toHaveValue("100px");
    const buttonLeft = Number.parseFloat(initial.screenA.primary[0]!.left);
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => {
        const state = await readState();
        return [state.screenA.primary[0]?.left, state.screenB.primary[0]?.left];
      })
      .toEqual([`${buttonLeft + 1}px`, initial.screenB.primary[0]!.left]);

    const layers = page.getByRole("tree", { name: "Layers" });
    const rowFor = (name: string) =>
      layers
        .locator("[data-layer-row-button][data-layer-node-id]")
        .filter({ has: page.locator(`span[title="${name}"]`) })
        .first()
        .locator('xpath=ancestor::*[@role="treeitem"][1]');
    const buttonRow = rowFor("Screen A Button");
    const companionRow = rowFor("Screen A Companion");
    await buttonRow.click();
    await companionRow.click({ modifiers: ["Shift"] });
    await expect(
      layers.locator('[role="treeitem"][aria-selected="true"]'),
    ).toHaveCount(2);

    await page.keyboard.press(`${MOD}+g`);
    const groupRow = rowFor("Group");
    await expect(groupRow).toBeVisible();
    await expect(
      layers.locator('[role="treeitem"][aria-selected="true"]'),
    ).toHaveCount(1);
    await expect(
      layers.locator('[role="treeitem"][aria-selected="true"]'),
    ).toContainText("Group");
    await groupRow.click();

    const fillSection = page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Fill", exact: true }) })
      .first();
    await expect(fillSection).toBeVisible();
    await fillSection
      .getByRole("button", { name: "Open color picker" })
      .click();
    const hex = page.getByRole("textbox", { name: "Hex", exact: true });
    await expect(hex).toHaveValue("DC2626");
    await hex.fill("3B82F6");
    await hex.press("Enter");
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => {
        const state = await readState();
        return {
          a: [
            state.screenA.primary[0]?.backgroundColor,
            state.screenA.companion[0]?.backgroundColor,
            state.screenA.groupCount,
          ],
          b: [
            state.screenB.primary[0]?.backgroundColor,
            state.screenB.companion[0]?.backgroundColor,
            state.screenB.groupCount,
          ],
        };
      })
      .toEqual({
        a: ["rgb(59, 130, 246)", "rgb(59, 130, 246)", 1],
        b: ["rgb(22, 163, 74)", "rgb(220, 38, 38)", 0],
      });

    await page.keyboard.press(`${MOD}+Shift+g`);
    await expect(groupRow).toHaveCount(0);
    await expect(
      layers.locator('[role="treeitem"][aria-selected="true"]'),
    ).toHaveCount(2);
    await expect
      .poll(async () => {
        const state = await readState();
        return {
          a: [
            state.screenA.primary[0]?.backgroundColor,
            state.screenA.companion[0]?.backgroundColor,
            state.screenA.groupCount,
          ],
          b: [
            state.screenB.primary[0]?.backgroundColor,
            state.screenB.companion[0]?.backgroundColor,
            state.screenB.groupCount,
          ],
        };
      })
      .toEqual({
        a: ["rgb(59, 130, 246)", "rgb(59, 130, 246)", 0],
        b: ["rgb(22, 163, 74)", "rgb(220, 38, 38)", 0],
      });
  } catch (error) {
    deleteDesign = false;
    throw error;
  } finally {
    if (deleteDesign) {
      await action(page, "delete-design", { id: designId }).catch(() => {});
    }
  }
});

test("delete and Undo stay in the selected Screen with duplicate authored IDs", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const design = await action(page, "create-design", {
    title: `Cross-Screen delete target ${Date.now()}`,
    projectType: "prototype",
    designSystemId: null,
  });
  const designId = design.id ?? design.data?.id;
  if (typeof designId !== "string") {
    throw new Error("create-design returned no id");
  }

  let deleteDesign = true;
  try {
    const screenA = await action(page, "create-file", {
      designId,
      filename: "screen-a.html",
      content: SCREEN_A_COMMANDS_HTML,
      fileType: "html",
    });
    const screenB = await action(page, "create-file", {
      designId,
      filename: "screen-b.html",
      content: SCREEN_B_COMMANDS_HTML,
      fileType: "html",
    });
    const screenAId = screenA.id ?? screenA.data?.id;
    const screenBId = screenB.id ?? screenB.data?.id;
    if (typeof screenAId !== "string" || typeof screenBId !== "string") {
      throw new Error("create-file did not return both Screen IDs");
    }

    await action(page, "update-design", {
      id: designId,
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", screenAId],
          value: { x: 0, y: 0, width: 500, height: 320 },
        },
        {
          op: "set",
          path: ["canvasFrames", screenBId],
          value: { x: 600, y: 0, width: 500, height: 320 },
        },
        {
          op: "set",
          path: ["screenMetadata", screenAId],
          value: {
            width: 500,
            height: 320,
            heightMode: "fixed",
            heightPinned: true,
          },
        },
        {
          op: "set",
          path: ["screenMetadata", screenBId],
          value: {
            width: 500,
            height: 320,
            heightMode: "fixed",
            heightPinned: true,
          },
        },
      ],
    });

    await gotoEditor(page, designId);
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2);
    await expandAllLayers(page);

    const readState = () =>
      commandLayerState(page, designId, screenAId, screenBId);
    const before = await readState();
    expect(before.screenA.primary).toHaveLength(1);
    expect(before.screenB.primary).toHaveLength(1);
    expect(before.screenA.companion).toHaveLength(1);
    expect(before.screenB.companion).toHaveLength(1);

    await designFrame(page, screenAId)
      .locator(".primary")
      .click({ force: true });
    const layers = page.getByRole("tree", { name: "Layers" });
    const selected = layers.locator('[role="treeitem"][aria-selected="true"]');
    await expect(selected).toHaveCount(1);
    await expect(selected).toContainText("Screen A Button");
    await page.keyboard.press("Delete");

    await expect
      .poll(async () => {
        const state = await readState();
        return {
          a: [state.screenA.primary.length, state.screenA.companion.length],
          b: [state.screenB.primary.length, state.screenB.companion.length],
        };
      })
      .toEqual({ a: [0, 1], b: [1, 1] });

    await page.keyboard.press(`${MOD}+z`);
    await expect.poll(readState).toEqual(before);
  } catch (error) {
    deleteDesign = false;
    throw error;
  } finally {
    if (deleteDesign) {
      await action(page, "delete-design", { id: designId }).catch(() => {});
    }
  }
});
