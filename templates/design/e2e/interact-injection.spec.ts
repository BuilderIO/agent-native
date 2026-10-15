import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { gotoEditor } from "./helpers";
import { INTERACT_FRAME } from "./interact-helpers";

// Interact runs the page as authored: a markup screen carries the theme bridge
// and the links bridge and nothing else the editor owns, and a screen served
// from a URL is a plain frame the editor puts nothing into.

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Plain</title></head><body style="margin:0;font:20px system-ui"><h1 id="title">Plain page</h1></body></html>`;

const URL_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>App</title></head><body style="margin:0;font:20px system-ui"><h1 id="title">Running app</h1><script>window.__received=[];window.addEventListener("message",function(e){window.__received.push(e.data&&e.data.type)});</script></body></html>`;

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

async function createDesign(page: Page, title: string): Promise<string> {
  const created = await postAction(page, "create-design", {
    title,
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  return designId;
}

const EDITOR_FRAME = "iframe[data-design-preview-iframe]";

// oracle: none — reads which editor scripts the running preview document carries.
test("an Interact markup preview carries the theme and links bridges and no editor bridge, and Design gets its bridges back", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1751, height: 897 });
  const designId = await createDesign(page, "Interact injection");
  await postAction(page, "create-file", {
    designId,
    filename: "index.html",
    content: PAGE,
    fileType: "html",
  });
  await gotoEditor(page, designId);
  await page.waitForURL(/editorView=overview/);

  const injected = (frame: ReturnType<Page["frameLocator"]>) =>
    frame.locator("html").evaluate(() =>
      Array.from(document.scripts)
        .flatMap((script) =>
          script
            .getAttributeNames()
            .filter((name) => name.startsWith("data-agent-native")),
        )
        .sort(),
    );

  await page
    .locator('[data-design-top-bar] [data-design-mode="interact"]')
    .click();
  const interact = page.frameLocator(INTERACT_FRAME);
  await expect(interact.locator("#title")).toHaveText("Plain page");
  expect(await injected(interact)).toEqual([
    "data-agent-native-interact-links-bridge",
    "data-agent-native-preview-theme-bridge",
  ]);

  await page.locator('[data-design-top-bar] [data-design-mode="edit"]').click();
  const edit = page.frameLocator(EDITOR_FRAME).first();
  await expect(edit.locator("#title")).toHaveText("Plain page");
  expect(await injected(edit)).toEqual(
    expect.arrayContaining([
      "data-agent-native-editor-chrome-bridge",
      "data-agent-native-hit-test-bridge",
      "data-agent-native-preview-theme-bridge",
    ]),
  );
});

// oracle: none — reads which messages and scripts the running URL page received.
test("an Interact URL screen is a plain frame: the editor hands it no bridge", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1751, height: 897 });
  const url = "https://preview.example.test/app";
  await page.route(url, (route) =>
    route.fulfill({ contentType: "text/html", body: URL_PAGE }),
  );
  const designId = await createDesign(page, "Interact URL injection");
  const app = await postAction(page, "create-file", {
    designId,
    filename: "app.html",
    content: url,
    fileType: "html",
  });
  const appId: string = app?.id ?? app?.data?.id ?? app?.file?.id;
  await postAction(page, "update-design", {
    id: designId,
    dataOperations: [
      {
        op: "set",
        path: ["screenMetadata", appId],
        value: { sourceType: "url", url, width: 1280, height: 800 },
      },
    ],
  });
  await gotoEditor(page, designId);
  await page.waitForURL(/editorView=overview/);

  const received = (frame: ReturnType<Page["frameLocator"]>) =>
    frame
      .locator("html")
      .evaluate(
        () => (window as unknown as { __received: string[] }).__received,
      );

  // The editor posts a page its state once it loads, so a message that has
  // arrived shows the page was reachable; the bridge install is never among them.
  await page
    .locator('[data-design-top-bar] [data-design-mode="interact"]')
    .click();
  const interact = page.frameLocator(INTERACT_FRAME);
  await expect(interact.locator("#title")).toHaveText("Running app");
  await expect.poll(() => received(interact)).toContain("set-interaction-mode");
  expect(await received(interact)).not.toContain("agentNative.installBridge");
  expect(
    await interact.locator("html").evaluate(() => document.scripts.length),
  ).toBe(1);
});
