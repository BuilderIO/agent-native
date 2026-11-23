import { expect, test } from "./fixtures";

test("SMOKE-01 home loads clean with the composer and recents", async ({
  daily,
}) => {
  await daily.open("/home");
  await expect(
    daily.page.getByText("JUMP BACK IN", { exact: false }).first(),
  ).toBeVisible({ timeout: 30_000 });
  await daily.check({ url: /\/home$/ });
});
