import type { DriveContext } from "../scripts/drive.ts";

export default async function run(ctx: DriveContext): Promise<void> {
  const { page } = ctx;
  const subject = ctx.params.subject ?? `Verify queued draft ${Date.now()}`;

  await ctx.open("/draft-queue");
  await page.getByRole("button", { name: "New draft request" }).click();
  const dialog = page.getByRole("dialog", { name: "Queue a draft" });
  const submit = dialog.getByRole("button", { name: "Queue a draft" });
  // Only To has a placeholder; the rest are unlabeled, in order: To, Cc, Bcc, Subject, Draft, Context.
  const boxes = dialog.getByRole("textbox");
  await dialog
    .getByPlaceholder("recipient@example.com")
    .fill("customer@example.test");
  await boxes.nth(3).fill(subject);
  if (await submit.isEnabled())
    throw new Error("submit enabled without a draft body");
  await boxes.nth(4).fill(`Draft body for ${subject}`);
  await boxes.nth(5).fill("Context for the reviewer");
  await ctx.shot("queue-form-filled");
  await submit.click();
  await dialog.waitFor({ state: "hidden", timeout: 15_000 });

  await page.getByText(subject).first().waitFor({ timeout: 15_000 });
  await ctx.shot("queue-listed");

  const queued = await ctx.action("list-queued-drafts", {
    scope: "review",
    status: "active",
  });
  if (!JSON.stringify(queued).includes(subject)) {
    throw new Error(`"${subject}" not in list-queued-drafts scope=review`);
  }

  await page.getByText(subject).first().click();
  await page
    .getByText("Context for the reviewer")
    .first()
    .waitFor({ timeout: 15_000 });
  await ctx.shot("queue-detail");
}
