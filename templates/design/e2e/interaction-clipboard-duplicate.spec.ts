import { type APIRequestContext, type Page } from "@playwright/test";

import { appPath, expandAllLayers } from "./helpers";
import {
  childrenOf,
  expect,
  expectOnlyChanged,
  styleOf,
  test,
  type App,
  type SavedNode,
} from "./rails";

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

async function createDesign(app: App, html: string, fileCount = 1) {
  const extra = Object.fromEntries(
    Array.from({ length: fileCount - 1 }, (_, i) => [
      `screen-${i + 2}.html`,
      html,
    ]),
  );
  const designId = await app.seed(html, { files: extra });
  const record = await (
    await app.page.request.get(
      appPath(`/_agent-native/actions/get-design?id=${designId}`),
    )
  ).json();
  const fileIds: string[] = ["index.html", ...Object.keys(extra)].map(
    (name) =>
      record.files.find((file: { filename: string }) => file.filename === name)
        .id,
  );
  await action(app.page.request, "update-design", {
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

type Nodes = Map<string, SavedNode>;

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

function idsNamed(nodes: Nodes, layerName: string) {
  return [...nodes.values()]
    .filter((node) => node.attrs["data-agent-native-layer-name"] === layerName)
    .map((node) => node.id);
}

function bodyId(nodes: Nodes) {
  return [...nodes.values()].find((node) => node.tag === "body")!.id;
}

/** Layer names, tags and text in document order: a screen copy gets new node ids but must match this. */
function shape(nodes: Nodes) {
  return [...nodes.values()].map((node) => [
    node.tag,
    node.attrs["data-agent-native-layer-name"] ?? "",
    node.text,
  ]);
}

/** A copy may serialize colours differently; compare every declaration except the paint. */
function layoutStyle(node: SavedNode | undefined) {
  const { background: _background, ...rest } = styleOf(node);
  return rest;
}

/** Paste picks its own spot; size and every other declaration must still match the source. */
function sizeAndLook(node: SavedNode | undefined) {
  const { left: _left, top: _top, ...rest } = layoutStyle(node);
  return rest;
}

async function openSingle(app: App, html: string) {
  const { designId } = await createDesign(app, html);
  await app.open(designId);
  await app.zoomToFit();
  await app.settled();
  return designId;
}

async function selectLayer(app: App, name: string) {
  await expandAllLayers(app.page);
  await app.page
    .getByRole("tree", { name: "Layers" })
    .getByRole("button", { name, exact: true })
    .first()
    .click();
  await expect.poll(() => app.selectedLayers()).toEqual([name]);
}

/** Indexes of the selected rows among the Layers rows named `name`, top row (frontmost layer) first. */
async function selectedRowsNamed(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator('[role="treeitem"]')
    .filter({
      has: page.locator(`[data-layer-row-button] span[title="${name}"]`),
    })
    .evaluateAll((rows) =>
      rows.flatMap((row, index) =>
        row.getAttribute("aria-selected") === "true" ? [index] : [],
      ),
    );
}

async function savedFrames(app: App, designId: string) {
  const design = await (
    await app.page.request.get(appPath("/_agent-native/actions/get-design"), {
      params: { id: designId, includeFileContent: "false" },
    })
  ).json();
  const data =
    typeof design.data === "string" ? JSON.parse(design.data) : design.data;
  return data.canvasFrames as Record<
    string,
    { x: number; y: number; width: number; height: number; z: number }
  >;
}

async function openOverview(app: App, designId: string, screens: number) {
  await app.page.goto(appPath(`/design/${designId}?view=overview`), {
    waitUntil: "domcontentloaded",
  });
  await expect(app.page.locator("[data-screen-shell]")).toHaveCount(screens);
  await app.settled();
}

function selectedScreenIds(page: Page) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator(
      '[role="treeitem"][aria-level="1"][aria-selected="true"] [data-layer-row-button][data-layer-node-id]',
    )
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("data-layer-node-id")),
    );
}

function topLevelLayerIds(page: Page) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator(
      '[role="treeitem"][aria-level="1"] [data-layer-row-button][data-layer-node-id]',
    )
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("data-layer-node-id")),
    );
}

