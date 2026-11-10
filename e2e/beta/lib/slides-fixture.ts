import { expect, type Page } from "@playwright/test";

export async function deleteTestDeckThroughUi(
  page: Page,
  origin: string,
  deckId: string,
  deckTitle: string,
): Promise<void> {
  const readUrl = `${origin}/_agent-native/actions/get-deck?id=${encodeURIComponent(deckId)}&compact=true`;
  const before = await page.request.get(readUrl);
  expect(before.ok(), "The exact test deck must exist before UI cleanup").toBe(
    true,
  );
  await page.goto(`${origin}/home`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page
    .getByRole("searchbox", { name: "Search decks", exact: true })
    .fill(deckTitle);
  const link = page.locator(`a[href="/deck/${deckId}"]`);
  await expect(link).toContainText(deckTitle);
  const card = page
    .locator(".agent-template-library-card")
    .filter({ has: link });
  await card.hover();
  await card.getByRole("button", { name: "Deck options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("alertdialog", {
    name: "Delete Deck?",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(link).toHaveCount(0);
  // A disappearing optimistic card alone does not prove persisted cleanup.
  await expect
    .poll(async () => {
      const response = await page.request.get(readUrl);
      return response.status();
    })
    .toBe(404);
}
