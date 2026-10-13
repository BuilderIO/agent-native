import { type Locator, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { expandAllLayers, gotoEditor } from "./helpers";
import { expect, expectOnlyChanged, test, type App } from "./rails";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

const FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Selection interaction</title></head>
  <body style="margin:0;min-height:900px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <div data-agent-native-node-id="card" data-agent-native-layer-name="Card"
         style="position:absolute;left:40px;top:40px;width:280px;height:200px;background:#111827">
      <div data-agent-native-node-id="kid-a" data-agent-native-layer-name="Kid A"
           style="position:absolute;left:16px;top:16px;width:110px;height:80px;background:#3b82f6"></div>
      <div data-agent-native-node-id="kid-b" data-agent-native-layer-name="Kid B"
           style="position:absolute;left:150px;top:16px;width:110px;height:80px;background:#22c55e"></div>
    </div>
    <div data-agent-native-node-id="solo-a" data-agent-native-layer-name="Solo A"
         style="position:absolute;left:40px;top:300px;width:120px;height:80px;background:#a855f7"></div>
    <div data-agent-native-node-id="solo-b" data-agent-native-layer-name="Solo B"
         style="position:absolute;left:190px;top:300px;width:120px;height:80px;background:#ec4899"></div>
  </body>
</html>`;

const BOARD_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Board</title></head>
  <body style="margin:0;min-height:900px;background:#e5e5e5">
    <div data-agent-native-node-id="board-a" data-agent-native-layer-name="Board A"
         style="position:absolute;left:20px;top:520px;width:120px;height:80px;background:#f59e0b"></div>
    <div data-agent-native-node-id="board-b" data-agent-native-layer-name="Board B"
         style="position:absolute;left:170px;top:520px;width:120px;height:80px;background:#0ea5e9"></div>
  </body>
</html>`;

const NESTED_BOARD_FIXTURE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Nested board drag</title></head>
  <body style="margin:0;min-height:900px;background:#e5e5e5">
    <div data-agent-native-node-id="outer" data-agent-native-layer-name="Outer" data-an-primitive="frame"
         style="position:absolute;left:80px;top:100px;width:560px;height:420px;overflow:hidden;background:#111827">
      <div data-agent-native-node-id="nested" data-agent-native-layer-name="Nested" data-an-primitive="frame"
           style="position:absolute;left:40px;top:40px;width:280px;height:220px;background:#374151">
        <div data-agent-native-node-id="existing-child" data-agent-native-layer-name="Existing child"
             style="position:absolute;left:28px;top:32px;width:80px;height:40px;background:#3b82f6"></div>
      </div>
    </div>
  </body>
</html>`;

const OVERLAPPING_BOARD_FRAMES = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Overlapping board frames</title></head>
  <body style="margin:0;min-height:900px;background:#e5e5e5">
    <div data-agent-native-node-id="drag-frame" data-agent-native-layer-name="Drag frame" data-an-primitive="frame"
         style="position:absolute;left:80px;top:100px;width:240px;height:220px;background:#111827"></div>
    <div data-agent-native-node-id="target-frame" data-agent-native-layer-name="Target frame" data-an-primitive="frame"
         style="position:absolute;left:500px;top:100px;width:240px;height:220px;background:#374151"></div>
  </body>
</html>`;

let baseURL = "";

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const res = await page.request.post(
    `${baseURL}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok())
    throw new Error(
      `${name}: ${res.status()} ${(await res.text()).slice(0, 200)}`,
    );
  return res.json();
}

async function newBoardDesign(
  page: Page,
  content: string = BOARD_FIXTURE,
): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "selection interaction board",
    projectType: "prototype",
  });
  const id = created?.id ?? created?.data?.id;
  if (!id) throw new Error("create-design returned no id");
  const board = await postAction(page, "create-file", {
    designId: id,
    filename: "__board__.html",
    content,
    fileType: "html",
  });
  const boardFileId = board?.id ?? board?.data?.id;
  if (!boardFileId) throw new Error("create-file returned no board id");
  await postAction(page, "update-design", {
    id,
    dataOperations: [{ op: "set", path: ["boardFileId"], value: boardFileId }],
  });
  return id;
}

async function persistedBoardLayout(page: Page, designId: string) {
  const response = await page.request.get(
    `${baseURL}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
  );
  if (!response.ok()) {
    throw new Error(
      `get-design: ${response.status()} ${(await response.text()).slice(0, 300)}`,
    );
  }
  const record = await response.json();
  const boardHtml = (record.files ?? []).find(
    (file: { filename?: string }) => file.filename === "__board__.html",
  )?.content;
  if (typeof boardHtml !== "string") {
    throw new Error(`design ${designId} has no persisted __board__.html`);
  }

  return page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const node = (id: string) => {
      const element = doc.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${id}"]`,
      );
      if (!element) throw new Error(`persisted board is missing ${id}`);
      const left = Number.parseFloat(element.style.left);
      const top = Number.parseFloat(element.style.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) {
        throw new Error(`persisted board has no finite left/top for ${id}`);
      }
      let worldLeft = 0;
      let worldTop = 0;
      let current: HTMLElement | null = element;
      while (current && current !== doc.documentElement) {
        worldLeft += Number.parseFloat(current.style.left) || 0;
        worldTop += Number.parseFloat(current.style.top) || 0;
        current = current.parentElement;
      }
      return {
        left,
        top,
        parentTagName: element.parentElement?.tagName.toLowerCase(),
        parentId: element.parentElement?.getAttribute(
          "data-agent-native-node-id",
        ),
        worldLeft,
        worldTop,
      };
    };

    return {
      outer: node("outer"),
      nested: node("nested"),
      child: node("existing-child"),
    };
  }, boardHtml);
}