test.describe("clipboard + duplicate (single-screen editor)", () => {
  test("cmd+C then cmd+V with nothing else selected pastes into the SAME parent, directly above the source, keeping name and size", async ({
    app,
  }) => {
    const id = await openSingle(app, GROUP_HTML);
    await selectLayer(app, "Original");
    const before = await app.savedNodes(id);
    await app.page.keyboard.press("ControlOrMeta+c");
    await app.page.keyboard.press("Escape");
    await expect.poll(() => app.selectedLayers()).toEqual([]);

    await app.page.keyboard.press("ControlOrMeta+v");

    await expect
      .poll(async () => childrenOf(await app.savedNodes(id), "group").length)
      .toBe(3);
    await app.settled();
    const after = await app.savedNodes(id);
    const copy = childrenOf(after, "group").find(
      (child) => child !== "original" && child !== "sibling",
    )!;
    expect(childrenOf(after, "group")).toEqual(["original", copy, "sibling"]);
    expect(after.get(copy)?.attrs["data-agent-native-layer-name"]).toBe(
      "Original",
    );
    expect(sizeAndLook(after.get(copy))).toEqual(
      sizeAndLook(before.get("original")),
    );
    expectOnlyChanged(before, after, [copy]);
    await expect
      .poll(
        () => selectedRowsNamed(app.page, "Original"),
        "the pasted copy is selected",
      )
      .toEqual([0]);
  });

  test("with a container selected, paste goes inside that container", async ({
    app,
  }) => {
    const id = await openSingle(app, CONTAINER_AND_SOURCE_HTML);
    await selectLayer(app, "Source");
    await app.page.keyboard.press("ControlOrMeta+c");
    await selectLayer(app, "Container");
    const before = await app.savedNodes(id);

    await app.page.keyboard.press("ControlOrMeta+v");

    await expect
      .poll(
        async () => childrenOf(await app.savedNodes(id), "container").length,
      )
      .toBe(1);
    await app.settled();
    const after = await app.savedNodes(id);
    const [copy] = childrenOf(after, "container");
    expect(after.get(copy)?.attrs["data-agent-native-layer-name"]).toBe(
      "Source",
    );
    expect({
      width: styleOf(after.get(copy)).width,
      height: styleOf(after.get(copy)).height,
    }).toEqual({
      width: "120px",
      height: "60px",
    });
    expectOnlyChanged(before, after, [copy]);
  });

  test("cmd+D duplicates in place (same x/y), directly above, identical name, selection moves to the copy", async ({
    app,
  }) => {
    const id = await openSingle(app, GROUP_HTML);
    await selectLayer(app, "Original");
    const before = await app.savedNodes(id);

    await app.page.keyboard.press("ControlOrMeta+d");

    await expect
      .poll(async () => childrenOf(await app.savedNodes(id), "group").length)
      .toBe(3);
    await app.settled();
    const after = await app.savedNodes(id);
    const copy = childrenOf(after, "group").find(
      (child) => child !== "original" && child !== "sibling",
    )!;
    expect(childrenOf(after, "group")).toEqual(["original", copy, "sibling"]);
    expect(after.get(copy)?.attrs["data-agent-native-layer-name"]).toBe(
      "Original",
    );
    expect(layoutStyle(after.get(copy)), "same place, same size").toEqual(
      layoutStyle(before.get("original")),
    );
    expectOnlyChanged(before, after, [copy]);
    expect(await app.designRect(copy)).toEqual({
      x: 320,
      y: 60,
      width: 120,
      height: 60,
    });
    await expect
      .poll(
        () => selectedRowsNamed(app.page, "Original"),
        "the copy is selected",
      )
      .toEqual([0]);
  });

  test("cmd+D on an unnamed (tag-fallback-named) element keeps the same computed name, not literal 'Copy'", async ({
    app,
  }) => {
    const id = await openSingle(app, UNNAMED_HTML);
    const centre = await app.pagePoint(420, 160);
    await app.page.mouse.click(centre.x, centre.y);
    await expect.poll(async () => (await layerNames(app.page)).length).toBe(1);
    const [originalName] = await layerNames(app.page);
    await expect.poll(() => app.selectedLayers()).toEqual([originalName]);
    const before = await app.savedNodes(id);

    await app.page.keyboard.press("ControlOrMeta+d");

    await expect
      .poll(
        async () => childrenOf(await app.savedNodes(id), bodyId(before)).length,
      )
      .toBe(2);
    await app.settled();
    const after = await app.savedNodes(id);
    const copy = childrenOf(after, bodyId(after)).find(
      (child) => child !== "plain",
    )!;
    expect(
      after.get(copy)?.attrs,
      "no stored name, so it computes the same fallback",
    ).not.toHaveProperty("data-agent-native-layer-name");
    expectOnlyChanged(before, after, [copy]);
    expect(await layerNames(app.page)).toEqual([originalName, originalName]);
  });

  test("shift+cmd+R (paste to replace) replaces the selection with the clipboard object in its slot", async ({
    app,
  }) => {
    const id = await openSingle(app, CONTAINER_AND_SOURCE_HTML);
    await selectLayer(app, "Source");
    await app.page.keyboard.press("ControlOrMeta+c");
    await selectLayer(app, "Container");
    const before = await app.savedNodes(id);

    await app.page.keyboard.press("ControlOrMeta+Shift+r");

    await expect
      .poll(async () => (await app.savedNodes(id)).has("container"))
      .toBe(false);
    await app.settled();
    const after = await app.savedNodes(id);
    const copy = idsNamed(after, "Source").find(
      (nodeId) => nodeId !== "source",
    )!;
    expect(
      childrenOf(after, bodyId(after)),
      "the copy takes the container's slot",
    ).toEqual(["source", copy]);
    expectOnlyChanged(before, after, ["container", copy]);
    const placed = await app.designRect(copy);
    expect(
      placed.x,
      "inside the replaced container (700-1000)",
    ).toBeGreaterThanOrEqual(700);
    expect(placed.x + placed.width).toBeLessThanOrEqual(1000);
    expect(
      placed.y,
      "inside the replaced container (200-400)",
    ).toBeGreaterThanOrEqual(200);
    expect(placed.y + placed.height).toBeLessThanOrEqual(400);
  });

  test("cmd+X removes the element, and one undo restores it", async ({
    app,
  }) => {
    const id = await openSingle(app, SIMPLE_HTML);
    const centre = await app.pagePoint(200, 160);
    await app.page.mouse.click(centre.x, centre.y);
    await expect.poll(() => app.selectedLayers()).toEqual(["Widget"]);
    const before = await app.savedNodes(id);

    await app.page.keyboard.press("ControlOrMeta+x");
    await expect
      .poll(async () => (await app.savedNodes(id)).has("rect"))
      .toBe(false);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), ["rect"]);

    await app.page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(async () => (await app.savedNodes(id)).has("rect"))
      .toBe(true);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
    expect(await app.designRect("rect")).toEqual({
      x: 100,
      y: 100,
      width: 200,
      height: 120,
    });
  });

  test("each of cmd+D and cmd+V is exactly one undo step", async ({ app }) => {
    const id = await openSingle(app, SIMPLE_HTML);
    const centre = await app.pagePoint(200, 160);
    await app.page.mouse.click(centre.x, centre.y);
    await expect.poll(() => app.selectedLayers()).toEqual(["Widget"]);
    const before = await app.savedNodes(id);
    const widgets = async () => idsNamed(await app.savedNodes(id), "Widget");

    await app.page.keyboard.press("ControlOrMeta+d");
    await expect
      .poll(async () => (await widgets()).length, "the duplicate saved")
      .toBe(2);
    await app.settled();
    await app.page.keyboard.press("ControlOrMeta+z");
    await expect.poll(widgets).toEqual(["rect"]);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);

    await app.page.mouse.click(centre.x, centre.y);
    await expect.poll(() => app.selectedLayers()).toEqual(["Widget"]);
    await app.page.keyboard.press("ControlOrMeta+c");
    await app.page.keyboard.press("ControlOrMeta+v");
    await expect
      .poll(async () => (await widgets()).length, "the paste saved")
      .toBe(2);
    await app.settled();
    await app.page.keyboard.press("ControlOrMeta+z");
    await expect.poll(widgets).toEqual(["rect"]);
    await app.settled();
    expectOnlyChanged(before, await app.savedNodes(id), []);
  });
});

