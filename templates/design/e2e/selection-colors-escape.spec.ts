import { expect, test, type APIRequestContext } from "@playwright/test";

import { enterDirectMode, expandAllLayers, gotoEditor } from "./helpers";

const FIXTURE = `<!doctype html><html><body style="margin:0">
<main data-agent-native-node-id="paint-owner" data-agent-native-layer-name="Paint owner" data-an-primitive="frame" style="position:relative;width:500px;height:300px">
<div data-agent-native-node-id="paint-shape" style="position:absolute;left:20px;top:20px;width:120px;height:80px;background-color:#f97316;border:8px solid #f97316"></div>
<p data-agent-native-node-id="paint-text" data-an-primitive="text" style="position:absolute;left:20px;top:140px;margin:0;color:#f97316;font:24px sans-serif">Paint</p>
</main></body></html>`;

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

test("Selection Colors commits survive picker Escape and undo together", async ({
  page,
  request,
}) => {
  let observingPaintGesture = false;
  const hmrEvents: string[] = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      const message = String(payload);
      if (
        observingPaintGesture &&
        /"type":"(?:update|full-reload)"/.test(message)
      ) {
        hmrEvents.push(message);
      }
    });
  });
  const created = await action(request, "create-design", {
    title: `Selection Colors Escape ${Date.now()}`,
    projectType: "prototype",
  });
  if (typeof created.id !== "string") throw new Error("Missing design id");
  try {
    await action(request, "create-file", {
      designId: created.id,
      filename: "index.html",
      content: FIXTURE,
      fileType: "html",
    });
    await gotoEditor(page, created.id);
    await enterDirectMode(page);
    await expandAllLayers(page);
    const tree = page.getByRole("tree", { name: "Layers" });
    await tree
      .getByRole("button", { name: "Paint owner", exact: true })
      .click();
    const selected = tree.locator('[role="treeitem"][aria-selected="true"]');
    await expect(selected).toContainText("Paint owner");
    await page.getByRole("button", { name: "Show selection colors" }).click();
    await page.getByRole("button", { name: /^#f97316$/i }).click();
    const hex = page.getByRole("textbox", { name: "Hex", exact: true });
    await expect(hex).toBeVisible();
    observingPaintGesture = true;
    await hex.fill("3B82F6");
    await hex.press("Enter");
    await expect(hex).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(hex).toBeHidden();
    await expect(selected).toContainText("Paint owner");

    const frame = page
      .locator("iframe[data-design-preview-iframe]")
      .last()
      .contentFrame();
    const paints = () =>
      frame
        .locator('[data-agent-native-node-id="paint-owner"]')
        .evaluate((owner) => {
          const shape = owner.querySelector(
            '[data-agent-native-node-id="paint-shape"]',
          );
          const text = owner.querySelector(
            '[data-agent-native-node-id="paint-text"]',
          );
          if (!shape || !text) throw new Error("Missing paint descendants");
          return [
            getComputedStyle(shape).backgroundColor,
            getComputedStyle(shape).borderTopColor,
            getComputedStyle(text).color,
          ];
        });
    await expect.poll(paints).toEqual(Array(3).fill("rgb(59, 130, 246)"));
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(paints).toEqual(Array(3).fill("rgb(249, 115, 22)"));
    expect(hmrEvents).toEqual([]);
  } finally {
    await action(request, "delete-design", { id: created.id });
  }
});
