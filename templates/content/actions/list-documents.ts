import { parseArgs } from "./_utils.js";
import { createClient } from "@libsql/client";

export default async function main(args: string[]) {
  const opts = parseArgs(args);

  if (opts.help) {
    console.log("Usage: pnpm action list-documents [--format json]");
    console.log("Lists all documents in a tree structure.");
    return;
  }

  const url = process.env.DATABASE_URL || "file:./data/app.db";
  const client = createClient({ url });

  const result = await client.execute(
    "SELECT id, parent_id, title, icon, position, is_favorite, created_at, updated_at FROM documents ORDER BY position",
  );

  interface DocRow {
    id: string;
    parent_id: string | null;
    title: string;
    icon: string | null;
    position: number;
    is_favorite: number;
    created_at: string;
    updated_at: string;
  }

  const docs = result.rows as unknown as DocRow[];

  if (opts.format === "json") {
    console.log(JSON.stringify(docs, null, 2));
    return;
  }

  if (docs.length === 0) {
    console.log("No documents found.");
    return;
  }

  // Build tree
  const byParent = new Map<string | null, DocRow[]>();
  for (const doc of docs) {
    const parentId = doc.parent_id ?? null;
    const key = parentId ?? "__root__";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(doc);
  }

  function printTree(parentId: string | null, indent: string) {
    const key = parentId ?? "__root__";
    const children = byParent.get(key) || [];
    for (let i = 0; i < children.length; i++) {
      const doc = children[i];
      const isLast = i === children.length - 1;
      const prefix = isLast ? "└── " : "├── ";
      const icon = doc.icon ? `${doc.icon} ` : "";
      const fav = doc.is_favorite ? " ★" : "";
      console.log(
        `${indent}${prefix}${icon}${doc.title || "Untitled"}${fav} (${doc.id})`,
      );
      const childIndent = indent + (isLast ? "    " : "│   ");
      printTree(doc.id, childIndent);
    }
  }

  console.log("Documents:");
  printTree(null, "");
}