async function persistedBoardPosition(
  page: Page,
  designId: string,
  nodeId: string,
) {
  const response = await page.request.get(
    `${baseURL}/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
  );
  if (!response.ok()) {
    throw new Error(
      `get-design: ${response.status()} ${(await response.text()).slice(0, 300)}`,
    );
  }
  const record = await response.json();
  const boardHtml = (record.files ?? []).find(
    (file: { filename?: string }) => file.filename === "__board__.html",
  )?.content;
  if (typeof boardHtml !== "string") {
    throw new Error(`design ${designId} has no persisted __board__.html`);
  }

  return page.evaluate(
    ({ html, id }) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const element = doc.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${CSS.escape(id)}"]`,
      );
      if (!element) throw new Error(`persisted board is missing ${id}`);
      const left = Number.parseFloat(element.style.left);
      const top = Number.parseFloat(element.style.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) {
        throw new Error(`persisted board has no finite left/top for ${id}`);
      }
      let worldLeft = 0;
      let worldTop = 0;
      let current: HTMLElement | null = element;
      while (current && current !== doc.documentElement) {
        worldLeft += Number.parseFloat(current.style.left) || 0;
        worldTop += Number.parseFloat(current.style.top) || 0;
        current = current.parentElement;
      }
      return {
        left,
        top,
        parentTagName: element.parentElement?.tagName.toLowerCase(),
        parentId: element.parentElement?.getAttribute(
          "data-agent-native-node-id",
        ),
        worldLeft,
        worldTop,
      };
    },
    { html: boardHtml, id: nodeId },
  );
}

function boardIframe(page: Page) {
  return page
    .locator("iframe[data-design-preview-iframe]:not([data-screen-iframe-id])")
    .first();
}

function layersTree(page: Page): Locator {
  return page.getByRole("tree", { name: "Layers" });
}

function selectedRows(page: Page): Locator {
  return layersTree(page).locator('[role="treeitem"][aria-selected="true"]');
}

async function selectedLayerNames(page: Page): Promise<string[]> {
  return (await selectedRows(page).allTextContents()).map((t) => t.trim());
}

function node(page: Page, id: string): Locator {
  return page
    .locator("iframe[data-design-preview-iframe]")
    .first()
    .contentFrame()
    .locator(`[data-agent-native-node-id="${id}"]`);
}

async function openEditorAndExpandLayers(
  page: Page,
  designId: string,
): Promise<void> {
  await gotoEditor(page, designId);
  await expandAllLayers(page);
}

async function click(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  modifiers?: ("Meta" | "Shift" | "Control")[],
) {
  if (modifiers?.length) for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  if (modifiers?.length) for (const m of modifiers) await page.keyboard.up(m);
}

async function sweep(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifiers?: ("Meta" | "Control")[],
): Promise<void> {
  if (modifiers?.length) {
    for (const m of modifiers) await page.keyboard.down(m);
  }
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 18 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  if (modifiers?.length) {
    for (const m of modifiers) await page.keyboard.up(m);
  }
}

async function openBoardFixture(app: App, content: string) {
  const id = await newBoardDesign(app.page, content);
  app.adopt(id);
  await openEditorAndExpandLayers(app.page, id);
  await expect
    .poll(() => app.selectedLayers(), {
      message: "precondition: nothing is selected",
    })
    .toEqual([]);
  return id;
}

async function openScreenFixture(app: App) {
  const id = await app.seed(FIXTURE);
  await app.open(id);
  await expandAllLayers(app.page);
  await app.zoomToFit();
  await expect
    .poll(() => app.selectedLayers(), {
      message: "precondition: nothing is selected",
    })
    .toEqual([]);
  return { id, before: await app.savedNodes(id) };
}

async function clickScreenNode(
  app: App,
  nodeId: string,
  modifiers?: ("Meta" | "Shift")[],
) {
  const rect = await app.designRect(nodeId);
  const centre = await app.pagePoint(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
  );
  await click(
    app.page,
    { x: centre.x, y: centre.y, width: 0, height: 0 },
    modifiers,
  );
}

