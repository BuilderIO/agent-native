import { expect, test, type Page } from "@playwright/test";

import { gotoEditor, readSeedDesignId } from "./helpers";

/**
 * Carbon points `background-brand`, `border-interactive`, `link-primary`, and
 * `focus` all at #0F62FE, so value-matching cannot name a fill of that blue.
 * A picked token persists as `var(--…)`, which names itself.
 */
const AMBIGUOUS_TOKEN = "cds-link-primary";

/**
 * Select from the Layers tree: the canvas iframe's pointer-capturing shield is
 * unreliable under Playwright, and the inspector reacts identically either way.
 */
async function selectLayer(page: Page, name: string) {
  const search = page.getByPlaceholder("Search layers...");
  if (!(await search.isVisible().catch(() => false))) {
    await page
      .getByRole("button", { name: "Search layers...", exact: true })
      .click();
  }
  await search.fill(name);
  await page
    .getByRole("tree", { name: "Layers" })
    .locator("[data-layer-row-button][data-layer-node-id]")
    .filter({ has: page.locator(`span[title="${name}"]`) })
    .first()
    .click();
}

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

test("a picked design system token names the fill it came from", async ({
  page,
}) => {
  const designId = await readSeedDesignId();

  await page.goto("/design-systems");
  const kit = await action(page, "create-design-system", {
    templateId: "carbon-white",
  });
  await action(page, "update-design", { id: designId, designSystemId: kit.id });

  await gotoEditor(page, designId);

  await selectLayer(page, "E2E Hero Heading");

  const trigger = page
    .getByRole("button", { name: "Open color picker" })
    .first();
  await trigger.click();

  const popover = page
    .locator("[data-radix-popper-content-wrapper]")
    .filter({ hasText: "Design system" })
    .first();
  // The kit's vocabulary is listed by name, alongside the document palette.
  // toBeInViewport, not toBeVisible: the token list once pushed this heading
  // off-screen, where it was still "visible" to the DOM but unreachable.
  const documentColors = popover.getByText("Document colors");
  await documentColors.scrollIntoViewIfNeeded();
  await expect(documentColors).toBeInViewport();
  await expect(
    popover.getByRole("button", { name: AMBIGUOUS_TOKEN }),
  ).toBeVisible();

  await popover.getByRole("button", { name: AMBIGUOUS_TOKEN }).click();
  await expect(trigger).toContainText(AMBIGUOUS_TOKEN);

  // Selection colors reads the same authored declaration, so it must agree with
  // the Fill row rather than printing the hex the reference resolves to.
  // Not Escape: that reverts the hex input's draft to its last committed value
  // and blurs, which rolls the pick back before this assertion can see it.
  await trigger.click();
  await page
    .getByRole("button", { name: "Show selection colors" })
    .click()
    .catch(() => {});
  // Keyed by the raw declaration (its aria-label), so this can only match the
  // Selection colors row — not the still-mounted, hidden picker list.
  const selectionRow = page.getByRole("button", {
    name: `var(--${AMBIGUOUS_TOKEN}, #0f62fe)`,
  });
  await expect(selectionRow).toBeVisible();
  await expect(selectionRow).toContainText(AMBIGUOUS_TOKEN);
});
