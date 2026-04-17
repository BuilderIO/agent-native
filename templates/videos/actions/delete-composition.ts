import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import { assertAccess } from "@agent-native/core/sharing";
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

    await assertAccess("composition", args.id, "admin");

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
  // trailing comma/whitespace) from the array. Use a string/comment-aware
  // walker so braces inside string and template literals (e.g. the
  // `Array.from({ length: 24 })` snippets we render in the Properties
  // panel) don't desync the depth counter and corrupt the registry.
  const idPattern = new RegExp(`id:\\s*["']${escapeRegex(id)}["']`);
  const idMatch = idPattern.exec(source);
  if (!idMatch) return; // nothing to do

  const open = scanBackwardForObjectStart(source, idMatch.index - 1);
  if (open === -1) return;

  const close = scanForwardForObjectEnd(source, open);
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

/**
 * Scan backward from `from` for the nearest unmatched `{` that opens an
 * object literal, skipping characters inside strings, template literals,
 * and comments so braces in user-authored snippets don't fool us.
 */
function scanBackwardForObjectStart(src: string, from: number): number {
  // Strip strings/comments first so we can do a simple linear scan
  // backward over a normalized buffer of the same length.
  const sanitized = sanitizeForBraceScan(src);
  let depth = 0;
  for (let i = from; i >= 0; i--) {
    const ch = sanitized[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/**
 * Scan forward from the opening `{` at `open` to its matching `}`,
 * ignoring braces inside strings, template literals, and comments.
 */
function scanForwardForObjectEnd(src: string, open: number): number {
  const sanitized = sanitizeForBraceScan(src);
  let depth = 0;
  for (let i = open; i < sanitized.length; i++) {
    const ch = sanitized[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Replace the contents of every JS/TS string literal, template literal,
 * and comment with spaces so brace-counting on the resulting buffer
 * matches the source's structural braces only. Lengths and offsets are
 * preserved 1:1 so callers can reuse offsets in the original source.
 */
function sanitizeForBraceScan(src: string): string {
  const out = src.split("");
  let i = 0;
  let templateDepth = 0;
  // Stack of `${` interpolation contexts inside template literals so a
  // `}` that closes an interpolation doesn't get treated as structural.
  const exprBraceStack: number[] = [];

  const skipUntil = (end: number) => {
    for (let k = i; k < end; k++) out[k] = " ";
    i = end;
  };

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    // Line comment
    if (ch === "/" && next === "/") {
      const eol = src.indexOf("\n", i);
      skipUntil(eol === -1 ? src.length : eol);
      continue;
    }
    // Block comment
    if (ch === "/" && next === "*") {
      const close = src.indexOf("*/", i + 2);
      skipUntil(close === -1 ? src.length : close + 2);
      continue;
    }
    // Single/double-quoted string
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === quote) {
          j++;
          break;
        }
        j++;
      }
      skipUntil(j);
      continue;
    }
    // Template literal — track interpolations so structural braces
    // outside `${...}` stay invisible while braces inside count toward
    // structural depth (because user code inside `${}` is real JS).
    if (ch === "`" && templateDepth === 0) {
      templateDepth = 1;
      out[i] = " ";
      i++;
      while (i < src.length && templateDepth > 0) {
        const c = src[i];
        if (c === "\\") {
          out[i] = " ";
          out[i + 1] = " ";
          i += 2;
          continue;
        }
        if (c === "`") {
          templateDepth = 0;
          out[i] = " ";
          i++;
          break;
        }
        if (c === "$" && src[i + 1] === "{") {
          // Leave the `${` invisible but step into the expression so its
          // braces are scanned normally; track our own depth with the
          // stack so we know when the matching `}` closes interpolation.
          out[i] = " ";
          out[i + 1] = " ";
          exprBraceStack.push(1);
          i += 2;
          while (i < src.length && exprBraceStack.length > 0) {
            const cc = src[i];
            if (cc === "{") {
              exprBraceStack[exprBraceStack.length - 1]++;
              out[i] = " ";
              i++;
              continue;
            }
            if (cc === "}") {
              const top = exprBraceStack[exprBraceStack.length - 1] - 1;
              if (top === 0) {
                exprBraceStack.pop();
                out[i] = " ";
                i++;
                break;
              }
              exprBraceStack[exprBraceStack.length - 1] = top;
              out[i] = " ";
              i++;
              continue;
            }
            // Strings inside interpolation can themselves contain
            // template literals — keep it simple and just blank
            // string/template content while inside.
            if (cc === "'" || cc === '"') {
              const quote = cc;
              let k = i + 1;
              while (k < src.length) {
                if (src[k] === "\\") {
                  k += 2;
                  continue;
                }
                if (src[k] === quote) {
                  k++;
                  break;
                }
                k++;
              }
              for (let m = i; m < k; m++) out[m] = " ";
              i = k;
              continue;
            }
            out[i] = " ";
            i++;
          }
          continue;
        }
        out[i] = " ";
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join("");
}
