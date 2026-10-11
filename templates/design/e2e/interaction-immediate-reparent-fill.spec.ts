import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import {
  appPath,
  childNodeIds,
  designFrame,
  expandAllLayers,
  gotoEditor,
} from "./helpers";

const WORKSPACE_ID = "reparent-workspace";
const MAIN_CONTENT_ID = "reparent-main-content";

const REPRO_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Reparent Fill repro</title></head>
  <body style="margin:0;padding:32px;display:flex;flex-direction:column;gap:24px;background:#0f1115;color:#f4f4f5">
    <div data-agent-native-node-id="${WORKSPACE_ID}" data-agent-native-layer-name="Workspace" style="display:flex;flex-direction:row;gap:24px;width:700px;height:300px;background:#1a1d24">
      <div data-agent-native-node-id="reparent-sidebar" data-agent-native-layer-name="Sidebar" style="width:200px;height:200px;background:#272a33"></div>
    </div>
    <div data-agent-native-node-id="${MAIN_CONTENT_ID}" data-agent-native-layer-name="Main Content" style="width:260px;height:180px;background:#202838">Main Content</div>
  </body>
</html>`;

type DesignRecord = {
  data?: unknown;
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
  (page as typeof page & { hmrUpdates: HmrSignal[] }).hmrUpdates = updates;
});

test.afterEach(async ({ page }) => {
  expect(hmrSignals(page), "No Vite HMR during the reparent proof").toEqual([]);
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
    title: `Immediate reparent Fill ${Date.now()}`,
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

function layerRowButton(page: Page, name: string) {
  return page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first();
}

async function previewNode(page: Page, nodeId: string) {
  return designFrame(page)
    .locator("body")
    .evaluate((body, id) => {
      const matches = Array.from(
        body.ownerDocument.querySelectorAll<HTMLElement>(
          `[data-agent-native-node-id="${CSS.escape(id)}"]`,
        ),
      );
      return matches.map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const parentStyle = element.parentElement
          ? getComputedStyle(element.parentElement)
          : null;
        const parentRect = element.parentElement?.getBoundingClientRect();
        return {
          id: element.getAttribute("data-agent-native-node-id"),
          name: element.getAttribute("data-agent-native-layer-name"),
          parentId: element.parentElement?.getAttribute(
            "data-agent-native-node-id",
          ),
          parentName: element.parentElement?.getAttribute(
            "data-agent-native-layer-name",
          ),
          width: style.width,
          flex: style.flex,
          boundsWidth: rect.width,
          parentWidth: parentStyle?.width,
          parentBoundsWidth: parentRect?.width,
        };
      });
    }, nodeId);
}

test("immediate layer reparent preserves one node and applies Fill to its new flex parent", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const designId = await createReproDesign(page);
  await gotoEditor(page, designId);
  await expandAllLayers(page);

  await expect.poll(() => previewNode(page, MAIN_CONTENT_ID)).toHaveLength(1);
  const workspaceRow = layerRowButton(page, "Workspace");
  const childRow = layerRowButton(page, "Main Content");
  await expect(workspaceRow).toBeVisible();
  await expect(childRow).toBeVisible();

  const childRowBox = await childRow.boundingBox();
  const workspaceRowBox = await workspaceRow.boundingBox();
  if (!childRowBox || !workspaceRowBox) {
    throw new Error("Workspace or Main Content layer row has no bounds");
  }

  await page.mouse.move(
    childRowBox.x + childRowBox.width / 2,
    childRowBox.y + childRowBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    workspaceRowBox.x + Math.min(96, workspaceRowBox.width / 2),
    workspaceRowBox.y + Math.min(16, workspaceRowBox.height / 2),
    { steps: 12 },
  );
  await page.mouse.up();

  const afterMouseUp = {
    at: Date.now(),
    nodes: await previewNode(page, MAIN_CONTENT_ID),
    source: await readSource(page, designId),
  };
  console.log("reparent-after-mouseup", {
    at: afterMouseUp.at,
    sourceIdCount: (afterMouseUp.source.match(/reparent-main-content/g) ?? [])
      .length,
    workspaceChildren: childNodeIds(afterMouseUp.source, WORKSPACE_ID),
    previewNodes: afterMouseUp.nodes,
  });

  await expect
    .poll(async () => {
      const source = await readSource(page, designId);
      return childNodeIds(source, WORKSPACE_ID).includes(MAIN_CONTENT_ID);
    })
    .toBe(true);
  await expect.poll(() => previewNode(page, MAIN_CONTENT_ID)).toHaveLength(1);

  await layerRowButton(page, "Main Content").click({ force: true });
  const widthMode = page.getByRole("button", {
    name: /^W sizing mode — Fixed$/,
  });
  await expect(widthMode).toBeVisible();
  await widthMode.click();
  await page.getByRole("menuitem", { name: "Fill container" }).click();

  await expect
    .poll(async () => {
      const source = await readSource(page, designId);
      return /data-agent-native-node-id="reparent-main-content"[^>]*style="[^"]*width:\s*auto/i.test(
        source,
      );
    })
    .toBe(true);
  const final = {
    at: Date.now(),
    source: await readSource(page, designId),
    nodes: await previewNode(page, MAIN_CONTENT_ID),
  };
  console.log("reparent-fill-final-without-reload", {
    at: final.at,
    sourceIdCount: (final.source.match(/reparent-main-content/g) ?? []).length,
    workspaceChildren: childNodeIds(final.source, WORKSPACE_ID),
    previewNodes: final.nodes,
  });
  expect(final.nodes).toHaveLength(1);
  expect(final.nodes[0]).toMatchObject({
    id: MAIN_CONTENT_ID,
    name: "Main Content",
    parentId: WORKSPACE_ID,
    parentName: "Workspace",
    flex: "1 0 0px",
    width: "476px",
    boundsWidth: 476,
    parentWidth: "700px",
    parentBoundsWidth: 700,
  });
});
