import { checkVersionHistoryRestore } from "../version-history-flow";
import { test } from "./fixtures";

test("report FLOW-version-history-restore", async ({ daily }) => {
  test.setTimeout(90_000);
  await daily.open("/home");
  const page = await daily.context.newPage();
  try {
    await checkVersionHistoryRestore(page, daily.server.base);
  } finally {
    await page.close();
  }
});
