import { expect, test } from "./fixtures";
import { seedThread } from "./objects.helpers";

test("a saved thread opens inside the workspace while sidebar activity is held", async ({
  daily,
}, testInfo) => {
  const threadId = await seedThread(daily, "How many orders are there?");
  const page = await daily.context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  let release = () => {};
  let held = false;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    /\/_agent-native\/actions\/get-workspace-activity(?:\?|$)/,
    async (route) => {
      held = true;
      await wait;
      await route.fallback();
    },
  );
  try {
    await page.goto(`${daily.server.base}/thread/${threadId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page
        .getByRole("complementary", { name: "Workspace", exact: true })
        .getByRole("link", { name: "Home", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('article.agentkit-message[data-role="assistant"]').last(),
    ).toBeVisible({ timeout: 15_000 });
    expect(held).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("thread-held-shell.png"),
    });
    expect(errors).toEqual([]);
  } finally {
    release();
    await page.close();
    await daily.cleanupAction("delete-thread", { threadId });
  }
});
