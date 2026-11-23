import { expect, test, uniqueName } from "./fixtures";
import { createConnection, deleteConnections } from "./setup.helpers";

// Reference: 95ad76a3:2241–2259 (schema lists), 1741–1759 (table lists).
for (const [id, scenario, dataset, table] of [
  ["PROVIDER-01", "one", "single_table", "only_table"],
  ["PROVIDER-02", "many", "warehouse_many", "events_62"],
] as const) {
  test(`${id} browse ${scenario} table${scenario === "one" ? "" : "s across pages"}`, async ({
    daily,
  }) => {
    const name = uniqueName(`Provider ${scenario}`);
    try {
      await createConnection(daily, name);
      await daily.open("/home/data");
      await expect(
        daily.page.getByRole("heading", { name: "Data browser", exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(daily.page.getByText(name, { exact: true })).toBeVisible();
      await daily.click(daily.page.getByText(name, { exact: true }));
      await expect(
        daily.page.getByText(dataset, { exact: true }).first(),
      ).toBeVisible();
      await daily.click(daily.page.getByText(dataset, { exact: true }).first());
      if (scenario === "many") {
        for (const count of [50, 62]) {
          await daily.click(
            daily.page.getByRole("button", {
              name: "Load more...",
              exact: true,
            }),
          );
          await expect(
            daily.page.getByRole("columnheader", {
              name: new RegExp(`^Tables [(]${count}[)]$`, "i"),
            }),
          ).toBeVisible();
        }
      }
      const last = daily.page.getByText(table, { exact: true }).first();
      await expect(last).toBeVisible();
      await last.scrollIntoViewIfNeeded();
      await daily.click(last);
      await daily.click(daily.page.getByRole("tab", { name: /^Columns \(/ }));
      await expect(
        daily.page
          .getByText(scenario === "one" ? "id" : "event_id", { exact: true })
          .first(),
      ).toBeVisible();
      await daily.check({ url: /\/home\/data/ });
    } finally {
      await deleteConnections(daily, [name]);
    }
  });
}

test("PROVIDER-03 successful connection with no schemas is empty, never an error", async ({
  daily,
}) => {
  const name = uniqueName("Provider empty");
  try {
    await daily.scenario({ bigquery: "empty" });
    await createConnection(daily, name);
    await daily.open("/home/data");
    await expect(
      daily.page.getByRole("heading", { name: "Data browser", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(daily.page.getByText(name, { exact: true })).toBeVisible();
    await daily.click(daily.page.getByText(name, { exact: true }));
    await expect(
      daily.page.getByRole("status").filter({ hasText: "No schemas found" }),
    ).toBeVisible();
    await expect(
      daily.page.getByText(/Failed to load|Error loading/),
    ).toHaveCount(0);
    await daily.check({ url: /\/home\/data/ });
  } finally {
    await deleteConnections(daily, [name]);
  }
});

test("PROVIDER-04 an empty dataset has no tables, never a load error", async ({
  daily,
}) => {
  const name = uniqueName("Provider empty tables");
  try {
    await daily.scenario({ emptyDatasets: ["empty_dataset"] });
    await createConnection(daily, name);
    await daily.open("/home/data");
    await expect(
      daily.page.getByRole("heading", { name: "Data browser", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(daily.page.getByText(name, { exact: true })).toBeVisible();
    await daily.click(daily.page.getByText(name, { exact: true }));
    await expect(
      daily.page
        .getByRole("table")
        .getByRole("button", { name: "empty_dataset", exact: true }),
    ).toBeVisible();
    await daily.click(
      daily.page
        .getByRole("table")
        .getByRole("button", { name: "empty_dataset", exact: true }),
    );
    await expect(
      daily.page.getByText("No tables found", { exact: true }),
    ).toBeVisible();
    await daily.check({ url: /\/home\/data/ });
  } finally {
    await deleteConnections(daily, [name]);
  }
});