test.use({ viewport: { width: 1600, height: 1000 } });

test.beforeEach(async ({ page }, testInfo) => {
  baseURL =
    (testInfo.project.use.baseURL as string | undefined) ?? e2eBaseURL();
});

test("board regression: an overlapping Frame drop into another board Frame persists after reload", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const trace: Array<unknown> = [];
    Object.defineProperty(window, "__boardDragTrace", {
      configurable: true,
      value: trace,
    });
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (
        data?.type === "visual-style-change" ||
        data?.type === "visual-structure-change" ||
        data?.type === "agent-native:cancel-active-drag"
      ) {
        trace.push(data);
      }
    });
  });

  const id = await newBoardDesign(page, OVERLAPPING_BOARD_FRAMES);
  await openEditorAndExpandLayers(page, id);
  const board = boardIframe(page).contentFrame();
  const draggedFrame = board.locator(
    '[data-agent-native-node-id="drag-frame"]',
  );
  const targetFrame = board.locator(
    '[data-agent-native-node-id="target-frame"]',
  );
  await expect(draggedFrame).toBeVisible();
  const sourceBox = (await draggedFrame.boundingBox())!;
  const targetBox = (await targetFrame.boundingBox())!;
  const targetPosition = await targetFrame.evaluate((element) => ({
    left: Number.parseFloat((element as HTMLElement).style.left),
    top: Number.parseFloat((element as HTMLElement).style.top),
  }));
  const start = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  };
  const drop = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  };

  await page.mouse.click(start.x, start.y);
  await expect.poll(() => selectedLayerNames(page)).toContain("Drag frame");

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 16 });
  await page.waitForTimeout(300);
  await page.mouse.up();

  await expect
    .poll(async () =>
      draggedFrame.evaluate((element) => {
        const html = element as HTMLElement;
        return {
          left: Number.parseFloat(html.style.left),
          top: Number.parseFloat(html.style.top),
          parentId: html.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ),
          worldLeft: Number.parseFloat(
            (html.parentElement as HTMLElement).style.left,
          ),
          worldTop: Number.parseFloat(
            (html.parentElement as HTMLElement).style.top,
          ),
        };
      }),
    )
    .toEqual({
      left: 0,
      top: 0,
      parentId: "target-frame",
      worldLeft: targetPosition.left,
      worldTop: targetPosition.top,
    });
  await expect
    .poll(() => persistedBoardPosition(page, id, "drag-frame"))
    .toEqual({
      left: 0,
      top: 0,
      parentTagName: "div",
      parentId: "target-frame",
      worldLeft: targetPosition.left,
      worldTop: targetPosition.top,
    });

  const parentTrace = await page.evaluate(
    () =>
      (window as Window & { __boardDragTrace?: Array<unknown> })
        .__boardDragTrace ?? [],
  );
  const frameTrace = await board.locator("body").evaluate(
    (body) =>
      (
        body.ownerDocument.defaultView as Window & {
          __boardDragTrace?: Array<unknown>;
        }
      ).__boardDragTrace ?? [],
  );
  const sourceChanges = (
    parentTrace as Array<{
      type?: string;
      selector?: string;
      anchorSelector?: string;
    }>
  ).filter((event) => event.selector?.includes("drag-frame"));
  expect(
    sourceChanges.map((event) => event.type),
    "the host must commit one structure change without a visual-style revert",
  ).toEqual(["visual-structure-change"]);
  expect(sourceChanges[0]?.anchorSelector).toContain("target-frame");
  expect(
    (frameTrace as Array<{ type?: string }>).some(
      (event) => event.type === "agent-native:cancel-active-drag",
    ),
    "an in-place board move must not be cancelled as a cross-screen drop",
  ).toBe(false);

  await gotoEditor(page, id);
  await expect
    .poll(() => persistedBoardPosition(page, id, "drag-frame"))
    .toEqual({
      left: 0,
      top: 0,
      parentTagName: "div",
      parentId: "target-frame",
      worldLeft: targetPosition.left,
      worldTop: targetPosition.top,
    });
});

