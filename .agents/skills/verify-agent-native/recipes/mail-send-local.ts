import type { DriveContext } from "../scripts/drive.ts";
import { fillCompose, resetCompose } from "./mail-compose-draft.ts";

export default async function run(ctx: DriveContext): Promise<void> {
  const { page } = ctx;
  const subject = ctx.params.subject ?? `Verify send ${Date.now()}`;

  await ctx.open("/inbox");
  await resetCompose(ctx);
  await page.getByRole("button", { name: "Compose email" }).click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page
    .getByText("Please add at least one recipient")
    .first()
    .waitFor({ timeout: 10_000 });
  ctx.note("send without recipient rejected");
  await page.getByRole("button", { name: "Close all drafts" }).click();

  await fillCompose(ctx, subject);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  // Send waits out a 10 s undo window before it commits.
  await page.getByText("Message sent.").first().waitFor({ timeout: 30_000 });
  await ctx.shot("message-sent-toast");

  const sent = await ctx.action("list-emails", {
    view: "sent",
    compact: "false",
  });
  if (!JSON.stringify(sent).includes(subject)) {
    throw new Error(`"${subject}" not in list-emails view=sent`);
  }

  await ctx.open("/sent");
  await page.getByText(subject).first().waitFor({ timeout: 15_000 });
  await ctx.shot("sent-view");
}
