import {
  expect,
  test,
  type APIRequestContext,
  type FrameLocator,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  childNodeIds,
  designFrame,
  enterDirectMode,
  expandAllLayers,
  gotoEditor,
  installBridge,
  waitForBridge,
} from "./helpers";

const PRIMARY = process.platform === "darwin" ? "Meta" : "Control";
const FIXTURE = `<!doctype html><html><body style="margin:0;padding:20px">
<div data-agent-native-node-id="stack" data-agent-native-layer-name="Stack" style="position:relative;width:260px;height:260px">
<div data-agent-native-node-id="S" data-agent-native-layer-name="S" style="position:absolute;left:20px;top:20px;width:160px;height:160px"></div>
<div data-agent-native-node-id="A" data-agent-native-layer-name="A" style="position:absolute;left:20px;top:20px;width:160px;height:160px;background:red"></div>
<div data-agent-native-node-id="B" data-agent-native-layer-name="B" style="position:absolute;left:20px;top:20px;width:160px;height:160px;background:green"></div>
<div data-agent-native-node-id="C" data-agent-native-layer-name="C" style="position:absolute;left:20px;top:20px;width:160px;height:160px;background:blue"></div>
<div data-agent-native-node-id="D" data-agent-native-layer-name="D" style="position:absolute;left:20px;top:20px;width:160px;height:160px;background:purple"></div>
</div>
<div data-agent-native-node-id="auto" data-agent-native-layer-name="Auto" style="display:flex;gap:12px;padding:12px;margin-top:20px">
<div data-agent-native-node-id="first" data-agent-native-layer-name="First" style="width:100px;height:40px;background:red"></div>
<div data-agent-native-node-id="second" data-agent-native-layer-name="Second" style="width:100px;height:40px;background:blue"></div>
</div>
<div data-agent-native-node-id="flow" data-agent-native-layer-name="Flow" style="width:160px;margin-top:20px">
<div data-agent-native-node-id="under" data-agent-native-layer-name="Under" style="height:160px;background:red"></div>
<div data-agent-native-node-id="over" data-agent-native-layer-name="Over" style="height:160px;margin-top:-80px;background:blue"></div>
</div></body></html>`;

const BOARD_SCREEN_FIXTURE = `<!doctype html><html><body style="margin:0;min-height:600px"><main data-agent-native-node-id="screen-root" style="position:relative;min-height:600px"></main></body></html>`;
const BOARD_FIXTURE = `<!doctype html><html><body style="margin:0;min-height:900px">
<main data-agent-native-node-id="board-stage" data-agent-native-layer-name="Board stage" style="position:relative;width:900px;height:700px">
<div data-agent-native-node-id="red" data-agent-native-layer-name="Red" data-an-primitive="rectangle" style="position:absolute;left:220px;top:180px;width:240px;height:200px;background:red"></div>
<div data-agent-native-node-id="blue" data-agent-native-layer-name="Blue" data-an-primitive="rectangle" style="position:absolute;left:360px;top:280px;width:240px;height:200px;background:blue"></div>
<div data-agent-native-node-id="green" data-agent-native-layer-name="Green" data-an-primitive="rectangle" style="position:absolute;left:500px;top:380px;width:240px;height:200px;background:green"></div>
</main></body></html>`;

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${e2eBaseURL()}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(request: APIRequestContext): Promise<string> {
  const created = await action(request, "create-design", {
    title: `Z-order parity ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: FIXTURE,
    fileType: "html",
  });
  return designId;
}

async function createBoardDesign(request: APIRequestContext): Promise<string> {
  const created = await action(request, "create-design", {
    title: `Board z-order parity ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const screen = await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: BOARD_SCREEN_FIXTURE,
    fileType: "html",
  });
  const screenId = screen.id ?? screen.data?.id;
  const secondScreen = await action(request, "create-file", {
    designId,
    filename: "second.html",
    content: BOARD_SCREEN_FIXTURE,
    fileType: "html",
  });
  const secondScreenId = secondScreen.id ?? secondScreen.data?.id;
  const board = await action(request, "create-file", {
    designId,
    filename: "__board__.html",
    content: BOARD_FIXTURE,
    fileType: "html",
  });
  const boardFileId = board.id ?? board.data?.id;
  if (!screenId || !secondScreenId || !boardFileId) {
    throw new Error("board fixture files returned no ids");
  }
  await action(request, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", screenId],
        value: { sourceType: "inline", width: 800, height: 600 },
      },
      {
        op: "set",
        path: ["canvasFrames", screenId],
        value: { x: 0, y: 0, width: 800, height: 600, z: 0 },
      },
      {
        op: "set",
        path: ["screenMetadata", secondScreenId],
        value: { sourceType: "inline", width: 800, height: 600 },
      },
      {
        op: "set",
        path: ["canvasFrames", secondScreenId],
        value: { x: 1200, y: 0, width: 800, height: 600, z: 0 },
      },
      { op: "set", path: ["boardFileId"], value: boardFileId },
    ],
  });
  return designId;
}

