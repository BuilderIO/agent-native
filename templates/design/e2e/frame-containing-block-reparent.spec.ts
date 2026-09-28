import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  appPath,
  childNodeIds,
  designFrame,
  expandAllLayers,
  gotoEditor,
} from "./helpers";

const WORKSPACE_ID = "frame-containment-workspace";
const FRAME_ID = "frame-containment-artwork";
const BADGE_ID = "frame-containment-play-button";

const REPRO_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Frame containment repro</title></head>
  <body style="margin:0;position:relative;width:1000px;height:700px;background:#0f1115">
    <div data-agent-native-node-id="${WORKSPACE_ID}" data-agent-native-layer-name="Workspace" style="position:absolute;left:40px;top:40px;display:flex;flex-direction:row;gap:16px;width:420px;height:180px;padding:12px;background:#1a1d24">
      <div data-agent-native-node-id="frame-containment-sidebar" data-agent-native-layer-name="Sidebar" style="flex:none;width:100px;height:120px;background:#272a33"></div>
    </div>
    <div data-agent-native-node-id="${FRAME_ID}" data-agent-native-layer-name="Artwork" data-an-primitive="frame" style="position:absolute;left:520px;top:320px;width:80px;height:60px;box-sizing:border-box;background:#4b5563">
      <div data-agent-native-node-id="${BADGE_ID}" data-agent-native-layer-name="Play button" style="position:absolute;right:10px;bottom:13px;width:18px;height:14px;background:#f97316"></div>
    </div>
  </body>
</html>`;

type DesignRecord = {
  files?: Array<{ id: string; content?: string }>;
};

type HmrSignal = { type: string; at: number };

function hmrSignals(page: Page) {
  return (page as Page & { hmrUpdates: HmrSignal[] }).hmrUpdates;
}

test.beforeEach(async ({ page }) => {
  const updates: HmrSignal[] = [];
  const targetHost = new URL(e2eBaseURL()).host;
  page.on("websocket", (socket) => {
    if (!socket.url().includes(targetHost)) return;
    socket.on("framereceived", (event) => {
      try {
        const message = JSON.parse(String(event.payload));
        if (["update", "full-reload"].includes(message.type)) {
          updates.push({ type: message.type, at: Date.now() });
        }
      } catch {
        // Vite sends non-JSON frames for heartbeat and connection control.
      }
    });
  });
  (page as Page & { hmrUpdates: HmrSignal[] }).hmrUpdates = updates;
});

test.afterEach(async ({ page }) => {
  expect(
    hmrSignals(page),
    "No Vite HMR during the Frame containment proof",
  ).toEqual([]);
});

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
) {
  const response = await page.request.post(
    appPath(`/_agent-native/actions/${name}`),
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(
      `${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function createReproDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: `Frame containment ${Date.now()}`,
    projectType: "prototype",
  });
  const designId = created?.id ?? created?.data?.id ?? created?.design?.id;
  if (typeof designId !== "string") {
    throw new Error(`create-design returned no id: ${JSON.stringify(created)}`);
  }
  await postAction(page, "create-file", {
    designId,
    filename: "index.html",
    content: REPRO_HTML,
    fileType: "html",
  });
  return designId;
}

async function readDesign(page: Page, designId: string) {
  const response = await page.request.get(
    appPath(`/_agent-native/actions/get-design?id=${designId}`),
  );
  if (!response.ok()) throw new Error(await response.text());
  return (await response.json()) as DesignRecord;
}

async function readSource(page: Page, designId: string) {
  const design = await readDesign(page, designId);
  return (
    design.files?.find((file) =>
      file.content?.includes(`data-agent-native-node-id="${WORKSPACE_ID}"`),
    )?.content ?? ""
  );
}

function styleForNode(source: string, nodeId: string) {
  const escapedId = nodeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(
      `data-agent-native-node-id=["']${escapedId}["'][^>]*style=["']([^"']*)["']`,
      "i",
    ).exec(source)?.[1] ?? ""
  );
}

function layerRowButton(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first();
}

async function previewFrame(page: Page) {
  return designFrame(page)
    .locator("body")
    .evaluate(
      (body, ids) => {
        const doc = body.ownerDocument;
        const frame = doc.querySelector<HTMLElement>(
          `[data-agent-native-node-id="${CSS.escape(ids.frameId)}"]`,
        );
        const badge = doc.querySelector<HTMLElement>(
          `[data-agent-native-node-id="${CSS.escape(ids.badgeId)}"]`,
        );
        if (!frame || !badge) return null;
        const frameRect = frame.getBoundingClientRect();
        const badgeRect = badge.getBoundingClientRect();
        return {
          frameCount: doc.querySelectorAll(
            `[data-agent-native-node-id="${CSS.escape(ids.frameId)}"]`,
          ).length,
          frameParentId: frame.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ),
          framePosition: getComputedStyle(frame).position,
          frameInlineStyle: frame.getAttribute("style"),
          framePrimitive:
            frame.getAttribute("data-an-primitive") ??
            frame.getAttribute("data-agent-native-primitive"),
          frameLeft: frameRect.left,
          frameTop: frameRect.top,
          frameWidth: frameRect.width,
          frameHeight: frameRect.height,
          badgeOffsetParentId: badge.offsetParent?.getAttribute(
            "data-agent-native-node-id",
          ),
          badgeRightGap: frameRect.right - badgeRect.right,
          badgeBottomGap: frameRect.bottom - badgeRect.bottom,
          badgeLeft: badgeRect.left,
          badgeTop: badgeRect.top,
        };
      },
      { frameId: FRAME_ID, badgeId: BADGE_ID },
    );
}

