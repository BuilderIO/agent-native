import type { DriveContext } from "../scripts/drive.ts";

interface MailPreferences {
  autocompleteEnabled?: boolean;
  signature?: string;
}

export default async function run(ctx: DriveContext): Promise<void> {
  const { page } = ctx;
  const signature = ctx.params.signature ?? `Verify signature ${Date.now()}`;

  await ctx.open("/settings/app/drafting");
  const save = page.getByRole("button", { name: "Save drafting settings" });
  if (await save.isEnabled()) throw new Error("save enabled with no changes");
  await page.getByRole("textbox", { name: "Signature" }).fill(signature);
  await save.click();
  // Save disables itself again once the form matches what was stored.
  for (let i = 0; i < 60 && (await save.isEnabled()); i++)
    await page.waitForTimeout(250);
  if (await save.isEnabled())
    throw new Error("save stayed enabled after saving");

  const autocomplete = page.getByRole("switch", { name: "Autocomplete" });
  const before = (await autocomplete.getAttribute("aria-checked")) === "true";
  await autocomplete.click();
  await page.waitForTimeout(1_500);
  await ctx.shot("drafting-changed");

  const prefs = await ctx.action<MailPreferences>("get-mail-preferences");
  if (prefs.signature !== signature)
    throw new Error(`stored signature "${prefs.signature}"`);
  if (prefs.autocompleteEnabled !== !before) {
    throw new Error(
      `stored autocompleteEnabled ${prefs.autocompleteEnabled}, expected ${!before}`,
    );
  }

  await ctx.open("/settings/app/drafting");
  if (
    (await page.getByRole("textbox", { name: "Signature" }).inputValue()) !==
    signature
  ) {
    throw new Error("signature not shown after reload");
  }
  if (
    ((await autocomplete.getAttribute("aria-checked")) === "true") !==
    !before
  ) {
    throw new Error("autocomplete state not kept after reload");
  }
  await ctx.shot("drafting-after-reload");

  await autocomplete.click();
  await page.waitForTimeout(1_500);
}