test.describe("clipboard + duplicate (overview / board objects, cross-screen)", () => {
  test("Cmd+C then Cmd+V pastes the selected screen 32px down and right of it, stacked above it, at its own size with the same content", async ({
    app,
  }) => {
    const page = app.page;
    const { designId, fileIds } = await createDesign(app, SIMPLE_HTML, 2);
    await openOverview(app, designId, 2);
    const framesBefore = await savedFrames(app, designId);
    const source = await app.savedNodes(designId);
    await page
      .locator(`[data-frame-id="${fileIds[0]}"] [data-frame-label]`)
      .click();
    await expect.poll(() => selectedScreenIds(page)).toEqual([fileIds[0]]);

    await page.keyboard.press("ControlOrMeta+c");
    await page.keyboard.press("ControlOrMeta+v");

    await expect(page.locator("[data-screen-shell]")).toHaveCount(3);
    await expect
      .poll(async () => Object.keys(await savedFrames(app, designId)).length)
      .toBe(3);
    await app.settled();
    const frames = await savedFrames(app, designId);
    const copyId = Object.keys(frames).find(
      (frameId) => !fileIds.includes(frameId),
    )!;
    expect(frames[fileIds[0]]).toEqual(framesBefore[fileIds[0]]);
    expect(frames[fileIds[1]]).toEqual(framesBefore[fileIds[1]]);
    expect(
      frames[copyId],
      "a keyboard paste offsets the copy 32px down and right of its source, at the source size",
    ).toMatchObject({ x: 32, y: 32, width: 1280, height: 900 });
    await expect.poll(() => selectedScreenIds(page)).toEqual([copyId]);
    await expect
      .poll(
        () => topLevelLayerIds(page),
        "the copy stacks directly above its source",
      )
      .toEqual([fileIds[1], copyId, fileIds[0]]);
    expectOnlyChanged(source, await app.savedNodes(designId), []);
    const record = await (
      await page.request.get(
        appPath(`/_agent-native/actions/get-design?id=${designId}`),
      )
    ).json();
    const copyFile = record.files.find(
      (file: { id: string }) => file.id === copyId,
    ).filename;
    expect(shape(await app.savedNodes(designId, copyFile))).toEqual(
      shape(source),
    );
  });

  test("copy in screen A, select screen B, paste lands in screen B at the source size", async ({
    app,
  }) => {
    const page = app.page;
    const { designId, fileIds } = await createDesign(app, SIMPLE_HTML, 2);
    await action(page.request, "update-file", {
      id: fileIds[1],
      content: `<!doctype html><html><body style="margin:0;position:relative;min-height:900px"></body></html>`,
    });
    await openOverview(app, designId, 2);
    const screenA = await app.savedNodes(designId);
    const rect = await app.pagePoint(200, 160, "index.html");
    await page.mouse.click(rect.x, rect.y);
    await expect.poll(() => app.selectedLayers()).toEqual(["Widget"]);
    await page.keyboard.press("ControlOrMeta+c");
    await page
      .locator(`[data-frame-id="${fileIds[1]}"] [data-frame-label]`)
      .click();
    await expect.poll(() => selectedScreenIds(page)).toEqual([fileIds[1]]);

    await page.keyboard.press("ControlOrMeta+v");

    await expect
      .poll(
        async () =>
          idsNamed(await app.savedNodes(designId, "screen-2.html"), "Widget")
            .length,
      )
      .toBe(1);
    await app.settled();
    const screenB = await app.savedNodes(designId, "screen-2.html");
    const [copy] = idsNamed(screenB, "Widget");
    expect(screenB.get(copy)?.parent).toBe(bodyId(screenB));
    expect(sizeAndLook(screenB.get(copy))).toEqual(
      sizeAndLook(screenA.get("rect")),
    );
    expectOnlyChanged(screenA, await app.savedNodes(designId), []);
  });

  test("repeated cmd+D uses the next free board slot, stacks above the source, and selects the latest copy", async ({
    app,
  }) => {
    const page = app.page;
    const request = page.request;
    const { designId, fileIds } = await createDesign(app, BOARD_OBJECT_HTML, 2);
    const designGap = 56; // Design's board-wide Screen gap.

    const readFrames = async () => {
      const response = await request.get(
        appPath("/_agent-native/actions/get-design"),
        { params: { id: designId, includeFileContent: "false" } },
      );
      if (!response.ok()) {
        throw new Error(`get-design: ${response.status()}`);
      }
      const design = await response.json();
      const data =
        typeof design.data === "string" ? JSON.parse(design.data) : design.data;
      if (!data || typeof data !== "object" || !data.canvasFrames) {
        throw new Error("get-design returned no canvas frame geometry");
      }
      return data.canvasFrames as Record<
        string,
        { x: number; y: number; width: number; height: number; z: number }
      >;
    };
    const selectedScreenIds = () =>
      page
        .getByRole("tree", { name: "Layers" })
        .locator(
          '[role="treeitem"][aria-level="1"][aria-selected="true"] [data-layer-row-button][data-layer-node-id]',
        )
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getAttribute("data-layer-node-id")),
        );

    const originalId = fileIds[0]!;
    const occupiedId = fileIds[1]!;
    await action(request, "update-design", {
      id: designId,
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", occupiedId],
          value: {
            x: 1280 + designGap,
            y: 0,
            width: 1280,
            height: 900,
            z: 1,
          },
        },
      ],
    });
    await page.goto(appPath(`/design/${designId}?view=overview`), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2, {
      timeout: 30_000,
    });
    await expect
      .poll(async () => (await readFrames())[occupiedId]?.x)
      .toBe(1280 + designGap);

    await page
      .locator(`[data-frame-id="${originalId}"] [data-frame-label]`)
      .click({ force: true });
    await page.keyboard.press("ControlOrMeta+d");

    let frames = await readFrames();
    await expect
      .poll(async () => {
        frames = await readFrames();
        const copyId = Object.keys(frames).find((id) => !fileIds.includes(id));
        const original = frames[originalId];
        const occupied = frames[occupiedId];
        const copy = copyId ? frames[copyId] : undefined;
        return Boolean(
          Object.keys(frames).length === 3 &&
          original &&
          occupied &&
          copy &&
          copy.x === occupied.x + occupied.width + designGap &&
          copy.z === original.z + 1,
        );
      })
      .toBe(true);
    const firstCopyId = Object.keys(frames).find((id) => !fileIds.includes(id));
    expect(firstCopyId).toBeTruthy();
    const firstCopy = frames[firstCopyId!]!;
    expect(firstCopy).toMatchObject({
      x: frames[occupiedId]!.x + frames[occupiedId]!.width + designGap,
      y: frames[originalId]!.y,
      width: frames[originalId]!.width,
      height: frames[originalId]!.height,
      z: frames[originalId]!.z + 1,
    });
    expect(frames[occupiedId]!.z).toBeGreaterThan(firstCopy.z);
    await expect.poll(selectedScreenIds).toEqual([firstCopyId]);

    await page
      .locator(`[data-frame-id="${originalId}"] [data-frame-label]`)
      .click({ force: true });
    await page.keyboard.press("ControlOrMeta+d");

    await expect
      .poll(async () => {
        frames = await readFrames();
        const copyId = Object.keys(frames).find(
          (id) => !fileIds.includes(id) && id !== firstCopyId,
        );
        const original = frames[originalId];
        const first = frames[firstCopyId!];
        const copy = copyId ? frames[copyId] : undefined;
        return Boolean(
          Object.keys(frames).length === 4 &&
          original &&
          first &&
          copy &&
          copy.x === first.x + first.width + designGap &&
          copy.z === original.z + 1 &&
          first.z > copy.z,
        );
      })
      .toBe(true);
    const secondCopyId = Object.keys(frames).find(
      (id) => !fileIds.includes(id) && id !== firstCopyId,
    );
    expect(secondCopyId).toBeTruthy();
    const secondCopy = frames[secondCopyId!]!;
    expect(secondCopy).toMatchObject({
      x: firstCopy.x + firstCopy.width + designGap,
      y: frames[originalId]!.y,
      width: frames[originalId]!.width,
      height: frames[originalId]!.height,
      z: frames[originalId]!.z + 1,
    });
    const restackedFirstCopy = frames[firstCopyId!]!;
    expect(
      restackedFirstCopy.z,
      JSON.stringify({ originalId, firstCopyId, secondCopyId, frames }),
    ).toBeGreaterThan(secondCopy.z);
    expect(frames[occupiedId]!.z).toBeGreaterThan(restackedFirstCopy.z);
    await expect.poll(selectedScreenIds).toEqual([secondCopyId]);

    const finalFrames = Object.values(frames);
    for (let index = 0; index < finalFrames.length; index += 1) {
      for (
        let otherIndex = index + 1;
        otherIndex < finalFrames.length;
        otherIndex += 1
      ) {
        const left = finalFrames[index]!;
        const right = finalFrames[otherIndex]!;
        expect(
          left.x + left.width <= right.x ||
            right.x + right.width <= left.x ||
            left.y + left.height <= right.y ||
            right.y + right.height <= left.y,
        ).toBe(true);
      }
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-screen-shell]")).toHaveCount(4, {
      timeout: 30_000,
    });
    await expect.poll(readFrames).toEqual(frames);
  });
});
