import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { appPath, cdpScreenshot, designFrame, gotoEditor } from "./helpers";


const BASE_URL = process.env.E2E_BASE_URL ?? e2eBaseURL();

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    `${BASE_URL}/_agent-native/actions/${name}`,
    { data: input },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(
  request: APIRequestContext,
  html: string,
  fileCount = 1,
) {
  const created = await action(request, "create-design", {
    title: `Clipboard/duplicate parity ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id ?? created.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const fileIds: string[] = [];
  for (let index = 0; index < fileCount; index += 1) {
    const file = await action(request, "create-file", {
      designId,
      filename: index === 0 ? "index.html" : `screen-${index + 1}.html`,
      content: html,
      fileType: "html",
    });
    const fileId = file.id ?? file.data?.id;
    if (!fileId) throw new Error("create-file returned no id");
    fileIds.push(fileId);
  }
  await action(request, "update-design", {
    id: designId,
    dataOperations: fileIds.flatMap((fileId, index) => [
      {
        op: "set",
        path: ["screenMetadata", fileId],
        value: { sourceType: "inline", width: 1280, height: 900 },
      },
      {
        op: "set",
        path: ["canvasFrames", fileId],
        value: { x: index * 1600, y: 0, width: 1280, height: 900, z: index },
      },
    ]),
  });
  return { designId, fileIds };
}

const GROUP_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;min-height:900px">
<div data-agent-native-node-id="group" data-agent-native-layer-name="Group"
     style="position:absolute;left:320px;top:60px;width:400px;height:300px;background:#eee">
  <div data-agent-native-node-id="original" data-agent-native-layer-name="Original"
       style="position:absolute;left:0px;top:0px;width:120px;height:60px;background:#3a7"></div>
  <div data-agent-native-node-id="sibling" data-agent-native-layer-name="Sibling"
       style="position:absolute;left:0px;top:80px;width:120px;height:60px;background:#559"></div>
</div>
</body></html>`;

const CONTAINER_AND_SOURCE_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;min-height:900px">
<div data-agent-native-node-id="source" data-agent-native-layer-name="Source"
     style="position:absolute;left:320px;top:60px;width:120px;height:60px;background:#3a7"></div>
<div data-agent-native-node-id="container" data-agent-native-layer-name="Container"
     style="position:absolute;left:700px;top:200px;width:300px;height:200px;background:#eef"></div>
</body></html>`;

const UNNAMED_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;min-height:900px">
<div data-agent-native-node-id="plain"
     style="position:absolute;left:320px;top:100px;width:200px;height:120px;background:#a37">
</div>
</body></html>`;

const SIMPLE_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;min-height:900px">
<div data-agent-native-node-id="rect" data-agent-native-layer-name="Widget"
     style="position:absolute;left:100px;top:100px;width:200px;height:120px;background:#3a7">
</div>
</body></html>`;

const BOARD_OBJECT_HTML = `<!doctype html>
<html><body style="margin:0;position:relative;min-height:900px">
<div data-agent-native-node-id="board-rect" data-agent-native-layer-name="BoardShape"
     style="position:absolute;left:100px;top:100px;width:160px;height:100px;background:#39a">
</div>
</body></html>`;

async function layerNames(page: Page): Promise<string[]> {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator(
      '[role="treeitem"]:not([aria-level="1"]) [data-layer-row-button] span[title]',
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("title") ?? ""),
    );
}

async function gotoEditorZoomed(page: Page, designId: string): Promise<void> {
  await gotoEditor(page, designId);
  await page.goto(appPath(`/design/${designId}?zoom=100`), {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  let lastBox: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        const box = await page
          .locator("[data-screen-card]")
          .first()
          .boundingBox();
        const stable =
          box !== null &&
          lastBox !== null &&
          Math.abs(box.x - lastBox.x) < 1 &&
          Math.abs(box.y - lastBox.y) < 1;
        lastBox = box;
        return stable;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
}

async function stableBox(
  locator: ReturnType<Page["locator"]>,
): Promise<{ x: number; y: number; width: number; height: number }> {
  let last: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        const box = await locator.boundingBox();
        const stable =
          box !== null &&
          last !== null &&
          Math.abs(box.x - last.x) < 1 &&
          Math.abs(box.y - last.y) < 1;
        last = box;
        return stable;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  return (await locator.boundingBox())!;
}

async function dumpTrace(page: Page) {
  return page
    .evaluate(() => (window as any).__designTrace?.dump?.() ?? null)
    .catch(() => null);
}

async function lastSelectedElementSelector(page: Page): Promise<string | null> {
  const trace = await dumpTrace(page);
  const matches = [
    ...(trace ?? "").matchAll(
      /\[select:selection-changed\] \{"layers":\[[^\]]*\],"element":"((?:[^"\\]|\\.)*)"/g,
    ),
  ];
  return matches[matches.length - 1]?.[1] ?? null;
}

/**
 * Click to select an element by its node id. Figma parity: a click inside a
 * group first selects the group itself; a second click drills into the
 * child (see editor-chrome.bridge.ts's descend-on-click/dblclick path).
 *
 * The descend's selection-changed message is an async iframe -> host
 * postMessage round trip, not a fixed-latency one: a flat sleep here is a
 * race against it (passes when the host is idle, flakes under load) rather
 * than a synchronization point. Poll __designTrace for the round trip to
 * actually land on `nodeId` instead of guessing how long it takes.
 */
async function selectByNodeId(page: Page, nodeId: string) {
  const frame = designFrame(page);
  const el = frame.locator(`[data-agent-native-node-id="${nodeId}"]`);
  const box = (await el.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy);
  await expect.poll(() => lastSelectedElementSelector(page)).not.toBeNull();
  await page.mouse.dblclick(cx, cy);
  await expect
    .poll(() => lastSelectedElementSelector(page), { timeout: 5_000 })
    .toContain(nodeId);
  return box;
}

test.describe("clipboard + duplicate (single-screen editor)", () => {
  test("cmd+C then cmd+V with nothing else selected pastes into the SAME parent, directly above the source, keeping name and size", async ({
    page,
    request,
  }) => {
    const { designId } = await createDesign(request, GROUP_HTML);
    try {
      await gotoEditorZoomed(page, designId);
      const frame = designFrame(page);
      await selectByNodeId(page, "original");
      await page.keyboard.press("ControlOrMeta+c");
      await page.waitForTimeout(300);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      await page.keyboard.press("ControlOrMeta+v");

      const groupChildrenLocator = frame.locator(
        '[data-agent-native-node-id="group"] > [data-agent-native-node-id]',
      );
      await expect
        .poll(() => groupChildrenLocator.count(), { timeout: 10_000 })
        .toBeGreaterThan(2);
      const groupChildIds = await groupChildrenLocator.evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-agent-native-node-id")),
      );
      const copyId = groupChildIds.find(
        (id) => id !== "original" && id !== "sibling",
      );

      if (!copyId || groupChildIds.indexOf(copyId) !== 1) {
        const trace = await dumpTrace(page);
        console.log("TRACE_DEBUG", JSON.stringify(trace));
        test.info().annotations.push({
          type: "trace",
          description: JSON.stringify({ groupChildIds, copyId, trace }),
        });
      }
      expect(copyId).toBeTruthy();
      expect(groupChildIds).toEqual(["original", copyId, "sibling"]);

      const originalBox = await frame
        .locator('[data-agent-native-node-id="original"]')
        .boundingBox();
      const copyBox = await frame
        .locator(`[data-agent-native-node-id="${copyId}"]`)
        .boundingBox();
      expect(Math.round(copyBox!.width)).toBe(Math.round(originalBox!.width));
      expect(Math.round(copyBox!.height)).toBe(Math.round(originalBox!.height));

      const names = await layerNames(page);
      expect(names.filter((n) => n === "Original")).toHaveLength(2);
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });

  test("with a container selected, paste goes inside that container", async ({
    page,
    request,
  }) => {
    const { designId } = await createDesign(request, CONTAINER_AND_SOURCE_HTML);
    try {
      await gotoEditorZoomed(page, designId);
      const frame = designFrame(page);
      await selectByNodeId(page, "source");
      await page.keyboard.press("ControlOrMeta+c");
      await page.waitForTimeout(300);
      await selectByNodeId(page, "container");
      await page.keyboard.press("ControlOrMeta+v");

      const containerChildren = frame.locator(
        '[data-agent-native-node-id="container"] > [data-agent-native-node-id]',
      );
      try {
        await expect(containerChildren).toHaveCount(1, { timeout: 10_000 });
      } catch (error) {
        const trace = await dumpTrace(page);
        console.log("TRACE_DEBUG", JSON.stringify(trace));
        test.info().annotations.push({
          type: "trace",
          description: JSON.stringify({ trace }),
        });
        throw error;
      }
      const names = await layerNames(page);
      expect(names.filter((n) => n === "Source")).toHaveLength(2);
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });

  test("cmd+D duplicates in place (same x/y), directly above, identical name, selection moves to the copy", async ({
    page,
    request,
  }) => {
    const { designId } = await createDesign(request, GROUP_HTML);
    try {
      await gotoEditorZoomed(page, designId);
      const frame = designFrame(page);
      const before = await selectByNodeId(page, "original");
      await page.keyboard.press("ControlOrMeta+d");

      const groupChildrenLocator = frame.locator(
        '[data-agent-native-node-id="group"] > [data-agent-native-node-id]',
      );
      await expect
        .poll(() => groupChildrenLocator.count(), { timeout: 10_000 })
        .toBeGreaterThan(2);
      const groupChildIds = await groupChildrenLocator.evaluateAll((els) =>
        els.map((el) => el.getAttribute("data-agent-native-node-id")),
      );
      const copyId = groupChildIds.find(
        (id) => id !== "original" && id !== "sibling",
      );
      if (!copyId || groupChildIds.indexOf(copyId) !== 1) {
        const trace = await dumpTrace(page);
        console.log("TRACE_DEBUG", JSON.stringify(trace));
        test.info().annotations.push({
          type: "trace",
          description: JSON.stringify({ groupChildIds, copyId, trace }),
        });
      }
      expect(copyId).toBeTruthy();
      expect(groupChildIds).toEqual(["original", copyId, "sibling"]);

      const copyBox = await frame
        .locator(`[data-agent-native-node-id="${copyId}"]`)
        .boundingBox();
      expect(Math.round(copyBox!.x)).toBe(Math.round(before.x));
      expect(Math.round(copyBox!.y)).toBe(Math.round(before.y));

      const names = await layerNames(page);
      expect(names.filter((n) => n === "Original")).toHaveLength(2);

      const trace = await dumpTrace(page);
      const selectionMatches = [
        ...(trace ?? "").matchAll(
          /\[select:selection-changed\] \{"layers":\[[^\]]*\],"element":"((?:[^"\\]|\\.)*)"/g,
        ),
      ];
      const lastSelection =
        selectionMatches[selectionMatches.length - 1]?.[1] ?? null;
      if (!lastSelection || !lastSelection.includes(copyId!)) {
        console.log("TRACE_DEBUG", JSON.stringify(trace));
      }
      expect(lastSelection).toContain(copyId);
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });

  test("cmd+D on an unnamed (tag-fallback-named) element keeps the same computed name, not literal 'Copy'", async ({
    page,
    request,
  }) => {
    const { designId } = await createDesign(request, UNNAMED_HTML);
    try {
      await gotoEditorZoomed(page, designId);
      await selectByNodeId(page, "plain");
      const namesBefore = await layerNames(page);
      expect(namesBefore).toHaveLength(1);
      const originalName = namesBefore[0]!;

      await page.keyboard.press("ControlOrMeta+d");
      await expect
        .poll(async () => (await layerNames(page)).length, {
          timeout: 10_000,
        })
        .toBe(2);

      const namesAfter = await layerNames(page);
      if (
        namesAfter.length !== 2 ||
        namesAfter.some((n) => n !== originalName)
      ) {
        const trace = await dumpTrace(page);
        console.log("TRACE_DEBUG", JSON.stringify(trace));
        test.info().annotations.push({
          type: "trace",
          description: JSON.stringify({ originalName, namesAfter, trace }),
        });
      }
      expect(namesAfter).toHaveLength(2);
      for (const name of namesAfter) {
        expect(name).toBe(originalName);
        expect(name.toLowerCase()).not.toContain("copy");
      }
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });

  test("shift+cmd+R (paste to replace) replaces the selection with the clipboard object", async ({
    page,
    request,
  }) => {
    const { designId } = await createDesign(request, CONTAINER_AND_SOURCE_HTML);
    try {
      await gotoEditorZoomed(page, designId);
      const frame = designFrame(page);
      await selectByNodeId(page, "source");
      await page.keyboard.press("ControlOrMeta+c");
      await page.waitForTimeout(300);
      await selectByNodeId(page, "container");
      await page.keyboard.press("ControlOrMeta+Shift+r");

      try {
        await expect(
          frame.locator('[data-agent-native-node-id="container"]'),
        ).toHaveCount(0, { timeout: 10_000 });
        await expect(
          frame.locator('[data-agent-native-layer-name="Source"]'),
        ).toHaveCount(2, { timeout: 10_000 });
      } catch (error) {
        const trace = await dumpTrace(page);
        console.log("TRACE_DEBUG", JSON.stringify(trace));
        test.info().annotations.push({
          type: "trace",
          description: JSON.stringify({ trace }),
        });
        throw error;
      }
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });

  test("cmd+X removes the element, and one undo restores it", async ({
    page,
    request,
  }) => {
    const { designId } = await createDesign(request, SIMPLE_HTML);
    try {
      await gotoEditorZoomed(page, designId);
      const frame = designFrame(page);
      await selectByNodeId(page, "rect");
      await page.keyboard.press("ControlOrMeta+x");
      await page.waitForTimeout(800);

      const afterCut = await frame
        .locator('[data-agent-native-node-id="rect"]')
        .count();
      if (afterCut !== 0) {
        const trace = await dumpTrace(page);
        console.log("TRACE_DEBUG", JSON.stringify(trace));
        test.info().annotations.push({
          type: "trace",
          description: JSON.stringify({ afterCut, trace }),
        });
      }
      expect(afterCut).toBe(0);

      await page.keyboard.press("ControlOrMeta+z");
      await page.waitForTimeout(800);
      const afterUndo = frame.locator('[data-agent-native-node-id="rect"]');
      await expect(afterUndo).toHaveCount(1, { timeout: 10_000 });
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });

  test("each of cmd+D and cmd+V is exactly one undo step", async ({
    page,
    request,
  }) => {
    const { designId } = await createDesign(request, SIMPLE_HTML);
    try {
      await gotoEditorZoomed(page, designId);
      const frame = designFrame(page);
      await selectByNodeId(page, "rect");

      await page.keyboard.press("ControlOrMeta+d");
      await expect(
        frame.locator(
          '[data-agent-native-node-id="rect"], [data-agent-native-node-id^="copy-"]',
        ),
      ).toHaveCount(2, { timeout: 10_000 });
      await page.keyboard.press("ControlOrMeta+z");
      await page.waitForTimeout(800);
      await expect(
        frame.locator(
          '[data-agent-native-node-id="rect"], [data-agent-native-node-id^="copy-"]',
        ),
      ).toHaveCount(1, { timeout: 10_000 });

      await selectByNodeId(page, "rect");
      await page.keyboard.press("ControlOrMeta+c");
      await page.waitForTimeout(300);
      await page.keyboard.press("ControlOrMeta+v");
      const afterPasteLocator = frame.locator(
        '[data-agent-native-node-id="rect"], [data-agent-native-node-id^="copy-"]',
      );
      try {
        await expect(afterPasteLocator).toHaveCount(2, { timeout: 10_000 });
      } catch (error) {
        const trace = await dumpTrace(page);
        console.log("TRACE_DEBUG", JSON.stringify(trace));
        test.info().annotations.push({
          type: "trace",
          description: JSON.stringify({ trace }),
        });
        throw error;
      }
      await page.keyboard.press("ControlOrMeta+z");
      await page.waitForTimeout(800);
      await expect(
        frame.locator(
          '[data-agent-native-node-id="rect"], [data-agent-native-node-id^="copy-"]',
        ),
      ).toHaveCount(1, { timeout: 10_000 });
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });
});

test.describe("clipboard + duplicate (overview / board objects, cross-screen)", () => {
  test("copy in screen A, select screen B, paste lands in screen B", async ({
    page,
    request,
  }) => {
    const { designId, fileIds } = await createDesign(request, SIMPLE_HTML, 2);
    try {
      await action(request, "update-file", {
        id: fileIds[1],
        content: `<!doctype html><html><body style="margin:0;position:relative;min-height:900px"></body></html>`,
      });

      await page.goto(
        appPath(`/design/${designId}?view=overview&screen=${fileIds[0]}`),
        { waitUntil: "domcontentloaded" },
      );
      await expect(
        page.getByRole("button", { name: "Move", exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("[data-screen-shell]").first()).toBeVisible();

      const frameA = designFrame(page, fileIds[0]);
      const rectBox = await stableBox(
        frameA.locator('[data-agent-native-node-id="rect"]'),
      );
      await page.mouse.click(
        rectBox.x + rectBox.width / 2,
        rectBox.y + rectBox.height / 2,
        { force: true } as any,
      );
      await page.waitForTimeout(250);
      await page.keyboard.press("ControlOrMeta+c");
      await page.waitForTimeout(300);

      await page.goto(
        appPath(`/design/${designId}?view=overview&screen=${fileIds[1]}`),
        { waitUntil: "domcontentloaded" },
      );
      await expect(page.locator("[data-screen-shell]").first()).toBeVisible();
      await page.keyboard.press("ControlOrMeta+v");

      const screenBFrame = designFrame(page, fileIds[1]);
      const pasted = screenBFrame.locator(
        '[data-agent-native-layer-name="Widget"]',
      );
      try {
        await expect(pasted).toHaveCount(1, { timeout: 10_000 });
      } catch (error) {
        const trace = await dumpTrace(page);
        console.log("TRACE_DEBUG", JSON.stringify(trace));
        test.info().annotations.push({
          type: "trace",
          description: JSON.stringify({ trace }),
        });
        throw error;
      }

      const screenAFrame = designFrame(page, fileIds[0]);
      await expect(
        screenAFrame.locator('[data-agent-native-node-id="rect"]'),
      ).toHaveCount(1);
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });

  test("cmd+D on a selected screen (a top-level frame board object) duplicates the whole screen and selects the copy", async ({
    page,
    request,
  }) => {
    const { designId, fileIds } = await createDesign(
      request,
      BOARD_OBJECT_HTML,
    );
    try {
      await page.goto(appPath(`/design/${designId}?view=overview`), {
        waitUntil: "domcontentloaded",
      });
      await expect(page.locator("[data-screen-shell]")).toHaveCount(1, {
        timeout: 30_000,
      });

      const readFramePositions = () =>
        page.evaluate(() =>
          Object.fromEntries(
            Array.from(
              document.querySelectorAll<HTMLElement>("[data-frame-id]"),
            ).map((node) => [
              node.getAttribute("data-frame-id")!,
              {
                left: Number.parseFloat(node.style.left),
                top: Number.parseFloat(node.style.top),
              },
            ]),
          ),
        );
      let before: Record<string, { left: number; top: number }> = {};
      await expect
        .poll(
          async () => {
            before = await readFramePositions();
            return Object.keys(before).length;
          },
          { timeout: 10_000 },
        )
        .toBe(1);

      await page.locator("[data-frame-label]").first().click({ force: true });
      await page.waitForTimeout(300);
      await page.keyboard.press("ControlOrMeta+d");

      let after: Record<string, { left: number; top: number }> = {};
      await expect
        .poll(
          async () => {
            after = await readFramePositions();
            return Object.keys(after).length;
          },
          { timeout: 10_000 },
        )
        .toBe(2);
      expect(Object.keys(after)).toHaveLength(2);
      const originalId = fileIds[0];
      const copyId = Object.keys(after).find((id) => id !== originalId);
      expect(copyId).toBeTruthy();
      expect(after[originalId]).toEqual(before[originalId]);
      const moved =
        after[copyId!].left !== before[originalId].left ||
        after[copyId!].top !== before[originalId].top;
      expect(moved).toBe(true);
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });
});
