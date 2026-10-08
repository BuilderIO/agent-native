import { expect, test, type Page } from "@playwright/test";

import { appPath, designFrame, gotoEditor } from "./helpers";

const NODE_ID = "drag-out-card";
const SCREEN_HTML = `<!doctype html><html lang="en"><head><title>Hug</title></head><body style="margin:0;background:#0b0b0f;color:#111827;font-family:Inter"><div data-agent-native-node-id="${NODE_ID}" data-agent-native-layer-name="Card" style="position:absolute;left:80px;top:80px;width:160px;height:100px;background:#e44"></div></body></html>`;
const HUG_OVERFLOW_HTML = `<!doctype html><html lang="en"><head><title>Hug overflow</title><meta data-agent-native-screen-height-mode="hug" /></head><body style="margin:0;width:320px;background:#0b0b0f;color:#111827;font-family:Inter"><div style="height:360px"></div><div data-agent-native-node-id="${NODE_ID}" data-agent-native-layer-name="Card" style="width:160px;height:64px;background:#e44"></div><div style="height:180px"></div></body></html>`;

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

async function filesContaining(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  const record = (await response.json()) as {
    files?: Array<{ filename: string; content?: string }>;
  };
  return (record.files ?? [])
    .filter((file) =>
      file.content?.includes(`data-agent-native-node-id="${NODE_ID}"`),
    )
    .map((file) => file.filename);
}

async function designRecord(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  return response.json();
}

async function boardLayerPosition(page: Page, designId: string) {
  const record = (await designRecord(page, designId)) as {
    files?: Array<{ filename: string; content?: string }>;
  };
  const board = record.files?.find(
    (file) => file.filename === "__board__.html",
  );
  if (!board?.content) throw new Error("board file has no content");
  return page.evaluate(
    ({ html, nodeId }) => {
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const node = parsed.querySelector<HTMLElement>(
        `[data-agent-native-node-id="${nodeId}"]`,
      );
      if (!node) throw new Error("dropped layer is missing from the board");
      return {
        position: node.style.position,
        left: Number.parseFloat(node.style.left),
        top: Number.parseFloat(node.style.top),
      };
    },
    { html: board.content, nodeId: NODE_ID },
  );
}

function designData(record: { data?: unknown }): Record<string, any> {
  return typeof record.data === "string"
    ? JSON.parse(record.data || "{}")
    : ((record.data ?? {}) as Record<string, any>);
}

test("a layer dragged below the rendered Screen card moves to the board", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    (window as unknown as { __DESIGN_TRACE?: boolean }).__DESIGN_TRACE = true;
  });
  const design = await action(page, "create-design", {
    title: `Drag out of screen ${Date.now()}`,
    projectType: "prototype",
    designSystemId: null,
  });
  const designId = design.id ?? design.data?.id;
  if (typeof designId !== "string") throw new Error("create-design no id");
  try {
    const screen = await action(page, "create-file", {
      designId,
      filename: "index.html",
      content: SCREEN_HTML,
      fileType: "html",
    });
    const screenId = screen.id ?? screen.data?.id;
    await gotoEditor(page, designId);

    const card = designFrame(page, screenId).locator(
      `[data-agent-native-node-id="${NODE_ID}"]`,
    );
    const cardBox = await card.boundingBox();
    const screenBox = await page
      .locator(
        `[data-screen-shell][data-frame-id="${screenId}"] [data-screen-card]`,
      )
      .boundingBox();
    if (!cardBox || !screenBox) throw new Error("no geometry");
    const start = {
      x: cardBox.x + cardBox.width / 2,
      y: cardBox.y + cardBox.height / 2,
    };
    await page.mouse.click(start.x, start.y);
    const end = {
      x: start.x,
      y: screenBox.y + screenBox.height + Math.max(cardBox.height * 0.25, 80),
    };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= 30; step += 1) {
      await page.mouse.move(
        start.x + ((end.x - start.x) * step) / 30,
        start.y + ((end.y - start.y) * step) / 30,
      );
      await page.waitForTimeout(25);
    }
    await page.waitForTimeout(700);
    await page.mouse.move(end.x + 1, end.y);
    await page.waitForTimeout(300);
    await page.mouse.up();

    await expect
      .poll(() => filesContaining(page, designId), { timeout: 20_000 })
      .toEqual(["__board__.html"]);

    const commitPoint = await page.evaluate(() => {
      const entries = (window as any).__designTrace?.entries?.() ?? [];
      return entries
        .filter(
          (entry: any) =>
            entry.area === "drop" && entry.event === "board-commit-point",
        )
        .at(-1)?.data;
    });
    expect(commitPoint.hasAnchor).toBe(false);
    expect(commitPoint.targetOutsideBoardRenderGeometry).toBe(false);
    expect(commitPoint.boardSurfaceRenderOrigin).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
    });
    expect(commitPoint.targetLocalPoint.x).toBeCloseTo(
      commitPoint.targetCanvasPoint.x - commitPoint.boardSurfaceRenderOrigin.x,
      4,
    );
    expect(commitPoint.targetLocalPoint.y).toBeCloseTo(
      commitPoint.targetCanvasPoint.y - commitPoint.boardSurfaceRenderOrigin.y,
      4,
    );
    expect(commitPoint.sourcePointerOffset).toBeTruthy();
    const persistedPosition = await boardLayerPosition(page, designId);
    expect(persistedPosition.position).toBe("absolute");
    expect(persistedPosition.left).toBeCloseTo(
      commitPoint.targetLocalPoint.x - commitPoint.sourcePointerOffset.x,
      0,
    );
    expect(persistedPosition.top).toBeCloseTo(
      commitPoint.targetLocalPoint.y - commitPoint.sourcePointerOffset.y,
      0,
    );
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});

