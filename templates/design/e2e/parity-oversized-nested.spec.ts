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
    <section data-agent-native-node-id="nested" data-agent-native-layer-name="Nested" data-an-primitive="frame" style="flex:0 0 160px;width:180px;height:160px;display:flex;flex-direction:column;gap:8px;padding:8px;background:#64748b">
      <div data-agent-native-node-id="anchor" data-agent-native-layer-name="Anchor" style="flex:0 0 32px;width:80px;height:32px;background:#94a3b8">Anchor</div>
    </section>
  </section>
</body></html>`;

const NESTED_PLAIN_FRAME_FIXTURE = `<!doctype html><html><body style="margin:0;min-height:900px;background:#111827">
  <div data-agent-native-node-id="source" data-agent-native-layer-name="Source" style="position:absolute;left:80px;top:520px;width:220px;height:96px;background:#f97316">Source</div>
  <section data-agent-native-node-id="outer" data-agent-native-layer-name="Outer" style="position:absolute;left:500px;top:120px;width:420px;height:320px;padding:16px;display:flex;flex-direction:column;gap:12px;background:#334155">
    <section data-agent-native-node-id="middle" data-agent-native-layer-name="Middle" data-an-primitive="frame" style="position:relative;flex:0 0 180px;width:180px;height:180px;background:#475569">
      <section data-agent-native-node-id="nested" data-agent-native-layer-name="Nested" data-an-primitive="frame" style="position:relative;width:140px;height:140px;background:#64748b">
        <div data-agent-native-node-id="anchor" data-agent-native-layer-name="Anchor" style="position:absolute;left:12px;top:12px;width:60px;height:32px;background:#94a3b8">Anchor</div>
      </section>
    </section>
  </section>
</body></html>`;

const STATIC_SECTION_FIXTURE = `<!doctype html><html><body style="margin:0;min-height:900px;position:relative;background:#111827">
  <div data-agent-native-node-id="source" data-agent-native-layer-name="Source" style="position:absolute;left:80px;top:520px;width:220px;height:96px;background:#f97316">Source</div>
  <section data-agent-native-node-id="static" data-agent-native-layer-name="Static Section" style="width:480px;height:320px;padding:16px;background:#334155">
    <section data-agent-native-node-id="nested" data-agent-native-layer-name="Nested" data-an-primitive="frame" style="position:relative;width:140px;height:140px;background:#64748b">
      <div data-agent-native-node-id="anchor" data-agent-native-layer-name="Anchor" style="position:absolute;left:12px;top:12px;width:60px;height:32px;background:#94a3b8">Anchor</div>
    </section>
  </section>
