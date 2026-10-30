import type { DriveContext } from "../scripts/drive.ts";

export default async function run(ctx: DriveContext): Promise<void> {
  const { page } = ctx;
  const name = ctx.params.name ?? `Verify alias ${Date.now()}`;

  await ctx.open("/settings/app/aliases");
  await page.getByRole("button", { name: "New alias" }).click();
  // Field labels are not associated with their inputs; placeholders are the handles.
  await page.getByPlaceholder("e.g. Design team").fill(name);
  await page
    .getByPlaceholder("alice@example.com")
    .fill("alice@example.test\nbob@example.test");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText(name).first().waitFor({ timeout: 15_000 });
  await ctx.shot("alias-created");

  const aliases = await ctx.action("list-aliases");
  const stored = JSON.stringify(aliases);
  if (!stored.includes(name) || !stored.includes("bob@example.test")) {
    throw new Error(`alias "${name}" with both recipients not in list-aliases`);
  }

  await ctx.open("/settings/app/aliases");
  await page.getByText(name).first().waitFor({ timeout: 15_000 });
}
