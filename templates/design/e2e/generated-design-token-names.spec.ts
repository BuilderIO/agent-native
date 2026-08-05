import { expect, test, type Page } from "@playwright/test";

import { gotoEditor, readSeedDesignId } from "./helpers";

/**
 * Pins, in a real engine, the CSSOM behaviour the authored-colour walk exists
 * for: a `background` shorthand holding `var()` cannot be expanded, so the
 * `backgroundColor` longhand reads empty and is indistinguishable from unset.
 */
const SCREEN = `<!doctype html><html><head><style>
:root{--color-primary:#0f62fe;--cds-background-brand:var(--color-primary,#0f62fe);--cds-border-subtle-00:#e0e0e0}
.primary{background:var(--cds-background-brand);color:#fff;border:0;padding:12px 20px}
.card{border:1px solid var(--cds-border-subtle-00)}
</style></head><body>
  <main><button class="primary" type="button">Get started</button>
  <div class="card">Card</div></main>
</body></html>`;

async function action(page: Page, name: string, body: unknown) {
  const res = await page.request.post(`/_agent-native/actions/${name}`, {
    data: body,
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok()) {
    throw new Error(`${name}: ${res.status()} ${await res.text()}`);
  }
  return res.json();
}

test("a token in a background shorthand survives only outside the longhand", async ({
  page,
}) => {
  const designId = await readSeedDesignId();

  await page.goto("/design-systems");
  const kit = await action(page, "create-design-system", {
    templateId: "carbon-white",
  });
  await action(page, "update-design", { id: designId, designSystemId: kit.id });

  const snapshotRes = await page.request.get(
    `/_agent-native/actions/get-design-snapshot?designId=${designId}`,
  );
  const seed = await snapshotRes.json();
  await action(page, "update-file", {
    id: seed.files[0].id as string,
    content: SCREEN,
  });

  await gotoEditor(page, designId);

  // FrameLocator has no evaluate(); reach the real Frame via its element handle.
  const handle = await page
    .locator("iframe[data-design-preview-iframe]")
    .last()
    .elementHandle();
  const frame = await handle!.contentFrame();
  const facts = await frame!.evaluate(() => {
    const el = document.querySelector("button.primary");
    if (!el) return null;
    const found: Record<string, string> = {};
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules) as CSSStyleRule[]) {
        if (!rule.selectorText || !rule.style) continue;
        if (!el.matches(rule.selectorText)) continue;
        if (!rule.selectorText.includes("primary")) continue;
        found.longhand = rule.style.backgroundColor;
        found.shorthand = rule.style.background;
      }
    }
    found.inline = (el as HTMLElement).style.backgroundColor;
    found.computed = getComputedStyle(el).backgroundColor;

    const card = document.querySelector(".card")!;
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of Array.from(sheet.cssRules) as CSSStyleRule[]) {
        if (rule.selectorText !== ".card") continue;
        found.borderLonghand = rule.style.borderColor;
        found.borderShorthand = rule.style.border;
      }
    }
    found.borderComputed = getComputedStyle(card).borderColor;
    return found;
  });

  expect(facts).not.toBeNull();
  // Neither source names the token.
  expect(facts!.inline).toBe("");
  expect(facts!.longhand).toBe("");
  // Only the shorthand still carries it.
  expect(facts!.shorthand).toContain("var(--cds-background-brand)");
  expect(facts!.computed).toBe("rgb(15, 98, 254)");

  // Same trap for strokes, and why the border shorthand must be mined for its
  // colour component rather than skipped.
  expect(facts!.borderLonghand).toBe("");
  expect(facts!.borderShorthand).toContain("var(--cds-border-subtle-00)");
  expect(facts!.borderComputed).toBe("rgb(224, 224, 224)");
});