</body></html>`;

function body(page: Page): Locator {
  return page
    .locator("iframe[data-design-preview-iframe][data-screen-iframe-id]")
    .first()
    .contentFrame()
    .locator("body");
}

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
              left: r.left,
              top: r.top,
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
  beforeRelease?: (
    held: Awaited<ReturnType<typeof guide>>,
  ) => void | Promise<void>,
  targetPosition?: { xRatio?: number; yRatio?: number },
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
      targetBox.x + targetBox.width * (targetPosition?.xRatio ?? 0.5),
      targetBox.y + targetBox.height * (targetPosition?.yRatio ?? 0.5),
      { steps: 24 },
    );
    const held = await guide(page);
    if (requireGuide) expect(held).toBeTruthy();
    await beforeRelease?.(held);
    await page.mouse.up();
    return held;
  } finally {
    if (modifier) await page.keyboard.up(modifier);
  }
}

async function cleanup(page: Page, id: string) {
  await postAction(page, "delete-design", { id }).catch(() => {});
}

test("width-only oversized drop previews the outer fallback insertion slot", async ({
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
    const target = node(page, "nested");
    const sizeGate = await body(page).evaluate((frameBody) => {
      const source = frameBody.querySelector<HTMLElement>(
        '[data-agent-native-node-id="source"]',
      )!;
      const nested = frameBody.querySelector<HTMLElement>(
        '[data-agent-native-node-id="nested"]',
      )!;
      const sourceRect = source.getBoundingClientRect();
      const nestedRect = nested.getBoundingClientRect();
      const nestedStyle = getComputedStyle(nested);
      return {
        sourceWidth: sourceRect.width,
        sourceHeight: sourceRect.height,
        nestedLeft: nestedRect.left,
        nestedTop: nestedRect.top,
        nestedWidth: nestedRect.width,
        nestedContentWidth:
          nestedRect.width -
          Number.parseFloat(nestedStyle.paddingLeft) -
          Number.parseFloat(nestedStyle.paddingRight),
        nestedContentHeight:
          nestedRect.height -
          Number.parseFloat(nestedStyle.paddingTop) -
          Number.parseFloat(nestedStyle.paddingBottom),
      };
    });
    expect(sizeGate.sourceWidth).toBeGreaterThan(sizeGate.nestedContentWidth);
    expect(sizeGate.sourceHeight).toBeLessThanOrEqual(
      sizeGate.nestedContentHeight,
    );
    const sourceParentBefore = await body(page)
      .locator('[data-agent-native-node-id="source"]')
      .evaluate(
        (el) =>
          el.parentElement?.getAttribute("data-agent-native-node-id") ??
          el.parentElement?.tagName,
      );
    const before = await indexHtml(page, id);
    await drag(
      page,
      "source",
      target,
      undefined,
      true,
      async (held) => {
        expect(held).toBeTruthy();
        expect(held?.height).toBeLessThan(16);
        expect(held?.width).toBeGreaterThan(sizeGate.nestedWidth - 2);
        expect(Math.abs(held!.left - sizeGate.nestedLeft)).toBeLessThan(2);
        expect(
          Math.abs(held!.top + held!.height / 2 - sizeGate.nestedTop),
        ).toBeLessThan(3);
        expect(await indexHtml(page, id)).toBe(before);
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
          .toBe(sourceParentBefore);
        await expect(
          body(page).locator(
            '[data-agent-native-node-id="nested"] [data-agent-native-node-id="source"]',
          ),
        ).toHaveCount(0);
      },
      { xRatio: 0.5, yRatio: 0.25 },
    );
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
      .toBe("outer");
    await expect
      .poll(() =>
        body(page)
          .locator('[data-agent-native-node-id="outer"]')
          .evaluate((outer) =>
            Array.from(outer.children).map((child) =>
              child.getAttribute("data-agent-native-node-id"),
            ),
          ),
      )
      .toEqual(["source", "nested"]);
  } finally {
    await cleanup(page, id);
  }
});

test("oversized drop from nested plain frames previews and lands in nearest fitting ancestor", async ({
  page,
}) => {
  const id = await newDesign(page, NESTED_PLAIN_FRAME_FIXTURE);
  try {
    await openEditor(page, id);
    await page
      .getByRole("tree", { name: "Layers" })
      .getByRole("button", { name: "Source", exact: true })
      .first()
      .click({ force: true });
    const before = await indexHtml(page, id);
    await drag(
      page,
      "source",
      node(page, "nested"),
      undefined,
      true,
      async (held) => {
        expect(held).toBeTruthy();
        expect(held?.height).toBeLessThan(16);
        expect(await indexHtml(page, id)).toBe(before);
      },
    );
    await expect
      .poll(() => indexHtml(page, id), { timeout: 5_000 })
      .not.toBe(before);
    await openEditor(page, id);
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
      .toBe("outer");
    await expect(
      body(page).locator(
        '[data-agent-native-node-id="middle"] [data-agent-native-node-id="source"]',
      ),
    ).toHaveCount(0);
  } finally {
    await cleanup(page, id);
  }
});

test("oversized drop leaves a fitting static section without a valid ancestor", async ({
  page,
}) => {
  const id = await newDesign(page, STATIC_SECTION_FIXTURE);
  try {
    await openEditor(page, id);
    await page
      .getByRole("tree", { name: "Layers" })
      .getByRole("button", { name: "Source", exact: true })
      .first()
      .click({ force: true });
    const before = await indexHtml(page, id);
    const expectedDropPosition = await body(page).evaluate((frameBody) => {
      const source = frameBody.querySelector(
        '[data-agent-native-node-id="source"]',
      )!;
      const target = frameBody.querySelector(
        '[data-agent-native-node-id="nested"]',
      )!;
      const sourceRect = source.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const startLeft = Number.parseFloat((source as HTMLElement).style.left);
      const startTop = Number.parseFloat((source as HTMLElement).style.top);
      return {
        left:
          targetRect.left +
          targetRect.width / 2 -
          (sourceRect.left + sourceRect.width / 2 - startLeft),
        top:
          targetRect.top +
          targetRect.height / 2 -
          (sourceRect.top + sourceRect.height / 2 - startTop),
      };
    });
    await drag(
      page,
      "source",
      node(page, "nested"),
      undefined,
      false,
      async (held) => {
        expect(held).toBeNull();
        expect(await indexHtml(page, id)).toBe(before);
      },
    );
    await openEditor(page, id);
    const persistedPosition = await body(page)
      .locator('[data-agent-native-node-id="source"]')
      .evaluate((el) => ({
        parentTag: el.parentElement?.tagName,
        left: Number.parseFloat((el as HTMLElement).style.left),
        top: Number.parseFloat((el as HTMLElement).style.top),
      }));
    expect(persistedPosition.parentTag).toBe("BODY");
    expect(
      Math.abs(persistedPosition.left - expectedDropPosition.left),
    ).toBeLessThan(8);
    expect(
      Math.abs(persistedPosition.top - expectedDropPosition.top),
    ).toBeLessThan(8);
    await expect(
      body(page).locator(
        '[data-agent-native-node-id="static"] [data-agent-native-node-id="source"]',
      ),
    ).toHaveCount(0);
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
    await expect
      .poll(() => indexHtml(page, id), { timeout: 5_000 })
      .toContain('data-agent-native-node-id="source"');
  } finally {
    await cleanup(page, id);
  }
});