test("a drag released inside rendered Hug overflow stays in its source Screen", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const design = await action(page, "create-design", {
    title: `Hug overflow drop ${Date.now()}`,
    projectType: "prototype",
    designSystemId: null,
  });
  const designId = design.id ?? design.data?.id;
  if (typeof designId !== "string") throw new Error("create-design no id");
  try {
    await page.addInitScript(() => {
      (window as unknown as { __DESIGN_TRACE?: boolean }).__DESIGN_TRACE = true;
    });
    const screen = await action(page, "create-file", {
      designId,
      filename: "index.html",
      content: HUG_OVERFLOW_HTML,
      fileType: "html",
    });
    const screenId = screen.id ?? screen.data?.id;
    if (typeof screenId !== "string") throw new Error("create-file no id");
    await action(page, "update-design", {
      id: designId,
      dataOperations: [
        {
          op: "set",
          path: ["canvasFrames", screenId],
          value: { x: 0, y: 0, width: 320, height: 200, z: 0 },
        },
        {
          op: "set",
          path: ["screenMetadata", screenId],
          value: {
            sourceType: "inline",
            width: 320,
            heightMode: "hug",
            heightPinned: false,
          },
        },
      ],
    });
    await gotoEditor(page, designId);

    const sourceFrame = page.locator(
      `iframe[data-screen-iframe-id="${screenId}"]`,
    );
    const card = designFrame(page, screenId).locator(
      `[data-agent-native-node-id="${NODE_ID}"]`,
    );
    await expect(card).toBeVisible();
    const readBounds = async () => {
      const [iframe, node] = await Promise.all([
        sourceFrame.boundingBox(),
        card.boundingBox(),
      ]);
      return { iframe, node };
    };
    await expect
      .poll(async () => {
        const { iframe } = await readBounds();
        if (!iframe) return 0;
        const designState = await designRecord(page, designId);
        const persistedHeight =
          designData(designState).canvasFrames?.[screenId]?.height;
        if (persistedHeight !== 200) return 0;
        const scale = iframe.width / 320;
        return iframe.height / scale > persistedHeight + 300 ? 1 : 0;
      })
      .toBe(1);
    const { iframe, node } = await readBounds();
    if (!iframe || !node) throw new Error("missing Hug overflow bounds");
    const scale = iframe.width / 320;
    const persistedFrame = designData(await designRecord(page, designId))
      .canvasFrames?.[screenId];
    expect(persistedFrame?.height).toBe(200);
    const release = { x: iframe.x + 100 * scale, y: iframe.y + 520 * scale };
    expect(release.y).toBeGreaterThan(iframe.y + persistedFrame.height * scale);
    expect(release.y).toBeLessThan(iframe.y + iframe.height);
    const beforeFiles = await filesContaining(page, designId);

    await page.mouse.click(node.x + node.width / 2, node.y + node.height / 2);
    await expect(
      page.getByRole("treeitem").filter({ hasText: "Card" }),
    ).toHaveAttribute("aria-selected", "true");
    await page.mouse.move(node.x + node.width / 2, node.y + node.height / 2);
    await page.mouse.down();
    await page.mouse.move(release.x, release.y, { steps: 18 });
    await page.mouse.up();

    await expect
      .poll(() =>
        page.evaluate(() => {
          const entries = (window as any).__designTrace?.entries?.() ?? [];
          return entries
            .filter(
              (entry: any) =>
                entry.area === "drop" && entry.event === "finalize",
            )
            .at(-1)?.data;
        }),
      )
      .toMatchObject({
        boardDropRoute: null,
        droppedInsideSourceScreen: true,
      });
    expect(await filesContaining(page, designId)).toEqual(beforeFiles);
  } finally {
    await action(page, "delete-design", { id: designId }).catch(() => {});
  }
});
