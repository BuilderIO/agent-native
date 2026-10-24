import type { DriveContext } from "../scripts/drive.ts";

interface StoredForm {
  id: string;
  title: string;
  slug: string;
  status: string;
  fields: Array<{ type: string; label: string }>;
}

export default async function run(ctx: DriveContext): Promise<void> {
  const { page } = ctx;
  const title = ctx.params.title ?? `Verify form ${Date.now()}`;

  await ctx.open("/forms");
  await ctx.shot("forms-list-before");

  await page
    .getByRole("navigation")
    .getByRole("button", { name: "New form" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Skip prompt" })
    .click();
  await page.waitForURL(/\/forms\/[^/?]+\?tab=edit/, { timeout: 30_000 });
  const id = new URL(page.url()).pathname.split("/").pop()!;
  ctx.note(`created form ${id}`);

  const titleBox = page.getByRole("textbox", { name: "Form Title" });
  await titleBox.fill(title);
  await titleBox.blur();

  await page.getByRole("button", { name: "Publish" }).click();
  await page
    .getByRole("region", { name: /Notifications/ })
    .getByText("Cannot publish: form has no fields")
    .waitFor({ timeout: 15_000 });
  ctx.note("empty form publish rejected as expected");

  await page.getByRole("button", { name: "Add Field" }).click();
  await page.getByRole("menuitem", { name: "Short Text" }).click();
  await page.getByRole("textbox", { name: "Enter text..." }).waitFor();

  await page.getByRole("button", { name: "Publish" }).click();
  await page
    .getByRole("region", { name: /Notifications/ })
    .getByText("Form published!")
    .waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Copy public form link" }).waitFor();
  await ctx.shot("editor-published");

  const stored = await ctx.action<StoredForm>("get-form", { id });
  if (stored.title !== title)
    throw new Error(`stored title "${stored.title}" != "${title}"`);
  if (stored.status !== "published")
    throw new Error(`stored status ${stored.status}`);
  if (stored.fields.length !== 1 || stored.fields[0].type !== "text") {
    throw new Error(`stored fields ${JSON.stringify(stored.fields)}`);
  }

  await ctx.open("/forms");
  await page.getByText(title).first().waitFor();
  await ctx.shot("forms-list-after");
  ctx.note(`verified ${id} slug=${stored.slug}`);
}
