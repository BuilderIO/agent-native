import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  MOD,
  indexHtml,
  newDesign,
  node,
  openEditor,
  postAction,
  setBaseURL,
} from "./drag-and-drop.shared";

test.use({ viewport: { width: 1600, height: 1000 } });
test.beforeEach(async ({}, info) => setBaseURL(info));

const FIXTURE = `<!doctype html><html><body style="margin:0;min-height:900px;background:#111827">
  <div data-agent-native-node-id="source" data-agent-native-layer-name="Source" style="position:absolute;left:80px;top:520px;width:220px;height:96px;background:#f97316">Source</div>
  <section data-agent-native-node-id="outer" data-agent-native-layer-name="Outer" style="position:absolute;left:500px;top:120px;width:340px;height:260px;padding:16px;display:flex;flex-direction:column;gap:12px;background:#334155">
    <section data-agent-native-node-id="nested" data-agent-native-layer-name="Nested" data-an-primitive="frame" style="flex:0 0 120px;width:120px;height:120px;display:flex;flex-direction:column;gap:8px;padding:8px;background:#64748b">
      <div data-agent-native-node-id="anchor" data-agent-native-layer-name="Anchor" style="flex:0 0 32px;width:80px;height:32px;background:#94a3b8">Anchor</div>
    </section>
  </section>
</body></html>`;

// Scoped to [data-screen-iframe-id] like node() (drag-and-drop.shared.ts): a
// live board surface can mount ahead of the screen iframe around a drag, and
// an unscoped .first() can then resolve to that board document instead.
function body(page: Page): Locator {
  return page
    .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
    .first()
    .contentFrame()
    .locator("body");
}

// Editor-chrome overlays (insertion guide, selection handles, etc.) mount on
// a host appended to <html>, not <body> (editor-chrome.bridge.ts's
// ensureEditorChromeHost, since 8330dc0873 made the chrome host survive
// hydration/body replacement) — a body()-scoped locator can never match one.
// Scoped to [data-screen-iframe-id] like node() (drag-and-drop.shared.ts):
// a live board surface mounts ahead of screen iframes once a drag starts, so
// the unscoped selector's .first() can resolve to the board iframe mid-drag,
// which paints no insertion guide at all.
function frameRoot(page: Page) {
  return page
    .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
    .first()
    .contentFrame();
}

async function guide(page: Page) {
  return frameRoot(page)
    .locator("[data-agent-native-insertion-guide]")
    .evaluateAll(
      (els) =>
        els
          .map((el) => {
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return {
              display: s.display,
              width: r.width,
              height: r.height,
              borderTop: s.borderTopColor,
              borderLeft: s.borderLeftColor,
            };
          })
          .find(
            (x) =>
              x.display !== "none" &&
              (x.width > 0 || x.height > 0) &&
              (x.borderTop !== "rgba(0, 0, 0, 0)" ||
                x.borderLeft !== "rgba(0, 0, 0, 0)"),
          ) ?? null,
    );
}

async function drag(
  page: Page,
  id: string,
  target: Locator,
  modifier?: "Meta" | "Control",
  requireGuide = true,
) {
  const source = (await node(page, id).boundingBox())!;
  const targetBox = (await target.boundingBox())!;
  if (modifier) await page.keyboard.down(modifier);
  try {
    await page.mouse.move(
      source.x + source.width / 2,
      source.y + source.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      source.x + source.width / 2 + 12,
      source.y + source.height / 2 + 8,
      { steps: 6 },
    );
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2,
      { steps: 24 },
    );
    const held = await guide(page);
    if (requireGuide) expect(held).toBeTruthy();
    await page.mouse.up();
    return held;
  } finally {
    if (modifier) await page.keyboard.up(modifier);
  }
}

async function cleanup(page: Page, id: string) {
  await postAction(page, "delete-design", { id }).catch(() => {});
}

test("default oversized drop rejects nested insertion", async ({ page }) => {
  const id = await newDesign(page, FIXTURE);
  try {
    await openEditor(page, id);
    await page
      .getByRole("tree", { name: "Layers" })
      .getByRole("button", { name: "Source", exact: true })
      .first()
      .click({ force: true });
    const target = node(page, "nested");
    const before = await indexHtml(page, id);
    await drag(page, "source", target, undefined, false);
    await expect
      .poll(() => indexHtml(page, id), { timeout: 5_000 })
      .not.toBe(before);
    await openEditor(page, id);
    await expect(
      body(page).locator(
        '[data-agent-native-node-id="nested"] [data-agent-native-node-id="source"]',
      ),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        body(page)
          .locator('[data-agent-native-node-id="source"]')
          .evaluate(
            (el) =>
              el.parentElement?.getAttribute("data-agent-native-node-id") ??
              el.parentElement?.tagName,
          ),
      )
      .not.toBe("nested");
  } finally {
    await cleanup(page, id);
  }
});

test("primary modifier oversized drop inserts into nested flow with held blue indicator", async ({
  page,
}) => {
  const id = await newDesign(page, FIXTURE);
  try {
    await openEditor(page, id);
    await page
      .getByRole("tree", { name: "Layers" })
      .getByRole("button", { name: "Source", exact: true })
      .first()
      .click({ force: true });
    const held = await drag(page, "source", node(page, "nested"), MOD);
    expect(held).toBeDefined();
    await expect(
      body(page).locator(
        '[data-agent-native-node-id="nested"] [data-agent-native-node-id="source"]',
      ),
    ).toHaveCount(1);
    await expect
      .poll(() =>
        body(page)
          .locator('[data-agent-native-node-id="source"]')
          .evaluate((el) => ({
            parent: el.parentElement?.getAttribute("data-agent-native-node-id"),
            position: getComputedStyle(el).position,
          })),
      )
      .toEqual({ parent: "nested", position: "static" });
    // Inline-source structural edits are pending until the guarded Apply handoff.
    await expect
      .poll(() => indexHtml(page, id), { timeout: 5_000 })
      .toContain('data-agent-native-node-id="source"');
  } finally {
    await cleanup(page, id);
  }
});
