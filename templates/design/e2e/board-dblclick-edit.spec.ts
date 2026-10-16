import { type Page } from "@playwright/test";

import { appPath } from "./helpers";
import { expect, expectOnlyChanged, test, type App } from "./rails";

const BOARD_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>html, body { background: transparent; } body { margin: 0; position: relative; overflow: visible; }</style>
</head><body>
<div data-agent-native-node-id="board-text" data-agent-native-layer-name="Board text" data-an-primitive="text" style="position: absolute; left: 120px; top: 80px; font-size: 48px; color: #111827; white-space: pre-wrap;">Hello world</div>
<svg data-agent-native-node-id="board-vector" data-agent-native-layer-name="Board vector" data-an-primitive="path" viewBox="120 220 200 140" preserveAspectRatio="none" style="position: absolute; left: 120px; top: 220px; width: 200px; height: 140px; overflow: visible" data-an-pen-nodes="[0,[120,360,null,null,null,null,null],[320,340,null,null,null,null,null],[220,220,null,null,null,null,null]]"><path d="M 120 360 L 320 340 L 220 220" fill="none" fill-opacity="0" stroke="#000000" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path></svg>
</body></html>`;

async function seedBoard(app: App) {
  const id = await app.seed("<!doctype html><html><body></body></html>", {
    files: { "__board__.html": BOARD_HTML },
  });
  const { files } = await app.savedRecord(id);
  const fileId = (filename: string) =>
    files.find((file) => file.filename === filename)!.id;
  const removed = await app.page.request.post(
    appPath("/_agent-native/actions/delete-file"),
    { data: { id: fileId("index.html") } },
  );
  expect(removed.ok()).toBe(true);
  const linked = await app.page.request.post(
    appPath("/_agent-native/actions/update-design"),
    {
      data: {
        id,
        dataOperations: [
          { op: "set", path: ["boardFileId"], value: fileId("__board__.html") },
        ],
      },
    },
  );
  expect(linked.ok()).toBe(true);
  return id;
}

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
          scale,
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

async function openBoard(app: App) {
  const id = await seedBoard(app);
  await app.open(id);
  await expect
    .poll(() => findBoardPoint(app.page, "board-text", 0.5, 0.5), {
      timeout: 40_000,
    })
    .not.toBeNull();
  return { id, before: await app.savedNodes(id, "__board__.html") };
}

async function enterVectorPointEditing(page: Page) {
  const onStroke = await boardPoint(page, "board-vector", 0.5, 0.93);
  await page.mouse.click(onStroke.x, onStroke.y);
  await expect(
    page.locator('[role="treeitem"][aria-selected="true"]'),
  ).toHaveText(["Board vector"]);
  await page.mouse.dblclick(onStroke.x, onStroke.y);
  await expect(page.locator("[data-vector-edit-overlay]")).toBeVisible();
}

test("double-clicking selected board text edits it in place, and Escape saves exactly the typed text", async ({
  app,
  page,
}) => {
  const { id, before } = await openBoard(app);
  const point = await boardPoint(page, "board-text", 0.3, 0.5);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator("[data-board-object-selection-box]")).toBeVisible();

  await page.mouse.dblclick(point.x, point.y);
  await expect.poll(() => editingNodeId(page)).toBe("board-text");
  await page.keyboard.type("Edited");
  await page.keyboard.press("Escape");

  await expect.poll(() => editingNodeId(page)).toBeNull();
  await app.settled();
  const after = await app.savedNodes(id, "__board__.html");
  expect(after.get("board-text")?.text).toBe("Edited");
  expect(after.get("board-text")?.attrs).toEqual(
    before.get("board-text")?.attrs,
  );
  expectOnlyChanged(before, after, ["board-text"]);
});

test("dragging an anchor in board-vector point editing moves only that anchor and saves the new path", async ({
  app,
  page,
}) => {
  const { id, before } = await openBoard(app);
  await enterVectorPointEditing(page);
  const anchor = await boardPoint(page, "board-vector", 1, 0.857);

  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.down();
  await page.mouse.move(
    anchor.x + 40 * anchor.scale,
    anchor.y + 30 * anchor.scale,
    { steps: 8 },
  );
  await page.mouse.up();

  await app.settled();
  const after = await app.savedNodes(id, "__board__.html");
  type PenNode = (number | null)[];
  const [, first, moved, last] = JSON.parse(
    after.get("board-vector")!.attrs["data-an-pen-nodes"]!,
  ) as [number, PenNode, PenNode, PenNode];
  expect(first).toEqual([120, 360, null, null, null, null, null]);
  expect(last).toEqual([220, 220, null, null, null, null, null]);
  expect(moved.slice(2)).toEqual([null, null, null, null, null]);
  expect(moved[0]).toBeCloseTo(360, 0);
  expect(moved[1]).toBeCloseTo(370, 0);
  const path = /d="M 120 360 L ([\d.]+) ([\d.]+) L 220 220"/.exec(
    await app.savedHtml(id, "__board__.html"),
  );
  expect(Number(path?.[1])).toBeCloseTo(360, 0);
  expect(Number(path?.[2])).toBeCloseTo(370, 0);
  expectOnlyChanged(before, after, ["board-vector"]);
});

test("an empty board click ends point editing and deselects the vector", async ({
  app,
  page,
}) => {
  const { id, before } = await openBoard(app);
  const selectedRows = page.locator('[role="treeitem"][aria-selected="true"]');
  await enterVectorPointEditing(page);
  const empty = await boardPoint(page, "board-text", 0.5, 1.9);
  const loadedAt = await page.evaluate(() => performance.timeOrigin);
  await page.waitForTimeout(600);

  await page.mouse.click(empty.x, empty.y);

  await expect(page.locator("[data-vector-edit-overlay]")).toBeHidden();
  await expect(selectedRows).toHaveCount(0);
  await page.waitForTimeout(1500); // e2e-harness-ignore: the stale re-select lands after the board's ready handshake; there is no positive state to await.
  await expect(selectedRows).toHaveCount(0);
  expect(
    await page.evaluate(() => performance.timeOrigin),
    "a reload mid-test would empty the selection on its own",
  ).toBe(loadedAt);
  await app.settled();
  expectOnlyChanged(before, await app.savedNodes(id, "__board__.html"), []);
});
