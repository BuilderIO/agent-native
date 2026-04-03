import { parseArgs, fail } from "./_utils.js";
import { createClient } from "@libsql/client";

export default async function main(args: string[]) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log(
      "Usage: pnpm action search-documents --query <text> [--format json]",
    );
    console.log("Searches documents by title and content.");
    return;
  }

  const query = opts.query;
  if (!query) fail("--query is required");

  const url = process.env.DATABASE_URL || "file:./data/app.db";
  const client = createClient({ url });

  const pattern = `%${query}%`;
  const result = await client.execute({
    sql: "SELECT id, parent_id, title, icon, content, updated_at FROM documents WHERE title LIKE ? OR content LIKE ? ORDER BY updated_at DESC",
    args: [pattern, pattern],
  });

  interface DocRow {
    id: string;
    parent_id: string | null;
    title: string;
    icon: string | null;
    content: string;
    updated_at: string;
  }

  const docs = result.rows as unknown as DocRow[];

  if (opts.format === "json") {
    console.log(JSON.stringify(docs, null, 2));
    return;
  }

  if (docs.length === 0) {
    console.log(`No documents matching "${query}".`);
    return;
  }

  console.log(`Found ${docs.length} document(s) matching "${query}":\n`);

  for (const doc of docs) {
    const icon = doc.icon ? `${doc.icon} ` : "";
    console.log(`  ${icon}${doc.title || "Untitled"} (${doc.id})`);

    // Show a snippet of matching content
    const contentLower = doc.content.toLowerCase();
    const queryLower = query.toLowerCase();
    const matchIndex = contentLower.indexOf(queryLower);
    if (matchIndex !== -1) {
      const start = Math.max(0, matchIndex - 40);
      const end = Math.min(doc.content.length, matchIndex + query.length + 40);
      const snippet = doc.content.slice(start, end).replace(/\n/g, " ");
      const prefix = start > 0 ? "..." : "";
      const suffix = end < doc.content.length ? "..." : "";
      console.log(`    ${prefix}${snippet}${suffix}`);
    }
    console.log();
  }
}
