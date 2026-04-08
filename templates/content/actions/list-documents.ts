import { defineAction } from "@agent-native/core";
import { asc } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { parseDocumentFavorite } from "../server/lib/documents.js";

export default defineAction({
  description: "List all documents ordered by position.",
  parameters: {
    format: { type: "string", description: 'Output format: "json" or "tree"' },
  },
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const documents = await db
      .select()
      .from(schema.documents)
      .orderBy(asc(schema.documents.position));

    const mapped = documents.map((d) => ({
      id: d.id,
      parentId: d.parentId,
      title: d.title,
      content: d.content,
      icon: d.icon,
      position: d.position,
      isFavorite: parseDocumentFavorite(d.isFavorite),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));

    // For agent CLI usage, print a tree
    if (args.format === "tree") {
      interface DocRow {
        id: string;
        parentId: string | null;
        title: string;
        icon: string | null;
        isFavorite: boolean;
      }
      const byParent = new Map<string, DocRow[]>();
      for (const doc of mapped) {
        const key = doc.parentId ?? "__root__";
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
          const fav = doc.isFavorite ? " ★" : "";
          console.log(
            `${indent}${prefix}${icon}${doc.title || "Untitled"}${fav} (${doc.id})`,
          );
          const childIndent = indent + (isLast ? "    " : "│   ");
          printTree(doc.id, childIndent);
        }
      }

      console.log("Documents:");
      printTree(null, "");
      return { documents: mapped };
    }

    return { documents: mapped };
  },
});
