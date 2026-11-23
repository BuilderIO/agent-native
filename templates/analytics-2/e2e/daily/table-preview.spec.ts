import { dataBrowserHref } from "../../app/components/workspace/DataPageAdapter.model";
import { expect, test } from "./fixtures";

test("report A2-DATA-TABLE-PREVIEW TABLE-PREVIEW sample rows refresh and follow the selected table", async ({
  daily,
}) => {
  const path = (name: string) =>
    dataBrowserHref(
      "all",
      { type: "table", id: `table:sample:PUBLIC:${name}` },
      "builtin-sample-data",
    );
  await daily.open(path("customers"));
  const panel = daily.page.getByRole("tabpanel");
  await expect(
    panel.getByRole("columnheader", { name: "customer_id" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(panel.locator("tbody tr")).toHaveCount(12);
  const refresh = panel.getByRole("button", {
    name: "Click to refresh preview data",
  });
  const response = daily.page.waitForResponse(
    (value) =>
      value.url().includes("/actions/get-data-table-preview") && value.ok(),
  );
  await refresh.click();
  await response;
  await expect(panel.locator("tbody tr")).toHaveCount(12);
  await daily.open(path("products"));
  await expect(
    panel.getByRole("columnheader", { name: "product_id" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    panel.getByRole("columnheader", { name: "customer_id" }),
  ).toHaveCount(0);
  await daily.check();
});
