import {
  open,
  runWithKeyboard,
  seed,
  stored,
  trashProject,
  waitForOutput,
} from "./dash.helpers";
import { expect, test } from "./fixtures";
import { cellAt, SAMPLE_CONNECTION } from "./notebook.helpers";

test("report 1794948257.991429: saved sample source stays named when the connection list is unavailable", async ({
  daily,
}) => {
  const project = await seed(daily, [
    {
      kind: "sql",
      text: "select * from orders limit 3",
      connection: SAMPLE_CONNECTION,
    },
  ]);
  let intercepted = 0;
  const pattern = "**/_agent-native/actions/list-data-connections*";
  await daily.page.route(pattern, async (route) => {
    intercepted++;
    await route.fulfill({ status: 200, json: { connections: [] } });
  });
  try {
    await open(daily, project);
    const cell = cellAt(daily.page, 0);
    const source = cell.getByRole("button", {
      name: "Data connection: [Demo] Public Data",
    });
    await expect(source).toBeVisible();
    expect(intercepted).toBeGreaterThan(0);
    await expect(
      cell.getByRole("button", { name: "Data connection: Unknown connection" }),
    ).toHaveCount(0);
    await runWithKeyboard(daily, 0);
    await waitForOutput(daily.page, 0);
    await expect(cell.locator("tbody tr")).toHaveCount(3);
    expect((await stored(daily, project.id))[0]?.dataConnectionId).toBe(
      SAMPLE_CONNECTION,
    );
    await daily.reload();
    await expect(source).toBeVisible();
    await expect(cell.locator("tbody tr")).toHaveCount(3);
    await daily.page.screenshot({
      path: ".tmp/analytics-owner/sample-source-corrected.png",
    });
  } finally {
    await daily.page.unroute(pattern);
    await trashProject(daily, project.id);
  }
});
