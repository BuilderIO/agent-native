import type { DriveContext } from "../scripts/drive.ts";

export default async function run(ctx: DriveContext): Promise<void> {
  const { page } = ctx;
  const name = ctx.params.name ?? `Verify rule ${Date.now()}`;

  await ctx.open("/settings/app/rules");
  await page.getByRole("button", { name: "New rule" }).click();
  const save = page.getByRole("button", { name: "Save", exact: true });
  await page.getByPlaceholder("e.g. Auto-label newsletters").fill(name);
  await page
    .getByPlaceholder(/from a newsletter or marketing mailing list/)
    .fill("from a newsletter");
  // The form starts with one "Apply label" action; Save is a silent no-op while its label is empty.
  await save.click();
  await page.waitForTimeout(1_000);
  if (JSON.stringify(await ctx.action("list-email-rules")).includes(name)) {
    throw new Error("rule saved with an empty label");
  }
  await page.getByRole("textbox", { name: "Label name" }).fill("Newsletters");
  await save.click();
  await page.getByText(name).first().waitFor({ timeout: 15_000 });
  await ctx.shot("rule-created");

  const rules = await ctx.action("list-email-rules");
  const stored = JSON.stringify(rules);
  if (!stored.includes(name) || !stored.includes("Newsletters")) {
    throw new Error(
      `rule "${name}" with label Newsletters not in list-email-rules`,
    );
  }

  await ctx.open("/settings/app/rules");
  await page.getByText(name).first().waitFor({ timeout: 15_000 });
}
