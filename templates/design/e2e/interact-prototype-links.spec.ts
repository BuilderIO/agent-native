import { expect, test, type Page } from "@playwright/test";

import { e2eBaseURL } from "./base-url";
import { gotoEditor } from "./helpers";
import { INTERACT_FRAME } from "./interact-helpers";

const SCREEN_CONTROL = "[data-design-top-bar] [data-design-interact-route]";

// A long page with a link to each kind of target, so one run shows which
// clicks the preview takes over and which it leaves to the page.
const HOME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Home</title>
<style>
  body{margin:0;font:20px system-ui;background:#ffffff;color:#111111}
  a{display:inline-block;margin:12px 24px}
  .filler{height:2400px}
</style></head><body>
  <h1 id="title">Home screen</h1>
  <a id="to-pricing" href="/pricing">Pricing</a>
  <a id="to-docs" href="docs.html">Docs</a>
  <a id="to-section" href="#bottom">Jump to the bottom</a>
  <div class="filler">a page taller than its frame</div>
  <h2 id="bottom">Bottom of the page</h2>
</body></html>`;

const page2 = (title: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body style="margin:0;font:20px system-ui"><h1 id="title">${title} screen</h1></body></html>`;

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

async function createLinkedDesign(page: Page): Promise<string> {
  const created = await postAction(page, "create-design", {
    title: "Interact prototype links",
    projectType: "prototype",
  });
  const designId: string | undefined =
    created?.id ?? created?.data?.id ?? created?.design?.id;
  if (!designId) throw new Error("create-design returned no id");
  for (const [filename, content] of [
    ["index.html", HOME],
    ["pricing.html", page2("Pricing")],
    ["docs.html", page2("Docs")],
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

async function enterInteractOnHome(page: Page) {
  await page.setViewportSize({ width: 1751, height: 897 });
  await gotoEditor(page, await createLinkedDesign(page));
  await page.waitForURL(/editorView=overview/);
  await page
    .locator('[data-design-top-bar] [data-design-mode="interact"]')
    .click();
  const screen = page.locator(SCREEN_CONTROL);
  await expect(screen).toBeVisible();
  // Pick Home explicitly: Interact opens on the selected or first screen.
  await screen.click();
  await page.getByRole("option", { name: "Home", exact: true }).click();
  await expect(screen).toHaveText("Home");
  const frame = page.locator(INTERACT_FRAME);
  const inner = frame.contentFrame();
  await expect(inner.locator("#title")).toHaveText("Home screen");
  return { screen, frame, inner };
}

// oracle: none — drives real clicks on the running prototype.
test("a link to another screen switches the preview, and nothing else is taken over", async ({
  page,
}) => {
  const { screen, inner } = await enterInteractOnHome(page);

  // A link to another screen of the design shows that screen.
  await inner.locator("#to-pricing").click();
  await expect(screen).toHaveText("Pricing");
  await expect(
    page.locator(INTERACT_FRAME).contentFrame().locator("#title"),
  ).toHaveText("Pricing screen");

  // Back to Home, then a relative file link to a different screen.
  await page.locator("[data-design-top-bar] button[aria-label='Back']").click();
  await expect(screen).toHaveText("Home");
  const home = page.locator(INTERACT_FRAME).contentFrame();
  await expect(home.locator("#title")).toHaveText("Home screen");
  await home.locator("#to-docs").click();
  await expect(screen).toHaveText("Docs");
  await expect(
    page.locator(INTERACT_FRAME).contentFrame().locator("#title"),
  ).toHaveText("Docs screen");

  // An in-page link stays on the screen and scrolls it, as in any page.
  await page.locator("[data-design-top-bar] button[aria-label='Back']").click();
  await expect(screen).toHaveText("Home");
  const again = page.locator(INTERACT_FRAME).contentFrame();
  await again.locator("#to-section").click();
  await expect(screen).toHaveText("Home");
  await expect
    .poll(() => again.locator("html").evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
});