test("board regression: overlapping board Frames keep the pointer drop without cancel or revert", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const trace: Array<unknown> = [];
    Object.defineProperty(window, "__boardDragTrace", {
      configurable: true,
      value: trace,
    });
    window.addEventListener("message", (event) => {
      if (
        event.data?.type === "agent-native:editor-drag-state" &&
        event.data.active === true
      ) {
        document.body.dataset.editorDragStarted = "true";
      }
      if (
        event.data?.type === "visual-style-change" ||
        event.data?.type === "agent-native:cancel-active-drag" ||
        event.data?.type === "agent-native:cross-screen-drag" ||
        event.data?.type === "agent-native:cross-screen-claim"
      ) {
        trace.push(event.data);
      }
    });
  });

  const id = await newBoardDesign(page, OVERLAPPING_BOARD_FRAMES);
  await openEditorAndExpandLayers(page, id);
  const board = boardIframe(page).contentFrame();
  const draggedFrame = board.locator(
    '[data-agent-native-node-id="drag-frame"]',
  );
  const targetFrame = board.locator(
    '[data-agent-native-node-id="target-frame"]',
  );
  const sourceBox = (await draggedFrame.boundingBox())!;
  const targetBox = (await targetFrame.boundingBox())!;
  const start = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  };
  const drop = {
    x: targetBox.x - 20,
    y: targetBox.y + targetBox.height / 2,
  };
  expect(drop.x).toBeLessThan(targetBox.x);
  const scale = sourceBox.width / 240;
  const expected = {
    left: 80 + (drop.x - start.x) / scale,
    top: 100 + (drop.y - start.y) / scale,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 8, start.y, { steps: 2 });
  await expect(page.locator("body")).toHaveAttribute(
    "data-editor-drag-started",
    "true",
  );
  await page.mouse.move(drop.x, drop.y, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const parentTrace = await page.evaluate(
    () =>
      (window as Window & { __boardDragTrace?: Array<unknown> })
        .__boardDragTrace ?? [],
  );
  const frameTrace = await board.locator("body").evaluate(
    (body) =>
      (
        body.ownerDocument.defaultView as Window & {
          __boardDragTrace?: Array<unknown>;
        }
      ).__boardDragTrace ?? [],
  );

  await expect
    .poll(() => persistedBoardPosition(page, id, "drag-frame"))
    .toMatchObject({ parentTagName: "body" });
  const persisted = await persistedBoardPosition(page, id, "drag-frame");
  expect(Math.abs(persisted.left - expected.left)).toBeLessThanOrEqual(6);
  expect(Math.abs(persisted.top - expected.top)).toBeLessThanOrEqual(6);
  expect(persisted.parentTagName).toBe("body");
  const landedBox = (await draggedFrame.boundingBox())!;
  expect(landedBox.x).toBeLessThan(targetBox.x + targetBox.width);
  expect(landedBox.x + landedBox.width).toBeGreaterThan(targetBox.x);

  const sourceChanges = (
    parentTrace as Array<{ type?: string; selector?: string }>
  ).filter(
    (event) =>
      event.type === "visual-style-change" &&
      event.selector?.includes("drag-frame"),
  );
  expect(
    sourceChanges.map((event) => event.type),
    "the board move should commit once without a delayed revert",
  ).toEqual(["visual-style-change"]);
  expect(
    (frameTrace as Array<{ type?: string }>).some(
      (event) => event.type === "agent-native:cancel-active-drag",
    ),
  ).toBe(false);
  await page.reload();
  await openEditorAndExpandLayers(page, id);
  const afterReload = await persistedBoardPosition(page, id, "drag-frame");
  expect(Math.abs(afterReload.left - expected.left)).toBeLessThanOrEqual(6);
  expect(Math.abs(afterReload.top - expected.top)).toBeLessThanOrEqual(6);
  expect(afterReload.parentTagName).toBe("body");
});

