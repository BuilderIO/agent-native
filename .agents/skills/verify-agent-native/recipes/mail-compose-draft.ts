import type { DriveContext } from "../scripts/drive.ts";

// Open compose windows persist in application state and reopen on load, so a
// failed earlier run can leave one behind.
export async function resetCompose(ctx: DriveContext): Promise<void> {
  const closeAll = ctx.page.getByRole("button", { name: "Close all drafts" });
  if (await closeAll.isVisible()) {
    await closeAll.click();
    await closeAll.waitFor({ state: "hidden" });
  }
}

export async function fillCompose(
  ctx: DriveContext,
  subject: string,
  to = "qa@example.test",
): Promise<void> {
  const { page } = ctx;
  await page.getByRole("button", { name: "Compose email" }).click();
  const recipients = page.getByRole("combobox", { name: "To recipients" });
  await recipients.fill(to);
  await recipients.press("Enter");
  await page.getByRole("textbox", { name: "Subject" }).fill(subject);
  await page
    .locator('[contenteditable="true"].compose-editor')
    .fill(`Body for ${subject}`);
}

export default async function run(ctx: DriveContext): Promise<void> {
  const { page } = ctx;
  const subject = ctx.params.subject ?? `Verify draft ${Date.now()}`;

  await ctx.open("/inbox");
  await resetCompose(ctx);
  await fillCompose(ctx, subject);
  // The mailbox copy autosaves 3 s after the last edit; closing also saves.
  await page.waitForTimeout(3_500);
  await ctx.shot("compose-filled");
  await page.getByRole("button", { name: "Close all drafts" }).click();

  const drafts = await ctx.action("list-emails", {
    view: "drafts",
    compact: "false",
  });
  if (!JSON.stringify(drafts).includes(subject)) {
    throw new Error(`draft "${subject}" not in list-emails view=drafts`);
  }

  await ctx.open("/drafts");
  if (
    await page
      .getByRole("heading", { name: "Connect your Google account" })
      .isVisible()
  ) {
    throw new Error("local draft did not lift the Connect Google gate");
  }
  await page.getByText(subject).first().click();
  const reopened = page.getByRole("textbox", { name: "Subject" });
  await reopened.waitFor({ timeout: 15_000 });
  if ((await reopened.inputValue()) !== subject) {
    throw new Error(
      `reopened draft subject is "${await reopened.inputValue()}"`,
    );
  }
  await ctx.shot("draft-reopened");
  await page.getByRole("button", { name: "Close all drafts" }).click();
}
