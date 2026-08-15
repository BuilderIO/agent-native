import { eq } from "drizzle-orm";

async function main() {
  const { getDb, schema } = await import("../server/db/index.js");
  const db = getDb();
  for (const id of process.argv.slice(2)) {
    const [row] = await db
      .select()
      .from(schema.decks)
      .where(eq(schema.decks.id, id));
    if (!row) {
      console.log(`${id}: NOT FOUND`);
      continue;
    }
    const data = JSON.parse(row.data as string);
    console.log(`\n== ${row.title} (${id}) ${data.slides.length} slides`);
    data.slides.forEach((slide: { content?: string }, i: number) => {
      const html = slide.content ?? "";
      const counts = {
        clipPath: (html.match(/clip-path:/g) ?? []).length,
        svg: (html.match(/<svg/g) ?? []).length,
        pathD: (html.match(/ d="/g) ?? []).length,
        img: (html.match(/<img/g) ?? []).length,
        dataUrl: (html.match(/data:/g) ?? []).length,
      };
      if (html.length > 30_000)
        console.log(
          `  slide ${i + 1}: ${(html.length / 1024).toFixed(0)}KB ${JSON.stringify(counts)}`,
        );
    });
    const biggest = data.slides
      .map((s: { content?: string }, i: number) => ({
        i: i + 1,
        len: (s.content ?? "").length,
      }))
      .sort((a: { len: number }, b: { len: number }) => b.len - a.len)[0];
    console.log(
      `  largest slide ${biggest.i} = ${(biggest.len / 1024).toFixed(0)}KB`,
    );
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
