import { checkInputMenu } from "../input-menu";
import { checkPublishDashboard } from "../predicted-notebook-flows";
import { expect, test } from "./fixtures";

test("report 1795066971 input menu anchors and creates a persistent input", async ({
  daily,
}) => {
  let navigations = 0;
  daily.page.on("domcontentloaded", () => navigations++);
  await checkInputMenu(daily.page, daily.server.base);
  expect(navigations).toBe(3); // Open the project, reload it, and return home for cleanup.
  await daily.open("/home");
  await daily.check();
});

test("publish dashboard selected flow", async ({ daily }) => {
  let navigations = 0;
  daily.page.on("domcontentloaded", () => navigations++);
  await checkPublishDashboard(daily.page, daily.server.base);
  expect(navigations).toBe(3); // Open the project, open the published app, and return home.
  await daily.open("/home");
  await daily.check();
});
