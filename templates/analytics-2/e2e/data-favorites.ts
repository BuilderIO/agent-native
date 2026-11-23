import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import {
  dataBrowserHref,
  decodeScopedResourceId,
} from "../app/components/workspace/DataPageAdapter.model.js";

export async function checkDataFavorites(
  page: Page,
  base: string,
  options: {
    navigate?: (path: string) => Promise<void>;
    onVerified?: () => Promise<void>;
  } = {},
) {
  const navigate =
    options.navigate ??
    (async (path: string) => {
      await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    });
  const url = new URL(base);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.port !== "8105"
  )
    throw new Error("DATA-FAVORITES requires the isolated local fixture");
  const connectionId = "builtin-sample-data";
  const tableId = "table:sample:PUBLIC:customers";
  const input = { connectionId, tableId };
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  async function setFavorite(favorited: boolean) {
    const response = await page.request.post(
      `${base}/_agent-native/actions/set-data-favorite`,
      { headers, data: { ...input, favorited } },
    );
    expect(response.ok(), `set-data-favorite: HTTP ${response.status()}`).toBe(
      true,
    );
  }
  async function favorites() {
    const response = await page.request.get(
      `${base}/_agent-native/actions/list-data-favorites`,
      { headers },
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
  let primaryError: unknown;
  try {
    await setFavorite(false);
    await navigate(
      dataBrowserHref("all", { type: "table", id: tableId }, connectionId),
    );
    const star = page.getByRole("button", {
      name: "Add to favorites",
      exact: true,
    });
    await expect(star).toBeEnabled({ timeout: 30_000 });
    await star.click();
    await expect(
      page.getByRole("button", { name: "Remove favorite", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect.poll(favorites).toContainEqual(expect.objectContaining(input));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "Remove favorite", exact: true }),
    ).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    await navigate(dataBrowserHref("favorites"));
    await page.getByRole("button", { name: "customers", exact: true }).click();
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
    await options.onVerified?.();
  } catch (error) {
    primaryError = error;
  }
  const cleanupErrors: unknown[] = [];
  try {
    await navigate("/home");
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await setFavorite(false);
    expect(await favorites()).not.toContainEqual(
      expect.objectContaining(input),
    );
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (primaryError !== undefined && cleanupErrors.length)
    throw new AggregateError(
      [primaryError, ...cleanupErrors],
      "DATA-FAVORITES and cleanup failed",
    );
  if (primaryError instanceof Error) throw primaryError;
  if (primaryError !== undefined)
    throw new AggregateError([primaryError], "DATA-FAVORITES check failed");
  if (cleanupErrors.length)
    throw new AggregateError(cleanupErrors, "DATA-FAVORITES cleanup failed");
}
