import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { parse } from "parse5";

import { appPath, cdpScreenshot, expandAllLayers, gotoEditor } from "./helpers";

const SCREEN = `<!doctype html><html><body style="margin:0;position:relative;width:800px;height:600px">
<div data-agent-native-node-id="free" data-agent-native-layer-name="Free element" style="position:absolute;left:80px;top:80px;width:120px;height:70px;background:#2563eb"></div>
<div data-agent-native-node-id="root" data-agent-native-layer-name="Root element" data-an-primitive="frame" style="position:absolute;left:80px;top:200px;width:120px;height:70px;background:#f97316"></div>
<section data-agent-native-node-id="nested-auto" data-agent-native-layer-name="Nested auto" data-an-primitive="frame" style="position:absolute;left:380px;top:80px;width:300px;height:180px;display:flex;flex-direction:row;gap:12px;padding:12px;background:#dbeafe;box-sizing:border-box">
<div data-agent-native-node-id="flow-child" data-agent-native-layer-name="Flow child" style="flex:0 0 100px;height:50px;background:#7c3aed"></div>
<div data-agent-native-node-id="auto-peer" data-agent-native-layer-name="Peer" style="flex:0 0 100px;height:50px;background:#06b6d4"></div>
</section></body></html>`;
const DESTINATION = `<!doctype html><html><body style="margin:0;position:relative;width:800px;height:600px">
<section data-agent-native-node-id="root" data-agent-native-layer-name="Destination" data-an-primitive="frame" style="position:absolute;left:180px;top:180px;width:260px;height:160px;background:#f97316"></section>
</body></html>`;

type HtmlNode = {
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  parentNode?: HtmlNode;
};

function findByNodeId(node: HtmlNode, id: string): HtmlNode | undefined {
  if (
    node.attrs?.some(
      (attribute) =>
        attribute.name === "data-agent-native-node-id" &&
        attribute.value === id,
    )
  )
    return node;
  for (const child of node.childNodes ?? []) {
    const match = findByNodeId(child, id);
    if (match) return match;
  }
  return undefined;
}

function attr(node: HtmlNode | undefined, name: string): string | undefined {
  return node?.attrs?.find((attribute) => attribute.name === name)?.value;
}

function ownership(html: string, id: string) {
  const node = findByNodeId(parse(html) as unknown as HtmlNode, id);
  return {
    exists: node !== undefined,
    parent: attr(node?.parentNode, "data-agent-native-node-id") ?? null,
    style: attr(node, "style") ?? "",
  };
}
async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input },
  );
  if (!response.ok())
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  return response.json();
}

async function createScreens(
  request: APIRequestContext,
  secondContent = SCREEN,
  sourceContent = SCREEN,
) {
  const created = await action(request, "create-design", {
    title: "drag acceptance",
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id;
  if (!designId) throw new Error("create-design returned no id");
  const ids: string[] = [];
  try {
    for (const [index, filename] of ["index.html", "second.html"].entries()) {
      const file = await action(request, "create-file", {
        designId,
        filename,
        content: index === 0 ? sourceContent : secondContent,
        fileType: "html",
      });
      const fileId = file.id ?? file.data?.id;
      if (!fileId)
        throw new Error(`create-file returned no id for ${filename}`);
      ids.push(fileId);
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
            value: {
              x: index * 1100,
              y: 0,
              width: 800,
              height: 600,
              z: index,
            },
          },
        ],
      });
    }
  } catch (error) {
    await action(request, "delete-design", { id: designId });
    throw error;
  }
  return { designId, ids };
}

function screenById(page: Page, fileId: string) {
  return page.locator(
    `iframe[data-design-preview-iframe][data-screen-iframe-id="${fileId}"]`,
  );
}

