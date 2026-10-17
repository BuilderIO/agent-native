import type { DriveContext } from "../scripts/drive.ts";

export default async function run(ctx: DriveContext): Promise<void> {
  const { page } = ctx;
  await ctx.open(ctx.params.path ?? "/");
  if (await page.getByText(/is not ready yet/).isVisible()) {
    throw new Error(
      `gateway reports the app is not ready: ${await page.locator("body").innerText()}`,
    );
  }
  await page.getByRole("main").first().waitFor({ timeout: 30_000 });
  const url = new URL(page.url());
  if (!url.href.startsWith(ctx.base)) {
    throw new Error(`landed outside the app base: ${url.href}`);
  }
  ctx.note(`landed on ${url.pathname} titled "${await page.title()}"`);
  await ctx.shot("gateway-app");
}
