import type { DriveContext } from "../scripts/drive.ts";

// Needs an instance with no Gmail account and no local mailbox data; any
// compose/send recipe run first will lift the gate.
export default async function run(ctx: DriveContext): Promise<void> {
  const { page } = ctx;
  const hero = page.getByRole("heading", {
    name: "Connect your Google account",
  });

  for (const view of ["/inbox", "/sent", "/drafts"]) {
    await ctx.open(view);
    await hero.waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "Connect Google" }).waitFor();
  }
  await ctx.shot("gate-hero");

  await ctx.open("/settings/app/drafting");
  if (await hero.isVisible()) throw new Error("settings is gated");
  await page
    .getByRole("switch", { name: "Autocomplete" })
    .waitFor({ timeout: 20_000 });
  await ctx.shot("settings-exempt");

  await ctx.open("/draft-queue");
  if (await hero.isVisible()) throw new Error("draft queue is gated");
  await page
    .getByRole("heading", { name: "Draft queue" })
    .first()
    .waitFor({ timeout: 20_000 });
  await ctx.shot("draft-queue-exempt");

  await ctx.open("/definitely-not-a-view");
  await page.getByText("Page not found").waitFor({ timeout: 20_000 });
  await page
    .getByRole("link", { name: "Go to Inbox" })
    .or(page.getByRole("button", { name: "Go to Inbox" }))
    .first()
    .waitFor();
  await ctx.shot("not-found");
}
