import type { DriveContext } from "../scripts/drive.ts";

interface MailPreferences {
  tracking?: { opens?: boolean; clicks?: boolean };
}

export default async function run(ctx: DriveContext): Promise<void> {
  const { page } = ctx;
  await ctx.open("/settings/app/tracking");
  const opens = page.getByRole("switch", { name: "Track email opens" });
  const before = (await opens.getAttribute("aria-checked")) === "true";
  await opens.click();
  await page.waitForTimeout(1_500);

  const prefs = await ctx.action<MailPreferences>("get-mail-preferences");
  if (prefs.tracking?.opens !== !before) {
    throw new Error(
      `stored tracking.opens ${prefs.tracking?.opens}, expected ${!before}`,
    );
  }

  await ctx.open("/settings/app/tracking");
  if (((await opens.getAttribute("aria-checked")) === "true") !== !before) {
    throw new Error("Track email opens not kept after reload");
  }
  await ctx.shot("tracking-after-reload");

  await opens.click();
  await page.waitForTimeout(1_500);
}