// PR #5644 made a plain click inside a SCREEN select the deepest block under
// the pointer directly (see editor-chrome.bridge.ts's plainClickSelectionTarget).
// The infinite-canvas board surface keeps container-first selection, so these
// tests use the same nested Card/Kid A fixture as a board object
// (newBoardDesign) instead of a screen (newDesign).
test.describe("click selects the container on the board surface, not the deep child", () => {
  test("selected nested frame drag from its grandchild tracks the pointer and persists", async ({
    page,
  }) => {
    const id = await newBoardDesign(page, NESTED_BOARD_FIXTURE);
    await openEditorAndExpandLayers(page, id);

    const before = await persistedBoardLayout(page, id);
    expect(before).toMatchObject({
      outer: { left: 80, top: 100 },
      nested: { left: 40, top: 40, parentId: "outer" },
      child: { left: 28, top: 32, parentId: "nested" },
    });

    const childBefore = (await node(page, "existing-child").boundingBox())!;
    const start = {
      x: childBefore.x + childBefore.width / 2,
      y: childBefore.y + childBefore.height / 2,
    };
    await page.mouse.click(start.x, start.y);
    await expect
      .poll(async () => (await selectedLayerNames(page)).join("|"), {
        timeout: 10_000,
        message: "clicking a grandchild on the board selects its container",
      })
      .toBe("Nested");

    const outerBefore = (await node(page, "outer").boundingBox())!;
    const nestedBefore = (await node(page, "nested").boundingBox())!;
    const selectedChildBefore = (await node(
      page,
      "existing-child",
    ).boundingBox())!;
    const dragStart = {
      x: selectedChildBefore.x + selectedChildBefore.width / 2,
      y: selectedChildBefore.y + selectedChildBefore.height / 2,
    };
    const dragEnd = { x: dragStart.x + 64, y: dragStart.y + 48 };

    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 16 });
    await page.waitForTimeout(350);
    await page.mouse.up();

    await expect
      .poll(
        async () => {
          const after = await persistedBoardLayout(page, id);
          return (
            after.nested.left !== before.nested.left ||
            after.nested.top !== before.nested.top
          );
        },
        {
          timeout: 15_000,
          message:
            "the physical drag must persist the selected board container's new position",
        },
      )
      .toBe(true);

    const after = await persistedBoardLayout(page, id);
    expect(after.outer).toEqual(before.outer);
    expect(after.nested.parentId).toBe("outer");
    expect(after.nested.left).not.toBe(before.nested.left);
    expect(after.nested.top).not.toBe(before.nested.top);
    expect(after.child).toMatchObject({
      left: before.child.left,
      top: before.child.top,
      parentId: before.child.parentId,
    });

    const outerAfter = (await node(page, "outer").boundingBox())!;
    const nestedAfter = (await node(page, "nested").boundingBox())!;
    const childAfter = (await node(page, "existing-child").boundingBox())!;
    const nestedDelta = {
      x: nestedAfter.x - nestedBefore.x,
      y: nestedAfter.y - nestedBefore.y,
    };
    const childDelta = {
      x: childAfter.x - selectedChildBefore.x,
      y: childAfter.y - selectedChildBefore.y,
    };
    const pointerDelta = {
      x: dragEnd.x - dragStart.x,
      y: dragEnd.y - dragStart.y,
    };
    const scaleX = outerBefore.width / 560;
    const scaleY = outerBefore.height / 420;
    expect(outerAfter.x).toBeCloseTo(outerBefore.x, 0);
    expect(outerAfter.y).toBeCloseTo(outerBefore.y, 0);
    expect(
      Math.abs(nestedDelta.x - pointerDelta.x),
      `screen X moved ${nestedDelta.x}px for a ${pointerDelta.x}px pointer drag`,
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(nestedDelta.y - pointerDelta.y),
      `screen Y moved ${nestedDelta.y}px for a ${pointerDelta.y}px pointer drag`,
    ).toBeLessThanOrEqual(2);
    expect(Math.abs(childDelta.x - nestedDelta.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(childDelta.y - nestedDelta.y)).toBeLessThanOrEqual(2);
    expect(
      Math.abs(
        after.nested.left - before.nested.left - pointerDelta.x / scaleX,
      ),
    ).toBeLessThanOrEqual(3);
    expect(
      Math.abs(after.nested.top - before.nested.top - pointerDelta.y / scaleY),
    ).toBeLessThanOrEqual(3);
    await expect
      .poll(async () => (await selectedLayerNames(page)).join("|"))
      .toBe("Nested");
  });

  test("clicking a child inside Card selects Card, not Kid A", async ({
    app,
    page,
  }) => {
    await openBoardFixture(app, FIXTURE);
    const kidA = (await node(page, "kid-a").boundingBox())!;

    await click(page, kidA);

    await expect
      .poll(() => app.selectedLayers(), {
        message:
          "a plain click on the board selects the top-level container, not the deep child (screens select the deep child, PR #5644)",
      })
      .toEqual(["Card"]);
  });

  test("double-click after selecting Card drills into the clicked child", async ({
    app,
    page,
  }) => {
    await openBoardFixture(app, FIXTURE);
    const kidA = (await node(page, "kid-a").boundingBox())!;
    await click(page, kidA);
    await expect
      .poll(() => app.selectedLayers(), {
        message: "precondition: the first click selects Card",
      })
      .toEqual(["Card"]);

    await page.mouse.dblclick(
      kidA.x + kidA.width / 2,
      kidA.y + kidA.height / 2,
    );

    await expect
      .poll(() => app.selectedLayers(), {
        message: "double-click drills one level in and replaces Card",
      })
      .toEqual(["Kid A"]);
  });

  test("cmd+click deep-selects Kid B directly with no prior selection", async ({
    app,
  }) => {
    const { id, before } = await openScreenFixture(app);

    await clickScreenNode(app, "kid-b", ["Meta"]);

    await expect.poll(() => app.selectedLayers()).toEqual(["Kid B"]);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });

  test("cmd+click a child of an already-selected Card replaces the selection with the child, not the Card", async ({
    app,
  }) => {
    const { id, before } = await openScreenFixture(app);
    const card = await app.designRect("card");
    const cardBottom = await app.pagePoint(
      card.x + card.width / 2,
      card.y + card.height - 20,
    );
    await app.page.mouse.click(cardBottom.x, cardBottom.y);
    await expect
      .poll(() => app.selectedLayers(), {
        message:
          "precondition: a plain click on Card's empty area selects Card",
      })
      .toEqual(["Card"]);

    await clickScreenNode(app, "kid-a", ["Meta"]);

    await expect
      .poll(() => app.selectedLayers(), {
        message:
          "cmd/ctrl+click replaces the selection even when it deep-selects a child of the selected container",
      })
      .toEqual(["Kid A"]);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });
});

