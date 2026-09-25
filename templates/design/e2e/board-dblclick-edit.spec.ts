import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { gotoEditor } from "./helpers";

// Board objects are covered by the host's selection box once selected, so the
// second click of a real double-click never lands in the board iframe itself.
const BOARD_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>html, body { background: transparent; } body { margin: 0; position: relative; overflow: visible; }</style>
</head><body>
<div data-agent-native-node-id="board-text" data-agent-native-layer-name="Board text" data-an-primitive="text" style="position: absolute; left: 120px; top: 80px; font-size: 48px; color: #111827; white-space: pre-wrap;">Hello world</div>
<svg data-agent-native-node-id="board-vector" data-agent-native-layer-name="Board vector" data-an-primitive="path" viewBox="120 220 200 140" preserveAspectRatio="none" style="position: absolute; left: 120px; top: 220px; width: 200px; height: 140px; overflow: visible" data-an-pen-nodes="[0,[120,360,null,null,null,null,null],[320,340,null,null,null,null,null],[220,220,null,null,null,null,null]]"><path d="M 120 360 L 320 340 L 220 220" fill="none" fill-opacity="0" stroke="#000000" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path></svg>
</body></html>`;

async function action(
  request: APIRequestContext,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await request.post(`/_agent-native/actions/${name}`, {
    data: input,
  });
  if (!response.ok()) {
    throw new Error(`${name}: ${response.status()} ${await response.text()}`);
  }
  return response.json();
}

async function createBoardDesign(request: APIRequestContext) {
  const created = await action(request, "create-design", {
    title: `Board double-click ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created.id ?? created.data?.id;
  const board = await action(request, "create-file", {
    designId,
    filename: "__board__.html",
    content: BOARD_HTML,
    fileType: "html",
  });
  const boardFileId = board.id ?? board.data?.id;
  await action(request, "update-design", {
    id: designId,
    dataOperations: [{ op: "set", path: ["boardFileId"], value: boardFileId }],
  });
  return { designId, boardFileId: boardFileId as string };
}

async function persistedBoard(
  request: APIRequestContext,
  designId: string,
  boardFileId: string,
) {
  const response = await request.get(
    `/_agent-native/actions/get-design?id=${encodeURIComponent(designId)}`,
  );
  if (!response.ok()) throw new Error(`get-design: ${await response.text()}`);
  const design = await response.json();
  const html = design.files?.find(
    (file: { id?: string }) => file.id === boardFileId,
  )?.content;
  if (typeof html !== "string") throw new Error("board HTML was not returned");
  return html;
}

/** Host-page point for a spot inside a board node, or null before it renders. */
function findBoardPoint(page: Page, nodeId: string, fx: number, fy: number) {
  return page.evaluate(
    ([id, ax, ay]) => {
      for (const iframe of Array.from(document.querySelectorAll("iframe"))) {
        const doc = (iframe as HTMLIFrameElement).contentDocument;
        const node = doc?.querySelector(`[data-agent-native-node-id="${id}"]`);
        if (!node) continue;
        const frame = iframe.getBoundingClientRect();
        const scale = frame.width / (iframe as HTMLIFrameElement).offsetWidth;
        const rect = node.getBoundingClientRect();
        return {
          x: frame.x + (rect.x + rect.width * ax) * scale,
          y: frame.y + (rect.y + rect.height * ay) * scale,
        };
      }
      return null;
    },
    [nodeId, fx, fy] as const,
  );
}

async function boardPoint(page: Page, nodeId: string, fx: number, fy: number) {
  const point = await findBoardPoint(page, nodeId, fx, fy);
  if (!point) throw new Error(`board node ${nodeId} is not rendered`);
  return point;
}

function editingNodeId(page: Page) {
  return page.evaluate(() => {
    for (const iframe of Array.from(document.querySelectorAll("iframe"))) {
      const node = (iframe as HTMLIFrameElement).contentDocument?.querySelector(
        '[contenteditable="true"]',
      );
      if (node) return node.getAttribute("data-agent-native-node-id");
    }
    return null;
  });
}

async function openBoard(page: Page, designId: string) {
  await gotoEditor(page, designId);
  await expect
    .poll(() => findBoardPoint(page, "board-text", 0.5, 0.5), {
      timeout: 40_000,
    })
    .not.toBeNull();
}

test("double-clicking selected board text starts editing it", async ({
  page,
  request,
}) => {
  const { designId, boardFileId } = await createBoardDesign(request);
  try {
    await openBoard(page, designId);
    const point = await boardPoint(page, "board-text", 0.3, 0.5);
    await page.mouse.click(point.x, point.y);
    await expect(
      page.locator("[data-board-object-selection-box]"),
    ).toBeVisible();

    await page.mouse.dblclick(point.x, point.y);
    await expect.poll(() => editingNodeId(page)).toBe("board-text");
    await page.keyboard.type("Edited");
    await page.keyboard.press("Escape");

    await expect
      .poll(async () => persistedBoard(request, designId, boardFileId))
      .toContain(">Edited</div>");
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("double-clicking a selected board vector opens point editing that persists", async ({
  page,
  request,
}) => {
  const { designId, boardFileId } = await createBoardDesign(request);
  try {
    await openBoard(page, designId);
    const onStroke = await boardPoint(page, "board-vector", 0.5, 0.93);
    await page.mouse.click(onStroke.x, onStroke.y);
    await expect(
      page.locator("[data-board-object-selection-box]"),
    ).toBeVisible();

    await page.mouse.dblclick(onStroke.x, onStroke.y);
    const overlay = page.locator("[data-vector-edit-overlay]");
    await expect(overlay).toBeVisible();

    const anchor = await boardPoint(page, "board-vector", 1, 0.857);
    await page.mouse.move(anchor.x, anchor.y);
    await page.mouse.down();
    await page.mouse.move(anchor.x + 40, anchor.y + 30, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const html = await persistedBoard(request, designId, boardFileId);
        const nodes = JSON.parse(
          html.match(/data-an-pen-nodes="([^"]*)"/)![1]!,
        ) as [number, ...number[][]];
        return nodes[2]![0];
      })
      .toBeGreaterThan(330);
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});

test("an empty board click ends point editing and deselects the vector", async ({
  page,
  request,
}) => {
  const { designId } = await createBoardDesign(request);
  try {
    await openBoard(page, designId);
    const selectedRows = page.locator(
      '[role="treeitem"][aria-selected="true"]',
    );
    const onStroke = await boardPoint(page, "board-vector", 0.5, 0.93);
    await page.mouse.click(onStroke.x, onStroke.y);
    await expect(selectedRows).toHaveCount(1);
    await page.mouse.dblclick(onStroke.x, onStroke.y);
    const overlay = page.locator("[data-vector-edit-overlay]");
    await expect(overlay).toBeVisible();

    const empty = await boardPoint(page, "board-text", 0.5, 1.9);
    // Clicks inside the double-click interval extend the double-click.
    await page.waitForTimeout(600);
    await page.mouse.click(empty.x, empty.y);

    await expect(overlay).toBeHidden();
    await expect(selectedRows).toHaveCount(0);
    await page.waitForTimeout(1500); // e2e-harness-ignore: the stale re-select lands after the board's ready handshake; there is no positive state to await.
    await expect(selectedRows).toHaveCount(0);
  } finally {
    await action(request, "delete-design", { id: designId });
  }
});
