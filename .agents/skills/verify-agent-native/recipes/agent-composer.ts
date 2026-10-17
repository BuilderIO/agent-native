import type { DriveContext } from "../scripts/drive.ts";

export default async function run(ctx: DriveContext): Promise<void> {
  const { page } = ctx;
  await ctx.open(ctx.params.path ?? "/forms");

  const composer = page.getByRole("textbox", { name: "Message agent..." });
  if (!(await composer.isVisible())) {
    await page.getByRole("button", { name: "Toggle agent" }).first().click();
  }
  await composer.waitFor({ timeout: 15_000 });
  // Until engine status loads the composer is disabled under a placeholder model
  // name; wait for it to settle into either the Connect AI card or enabled.
  const connectCta = page.getByRole("button", { name: "Use Builder.io" });
  const enabledComposer = page.getByRole("textbox", {
    name: "Message agent...",
    disabled: false,
  });
  await connectCta.or(enabledComposer).first().waitFor({ timeout: 30_000 });

  const needsConnect = await connectCta.isVisible();
  const enabled = await composer.isEnabled();
  ctx.note(
    `${needsConnect ? "Connect AI card shown" : "no Connect AI card"}, composer ${enabled ? "enabled" : "disabled"}`,
  );
  if (needsConnect === enabled) {
    throw new Error(
      `Connect AI card ${needsConnect ? "shown" : "absent"} but composer ${enabled ? "enabled" : "disabled"}`,
    );
  }
  await ctx.shot("agent-composer");
}