test.describe("shift+click toggles membership", () => {
  test("shift+click adds an unselected object, then removes it on a second shift+click", async ({
    app,
  }) => {
    const { id, before } = await openScreenFixture(app);
    await clickScreenNode(app, "solo-a");
    await expect
      .poll(() => app.selectedLayers(), {
        message: "precondition: the first click selects Solo A",
      })
      .toEqual(["Solo A"]);

    await clickScreenNode(app, "solo-b", ["Shift"]);
    await expect
      .poll(() => app.selectedLayers(), {
        message: "shift+click adds Solo B to the selection",
      })
      .toEqual(["Solo B", "Solo A"]);

    await clickScreenNode(app, "solo-b", ["Shift"]);
    await expect
      .poll(() => app.selectedLayers(), {
        message: "shift+click on an already-selected object removes only it",
      })
      .toEqual(["Solo A"]);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });
});

test.describe("Esc / Enter traversal from a real drill-in", () => {
  test("Escape clears the selection entirely, even from a drilled-in child", async ({
    app,
    page,
  }) => {
    await openBoardFixture(app, FIXTURE);
    const kidA = (await node(page, "kid-a").boundingBox())!;
    await click(page, kidA);
    await expect
      .poll(() => app.selectedLayers(), {
        message: "precondition: the first click selects Card",
      })
      .toEqual(["Card"]);
    await page.mouse.dblclick(
      kidA.x + kidA.width / 2,
      kidA.y + kidA.height / 2,
    );
    await expect
      .poll(() => app.selectedLayers(), {
        message: "precondition: double-click drilled into Kid A",
      })
      .toEqual(["Kid A"]);

    await page.keyboard.press("Escape");

    await expect
      .poll(() => app.selectedLayers(), {
        message: "Escape must clear the selection entirely",
      })
      .toEqual([]);
  });

  test("Enter on a selected Card selects all of its children", async ({
    page,
  }) => {
    const id = await newBoardDesign(page, FIXTURE);
    await openEditorAndExpandLayers(page, id);
    const kidA = (await node(page, "kid-a").boundingBox())!;
    await click(page, kidA);
    await expect
      .poll(async () => (await selectedLayerNames(page)).join("|"), {
        timeout: 10_000,
        message: "precondition: Card is selected",
      })
      .toContain("Card");

    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await selectedLayerNames(page)).sort(), {
        message: "Enter selects one level down: all of Card's children",
      })
      .toEqual(["Kid A", "Kid B"]);
  });
});

test("clicking empty canvas inside the screen deselects everything", async ({
  app,
}) => {
  const { id, before } = await openScreenFixture(app);
  await clickScreenNode(app, "solo-a");
  await expect
    .poll(() => app.selectedLayers(), {
      message: "precondition: clicking Solo A selects exactly it",
    })
    .toEqual(["Solo A"]);

  const emptyScreenPoint = await app.pagePoint(100, 560);
  await app.page.mouse.click(emptyScreenPoint.x, emptyScreenPoint.y);

  await expect
    .poll(() => app.selectedLayers(), {
      message: "clicking empty canvas must clear the selection",
    })
    .toEqual([]);
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id), []);
});

test.describe("marquee semantics", () => {
  test("a marquee selects every top-level object it merely INTERSECTS, not just fully-enclosed ones", async ({
    app,
    page,
  }) => {
    const { id, before } = await openScreenFixture(app);
    const card = await app.designRect("card");
    const soloA = await app.designRect("solo-a");
    const soloB = await app.designRect("solo-b");
    // Starts on screen background between Card and Solo A, ends inside Solo B: neither is enclosed.
    await sweep(
      page,
      await app.pagePoint(
        soloA.x + soloA.width / 2,
        (card.y + card.height + soloA.y) / 2,
      ),
      await app.pagePoint(
        soloB.x + soloB.width / 2,
        soloB.y + soloB.height / 2,
      ),
    );

    await expect.poll(() => app.selectedLayers()).toEqual(["Solo B", "Solo A"]);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });

  test("a marquee over Card selects Card only, not its children", async ({
    app,
    page,
  }) => {
    const { id, before } = await openScreenFixture(app);
    const card = await app.designRect("card");
    await sweep(
      page,
      await app.pagePoint(card.x - 20, card.y - 20),
      await app.pagePoint(card.x + card.width + 20, card.y + card.height + 20),
    );

    await expect.poll(() => app.selectedLayers()).toEqual(["Card"]);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });

  // fixme: product bug: Cmd+marquee selects an ancestor together with its descendants: Layers shows [Card, Kid B, Kid A], inspector '3 selected'. The bridge's
  test.fixme("cmd+marquee over Card reaches into Kid A and Kid B", async ({
    app,
    page,
  }) => {
    const { id, before } = await openScreenFixture(app);
    const card = await app.designRect("card");
    await sweep(
      page,
      await app.pagePoint(card.x - 20, card.y - 20),
      await app.pagePoint(card.x + card.width + 20, card.y + card.height + 20),
      ["Meta"],
    );

    await expect.poll(() => app.selectedLayers()).toEqual(["Kid B", "Kid A"]);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });
});

