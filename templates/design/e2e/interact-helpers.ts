import { expect, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { gotoEditor } from "./helpers";

// A page that is long, hovers and answers clicks and Space on its own, beside
// a second screen: enough to tell the running page from a picture of it.
const LIVE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Live page</title>
<style>
  body{margin:0;font:20px system-ui;background:#ffffff;color:#111111}
  #go{margin:24px;padding:12px 20px;font-size:18px;color:#ffffff;background:rgb(99,102,241);border:0;border-radius:8px}
  #go:hover{background:rgb(239,68,68)}
  .filler{height:3000px}
</style></head><body>
  <h1>Live page</h1>
  <button id="go" onclick="document.getElementById('out').textContent='clicked'">Go</button>
  <p id="out">idle</p>
  <button id="space" onclick="document.getElementById('out2').textContent='activated'">Space</button>
  <p id="out2">idle</p>
  <div class="filler">a page taller than its frame</div>
</body></html>`;

const OTHER_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Other</title></head><body style="margin:0;font:20px system-ui"><h1>Other screen</h1></body></html>`;

export const INTERACT_FRAME =
  '[data-screen-interact-mode="true"] iframe[data-design-preview-iframe]';

async function postAction(
  page: Page,
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, any>> {
  const response = await page.request.post(
    `${e2eBaseURL()}/_agent-native/actions/${name}`,
    { data: input, headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok()) {
    throw new Error(
      `action ${name} failed: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

async function createDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "Interact live page",
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  for (const [filename, content] of [
    ["index.html", LIVE_PAGE],
    ["other.html", OTHER_PAGE],
  ] as const) {
    await postAction(page, "create-file", {
      designId,
      filename,
      content,
      fileType: "html",
    });
  }
  return designId;
}

/** Opens a two-screen design in Interact with nothing selected. */
export async function enterInteract(page: Page) {
  await page.setViewportSize({ width: 1751, height: 897 });
  await gotoEditor(page, await createDesign(page));
  await page
    .locator('[data-design-top-bar] [data-design-mode="interact"]')
    .click();
  const frame = page.locator(INTERACT_FRAME);
  await expect(frame).toBeVisible();
  const inner = frame.contentFrame();
  // The page has been handed over once its document is Interact's: the links
  // bridge is there and no editor bridge is.
  await expect(
    inner.locator("script[data-agent-native-interact-links-bridge]"),
  ).toHaveCount(1);
  await expect(
    inner.locator("script[data-agent-native-editor-chrome-bridge]"),
  ).toHaveCount(0);
  await expect(inner.locator("#go")).toBeVisible();
  return { frame, inner };
}

export const centerOf = (box: {
  x: number;
  y: number;
  width: number;
  height: number;
}) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
