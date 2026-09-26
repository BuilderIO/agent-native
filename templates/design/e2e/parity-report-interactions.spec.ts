import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import {
  appPath,
  childNodeIds,
  cdpScreenshot,
  expandAllLayers,
  gotoEditor,
} from "./helpers";

const MOD = process.platform === "darwin" ? "Meta" : "Control";

const SCREEN_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Nested drop</title></head>
<body style="margin:0;position:relative;width:800px;height:600px;background:#fff">
  <div data-agent-native-node-id="outer-frame" data-agent-native-layer-name="Outer frame" data-an-primitive="frame"
       style="position:absolute;left:80px;top:80px;width:560px;height:420px;box-sizing:border-box;background:#dbeafe;padding:24px">
    <div data-agent-native-node-id="nested-frame" data-agent-native-layer-name="Nested frame" data-an-primitive="frame"
         style="position:absolute;left:120px;top:90px;width:280px;height:220px;box-sizing:border-box;background:#bfdbfe">
      <div data-agent-native-node-id="nested-anchor" data-agent-native-layer-name="Existing child"
         style="position:absolute;left:16px;top:16px;width:80px;height:40px;background:#2563eb"></div>
    </div>
    <div data-agent-native-node-id="auto-frame" data-agent-native-layer-name="Auto frame"
         style="position:absolute;left:120px;top:330px;width:280px;height:70px;box-sizing:border-box;display:flex;flex-direction:row;gap:12px;padding:12px;background:#bfdbfe">
      <div data-agent-native-node-id="auto-first" data-agent-native-layer-name="First item"
           style="flex:0 0 auto;width:100px;height:40px;background:#2563eb"></div>
      <div data-agent-native-node-id="auto-second" data-agent-native-layer-name="Second item"
           style="flex:0 0 auto;width:100px;height:40px;background:#7c3aed"></div>
    </div>
  </div>