test.describe("board objects on the overview canvas", () => {
  test("clicking a board object selects it directly (no screen wraps it)", async ({
    app,
    page,
  }) => {
    await openBoardFixture(app, BOARD_FIXTURE);
    const boardA = (await node(page, "board-a").boundingBox())!;

    await click(page, boardA);

    await expect
      .poll(() => app.selectedLayers(), {
        message:
          "board objects are already top-level; a click selects Board A alone",
      })
      .toEqual(["Board A"]);
  });

  test("Tab cycles from Board A to Board B on the overview canvas", async ({
    app,
    page,
  }) => {
    await openBoardFixture(app, BOARD_FIXTURE);
    const boardA = (await node(page, "board-a").boundingBox())!;
    await click(page, boardA);
    await expect
      .poll(() => app.selectedLayers(), {
        message: "precondition: clicking Board A selects it",
      })
      .toEqual(["Board A"]);

    await page.keyboard.press("Tab");

    await expect
      .poll(() => app.selectedLayers(), {
        message: "Tab moves the selection to the next sibling",
      })
      .toEqual(["Board B"]);
  });

  test("a marquee drawn on the board surface selects the board objects it intersects", async ({
    app,
    page,
  }) => {
    await openBoardFixture(app, BOARD_FIXTURE);
    const boardA = (await node(page, "board-a").boundingBox())!;
    const boardB = (await node(page, "board-b").boundingBox())!;

    await sweep(
      page,
      { x: boardA.x + boardA.width / 2, y: boardA.y - 20 },
      { x: boardB.x + boardB.width / 2, y: boardB.y + boardB.height / 2 },
    );

    await expect
      .poll(() => app.selectedLayers(), {
        message:
          "a marquee on the board surface selects exactly the objects it intersects",
      })
      .toEqual(["Board B", "Board A"]);
  });

  test("cmd+click a child of an already-selected Card on the board surface replaces the selection with the child", async ({
    app,
    page,
  }) => {
    await openBoardFixture(app, FIXTURE);
    const card = (await node(page, "card").boundingBox())!;
    await page.mouse.click(card.x + card.width / 2, card.y + card.height - 20);
    await expect
      .poll(() => app.selectedLayers(), {
        message: "precondition: the plain click selects Card",
      })
      .toEqual(["Card"]);

    const kidA = (await node(page, "kid-a").boundingBox())!;
    await click(page, kidA, ["Meta"]);

    await expect
      .poll(() => app.selectedLayers(), {
        message:
          "cmd/ctrl+click on a board object's child replaces the selection with the child",
      })
      .toEqual(["Kid A"]);
  });
});

/**
 * Overview screen selection must be the single source of truth for what Cmd+A
 * treats as the current selection. Expected: once a Screen card is the
 * selection, Cmd+A selects all Screens, never the stale element's siblings
 * from a different screen.
 */

const SCREEN_ONE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Screen One</title></head>
  <body style="margin:0;min-height:600px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <main data-agent-native-node-id="s1-main" data-agent-native-layer-name="Main"
          style="padding:40px;display:flex;flex-direction:column;gap:16px">
      <div data-agent-native-node-id="s1-row" data-agent-native-layer-name="Row"
           style="display:flex;flex-direction:row;gap:16px">
        <button data-agent-native-node-id="s1-alpha" data-agent-native-layer-name="Alpha Button"
                style="padding:14px 28px;border-radius:10px;border:0;background:#6366f1;color:#fff">Alpha Button</button>
        <button data-agent-native-node-id="s1-beta" data-agent-native-layer-name="Beta Button"
                style="padding:14px 28px;border-radius:10px;border:0;background:#22c55e;color:#06240f">Beta Button</button>
      </div>
    </main>
  </body>
</html>`;

const SCREEN_TWO = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Screen Two</title></head>
  <body style="margin:0;min-height:400px;background:#0f1115;color:#fff;font-family:system-ui,sans-serif">
    <section data-agent-native-node-id="s2-target" data-agent-native-layer-name="Page2Target"
             style="margin:40px;width:300px;height:200px;background:#312e81"></section>
  </body>
</html>`;

async function openTwoScreens(app: App) {
  const id = await app.seed(SCREEN_ONE, {
    files: { "page-two.html": SCREEN_TWO },
  });
  await app.open(id);
  await expandAllLayers(app.page);
  await app.zoomToFit();
  return id;
}

const TWO_SCREEN_FRAMES = {
  "index.html": { x: 0, y: 736, width: 1440, height: 1024 },
  "page-two.html": { x: 0, y: 1856, width: 1440, height: 1024 },
};

