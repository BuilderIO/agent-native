import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import {
  dataBrowserHref,
  decodeScopedResourceId,
} from "../../app/components/workspace/DataPageAdapter.model.js";
import { actionHeaders, assertQaIdentity } from "./shared.js";

export async function checkDataFavoritesLive(page: Page, base: string) {
  await assertQaIdentity(page, base);
  const connectionId = "builtin-sample-data";
  const tableId = "table:sample:PUBLIC:customers";
  const input = { connectionId, tableId };
  const go = (path: string) =>
    page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  async function setFavorite(favorited: boolean) {
    const response = await page.request.post(
      `${base}/_agent-native/actions/set-data-favorite`,
      { headers: actionHeaders, data: { ...input, favorited } },
    );
    expect(response.ok(), `set-data-favorite: HTTP ${response.status()}`).toBe(
      true,
    );
  }
  async function favorites() {
    const response = await page.request.get(
      `${base}/_agent-native/actions/list-data-favorites`,
      { headers: actionHeaders },
    );
    expect(
      response.ok(),
      `list-data-favorites: HTTP ${response.status()}`,
    ).toBe(true);
    return z
      .object({
        favorites: z.array(
          z.object({ connectionId: z.string(), tableId: z.string() }),
        ),
      })
      .parse(await response.json()).favorites;
  }
  let primary: unknown;
  try {
    await setFavorite(false);
    await go(
      dataBrowserHref("all", { type: "table", id: tableId }, connectionId),
    );
    const star = page.getByRole("button", { name: "Add to favorites" });
    await expect(star).toBeEnabled({ timeout: 30_000 });
    await star.click();
    await expect(
      page.getByRole("button", { name: "Remove favorite" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect.poll(favorites).toContainEqual(expect.objectContaining(input));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Remove favorite" }),
    ).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    await go(dataBrowserHref("favorites"));
    await page.getByRole("button", { name: /customers/ }).click();
    await expect(
      page.getByRole("heading", { name: "customers", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole("columnheader", { name: "customer_id" }),
    ).toBeVisible();
    const segment = new URL(page.url()).pathname.split("/").at(-1);
    if (!segment) throw new Error("The table route has no resource id.");
    expect(decodeScopedResourceId(decodeURIComponent(segment))).toEqual({
      connectionId,
      kind: "table",
      resourceId: tableId,
    });
  } catch (error) {
    primary = error;
  }
  const cleanup: unknown[] = [];
  try {
    await go("/home");
  } catch (error) {
    cleanup.push(error);
  }
  try {
    await setFavorite(false);
    expect(await favorites()).not.toContainEqual(
      expect.objectContaining(input),
    );
  } catch (error) {
    cleanup.push(error);
  }
  if (primary !== undefined && cleanup.length)
    throw new AggregateError(
      [primary, ...cleanup],
      "DATA-FAVORITES and cleanup failed",
    );
  if (primary !== undefined) throw primary;
  if (cleanup.length)
    throw new AggregateError(cleanup, "DATA-FAVORITES cleanup failed");
}