async function indexHtml(
  request: APIRequestContext,
  designId: string,
  filename = "index.html",
): Promise<string> {
  const response = await request.get(
    `${e2eBaseURL()}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
  );
  if (!response.ok()) {
    throw new Error(
      `get-design: ${response.status()} ${await response.text()}`,
    );
  }
  const result = await response.json();
  const file = (result.files ?? result.data?.files)?.find(
    (candidate: { filename: string }) => candidate.filename === filename,
  );
  if (!file) throw new Error(`${filename} was not returned`);
  return file.content;
}

function layerButton(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first();
}

function boardFrame(page: Page): FrameLocator {
  return page
    .locator("[data-board-surface-layer] iframe[data-design-preview-iframe]")
    .contentFrame();
}

async function boardTreeOrder(page: Page): Promise<string[]> {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button] span[title]")
    .evaluateAll((layers) => {
      const boardLayerNames = new Set(["Red", "Blue", "Green"]);
      return layers
        .map((layer) => layer.getAttribute("title"))
        .filter(
          (name): name is string => name !== null && boardLayerNames.has(name),
        );
    });
}

async function rightClickBoardNode(page: Page, nodeId: string): Promise<void> {
  await page.evaluate(() => ((window as any).__bridge = []));
  const frame = boardFrame(page);
  const node = frame.locator(`[data-agent-native-node-id="${nodeId}"]`);
  const point = await node.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await node.evaluate((_element, pt) => {
    document.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        buttons: 2,
        clientX: pt.x,
        clientY: pt.y,
      }),
    );
  }, point);
  await waitForBridge(page, "element-contextmenu");
  await expect(page.getByRole("menu").last()).toBeVisible();
}

async function selectLayer(
  page: Page,
  name: string,
  additive = false,
): Promise<void> {
  const button = layerButton(page, name);
  await expect(button).toBeVisible();
  await button.click({
    force: true,
    ...(additive ? { modifiers: [PRIMARY] } : {}),
  });
  await expect(
    button.locator('xpath=ancestor::*[@role="treeitem"][1]'),
  ).toHaveAttribute("aria-selected", "true");
}

async function topNodeAt(page: Page, parentId: string): Promise<string | null> {
  return designFrame(page)
    .locator(`[data-agent-native-node-id="${parentId}"]`)
    .evaluate((parent) => {
      const rect = parent.getBoundingClientRect();
      return (
        document
          .elementsFromPoint(rect.left + 100, rect.top + 100)
          .map((node) => node.getAttribute("data-agent-native-node-id"))
          .find(Boolean) ?? null
      );
    });
}

/** Children painted at the parent's +100,+100 point, bottom to top. */
async function paintedOrder(
  page: Page,
  parentId: string,
): Promise<(string | null)[]> {
  return designFrame(page)
    .locator(`[data-agent-native-node-id="${parentId}"]`)
    .evaluate((parent) => {
      const rect = parent.getBoundingClientRect();
      const children = new Set<Element>(Array.from(parent.children));
      return document
        .elementsFromPoint(rect.left + 100, rect.top + 100)
        .filter((node) => children.has(node))
        .map((node) => node.getAttribute("data-agent-native-node-id"))
        .reverse();
    });
}

async function renderedRect(page: Page, nodeId: string) {
  return designFrame(page)
    .locator(`[data-agent-native-node-id="${nodeId}"]`)
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const parent = element.parentElement!.getBoundingClientRect();
      return {
        x: Math.round(rect.left - parent.left),
        y: Math.round(rect.top - parent.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    });
}

async function renderedOrder(page: Page, parentId: string): Promise<string[]> {
  return designFrame(page)
    .locator(`[data-agent-native-node-id="${parentId}"]`)
    .evaluate((parent) =>
      Array.from(parent.children)
        .map((el) => el.getAttribute("data-agent-native-node-id"))
        .filter((id): id is string => Boolean(id)),
    );
}

async function pressZ(page: Page, undo = false): Promise<void> {
  await page.keyboard.press(undo ? `${PRIMARY}+z` : `${PRIMARY}+Shift+z`);
}

test("Figma G8 multi-selection preserves native order, painted order, and one-step undo", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await gotoEditor(page, designId);
    await expandAllLayers(page);
    await enterDirectMode(page);
    await installBridge(page);
    await selectLayer(page, "A");
    await selectLayer(page, "C", true);

    await page.keyboard.press("]");
    await expect
      .poll(() =>
        indexHtml(request, designId).then((html) =>
          childNodeIds(html, "stack"),
        ),
      )
      .toEqual(["S", "B", "D", "A", "C"]);
    await expect.poll(() => topNodeAt(page, "stack")).toBe("C");

    await page.keyboard.press("[");
    await expect
      .poll(() =>
        indexHtml(request, designId).then((html) =>
          childNodeIds(html, "stack"),
        ),
      )
      .toEqual(["A", "C", "S", "B", "D"]);
    await expect.poll(() => topNodeAt(page, "stack")).toBe("D");

    await pressZ(page, true);
    await expect
      .poll(() =>
        indexHtml(request, designId).then((html) =>
          childNodeIds(html, "stack"),
        ),
      )
      .toEqual(["S", "B", "D", "A", "C"]);
    await expect.poll(() => topNodeAt(page, "stack")).toBe("C");

    await pressZ(page, true);
    await expect
      .poll(() =>
        indexHtml(request, designId).then((html) =>
          childNodeIds(html, "stack"),
        ),
      )
      .toEqual(["S", "A", "B", "C", "D"]);
    await expect.poll(() => topNodeAt(page, "stack")).toBe("D");

    for (const step of [
      { key: `${PRIMARY}+BracketRight`, expected: ["S", "B", "A", "D", "C"] },
      { key: `${PRIMARY}+BracketLeft`, expected: ["A", "S", "C", "B", "D"] },
    ]) {
      await page.keyboard.press(step.key);
      await expect
        .poll(() =>
          indexHtml(request, designId).then((html) =>
            childNodeIds(html, "stack"),
          ),
        )
        .toEqual(step.expected);
      await expect
        .poll(() => paintedOrder(page, "stack"))
        .toEqual(step.expected);

      await pressZ(page, true);
      await expect
        .poll(() =>
          indexHtml(request, designId).then((html) =>
            childNodeIds(html, "stack"),
          ),
        )
        .toEqual(["S", "A", "B", "C", "D"]);
      await expect
        .poll(() => paintedOrder(page, "stack"))
        .toEqual(["S", "A", "B", "C", "D"]);
    }
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("Figma G9 Bring to Front reorders an auto-layout child and undo restores it", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await gotoEditor(page, designId);
    await expandAllLayers(page);
    await enterDirectMode(page);
    await selectLayer(page, "First");
    expect((await renderedRect(page, "first")).x).toBe(12);

    await page.keyboard.press("]");
    await expect
      .poll(async () => (await renderedRect(page, "first")).x)
      .toBe(124);
    await expect
      .poll(() =>
        indexHtml(request, designId).then((html) => childNodeIds(html, "auto")),
      )
      .toEqual(["second", "first"]);

    await pressZ(page, true);
    await expect
      .poll(async () => (await renderedRect(page, "first")).x)
      .toBe(12);
    await expect
      .poll(() =>
        indexHtml(request, designId).then((html) => childNodeIds(html, "auto")),
      )
      .toEqual(["first", "second"]);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("Bring to Front on a block-flow layer paints above its sibling without moving it", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  const rect = { x: 0, y: 0, width: 160, height: 160 };
  const persisted = async () => {
    const html = await indexHtml(request, designId);
    const tag = /<[^>]*data-agent-native-node-id="under"[^>]*>/.exec(html)?.[0];
    if (!tag) throw new Error("under missing from the persisted file");
    return {
      order: childNodeIds(html, "flow"),
      relative: /position:\s*relative/.test(tag),
      zIndex: /z-index:\s*(-?\d+)/.exec(tag)?.[1] ?? null,
    };
  };
  try {
    await gotoEditor(page, designId);
    await expandAllLayers(page);
    await enterDirectMode(page);
    await expect.poll(() => topNodeAt(page, "flow")).toBe("over");
    expect(await renderedRect(page, "under")).toEqual(rect);
    await selectLayer(page, "Under");

    await page.keyboard.press("]");
    await expect.poll(() => topNodeAt(page, "flow")).toBe("under");
    expect(await renderedRect(page, "under")).toEqual(rect);
    await expect
      .poll(persisted)
      .toEqual({ order: ["under", "over"], relative: true, zIndex: "1" });

    await pressZ(page, true);
    await expect.poll(() => topNodeAt(page, "flow")).toBe("over");
    expect(await renderedRect(page, "under")).toEqual(rect);
    await expect
      .poll(persisted)
      .toEqual({ order: ["under", "over"], relative: false, zIndex: null });
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("Figma arrange keyboard commands use physical brackets and persist across reload", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  const initialOrder = ["S", "A", "B", "C", "D"];
  const cases = [
    { node: "A", key: "]", expected: ["S", "B", "C", "D", "A"] },
    {
      node: "B",
      key: `${PRIMARY}+BracketRight`,
      expected: ["S", "A", "C", "B", "D"],
    },
    { node: "D", key: "[", expected: ["D", "S", "A", "B", "C"] },
    {
      node: "C",
      key: `${PRIMARY}+BracketLeft`,
      expected: ["S", "A", "C", "B", "D"],
    },
  ] as const;
  try {
    await gotoEditor(page, designId);
    await expandAllLayers(page);
    await enterDirectMode(page);
    await installBridge(page);

    for (const [index, testCase] of cases.entries()) {
      await selectLayer(page, testCase.node);
      await page.keyboard.press(testCase.key);
      await expect
        .poll(() =>
          indexHtml(request, designId).then((html) =>
            childNodeIds(html, "stack"),
          ),
        )
        .toEqual(testCase.expected);
      if (index === cases.length - 1) {
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(
          page.getByRole("button", { name: "Move", exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        await enterDirectMode(page);
        await expect
          .poll(() => renderedOrder(page, "stack"))
          .toEqual(testCase.expected);
      } else {
        await page.keyboard.press(`${PRIMARY}+z`);
        await expect
          .poll(() =>
            indexHtml(request, designId).then((html) =>
              childNodeIds(html, "stack"),
            ),
          )
          .toEqual(initialOrder);
      }
    }
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("Figma overview board arrange commands measure, persist, and support context menus", async ({
  page,
  request,
}) => {
  const designId = await createBoardDesign(request);
  const initialOrder = ["red", "blue", "green"];
  // Front/back cases move an end layer two steps, so a one-step move fails.
  const cases = [
    { node: "Red", key: "]", expected: ["blue", "green", "red"] },
    {
      node: "Red",
      key: `${PRIMARY}+BracketRight`,
      expected: ["blue", "red", "green"],
    },
    {
      node: "Green",
      key: `${PRIMARY}+BracketLeft`,
      expected: ["red", "green", "blue"],
    },
    { node: "Green", key: "[", expected: ["green", "red", "blue"] },
  ] as const;
  try {
    await gotoEditor(page, designId);
    await expandAllLayers(page);
    await enterDirectMode(page);
    await installBridge(page);
    await expect(
      page.locator(
        "[data-board-surface-layer] iframe[data-design-preview-iframe]",
      ),
    ).toBeVisible();

    for (const [index, testCase] of cases.entries()) {
      await selectLayer(page, testCase.node);
      await page.keyboard.press(testCase.key);
      await expect
        .poll(() =>
          indexHtml(request, designId, "__board__.html").then((html) =>
            childNodeIds(html, "board-stage"),
          ),
        )
        .toEqual(testCase.expected);
      await expect
        .poll(() => boardTreeOrder(page))
        .toEqual(
          testCase.expected
            .slice()
            .reverse()
            .map((id) => id[0]!.toUpperCase() + id.slice(1)),
        );

      if (index === cases.length - 1) {
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(
          page.getByRole("button", { name: "Move", exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        await enterDirectMode(page);
        await installBridge(page);
        await expandAllLayers(page);
        await expect
          .poll(() =>
            boardFrame(page)
              .locator('[data-agent-native-node-id="board-stage"]')
              .evaluate((parent) =>
                Array.from(parent.children)
                  .map((el) => el.getAttribute("data-agent-native-node-id"))
                  .filter((id): id is string => Boolean(id)),
              ),
          )
          .toEqual(testCase.expected);
      } else {
        await page.keyboard.press(`${PRIMARY}+z`);
        await expect
          .poll(() =>
            indexHtml(request, designId, "__board__.html").then((html) =>
              childNodeIds(html, "board-stage"),
            ),
          )
          .toEqual(initialOrder);
      }
    }

    await rightClickBoardNode(page, "blue");
    await page
      .getByRole("menu")
      .last()
      .getByText("Send to back", { exact: true })
      .click();
    await expect
      .poll(() =>
        indexHtml(request, designId, "__board__.html").then((html) =>
          childNodeIds(html, "board-stage"),
        ),
      )
      .toEqual(["blue", "green", "red"]);
    await expect
      .poll(() => boardTreeOrder(page))
      .toEqual(["Red", "Green", "Blue"]);

    await rightClickBoardNode(page, "blue");
    await page
      .getByRole("menu")
      .last()
      .getByText("Bring to front", { exact: true })
      .click();
    await expect
      .poll(() =>
        indexHtml(request, designId, "__board__.html").then((html) =>
          childNodeIds(html, "board-stage"),
        ),
      )
      .toEqual(["green", "red", "blue"]);
    await expect
      .poll(() => boardTreeOrder(page))
      .toEqual(["Blue", "Red", "Green"]);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});
