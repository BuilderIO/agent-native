import type { DriveContext } from "../scripts/drive.ts";
import { fillCompose, resetCompose } from "./mail-compose-draft.ts";

export default async function run(ctx: DriveContext): Promise<void> {
  const { page } = ctx;
  const subject = ctx.params.subject ?? `Verify schedule ${Date.now()}`;

  await ctx.open("/inbox");
  await resetCompose(ctx);
  await fillCompose(ctx, subject);
  await page.getByRole("button", { name: "Schedule send" }).click();
  const picker = page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Date and time" });
  await picker.waitFor();
  await ctx.shot("schedule-picker");
  await page.getByRole("option", { name: /^Tomorrow morning/ }).click();
  await page
    .getByRole("button", { name: "Close all drafts" })
    .waitFor({ state: "hidden", timeout: 15_000 });

  const jobs = await ctx.action("list-scheduled-jobs");
  if (!JSON.stringify(jobs).includes(subject)) {
    throw new Error(`"${subject}" not in list-scheduled-jobs`);
  }

  await ctx.open("/scheduled");
  await page.getByText(subject).first().waitFor({ timeout: 15_000 });
  await ctx.shot("scheduled-view");
}
