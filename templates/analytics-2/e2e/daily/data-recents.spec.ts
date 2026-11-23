import {
  dataBrowserHref,
  decodeScopedResourceId,
} from "../../app/components/workspace/DataPageAdapter.model";
import { expect, test } from "./fixtures";

test("report1794912417.197639 Recommended tab loads and survives reload", async ({
  daily,
}) => {
  await daily.open(dataBrowserHref("all"));
  const recommended = daily.page.getByRole("tab", { name: "Recommended" });
  await recommended.click();
  await expect(daily.page).toHaveURL(/\/home\/data\/recommended$/);
  await expect(recommended).toHaveAttribute("aria-selected", "true");
  const panel = daily.page.getByRole("tabpanel", { name: "Recommended" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Recently used", { exact: true })).toBeVisible();

  await daily.reload();
  await expect(daily.page).toHaveURL(/\/home\/data\/recommended$/);
  await expect(recommended).toHaveAttribute("aria-selected", "true");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Recently used", { exact: true })).toBeVisible();

  await daily.page.getByRole("tab", { name: "Warehouse" }).click();
  await expect(daily.page).toHaveURL(/\/home\/data\/all$/);
  await expect(
    daily.page.getByRole("tabpanel", { name: "Warehouse" }),
  ).toBeVisible();
  await daily.check();
});

test("report 1794912417.197639 and 807: recent tables persist and open the selected table", async ({
  daily,
}) => {
  const connectionId = "builtin-sample-data";
  const first = "table:sample:PUBLIC:customers";
  const second = "table:sample:PUBLIC:products";
  for (const [tableId, name] of [
    [first, "customers"],
    [second, "products"],
    [first, "customers"],
  ] as const) {
    await daily.open(
      dataBrowserHref("all", { type: "table", id: tableId }, connectionId),
    );
    await expect(
      daily.page.getByRole("heading", { name, exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        async () =>
          (
            await daily.action<{ recents: Array<{ tableId: string }> }>(
              "list-data-recents",
              {},
              "GET",
            )
          ).recents[0]?.tableId,
      )
      .toBe(tableId);
  }
  await daily.open(dataBrowserHref("recently-used"));
  await daily.reload();
  const rows = daily.page.locator(".data-secondary-rows > li");
  await expect(rows.first()).toContainText("customers", { timeout: 30_000 });
  await expect(rows.nth(1)).toContainText("products");
  await daily.page.screenshot({
    path: ".tmp/analytics-owner/data-recents.png",
    fullPage: true,
  });
  await rows
    .nth(1)
    .getByRole("button", { name: /products/ })
    .click();
  await expect(
    daily.page.getByRole("heading", { name: "products", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const segment = new URL(daily.page.url()).pathname.split("/").at(-1);
  if (!segment) throw new Error("The table route has no resource id.");
  expect(decodeScopedResourceId(decodeURIComponent(segment))).toEqual({
    connectionId,
    kind: "table",
    resourceId: second,
  });
  await daily.check();
});

test("report 807: a failed recents read can be retried", async ({ daily }) => {
  const path = /\/_agent-native\/actions\/list-data-recents(?:\?|$)/;
  daily.allowResponse.push(path);
  await daily.page.route(path, (route) =>
    route.fulfill({ status: 400, json: { error: "forced failure" } }),
  );
  await daily.open(dataBrowserHref("recently-used"));
  await expect(daily.page.getByRole("alert")).toContainText(
    "Error loading recently used",
  );
  await daily.page.unroute(path);
  await daily.page.getByRole("button", { name: "Retry" }).click();
  await expect(daily.page.getByRole("alert")).not.toBeVisible();
  await daily.check();
});