</body></html>`;

const BOARD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Board</title></head>
<body style="margin:0;position:relative;width:1800px;height:900px;overflow:visible;background:transparent">
  <div data-agent-native-node-id="board-source" data-agent-native-layer-name="Board source" data-an-primitive="frame"
       style="position:absolute;left:-400px;top:140px;width:60px;height:30px;box-sizing:border-box;background:#f97316"></div>
  <div data-agent-native-node-id="board-text" data-agent-native-layer-name="Board text"
       style="position:absolute;left:-280px;top:140px;width:120px;height:30px;box-sizing:border-box;background:#fef3c7;color:#111827">Board text</div>
</body></html>`;

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createDesign(request: APIRequestContext): Promise<string> {
  const created = await action(request, "create-design", {
    title: `Design interaction report ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  const screen = await action(request, "create-file", {
    designId,
    filename: "index.html",
    content: SCREEN_HTML,
    fileType: "html",
  });
  const screenFileId = screen?.id ?? screen?.data?.id;
  if (!screenFileId) throw new Error("create-file returned no screen id");
  const board = await action(request, "create-file", {
    designId,
    filename: "__board__.html",
    content: BOARD_HTML,
    fileType: "html",
  });
  const boardFileId = board?.id ?? board?.data?.id;
  if (!boardFileId) throw new Error("create-file returned no board id");
  await action(request, "update-design", {
    id: designId,
    dataOperations: [
      { op: "set", path: ["boardFileId"], value: boardFileId },
      {
        op: "set",
        path: ["screenMetadata", boardFileId],
        value: { sourceType: "inline", width: 1800, height: 900 },
      },
      {
        op: "set",
        path: ["screenMetadata", screenFileId],
        value: { sourceType: "inline", width: 800, height: 600 },
      },
      {
        op: "set",
        path: ["canvasFrames", screenFileId],
        value: { x: 0, y: 0, width: 800, height: 600, z: 0 },
      },
    ],
  });
  return designId;
}

async function fileContent(
  request: APIRequestContext,
  designId: string,
  filename: string,
): Promise<string> {
  const record = await request
    .get(appPath(`/_agent-native/actions/get-design?id=${designId}`))
    .then((response) => response.json());
  return (
    (record.files ?? []).find((file: any) => file.filename === filename)
      ?.content ?? ""
  );
}

async function designData(
  request: APIRequestContext,
  designId: string,
): Promise<Record<string, any>> {
  const response = await request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) {
    throw new Error(
      `get-design: ${response.status()} ${await response.text()}`,
    );
  }
  const record = await response.json();
  if (typeof record.data !== "string") {
    throw new Error("get-design returned no design data");
  }
  const parsed = JSON.parse(record.data);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("get-design returned invalid design data");
  }
  return parsed;
}

async function fileRecords(
  request: APIRequestContext,
  designId: string,
): Promise<Array<{ id: string; filename: string; content: string }>> {
  const record = await request
    .get(appPath(`/_agent-native/actions/get-design?id=${designId}`))
    .then((response) => response.json());
  return (record.files ?? []).map(
    (file: { id: string; filename: string; content: string }) => file,
  );
}

function screenFrame(page: Page) {
  return page
    .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
    .first();
}

function boardFrame(page: Page) {
  return page.locator("[data-board-surface-layer] iframe").first();
}

async function openOverview(page: Page, designId: string) {
  await page.goto(appPath(`/design/${designId}?view=overview&zoom=50`), {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: "Move", exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("[data-screen-shell]")).toHaveCount(1, {
    timeout: 30_000,
  });
  await expect(page.locator("[data-screen-card]").first()).toBeVisible();
  await page.getByRole("button", { name: /%$/, exact: false }).first().click();
  await page.getByRole("menuitem", { name: "Zoom to 50%" }).click();
  await expect(
    page.getByRole("button", { name: "50%", exact: true }),
  ).toBeVisible();
}

async function setOverviewZoom(page: Page, zoom: 100 | 200) {
  await page.getByRole("button", { name: "50%", exact: true }).click();
  await page.getByRole("menuitem", { name: `Zoom to ${zoom}%` }).click();
  await expect(
    page.getByRole("button", { name: `${zoom}%`, exact: true }),
  ).toBeVisible();
}

async function resetOverviewZoom(page: Page): Promise<void> {
  await page.getByRole("button", { name: /%$/, exact: false }).first().click();
  await page.getByRole("menuitem", { name: "Zoom to 50%" }).click();
  await expect(
    page.getByRole("button", { name: "50%", exact: true }),
  ).toBeVisible();
}

async function expectReloadedOverviewZoom(page: Page, zoom: 100 | 200) {
  await expect
    .poll(
      async () => {
        const zoomButton = page.getByRole("button", {
          name: `${zoom}%`,
          exact: true,
        });
        const world = page.locator("[data-multi-screen-canvas-world]");
        const renderedZoom =
          (await world.count()) > 0
            ? await world.evaluate((element) => {
                const transform = getComputedStyle(element).transform;
                if (transform === "none") return 100;
                return Math.round(new DOMMatrix(transform).a * 100);
              })
            : null;
        return {
          urlZoom: new URL(page.url()).searchParams.get("zoom"),
          buttonText:
            (await zoomButton.count()) > 0
              ? (await zoomButton.allTextContents())[0]?.trim()
              : null,
          buttonVisible:
            (await zoomButton.count()) > 0 && (await zoomButton.isVisible()),
          renderedZoom,
        };
      },
      { timeout: 30_000 },
    )
    .toEqual({
      urlZoom: String(zoom),
      buttonText: `${zoom}%`,
      buttonVisible: true,
      renderedZoom: zoom,
    });
}

async function dragBoardSourceIntoNestedFrame(page: Page): Promise<{
  release: { x: number; y: number };
  sourceBefore: { x: number; y: number; width: number; height: number };
  grabOffset: { x: number; y: number };
}> {
  const source = boardFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="board-source"]');
  const target = screenFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="nested-frame"]');
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  const sourceBefore = (await source.boundingBox())!;
  const targetBox = (await target.boundingBox())!;
  const release = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  };
  const grabOffset = { x: 18, y: 11 };
  await page.mouse.move(
    sourceBefore.x + grabOffset.x,
    sourceBefore.y + grabOffset.y,
  );
  await page.mouse.down();
  await page.mouse.move(
    sourceBefore.x + grabOffset.x - 12,
    sourceBefore.y + grabOffset.y,
    { steps: 4 },
  );
  await page.mouse.move(release.x, release.y, { steps: 24 });
  await page.mouse.up();
  return { release, sourceBefore, grabOffset };
}

async function selectBoardSourceFromHost(page: Page) {
  const source = boardFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="board-source"]');
  await expect(source).toBeVisible();
  const sourceBefore = (await source.boundingBox())!;
  await page.mouse.click(
    sourceBefore.x + sourceBefore.width / 2,
    sourceBefore.y + sourceBefore.height / 2,
  );
  await expect(page.locator("[data-board-object-selection-box]")).toBeVisible();
  const dragSurface = page.locator(
    "[data-board-object-selection-box] [data-frame-drag-surface]",
  );
  await expect(dragSurface).toBeVisible();
  return { sourceBefore, dragSurface };
}

async function dragHostBoardSourceIntoNestedFrame(
  page: Page,
  dragSurface: ReturnType<Page["locator"]>,
  alt = false,
) {
  const target = screenFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="nested-frame"]');
  const targetBox = (await target.boundingBox())!;
  const release = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  };
  const dragBox = (await dragSurface.boundingBox())!;
  await page.mouse.move(
    dragBox.x + dragBox.width / 2,
    dragBox.y + dragBox.height / 2,
  );
  if (alt) await page.keyboard.down("Alt");
  await page.mouse.down();
  if (alt) {
    await page.keyboard.up("Alt");
  }
  await page.mouse.move(release.x, release.y, { steps: 24 });
  await page.mouse.up();
  return release;
}

async function dragBoardSourceIntoAutoLayout(page: Page) {
  const source = boardFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="board-source"]');
  const target = screenFrame(page)
    .contentFrame()
    .locator('[data-agent-native-node-id="auto-frame"]');
  const sourceBox = (await source.boundingBox())!;
  const targetBox = (await target.boundingBox())!;
  const release = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  };
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(release.x, release.y, { steps: 24 });
  await page.mouse.up();
  return release;
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("report path: board frame drops directly into a nested screen frame and survives undo/redo", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await gotoEditor(page, designId);
    const { release, sourceBefore, grabOffset } =
      await dragBoardSourceIntoNestedFrame(page);

    await expect
      .poll(
        async () =>
          childNodeIds(
            await fileContent(request, designId, "index.html"),
            "nested-frame",
          ),
        {
          timeout: 20_000,
        },
      )
      .toContain("board-source");
    await expect
      .poll(() => fileContent(request, designId, "__board__.html"), {
        timeout: 20_000,
      })
      .not.toContain('data-agent-native-node-id="board-source"');

    const boardSource = boardFrame(page)
      .contentFrame()
      .locator('[data-agent-native-node-id="board-source"]');
    const moved = screenFrame(page)
      .contentFrame()
      .locator('[data-agent-native-node-id="board-source"]');
    await expect(boardSource).toHaveCount(0);
    await expect(moved).toHaveCount(1);
    const movedBox = await moved.boundingBox();
    expect(movedBox).not.toBeNull();
    expect(movedBox!.x).toBeCloseTo(release.x - grabOffset.x, -1);
    expect(movedBox!.y).toBeCloseTo(release.y - grabOffset.y, -1);
    expect(movedBox!.x).toBeGreaterThan(sourceBefore.x);

    await expandAllLayers(page);
    const selected = page
      .getByRole("tree", { name: "Layers" })
      .locator('[role="treeitem"][aria-selected="true"]')
      .filter({ hasText: "Board source" });
    await expect(selected).toHaveCount(1);
    await expect(selected).toContainText("Board source");

    await cdpScreenshot(page, "../../.tmp/report-nested-drop.png");
    await test.info().attach("report-nested-drop.png", {
      path: "../../.tmp/report-nested-drop.png",
      contentType: "image/png",
    });
    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(() => fileContent(request, designId, "__board__.html"), {
        timeout: 20_000,
      })
      .toContain('data-agent-native-node-id="board-source"');
    await expect
      .poll(() => fileContent(request, designId, "index.html"), {
        timeout: 20_000,
      })
      .not.toContain('data-agent-native-node-id="board-source"');

    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect
      .poll(
        async () =>
          childNodeIds(
            await fileContent(request, designId, "index.html"),
            "nested-frame",
          ),
        {
          timeout: 20_000,
        },
      )
      .toContain("board-source");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(
        async () =>
          childNodeIds(
            await fileContent(request, designId, "index.html"),
            "nested-frame",
          ),
        { timeout: 20_000 },
      )
      .toContain("board-source");
    await expect(
      page
        .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
        .first()
        .contentFrame()
        .locator('[data-agent-native-node-id="board-source"]'),
    ).toBeVisible();
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("report path: held board text drop into a nested frame shows guide and ghost, preserves z-order, and reloads", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await gotoEditor(page, designId);
    const source = boardFrame(page)
      .contentFrame()
      .locator('[data-agent-native-node-id="board-text"]');
    const target = screenFrame(page)
      .contentFrame()
      .locator('[data-agent-native-node-id="nested-frame"]');
    await expect(source).toBeVisible();
    await expect(target).toBeVisible();

    const sourceBox = (await source.boundingBox())!;
    const targetBox = (await target.boundingBox())!;
    const release = {
      x: targetBox.x + targetBox.width / 2,
      y: targetBox.y + targetBox.height / 2,
    };
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2,
      sourceBox.y + sourceBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2 - 12,
      sourceBox.y + sourceBox.height / 2,
      { steps: 4 },
    );
    await page.mouse.move(release.x, release.y, { steps: 24 });
    await expect(page.locator("[data-cross-screen-drop-guide]")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator("[data-cross-screen-drag-ghost]")).toBeVisible({
      timeout: 5_000,
    });
    await page.mouse.up();

    await expect
      .poll(
        async () =>
          childNodeIds(
            await fileContent(request, designId, "index.html"),
            "nested-frame",
          ),
        { timeout: 20_000 },
      )
      .toEqual(["nested-anchor", "board-text"]);
    await expect
      .poll(() => fileContent(request, designId, "__board__.html"), {
        timeout: 20_000,
      })
      .not.toContain('data-agent-native-node-id="board-text"');

    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(
        async () =>
          childNodeIds(
            await fileContent(request, designId, "index.html"),
            "nested-frame",
          ),
        { timeout: 20_000 },
      )
      .toEqual(["nested-anchor"]);
    await expect
      .poll(() => fileContent(request, designId, "__board__.html"), {
        timeout: 20_000,
      })
      .toContain('data-agent-native-node-id="board-text"');

    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect
      .poll(
        async () =>
          childNodeIds(
            await fileContent(request, designId, "index.html"),
            "nested-frame",
          ),
        { timeout: 20_000 },
      )
      .toEqual(["nested-anchor", "board-text"]);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(
        async () =>
          childNodeIds(
            await fileContent(request, designId, "index.html"),
            "nested-frame",
          ),
        { timeout: 20_000 },
      )
      .toEqual(["nested-anchor", "board-text"]);
    await expect(
      screenFrame(page)
        .contentFrame()
        .locator('[data-agent-native-node-id="board-text"]'),
    ).toBeVisible();
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("report path: selected root board frame moves through the host selection box", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await gotoEditor(page, designId);
    const { dragSurface } = await selectBoardSourceFromHost(page);
    const release = await dragHostBoardSourceIntoNestedFrame(page, dragSurface);

    await expect
      .poll(
        async () =>
          childNodeIds(
            await fileContent(request, designId, "index.html"),
            "nested-frame",
          ),
        { timeout: 20_000 },
      )
      .toContain("board-source");
    await expect
      .poll(() => fileContent(request, designId, "__board__.html"), {
        timeout: 20_000,
      })
      .not.toContain('data-agent-native-node-id="board-source"');

    const moved = screenFrame(page)
      .contentFrame()
      .locator('[data-agent-native-node-id="board-source"]');
    await expect(moved).toBeVisible();
    const movedBox = (await moved.boundingBox())!;
    expect(movedBox.x + movedBox.width / 2).toBeCloseTo(release.x, -1);
    expect(movedBox.y + movedBox.height / 2).toBeCloseTo(release.y, -1);
    await expandAllLayers(page);
    await expect(
      page
        .getByRole("tree", { name: "Layers" })
        .locator('[role="treeitem"][aria-selected="true"]')
        .filter({ hasText: "Board source" }),
    ).toHaveCount(1);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("report path: board frame inserts between children of a nested auto-layout frame", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await gotoEditor(page, designId);
    await dragBoardSourceIntoAutoLayout(page);

    await expect
      .poll(
        async () =>
          childNodeIds(
            await fileContent(request, designId, "index.html"),
            "auto-frame",
          ),
        { timeout: 20_000 },
      )
      .toEqual(["auto-first", "board-source", "auto-second"]);
    await expect
      .poll(() => fileContent(request, designId, "__board__.html"), {
        timeout: 20_000,
      })
      .not.toContain('data-agent-native-node-id="board-source"');

    const moved = screenFrame(page)
      .contentFrame()
      .locator('[data-agent-native-node-id="board-source"]');
    await expect(moved).toBeVisible();
    const movedStyle = await moved.getAttribute("style");
    expect(movedStyle).toContain("position: relative");
    expect(movedStyle).not.toMatch(/(?:^|;)\s*(?:left|top):/);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("report path: Option-dragging a selected root board frame duplicates into a nested frame", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await gotoEditor(page, designId);
    const { dragSurface } = await selectBoardSourceFromHost(page);
    const target = screenFrame(page)
      .contentFrame()
      .locator('[data-agent-native-node-id="nested-frame"]');
    const targetBox = (await target.boundingBox())!;
    const release = {
      x: targetBox.x + targetBox.width / 2,
      y: targetBox.y + targetBox.height / 2,
    };
    const dragBox = (await dragSurface.boundingBox())!;
    await page.mouse.move(
      dragBox.x + dragBox.width / 2,
      dragBox.y + dragBox.height / 2,
    );
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(
      dragBox.x + dragBox.width / 2 - 12,
      dragBox.y + dragBox.height / 2,
      { steps: 4 },
    );
    await expect(
      boardFrame(page)
        .contentFrame()
        .locator('[data-agent-native-clone-root="true"]'),
    ).toHaveCount(1);
    await page.mouse.move(release.x, release.y, { steps: 24 });
    await expect(
      screenFrame(page)
        .contentFrame()
        .locator("[data-agent-native-hit-test-preview]"),
    ).toBeVisible();
    await page.mouse.up();
    await page.keyboard.up("Alt");

    await expect
      .poll(
        async () =>
          childNodeIds(
            await fileContent(request, designId, "index.html"),
            "nested-frame",
          ),
        { timeout: 20_000 },
      )
      .toHaveLength(2);
    const nestedChildren = childNodeIds(
      await fileContent(request, designId, "index.html"),
      "nested-frame",
    );
    const copyId = nestedChildren.find((id) => id !== "nested-anchor");
    expect(copyId).toBeTruthy();
    expect(copyId).not.toBe("board-source");
    const nestedContent = await fileContent(request, designId, "index.html");
    expect(nestedContent).toMatch(
      new RegExp(
        `data-agent-native-node-id="${copyId}"[^>]*data-agent-native-layer-name="Board source"`,
      ),
    );
    expect(await fileContent(request, designId, "__board__.html")).toContain(
      'data-agent-native-node-id="board-source"',
    );
    expect(nestedChildren[nestedChildren.length - 1]).toBe(copyId);
    await expandAllLayers(page);
    await expect(
      page
        .getByRole("tree", { name: "Layers" })
        .locator('[role="treeitem"][aria-selected="true"]')
        .filter({ hasText: "Board source" }),
    ).toHaveCount(1);

    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(
        async () =>
          childNodeIds(
            await fileContent(request, designId, "index.html"),
            "nested-frame",
          ),
        { timeout: 20_000 },
      )
      .toEqual(["nested-anchor"]);
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect
      .poll(
        async () =>
          childNodeIds(
            await fileContent(request, designId, "index.html"),
            "nested-frame",
          ),
        { timeout: 20_000 },
      )
      .toEqual(["nested-anchor", copyId]);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-screen-shell]")).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect
      .poll(() => fileContent(request, designId, "index.html"), {
        timeout: 20_000,
      })
      .toContain(`data-agent-native-node-id="${copyId}"`);
    expect(
      childNodeIds(
        await fileContent(request, designId, "index.html"),
        "nested-frame",
      ),
    ).toEqual(["nested-anchor", copyId]);
    await expect
      .poll(() => fileContent(request, designId, "__board__.html"), {
        timeout: 20_000,
      })
      .toContain('data-agent-native-node-id="board-source"');
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

test("report path: Option-dragging a root Screen preserves naming, placement, selection, and history", async ({
  page,
  request,
}) => {
  const designId = await createDesign(request);
  try {
    await openOverview(page, designId);
    await expect(
      page.getByRole("button", { name: "50%", exact: true }),
    ).toBeVisible();
    const sourceLabel = page.locator("[data-frame-label]").first();
    await sourceLabel.click({ force: true });
    const dragSurface = page.locator("[data-frame-drag-surface]").first();
    await expect(dragSurface).toBeVisible();
    const dragBox = (await dragSurface.boundingBox())!;
    const sourceFilesBefore = await fileRecords(request, designId);
    const sourceContent =
      sourceFilesBefore.find((file) => file.filename === "index.html")
        ?.content ?? "";
    const sourceIds = Array.from(
      sourceContent.matchAll(/data-agent-native-node-id="([^"]+)"/g),
    ).map((match) => match[1]);

    await page.mouse.move(
      dragBox.x + dragBox.width / 2,
      dragBox.y + dragBox.height / 2,
    );
    await page.keyboard.down("Alt");
    await page.mouse.down();
    await page.mouse.move(
      dragBox.x + dragBox.width / 2 + 220,
      dragBox.y + dragBox.height / 2 + 140,
      { steps: 16 },
    );
    await page.mouse.up();
    await page.keyboard.up("Alt");

    await expect(page.locator("[data-screen-shell]")).toHaveCount(2, {
      timeout: 20_000,
    });
    await expect
      .poll(() => fileRecords(request, designId), { timeout: 20_000 })
      .toHaveLength(sourceFilesBefore.length + 1);
    const filesAfterDuplicate = await fileRecords(request, designId);
    const copy = filesAfterDuplicate.find(
      (file) => !sourceFilesBefore.some((before) => before.id === file.id),
    );
    expect(copy?.filename).toBe("index-copy.html");
    expect(copy?.content).toContain("Nested drop");
    const copyIds = Array.from(
      (copy?.content ?? "").matchAll(/data-agent-native-node-id="([^"]+)"/g),
    ).map((match) => match[1]);
    expect(copyIds).toHaveLength(sourceIds.length);
    expect(copyIds.some((id) => sourceIds.includes(id))).toBe(false);

    const copyFrame = page.locator(`[data-frame-id="${copy?.id}"]`);
    await expect(copyFrame).toBeVisible();
    await expect
      .poll(
        async () =>
          (await designData(request, designId)).canvasFrames?.[copy?.id ?? ""],
        { timeout: 20_000 },
      )
      .toMatchObject({ x: 440, y: 280, width: 800, height: 600 });
    await expect(page.locator("[data-frame-drag-surface]")).toHaveCount(1);
    await resetOverviewZoom(page);
    await expect(
      page
        .getByRole("tree", { name: "Layers" })
        .locator('[role="treeitem"][aria-selected="true"]')
        .filter({ hasText: "Index copy" }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "50%", exact: true }),
    ).toBeVisible();
    await cdpScreenshot(page, "../../.tmp/report-screen-duplicate.png");
    await test.info().attach("report-screen-duplicate.png", {
      path: "../../.tmp/report-screen-duplicate.png",
      contentType: "image/png",
    });
    await page.keyboard.press(`${MOD}+z`);
    await expect
      .poll(() => fileRecords(request, designId), { timeout: 20_000 })
      .toHaveLength(sourceFilesBefore.length);
    await expect(
      page.getByRole("button", { name: "50%", exact: true }),
    ).toBeVisible();
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect
      .poll(() => fileRecords(request, designId), { timeout: 20_000 })
      .toHaveLength(sourceFilesBefore.length + 1);
    await expect(
      page.getByRole("button", { name: "50%", exact: true }),
    ).toBeVisible();
    const redoCopy = (await fileRecords(request, designId)).find(
      (file) => file.filename === "index-copy.html",
    );
    expect(redoCopy).toBeTruthy();
    expect(redoCopy?.content).toContain("Nested drop");
    await expect
      .poll(
        async () =>
          (await designData(request, designId)).canvasFrames?.[
            redoCopy?.id ?? ""
          ],
        { timeout: 20_000 },
      )
      .toMatchObject({ x: 440, y: 280, width: 800, height: 600 });
    await expect
      .poll(() => new URL(page.url()).searchParams.get("screen"), {
        timeout: 10_000,
      })
      .toBe(redoCopy?.id);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-screen-shell]")).toHaveCount(2, {
      timeout: 30_000,
    });
    await expect(
      page.getByRole("button", { name: "50%", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("tree", { name: "Layers" })
        .locator('[role="treeitem"][aria-selected="true"]')
        .filter({ hasText: "Index copy" }),
    ).toHaveCount(1);
  } finally {
    await action(request, "delete-design", { id: designId }).catch(() => {});
  }
});

for (const zoom of [100, 200] as const) {
  test(`report path: Option-dragging a root Screen remains addressable at ${zoom}%`, async ({
    page,
    request,
  }) => {
    const designId = await createDesign(request);
    try {
      await openOverview(page, designId);
      const sourceLabel = page.locator("[data-frame-label]").first();
      await sourceLabel.click({ force: true });
      const dragSurface = page.locator("[data-frame-drag-surface]").first();
      await expect(dragSurface).toBeVisible();
      await setOverviewZoom(page, zoom);
      const dragBox = (await dragSurface.boundingBox())!;
      const offset = zoom === 200 ? { x: 80, y: 60 } : { x: 220, y: 140 };
      const start = {
        x: Math.max(dragBox.x + 16, 700),
        y: Math.max(dragBox.y + 16, 300),
      };

      await page.mouse.move(start.x, start.y);
      await page.keyboard.down("Alt");
      await page.mouse.down();
      await page.mouse.move(start.x + offset.x, start.y + offset.y, {
        steps: 16,
      });
      await page.mouse.up();
      await page.keyboard.up("Alt");

      await expect(page.locator("[data-screen-shell]")).toHaveCount(2, {
        timeout: 20_000,
      });
      await expect
        .poll(
          async () =>
            (await fileRecords(request, designId)).some(
              (file) => file.filename === "index-copy.html",
            ),
          { timeout: 20_000 },
        )
        .toBe(true);
      const copy = (await fileRecords(request, designId)).find(
        (file) => file.filename === "index-copy.html",
      );
      expect(copy).toBeTruthy();
      await expect
        .poll(
          async () => {
            const geometry = (await designData(request, designId))
              .canvasFrames?.[copy?.id ?? ""];
            return geometry && geometry.x > 0 && geometry.y > 0
              ? geometry
              : null;
          },
          { timeout: 20_000 },
        )
        .not.toBeNull();
      await expect(
        page
          .getByRole("tree", { name: "Layers" })
          .locator('[role="treeitem"][aria-selected="true"]')
          .filter({ hasText: "Index copy" }),
      ).toHaveCount(1);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator("[data-screen-shell]")).toHaveCount(2, {
        timeout: 30_000,
      });
      await expectReloadedOverviewZoom(page, zoom);
      await expect(
        page
          .getByRole("tree", { name: "Layers" })
          .locator('[role="treeitem"][aria-selected="true"]')
          .filter({ hasText: "Index copy" }),
      ).toHaveCount(1);
    } finally {
      await action(request, "delete-design", { id: designId }).catch(() => {});
    }
  });
}
