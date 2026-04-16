import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Delete a composition by ID",
  schema: z.object({
    id: z.string().optional().describe("Composition ID to delete"),
  }),
  run: async (args) => {
    if (!args.id) {
      return { error: "Composition id is required" };
    }

    const db = getDb();
    await db
      .delete(schema.compositions)
      .where(eq(schema.compositions.id, args.id));

    // The UI reads compositions from app/remotion/registry.ts (a static source
    // file the agent edits), not from the DB. Deleting only from the DB means
    // the entry reappears on reload. In dev, also remove it from the source.
    if (process.env.NODE_ENV === "development") {
      try {
        await removeFromRegistry(args.id);
      } catch (err) {
        console.error("[delete-composition] Failed to update registry:", err);
      }
    }

    return { success: true };
  },
});

async function removeFromRegistry(id: string) {
  const registryPath = path.join(process.cwd(), "app/remotion/registry.ts");
  const source = await fs.readFile(registryPath, "utf-8");

  // Find `id: "<id>"` inside an object literal, then walk back to its `{`
  // and forward to the matching `}`, and remove that object (plus its
  // trailing comma/whitespace) from the array.
  const idPattern = new RegExp(`id:\\s*["']${escapeRegex(id)}["']`);
  const idMatch = idPattern.exec(source);
  if (!idMatch) return; // nothing to do

  let open = -1;
  for (let i = idMatch.index - 1; i >= 0; i--) {
    if (source[i] === "{") {
      open = i;
      break;
    }
  }
  if (open === -1) return;

  let depth = 0;
  let close = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) return;

  // Expand the removal range to swallow a trailing comma + following
  // whitespace so we don't leave `,\n  ,` or a dangling blank line.
  let end = close + 1;
  while (end < source.length && /[ \t]/.test(source[end])) end++;
  if (source[end] === ",") {
    end++;
    while (end < source.length && /[ \t\r\n]/.test(source[end])) end++;
  } else {
    // No trailing comma (last element) — strip leading comma instead.
    let start = open;
    while (start > 0 && /[ \t\r\n]/.test(source[start - 1])) start--;
    if (source[start - 1] === ",") {
      const next = source.slice(0, start - 1) + source.slice(close + 1);
      await fs.writeFile(registryPath, next, "utf-8");
      return;
    }
  }

  const next = source.slice(0, open) + source.slice(end);
  await fs.writeFile(registryPath, next, "utf-8");
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
