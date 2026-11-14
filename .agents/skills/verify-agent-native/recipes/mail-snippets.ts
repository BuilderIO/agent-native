import type { DriveContext } from "../scripts/drive.ts";

export default async function run(ctx: DriveContext): Promise<void> {
  const { page } = ctx;
  const name = ctx.params.name ?? `Verify snippet ${Date.now()}`;

  await ctx.open("/settings/app/snippets");
  await page.getByRole("button", { name: "New snippet" }).click();
  await page.getByPlaceholder("e.g. Pricing follow-up").fill(name);
  await page
    .getByPlaceholder("Text inserted when this snippet is used...")
    .fill(`Body of ${name}`);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText(name).first().waitFor({ timeout: 15_000 });
  await ctx.shot("snippet-created");

  // manage-snippets is POST-only; its list operation is the read-back.
  const snippets = await ctx.action(
    "manage-snippets",
    { operation: "list" },
    "POST",
  );
  if (!JSON.stringify(snippets).includes(name)) {
    throw new Error(`snippet "${name}" not in manage-snippets list`);
  }

  await ctx.open("/settings/app/snippets");
  await page.getByText(name).first().waitFor({ timeout: 15_000 });
}
