/**
 * Drop translated docs markdown from the deployed serverless functions.
 *
 * `docs-content.ts` globs `core/docs/content/locales/<locale>/*.md{,x}` with
 * `query: "?raw"`, so Vite emits one lazy chunk per translated file — 1251 of
 * them, 19.2MB, roughly 40% of a 51MB docs function. Netlify's
 * `nodeBundler: "none"` + `includedFiles: ["**"]` ships every one, and the
 * function unzips all of it on each cold start.
 *
 * It can never serve them. Every localized docs page is prerendered to a static
 * file at build time, so the CDN answers those URLs from the publish directory
 * and the render function is never invoked for them. The globs stay: the chunk
 * KEYS still drive `localizedDocKey` and the locale-availability enumeration,
 * so hreflang and the locale switcher keep working with the target files gone.
 *
 * This runs after `agent-native build`, when the emitted functions are final.
 * It deletes nothing it cannot prove is prerendered — see `assertPrerendered`.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DOCS_SLUG_REDIRECTS } from "../app/components/docs-slug-redirects.js";

const DOCS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const FUNCTIONS_DIR = path.join(DOCS_ROOT, ".netlify", "functions-internal");
const PUBLISH_DIR = path.join(DOCS_ROOT, "dist");
const LOCALES_DIR = path.resolve(DOCS_ROOT, "../core/docs/content/locales");

/** `"../../../core/docs/content/locales/ar-SA/x.mdx":()=>import(`./x-HASH.mjs`)` */
const GLOB_ENTRY =
  /"([^"]*\/core\/docs\/content\/(?:locales\/[^/"]+\/)?[^"]+\.mdx?)"\s*:\s*\(\)\s*=>\s*import\(\s*[`"']\.\/([^`"']+)[`"']\s*\)/g;

type Attribution = {
  localeOnly: Set<string>;
  keysByChunk: Map<string, string[]>;
};

/**
 * Map each emitted chunk to the glob keys that reference it. A chunk is
 * locale-only when every key that reaches it lives under `locales/`. Reading
 * the emitted bundle rather than a manifest means this cannot drift from what
 * the build actually produced.
 */
function attributeChunks(chunksDir: string): Attribution {
  const keysByChunk = new Map<string, string[]>();
  for (const name of readdirSync(chunksDir)) {
    if (!name.endsWith(".mjs")) continue;
    let source: string;
    try {
      source = readFileSync(path.join(chunksDir, name), "utf8");
    } catch {
      continue;
    }
    GLOB_ENTRY.lastIndex = 0;
    for (let m: RegExpExecArray | null; (m = GLOB_ENTRY.exec(source)); ) {
      const [, key, chunk] = m;
      const list = keysByChunk.get(chunk) ?? [];
      list.push(key);
      keysByChunk.set(chunk, list);
    }
  }

  const localeOnly = new Set<string>();
  for (const [chunk, keys] of keysByChunk) {
    if (keys.every((key) => key.includes("/locales/"))) localeOnly.add(chunk);
  }
  return { localeOnly, keysByChunk };
}

function slugFromKey(key: string): string {
  return path.basename(key).replace(/\.mdx?$/, "");
}

function localeFromKey(key: string): string | undefined {
  return /\/locales\/([^/]+)\//.exec(key)?.[1];
}

function isDraft(key: string): boolean {
  // A draft is excluded from prerender, so the function is still its only
  // renderer. `docs-content` loads the chunk before it decides visibility.
  const absolute = path.resolve(
    LOCALES_DIR,
    "..",
    key.replace(/^.*core\/docs\/content\//, ""),
  );
  try {
    return /^---[\s\S]*?\bdraft:\s*["']?true/m.test(
      readFileSync(absolute, "utf8"),
    );
  } catch {
    // Unreadable source is not provably prerendered, so keep its chunk.
    return true;
  }
}

/**
 * Refuse to delete a chunk whose page is not actually prerendered. A missing
 * static page would turn a translated doc into a 500 the moment the function
 * tried to load a chunk this script removed, so an unproven page aborts the
 * build instead.
 */
function assertPrerendered(keys: string[]): string[] {
  const missing: string[] = [];
  for (const key of keys) {
    const locale = localeFromKey(key);
    const slug = slugFromKey(key);
    if (!locale) continue;
    const candidates =
      slug === "getting-started"
        ? [path.join(PUBLISH_DIR, locale, "docs", "index.html")]
        : [path.join(PUBLISH_DIR, locale, "docs", slug, "index.html")];
    if (!candidates.some((file) => existsSync(file)))
      missing.push(`${locale}/${slug}`);
  }
  return missing;
}

function pruneFunction(functionDir: string): {
  removed: number;
  bytes: number;
} {
  const chunksDir = path.join(functionDir, "_chunks");
  if (!existsSync(chunksDir)) return { removed: 0, bytes: 0 };

  const { localeOnly, keysByChunk } = attributeChunks(chunksDir);
  const redirectSlugs = new Set(Object.keys(DOCS_SLUG_REDIRECTS));

  const prunable: string[] = [];
  const provenKeys: string[] = [];
  for (const chunk of localeOnly) {
    const keys = keysByChunk.get(chunk) ?? [];
    // A redirect slug never renders its own page, and a draft is not
    // prerendered; both keep their chunk rather than gamble on the 301/500.
    if (
      keys.some((key) => redirectSlugs.has(slugFromKey(key)) || isDraft(key))
    ) {
      continue;
    }
    prunable.push(chunk);
    provenKeys.push(...keys);
  }

  const missing = assertPrerendered(provenKeys);
  if (missing.length > 0) {
    throw new Error(
      `prune-serverless-functions: refusing to prune — ${missing.length} translated doc(s) have no prerendered page, ` +
        `so the function is still their only renderer: ${missing.slice(0, 8).join(", ")}` +
        (missing.length > 8 ? ` (+${missing.length - 8} more)` : ""),
    );
  }

  let removed = 0;
  let bytes = 0;
  for (const chunk of prunable) {
    const file = path.join(chunksDir, chunk);
    try {
      bytes += statSync(file).size;
      rmSync(file);
      removed += 1;
      // A chunk already gone is the goal state, not a failure: the sibling
      // function directory is hardlinked in some layouts, so the first prune
      // removes it for both. The reported byte count stays honest because the
      // size is read before the unlink.
      // coercion-ok: absent and removed are the same outcome here.
    } catch {}
  }
  return { removed, bytes };
}

function main(): void {
  if (!existsSync(FUNCTIONS_DIR)) {
    console.log("[docs] No emitted functions; skipping locale chunk prune.");
    return;
  }

  let removed = 0;
  let bytes = 0;
  for (const entry of readdirSync(FUNCTIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // Netlify zips each function separately, so a chunk must be deleted from
    // every emitted copy to actually leave the upload.
    const result = pruneFunction(path.join(FUNCTIONS_DIR, entry.name));
    removed += result.removed;
    bytes += result.bytes;
  }

  console.log(
    `[docs] Pruned ${removed} translated-doc chunk(s) (${(bytes / 1024 / 1024).toFixed(1)}MB) from the ` +
      `serverless functions; every localized page is prerendered and served statically.`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}

export { attributeChunks, assertPrerendered, pruneFunction };
