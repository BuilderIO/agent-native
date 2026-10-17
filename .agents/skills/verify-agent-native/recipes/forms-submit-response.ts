import type { DriveContext } from "../scripts/drive.ts";

interface ListedForm {
  id: string;
  title: string;
  slug: string;
}

export default async function run(ctx: DriveContext): Promise<void> {
  const { page } = ctx;
  const answer = ctx.params.answer ?? `verify answer ${Date.now()}`;

  const published = await ctx.action<ListedForm[]>("list-forms", {
    status: "published",
  });
  const form = ctx.params.title
    ? published.find((f) => f.title === ctx.params.title)
    : published[0];
  if (!form) {
    throw new Error(
      "No published form in this instance. Run recipes/forms-create-publish.ts first.",
    );
  }
  ctx.note(`submitting to ${form.id} (${form.slug})`);

  await ctx.open(`/f/${form.slug}`);
  await page.getByRole("heading", { name: form.title, level: 1 }).waitFor();
  // The submit handler 429s anything faster than MIN_FILL_TIME_MS (500 ms) after render.
  await page.waitForTimeout(1_000);
  await page.getByRole("textbox").first().fill(answer);
  await ctx.shot("public-form-filled");
  await page.getByRole("button", { name: "Submit" }).click();
  await page
    .getByRole("heading", { name: "Response submitted" })
    .waitFor({ timeout: 15_000 });
  await ctx.shot("public-form-submitted");

  const stored = await ctx.action<{
    responses: Array<{ data: Record<string, unknown> }>;
  }>("list-responses", { formId: form.id });
  if (!stored.responses.some((r) => Object.values(r.data).includes(answer))) {
    throw new Error(`response "${answer}" not stored for ${form.id}`);
  }

  await ctx.open(`/forms/${form.id}?tab=results`);
  await page.getByText(answer).first().waitFor({ timeout: 15_000 });
  await ctx.shot("results-tab");
}