test("Layers reparent keeps a nested absolute child anchored to its Frame through resize and reload", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const designId = await createReproDesign(page);
  await gotoEditor(page, designId);
  await expandAllLayers(page);

  const workspaceRow = layerRowButton(page, "Workspace");
  const artworkRow = layerRowButton(page, "Artwork");
  await expect(workspaceRow).toBeVisible();
  await expect(artworkRow).toBeVisible();
  await expect
    .poll(() => previewFrame(page))
    .toMatchObject({
      frameCount: 1,
      frameParentId: expect.stringMatching(/^an-/),
      framePosition: "absolute",
      badgeOffsetParentId: FRAME_ID,
      badgeRightGap: 10,
      badgeBottomGap: 13,
    });

  const initialFrame = await previewFrame(page);
  expect(initialFrame).not.toBeNull();
  const artworkBounds = await artworkRow.boundingBox();
  const workspaceBounds = await workspaceRow.boundingBox();
  if (!artworkBounds || !workspaceBounds) {
    throw new Error("Artwork or Workspace layer row has no bounds");
  }
  await page.mouse.move(
    artworkBounds.x + artworkBounds.width / 2,
    artworkBounds.y + artworkBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    workspaceBounds.x + Math.min(96, workspaceBounds.width / 2),
    workspaceBounds.y + Math.min(16, workspaceBounds.height / 2),
    { steps: 12 },
  );
  await page.mouse.up();

  await expect
    .poll(async () =>
      childNodeIds(await readSource(page, designId), WORKSPACE_ID),
    )
    .toContain(FRAME_ID);
  const sourceAfterMove = await readSource(page, designId);
  const frameStyleAfterMove = styleForNode(sourceAfterMove, FRAME_ID);
  await test.info().attach("source-after-frame-reparent.html", {
    body: sourceAfterMove,
    contentType: "text/html",
  });
  await test.info().attach("live-frame-after-reparent.json", {
    body: JSON.stringify(await previewFrame(page), null, 2),
    contentType: "application/json",
  });
  expect(frameStyleAfterMove).toMatch(/position:\s*absolute/i);
  expect(frameStyleAfterMove).toMatch(/left:\s*480px/i);
  expect(frameStyleAfterMove).toMatch(/top:\s*280px/i);
  const frameAfterMove = await previewFrame(page);
  expect(frameAfterMove).toMatchObject({
    frameLeft: initialFrame!.frameLeft,
    frameTop: initialFrame!.frameTop,
  });
  await expect
    .poll(() => previewFrame(page))
    .toMatchObject({
      frameCount: 1,
      frameParentId: WORKSPACE_ID,
      framePosition: "absolute",
      framePrimitive: "frame",
      frameLeft: initialFrame!.frameLeft,
      frameTop: initialFrame!.frameTop,
      badgeOffsetParentId: FRAME_ID,
      badgeRightGap: 10,
      badgeBottomGap: 13,
    });

  expect(sourceAfterMove).toContain('data-an-primitive="frame"');
  expect(sourceAfterMove).toMatch(
    /data-agent-native-node-id="frame-containment-artwork"[^>]*style="[^"]*position:\s*absolute/i,
  );

  await artworkRow.click({ force: true });
  const width = page.getByRole("textbox", {
    name: /^W(?: size in pixels)?$/,
  });
  const height = page.getByRole("textbox", {
    name: /^H(?: size in pixels)?$/,
  });
  await expect(width).toBeVisible();
  await width.fill("120");
  await width.press("Enter");
  await expect
    .poll(() => previewFrame(page))
    .toMatchObject({
      frameWidth: 120,
      badgeOffsetParentId: FRAME_ID,
      badgeRightGap: 10,
    });
  await height.fill("90");
  await height.press("Enter");
  await expect
    .poll(() => previewFrame(page))
    .toMatchObject({
      frameWidth: 120,
      frameHeight: 90,
      badgeOffsetParentId: FRAME_ID,
      badgeRightGap: 10,
      badgeBottomGap: 13,
    });

  const finalSource = await readSource(page, designId);
  expect(finalSource).toContain(`data-agent-native-node-id="${FRAME_ID}"`);
  expect(finalSource).toContain(`data-agent-native-node-id="${BADGE_ID}"`);
  await expect
    .poll(async () => {
      const style = styleForNode(await readSource(page, designId), FRAME_ID);
      return /width:\s*120px/i.test(style) && /height:\s*90px/i.test(style);
    })
    .toBe(true);
  await page.reload();
  await gotoEditor(page, designId);
  await expect
    .poll(() => previewFrame(page))
    .toMatchObject({
      frameCount: 1,
      frameParentId: WORKSPACE_ID,
      framePosition: "absolute",
      frameLeft: initialFrame!.frameLeft,
      frameTop: initialFrame!.frameTop,
      frameWidth: 120,
      frameHeight: 90,
      badgeOffsetParentId: FRAME_ID,
      badgeRightGap: 10,
      badgeBottomGap: 13,
    });
});