async function file(
  request: APIRequestContext,
  designId: string,
  filename: string,
) {
  const result = await request
    .get(appPath(`/_agent-native/actions/get-design?id=${designId}`))
    .then((r) => r.json());
  const found = result.files?.find(
    (item: { filename: string }) => item.filename === filename,
  );
  if (!found) throw new Error(`missing ${filename}`);
  return found.content as string;
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("free-position drag exposes its live position and persists after reload", async ({
  page,
  request,
}) => {
  const { designId, ids } = await createScreens(request);
  try {
    await gotoEditor(page, designId);
    await expandAllLayers(page);
    const source = screenById(page, ids[0]!)
      .contentFrame()
      .locator('[data-agent-native-node-id="free"]');
    await expect(source).toBeVisible();
    const start = (await source.boundingBox())!;
    const origin = {
      x: start.x + start.width / 2,
      y: start.y + start.height / 2,
    };
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    await page.mouse.move(origin.x + 8, origin.y + 4, { steps: 3 });
    await page.mouse.move(origin.x + 100, origin.y + 60, { steps: 12 });
    const selection = screenById(page, ids[0]!)
      .contentFrame()
      .locator('[data-agent-native-edit-overlay="selection"]');
    await expect(selection).toBeVisible();
    const live = await source.boundingBox();
    expect(live!.x).toBeGreaterThan(start.x + 60);
    expect(live!.y).toBeGreaterThan(start.y + 30);
    const feedback = await selection.boundingBox();
    expect(feedback!.x).toBeGreaterThan(start.x + 60);
    expect(feedback!.y).toBeGreaterThan(start.y + 30);
    const heldScreenshot = test.info().outputPath("free-drag-held.png");
    await cdpScreenshot(page, heldScreenshot);
    await test.info().attach("free-drag-held.png", {
      path: heldScreenshot,
      contentType: "image/png",
    });
    await page.mouse.up();
    await expect
      .poll(
        async () =>
          (await file(request, designId, "index.html")).match(
            /data-agent-native-node-id="free"[^>]*style="([^"]+)"/,
          )?.[1] ?? "",
      )
      .not.toContain("left:80px");
    const committed = await file(request, designId, "index.html");
    const movedStyle =
      /data-agent-native-node-id="free"[^>]*style="([^"]+)"/.exec(
        committed,
      )?.[1];
    expect(movedStyle).toContain("left:");
    expect(movedStyle).toContain("top:");
    await page.reload({ waitUntil: "domcontentloaded" });
    const persistedNode = screenById(page, ids[0]!)
      .contentFrame()
      .locator('[data-agent-native-node-id="free"]');
    await expect(persistedNode).toBeVisible();
    const persisted = await persistedNode.evaluate((el) => ({
      left: (el as HTMLElement).style.left,
      top: (el as HTMLElement).style.top,
    }));
    expect(persisted.left).not.toBe("80px");
    expect(persisted.top).not.toBe("80px");
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("Option-dragging a root Screen previews, creates, and persists a duplicate", async ({
  page,
  request,
}) => {
  const { designId, ids } = await createScreens(request);
  try {
    await page.goto(appPath(`/design/${designId}?view=overview&zoom=50`), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2, {
      timeout: 30_000,
    });
    const fileCountBefore = await page.request
      .get(appPath(`/_agent-native/actions/get-design?id=${designId}`))
      .then((r) => r.json())
      .then((result) => result.files.length);
    await expect(page.locator("[data-screen-card]").first()).toBeVisible();
    await page.locator("[data-frame-label]").first().click({ force: true });
    const source = page.locator("[data-frame-drag-surface]").first();
    await expect(source).toBeVisible();
    const box = (await source.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(point.x, point.y);
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(point.x + 14, point.y + 8, { steps: 3 });
    await expect(page.locator("[data-duplicate-preview-ghost]")).toBeVisible();
    await page.mouse.move(point.x + 160, point.y + 90, { steps: 12 });
    const duplicateGhost = await page
      .locator("[data-duplicate-preview-ghost]")
      .boundingBox();
    expect(duplicateGhost).not.toBeNull();
    expect(duplicateGhost!.x).toBeGreaterThan(box.x + 80);
    const heldScreenshot = test.info().outputPath("screen-duplicate-held.png");
    await cdpScreenshot(page, heldScreenshot);
    await test.info().attach("screen-duplicate-held.png", {
      path: heldScreenshot,
      contentType: "image/png",
    });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect(page.locator("[data-screen-shell]")).toHaveCount(3, {
      timeout: 20_000,
    });
    await expect
      .poll(
        async () =>
          (
            await page.request
              .get(appPath(`/_agent-native/actions/get-design?id=${designId}`))
              .then((r) => r.json())
          ).files?.length,
      )
      .toBeGreaterThan(fileCountBefore);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-screen-shell]")).toHaveCount(3, {
      timeout: 30_000,
    });
    const result = await page.request
      .get(appPath(`/_agent-native/actions/get-design?id=${designId}`))
      .then((r) => r.json());
    expect(result.files.length).toBeGreaterThan(fileCountBefore);
    const duplicates = result.files.filter(
      (entry: { filename: string; id: string }) =>
        !ids.includes(entry.id) && /copy/i.test(entry.filename),
    );
    expect(duplicates.length).toBeGreaterThan(0);
    const sourceHtml = result.files.find(
      (entry: { id: string }) => entry.id === ids[0],
    ).content as string;
    const sourceNodeIds = [
      ...sourceHtml.matchAll(/data-agent-native-node-id="([^"]+)"/g),
    ].map((match) => match[1]);
    const duplicate = duplicates.find((entry: { content: string }) => {
      const copiedNodeIds = [
        ...entry.content.matchAll(/data-agent-native-node-id="([^"]+)"/g),
      ].map((match) => match[1]);
      return (
        entry.content.includes('data-agent-native-layer-name="Flow child"') &&
        copiedNodeIds.length === sourceNodeIds.length &&
        copiedNodeIds.every((id: string) => !sourceNodeIds.includes(id))
      );
    });
    expect(duplicate).toBeDefined();
    expect(JSON.parse(result.data).canvasFrames?.[duplicate!.id]).toMatchObject(
      {
        x: 320,
        y: 180,
        width: 800,
        height: 600,
      },
    );
    const sourceCard = page.locator(
      `[data-screen-shell][data-frame-id="${ids[0]}"] [data-screen-card]`,
    );
    const duplicateCard = page.locator(
      `[data-screen-shell][data-frame-id="${duplicate!.id}"] [data-screen-card]`,
    );
    const sourceBox = await sourceCard.boundingBox();
    const duplicateBox = await duplicateCard.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(duplicateBox).not.toBeNull();
    expect(Math.abs(duplicateBox!.x - sourceBox!.x - 160)).toBeLessThan(2);
    expect(Math.abs(duplicateBox!.y - sourceBox!.y - 90)).toBeLessThan(2);
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("nested auto-layout child drops into an existing root frame across Screens", async ({
  page,
  request,
}) => {
  const { designId, ids } = await createScreens(request, DESTINATION);
  try {
    await gotoEditor(page, designId);
    await expandAllLayers(page);
    const source = screenById(page, ids[0]!)
      .contentFrame()
      .locator('[data-agent-native-node-id="flow-child"]');
    const target = screenById(page, ids[1]!)
      .contentFrame()
      .locator('[data-agent-native-node-id="root"]');
    await expect(source).toBeVisible();
    await expect(target).toBeVisible();
    const sourceComputedSize = await source.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: Number.parseFloat(style.width),
        height: Number.parseFloat(style.height),
      };
    });
    expect(sourceComputedSize).toEqual({ width: 100, height: 50 });
    await page.evaluate(() => {
      const host = window as Window & { __crossScreenDndMessages?: unknown[] };
      host.__crossScreenDndMessages = [];
      window.addEventListener("message", (event: MessageEvent) => {
        if (event.data?.type === "agent-native:cross-screen-drag") {
          host.__crossScreenDndMessages?.push(event.data);
        }
      });
    });
    const sourceBox = (await source.boundingBox())!;
    const targetBox = (await target.boundingBox())!;
    const origin = {
      x: sourceBox.x + sourceBox.width / 2,
      y: sourceBox.y + sourceBox.height / 2,
    };
    const editorUrl = page.url();
    const sourceBefore = await file(request, designId, "index.html");
    const destinationBefore = await file(request, designId, "second.html");
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    try {
      await page.mouse.move(origin.x - 12, origin.y, { steps: 4 });
      await page.mouse.move(
        targetBox.x + targetBox.width / 2,
        targetBox.y + targetBox.height / 2,
        { steps: 24 },
      );
      await expect(page.locator("[data-cross-screen-drop-guide]")).toBeVisible({
        timeout: 5_000,
      });
      await expect(page.locator("[data-cross-screen-drag-ghost]")).toBeVisible({
        timeout: 5_000,
      });
      const hitPreview = screenById(page, ids[1]!)
        .contentFrame()
        .locator("[data-agent-native-hit-test-preview]");
      await expect(hitPreview).toBeVisible({ timeout: 5_000 });
      expect(
        await source.evaluate((element) =>
          element.parentElement?.getAttribute("data-agent-native-node-id"),
        ),
      ).toBe("nested-auto");
      const heldSourceBox = await source.boundingBox();
      expect(heldSourceBox).not.toBeNull();
      expect(heldSourceBox!.x).toBeCloseTo(sourceBox.x, 0);
      expect(heldSourceBox!.y).toBeCloseTo(sourceBox.y, 0);
      const previewBox = await hitPreview.boundingBox();
      expect(previewBox).not.toBeNull();
      expect(previewBox!.x + previewBox!.width / 2).toBeGreaterThan(
        targetBox.x - 40,
      );
      expect(previewBox!.x + previewBox!.width / 2).toBeLessThan(
        targetBox.x + targetBox.width + 40,
      );
      expect(previewBox!.y + previewBox!.height / 2).toBeGreaterThan(
        targetBox.y - 40,
      );
      expect(previewBox!.y + previewBox!.height / 2).toBeLessThan(
        targetBox.y + targetBox.height + 40,
      );
      expect(await file(request, designId, "index.html")).toBe(sourceBefore);
      expect(await file(request, designId, "second.html")).toBe(
        destinationBefore,
      );
      const heldScreenshot = test
        .info()
        .outputPath("nested-flow-to-existing-root-held.png");
      await cdpScreenshot(page, heldScreenshot);
      await test.info().attach("nested-flow-to-existing-root-held.png", {
        path: heldScreenshot,
        contentType: "image/png",
      });
    } finally {
      await page.mouse.up();
    }

    expect(new URL(page.url()).pathname).toBe(new URL(editorUrl).pathname);
    await expect
      .poll(async () => {
        const [sourceHtml, destinationHtml] = await Promise.all([
          file(request, designId, "index.html"),
          file(request, designId, "second.html"),
        ]);
        return {
          source: ownership(sourceHtml, "flow-child"),
          destination: ownership(destinationHtml, "flow-child"),
        };
      })
      .toEqual({
        source: { exists: false, parent: null, style: "" },
        destination: {
          exists: true,
          parent: "root",
          style: expect.stringMatching(/(?:^|;)\s*position\s*:\s*absolute/i),
        },
      });
    const dndMessages = await page.evaluate(
      () =>
        (window as Window & { __crossScreenDndMessages?: unknown[] })
          .__crossScreenDndMessages ?? [],
    );
    const sizeMessages = dndMessages.flatMap((message) => {
      if (
        typeof message !== "object" ||
        message === null ||
        !("phase" in message) ||
        !["start", "end"].includes(String(message.phase))
      ) {
        return [];
      }
      return [
        {
          phase: message.phase,
          sourceComputedSize:
            "sourceComputedSize" in message
              ? message.sourceComputedSize
              : undefined,
        },
      ];
    });
    expect(sizeMessages.length).toBeGreaterThan(0);
    expect(sizeMessages[sizeMessages.length - 1]?.phase).toBe("end");
    expect(sizeMessages.map((message) => message.sourceComputedSize)).toEqual(
      sizeMessages.map(() => ({ width: sourceComputedSize.width })),
    );
    const persistedDestination = ownership(
      await file(request, designId, "second.html"),
      "flow-child",
    );
    expect(persistedDestination.style).toMatch(/(?:^|;)\s*width\s*:\s*100px/i);
    expect(persistedDestination.style).toMatch(/(?:^|;)\s*height\s*:\s*50px/i);
    const sourceSibling = ownership(
      await file(request, designId, "index.html"),
      "auto-peer",
    );
    expect(sourceSibling).toMatchObject({
      exists: true,
      parent: "nested-auto",
    });

    const [sourceAfterDrop, destinationAfterDrop] = await Promise.all([
      file(request, designId, "index.html"),
      file(request, designId, "second.html"),
    ]);
    const undo = process.platform === "darwin" ? "Meta+Z" : "Control+Z";
    const redo =
      process.platform === "darwin" ? "Meta+Shift+Z" : "Control+Shift+Z";
    await page.keyboard.press(undo);
    await expect
      .poll(() =>
        Promise.all([
          file(request, designId, "index.html"),
          file(request, designId, "second.html"),
        ]),
      )
      .toEqual([sourceBefore, destinationBefore]);
    await page.keyboard.press(redo);
    await expect
      .poll(() =>
        Promise.all([
          file(request, designId, "index.html"),
          file(request, designId, "second.html"),
        ]),
      )
      .toEqual([sourceAfterDrop, destinationAfterDrop]);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      screenById(page, ids[0]!)
        .contentFrame()
        .locator('[data-agent-native-node-id="auto-peer"]'),
    ).toBeVisible();
    await expect(
      screenById(page, ids[0]!)
        .contentFrame()
        .locator('[data-agent-native-node-id="flow-child"]'),
    ).toHaveCount(0);
    const moved = screenById(page, ids[1]!)
      .contentFrame()
      .locator('[data-agent-native-node-id="flow-child"]');
    await expect(moved).toBeAttached();
    const movedState = await moved.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const source = element as Element & { __anSource?: boolean };
      const style = getComputedStyle(element);
      return {
        html: element.outerHTML,
        parentHtml: element.parentElement?.outerHTML,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        sourceOwned: source.__anSource === true,
      };
    });
    await test.info().attach("moved-layer-after-reload.json", {
      body: JSON.stringify(movedState, null, 2),
      contentType: "application/json",
    });
    const reloadedScreenshot = test
      .info()
      .outputPath("nested-flow-to-existing-root-reloaded.png");
    await cdpScreenshot(page, reloadedScreenshot);
    await test.info().attach("nested-flow-to-existing-root-reloaded.png", {
      path: reloadedScreenshot,
      contentType: "image/png",
    });
    expect(movedState.display).not.toBe("none");
    expect(movedState.visibility).toBe("visible");
    expect(Number(movedState.opacity)).toBeGreaterThan(0);
    expect(movedState.width).toBeGreaterThan(0);
    expect(movedState.height).toBeGreaterThan(0);
    await expect(moved).toBeVisible();
    expect(
      await moved.evaluate((element) =>
        element.parentElement?.getAttribute("data-agent-native-node-id"),
      ),
    ).toBe("root");
    expect(
      await moved.evaluate((element) => getComputedStyle(element).position),
    ).toBe("absolute");
    const reloadedRoot = screenById(page, ids[1]!)
      .contentFrame()
      .locator('[data-agent-native-node-id="root"]');
    const [movedBox, reloadedRootBox] = await Promise.all([
      moved.boundingBox(),
      reloadedRoot.boundingBox(),
    ]);
    expect(movedBox).not.toBeNull();
    expect(reloadedRootBox).not.toBeNull();
    expect(movedBox!.x).toBeGreaterThanOrEqual(reloadedRootBox!.x);
    expect(movedBox!.y).toBeGreaterThanOrEqual(reloadedRootBox!.y);
    expect(movedBox!.x + movedBox!.width).toBeLessThanOrEqual(
      reloadedRootBox!.x + reloadedRootBox!.width,
    );
    expect(movedBox!.y + movedBox!.height).toBeLessThanOrEqual(
      reloadedRootBox!.y + reloadedRootBox!.height,
    );
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("ordinary cross-Screen drops preserve percentage and auto sizing", async ({
  page,
  request,
}) => {
  const responsiveSource = `<!doctype html><html><body style="margin:0;position:relative;width:800px;height:600px">
    <div style="position:relative;margin:80px;width:600px;min-height:200px">
      <div data-agent-native-node-id="responsive" data-agent-native-layer-name="Responsive" style="width:50%;height:auto;background:#059669">Responsive layer</div>
    </div>
  </body></html>`;
  const { designId, ids } = await createScreens(
    request,
    DESTINATION,
    responsiveSource,
  );
  try {
    await gotoEditor(page, designId);
    await expandAllLayers(page);
    const source = screenById(page, ids[0]!)
      .contentFrame()
      .locator('[data-agent-native-node-id="responsive"]');
    const target = screenById(page, ids[1]!)
      .contentFrame()
      .locator('[data-agent-native-node-id="root"]');
    await expect(source).toBeVisible();
    await expect(target).toBeVisible();
    expect(
      await source.evaluate((element) => ({
        width: (element as HTMLElement).style.width,
        height: (element as HTMLElement).style.height,
      })),
    ).toEqual({ width: "50%", height: "auto" });
    await page.evaluate(() => {
      const host = window as Window & {
        __crossScreenDndMessages?: Array<{
          phase?: string;
          sourceComputedSize?: unknown;
        }>;
      };
      host.__crossScreenDndMessages = [];
      window.addEventListener("message", (event: MessageEvent) => {
        if (event.data?.type === "agent-native:cross-screen-drag") {
          host.__crossScreenDndMessages?.push(event.data);
        }
      });
    });
    const sourceBox = (await source.boundingBox())!;
    const targetBox = (await target.boundingBox())!;
    const editorUrl = page.url();
    const sourceBefore = await file(request, designId, "index.html");
    const destinationBefore = await file(request, designId, "second.html");
    const origin = {
      x: sourceBox.x + sourceBox.width / 2,
      y: sourceBox.y + sourceBox.height / 2,
    };
    await page.mouse.move(origin.x, origin.y);
    await page.mouse.down();
    try {
      await page.mouse.move(origin.x - 12, origin.y, { steps: 4 });
      await page.mouse.move(
        targetBox.x + targetBox.width / 2,
        targetBox.y + targetBox.height / 2,
        { steps: 24 },
      );
      const dragMessages = await page.evaluate(
        () =>
          (
            window as Window & {
              __crossScreenDndMessages?: Array<{ phase?: string }>;
            }
          ).__crossScreenDndMessages ?? [],
      );
      await test.info().attach("responsive-cross-screen-drag-phases.json", {
        body: JSON.stringify(dragMessages.map(({ phase }) => phase)),
        contentType: "application/json",
      });
      expect(dragMessages.map(({ phase }) => phase)).toContain("move");
      await expect(page.locator("[data-cross-screen-drop-guide]")).toBeVisible({
        timeout: 5_000,
      });
      const heldScreenshot = test
        .info()
        .outputPath("responsive-cross-screen-held.png");
      await cdpScreenshot(page, heldScreenshot);
      await test.info().attach("responsive-cross-screen-held.png", {
        path: heldScreenshot,
        contentType: "image/png",
      });
      expect(await file(request, designId, "index.html")).toBe(sourceBefore);
      expect(await file(request, designId, "second.html")).toBe(
        destinationBefore,
      );
    } finally {
      await page.mouse.up();
    }
    expect(new URL(page.url()).pathname).toBe(new URL(editorUrl).pathname);
    await expect
      .poll(async () => {
        const [sourceHtml, destinationHtml] = await Promise.all([
          file(request, designId, "index.html"),
          file(request, designId, "second.html"),
        ]);
        return {
          source: ownership(sourceHtml, "responsive"),
          destination: ownership(destinationHtml, "responsive"),
        };
      })
      .toEqual({
        source: { exists: false, parent: null, style: "" },
        destination: {
          exists: true,
          parent: "root",
          style: expect.stringMatching(/(?:^|;)\s*width\s*:\s*50%/i),
        },
      });
    const persisted = ownership(
      await file(request, designId, "second.html"),
      "responsive",
    );
    expect(persisted.style).toMatch(/(?:^|;)\s*height\s*:\s*auto/i);
    expect(persisted.style).not.toMatch(
      /(?:^|;)\s*width\s*:\s*\d+(?:\.\d+)?px/i,
    );
    const sizeMessages = await page.evaluate(
      () =>
        (
          window as Window & {
            __crossScreenDndMessages?: Array<{
              phase?: string;
              sourceComputedSize?: unknown;
            }>;
          }
        ).__crossScreenDndMessages ?? [],
    );
    const startAndEnd = sizeMessages.filter((message) =>
      ["start", "end"].includes(message.phase ?? ""),
    );
    expect(startAndEnd.length).toBeGreaterThan(0);
    expect(startAndEnd.map((message) => message.sourceComputedSize)).toEqual(
      startAndEnd.map(() => undefined),
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    const moved = screenById(page, ids[1]!)
      .contentFrame()
      .locator('[data-agent-native-node-id="responsive"]');
    await expect(moved).toBeVisible();
    const movedSizing = await moved.evaluate((element) => ({
      width: (element as HTMLElement).style.width,
      height: (element as HTMLElement).style.height,
      rectWidth: element.getBoundingClientRect().width,
    }));
    expect(movedSizing).toMatchObject({ width: "50%", height: "auto" });
    expect(movedSizing.rectWidth).toBeLessThan(260);
    const reloadedScreenshot = test
      .info()
      .outputPath("responsive-cross-screen-reloaded.png");
    await cdpScreenshot(page, reloadedScreenshot);
    await test.info().attach("responsive-cross-screen-reloaded.png", {
      path: reloadedScreenshot,
      contentType: "image/png",
    });
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("cross-Screen drops preserve Flex and default Grid-stretched sizes", async ({
  page,
  request,
}) => {
  const sourceContent = `<!doctype html><html><body style="margin:0;position:relative;width:800px;height:600px">
    <section style="position:absolute;left:80px;top:80px;width:300px;height:200px;display:flex">
      <div data-agent-native-node-id="flex-stretched" data-agent-native-layer-name="Flex item" style="position:relative;width:auto;height:auto;min-width:0;flex:0 1 auto;white-space:nowrap;background:#059669">A long unbreakable flex child that shrinks to fit its row</div>
    </section>
    <section style="position:absolute;left:80px;top:320px;width:300px;height:200px;display:grid;grid-template-columns:300px;grid-template-rows:200px">
      <div data-agent-native-node-id="grid-stretched" data-agent-native-layer-name="Grid item" style="width:auto;height:auto;background:#7c3aed">Default-stretched grid item</div>
    </section>
  </body></html>`;
  const { designId, ids } = await createScreens(
    request,
    DESTINATION,
    sourceContent,
  );
  try {
    await gotoEditor(page, designId);
    const target = screenById(page, ids[1]!)
      .contentFrame()
      .locator('[data-agent-native-node-id="root"]');
    await expect(target).toBeVisible();
    await page.evaluate(() => {
      const host = window as Window & {
        __crossScreenDndMessages?: Array<{
          phase?: string;
          sourceComputedSize?: { width?: number; height?: number };
        }>;
      };
      host.__crossScreenDndMessages = [];
      window.addEventListener("message", (event: MessageEvent) => {
        if (event.data?.type === "agent-native:cross-screen-drag") {
          host.__crossScreenDndMessages?.push(event.data);
        }
      });
    });
    const gridSourceBefore = ownership(
      await file(request, designId, "index.html"),
      "grid-stretched",
    );
    for (const nodeId of ["flex-stretched", "grid-stretched"]) {
      const source = screenById(page, ids[0]!)
        .contentFrame()
        .locator(`[data-agent-native-node-id="${nodeId}"]`);
      await expect(source).toBeVisible();
      expect(
        await source.evaluate((element) => {
          const { width, height } = element.getBoundingClientRect();
          return { width, height };
        }),
      ).toEqual({ width: 300, height: 200 });

      const sourceBefore = await file(request, designId, "index.html");
      const destinationBefore = await file(request, designId, "second.html");
      const sourceBox = (await source.boundingBox())!;
      const targetBox = (await target.boundingBox())!;
      const origin = {
        x: sourceBox.x + sourceBox.width / 2,
        y: sourceBox.y + sourceBox.height / 2,
      };
      await page.evaluate(() => {
        const host = window as Window & {
          __crossScreenDndMessages?: Array<{
            phase?: string;
            sourceComputedSize?: { width?: number; height?: number };
          }>;
        };
        host.__crossScreenDndMessages = [];
      });
      await page.mouse.move(origin.x, origin.y);
      await page.mouse.down();
      try {
        await page.mouse.move(origin.x - 12, origin.y, { steps: 4 });
        await page.mouse.move(
          targetBox.x + targetBox.width / 2,
          targetBox.y + targetBox.height / 2,
          { steps: 24 },
        );
        await expect(
          page.locator("[data-cross-screen-drop-guide]"),
        ).toBeVisible({
          timeout: 5_000,
        });
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                (
                  window as Window & {
                    __crossScreenDndMessages?: Array<{ phase?: string }>;
                  }
                ).__crossScreenDndMessages?.some(
                  (message) => message.phase === "start",
                ) ?? false,
            ),
          )
          .toBe(true);
        const startMessage = await page.evaluate(() =>
          (
            window as Window & {
              __crossScreenDndMessages?: Array<{
                phase?: string;
                sourceComputedSize?: { width?: number; height?: number };
              }>;
            }
          ).__crossScreenDndMessages?.find(
            (message) => message.phase === "start",
          ),
        );
        expect(startMessage?.sourceComputedSize).toEqual({
          width: 300,
          height: 200,
        });
        expect(await file(request, designId, "index.html")).toBe(sourceBefore);
        expect(await file(request, designId, "second.html")).toBe(
          destinationBefore,
        );
      } finally {
        await page.mouse.up();
      }

      await expect
        .poll(async () => {
          const [sourceHtml, destinationHtml] = await Promise.all([
            file(request, designId, "index.html"),
            file(request, designId, "second.html"),
          ]);
          return {
            source: ownership(sourceHtml, nodeId),
            destination: ownership(destinationHtml, nodeId),
          };
        })
        .toMatchObject({
          source: { exists: false },
          destination: {
            exists: true,
            parent: "root",
            style: expect.stringMatching(/(?:^|;)\s*width\s*:\s*300px/i),
          },
        });
      await expect
        .poll(async () => {
          const destinationHtml = await file(request, designId, "second.html");
          return ownership(destinationHtml, nodeId).style;
        })
        .toMatch(/(?:^|;)\s*height\s*:\s*200px/i);
    }

    const undoShortcut = process.platform === "darwin" ? "Meta+z" : "Control+z";
    const redoShortcut =
      process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z";
    await page.keyboard.press(undoShortcut);
    await expect
      .poll(async () => {
        const [sourceHtml, destinationHtml] = await Promise.all([
          file(request, designId, "index.html"),
          file(request, designId, "second.html"),
        ]);
        return {
          source: ownership(sourceHtml, "grid-stretched"),
          destination: ownership(destinationHtml, "grid-stretched"),
        };
      })
      .toEqual({
        source: gridSourceBefore,
        destination: { exists: false, parent: null, style: "" },
      });

    await page.keyboard.press(redoShortcut);
    await expect
      .poll(async () => {
        const [sourceHtml, destinationHtml] = await Promise.all([
          file(request, designId, "index.html"),
          file(request, designId, "second.html"),
        ]);
        return {
          source: ownership(sourceHtml, "grid-stretched"),
          destination: ownership(destinationHtml, "grid-stretched"),
        };
      })
      .toMatchObject({
        source: { exists: false },
        destination: {
          exists: true,
          parent: "root",
          style: expect.stringMatching(/(?:^|;)\s*width\s*:\s*300px/i),
        },
      });

    await page.reload({ waitUntil: "domcontentloaded" });
    for (const nodeId of ["flex-stretched", "grid-stretched"]) {
      const moved = screenById(page, ids[1]!)
        .contentFrame()
        .locator(`[data-agent-native-node-id="${nodeId}"]`);
      await expect(moved).toBeVisible();
      const movedSize = await moved.evaluate((element) => {
        const { width, height } = element.getBoundingClientRect();
        return {
          width: (element as HTMLElement).style.width,
          height: (element as HTMLElement).style.height,
          rectWidth: width,
          rectHeight: height,
        };
      });
      expect(movedSize).toEqual({
        width: "300px",
        height: "200px",
        rectWidth: 300,
        rectHeight: 200,
      });
    }
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});