async function savedFramesByFilename(app: App, id: string) {
  const { data, files } = await app.savedRecord(id);
  const frames = (data as { canvasFrames: Record<string, unknown> })
    .canvasFrames;
  return Object.fromEntries(
    Object.entries(frames).map(([fileId, frame]) => [
      files.find((file) => file.id === fileId)?.filename ?? fileId,
      frame,
    ]),
  );
}

async function selectAlphaButton(app: App) {
  const alpha = await app.designRect("s1-alpha", "index.html");
  const center = await app.pagePoint(
    alpha.x + alpha.width / 2,
    alpha.y + alpha.height / 2,
    "index.html",
  );
  await app.page.mouse.click(center.x, center.y);
  await expect
    .poll(() => app.selectedLayers(), {
      message: "precondition: the click selects the nested Alpha Button",
    })
    .toEqual(["Alpha Button"]);
}

test.describe("overview screen selection vs stale layer selection (Cmd+A)", () => {
  test("click-selecting Screen 2 after a nested Screen 1 element replaces the layer selection, so Cmd+A selects all Screens", async ({
    app,
    page,
  }) => {
    const id = await openTwoScreens(app);
    await selectAlphaButton(app);
    const savedBefore = {
      one: await app.savedNodes(id),
      two: await app.savedNodes(id, "page-two.html"),
    };
    expect(await savedFramesByFilename(app, id)).toStrictEqual(
      TWO_SCREEN_FRAMES,
    );

    await page.locator('[data-frame-title][title="page-two.html"]').click();
    await expect
      .poll(() => app.selectedLayers(), {
        message:
          "clicking Screen 2's title replaces the Alpha Button selection",
      })
      .toEqual(["Two"]);

    await page.keyboard.press(`${MOD}+a`);

    await expect.poll(() => app.selectedLayers()).toEqual(["Two", "Home"]);
    await expect(page.locator("[data-frame-selection-box]")).toHaveCount(1);
    await app.settled();
    expectOnlyChanged(savedBefore.one, await app.savedNodes(id), []);
    expectOnlyChanged(
      savedBefore.two,
      await app.savedNodes(id, "page-two.html"),
      [],
    );
    expect(await savedFramesByFilename(app, id)).toStrictEqual(
      TWO_SCREEN_FRAMES,
    );
  });

  test("marquee-selecting Screen 2 after a nested Screen 1 element replaces the layer selection, so Cmd+A selects all Screens", async ({
    app,
    page,
  }) => {
    const id = await openTwoScreens(app);
    const record = await app.savedRecord(id);
    const fileId = (name: string) =>
      record.files.find((file) => file.filename === name)!.id;
    const shell = (name: string) =>
      page.locator(`[data-screen-shell][data-frame-id="${fileId(name)}"]`);
    const shellOne = (await shell("index.html").boundingBox())!;
    const shellTwo = (await shell("page-two.html").boundingBox())!;
    const margin = (shellTwo.y - (shellOne.y + shellOne.height)) / 2;
    expect(
      margin,
      "precondition: Screen 2 sits below Screen 1 with a gap",
    ).toBeGreaterThan(2);
    await selectAlphaButton(app);
    const savedBefore = {
      one: await app.savedNodes(id),
      two: await app.savedNodes(id, "page-two.html"),
    };
    expect(await savedFramesByFilename(app, id)).toStrictEqual(
      TWO_SCREEN_FRAMES,
    );

    await sweep(
      page,
      { x: shellTwo.x - margin, y: shellTwo.y - margin },
      {
        x: shellTwo.x + shellTwo.width + margin,
        y: shellTwo.y + shellTwo.height + margin,
      },
    );
    await expect
      .poll(() => app.selectedLayers(), {
        message:
          "the marquee replaces the Alpha Button selection with Screen 2",
      })
      .toEqual(["Two"]);

    await page.keyboard.press(`${MOD}+a`);

    await expect.poll(() => app.selectedLayers()).toEqual(["Two", "Home"]);
    const selectionBox = page.locator("[data-frame-selection-box]");
    await expect(selectionBox).toHaveCount(1);
    const box = (await selectionBox.boundingBox())!;
    const cardOne = (await shell("index.html")
      .locator("[data-screen-card]")
      .boundingBox())!;
    const cardTwo = (await shell("page-two.html")
      .locator("[data-screen-card]")
      .boundingBox())!;
    expect(
      Math.abs(box.y - cardOne.y),
      "the selection box starts at Home's top",
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(box.y + box.height - (cardTwo.y + cardTwo.height)),
      "the selection box ends at Two's bottom",
    ).toBeLessThanOrEqual(2);
    await app.settled();
    expectOnlyChanged(savedBefore.one, await app.savedNodes(id), []);
    expectOnlyChanged(
      savedBefore.two,
      await app.savedNodes(id, "page-two.html"),
      [],
    );
    expect(await savedFramesByFilename(app, id)).toStrictEqual(
      TWO_SCREEN_FRAMES,
    );
  });
});
