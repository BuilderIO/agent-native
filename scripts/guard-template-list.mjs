#!/usr/bin/env node
/**
 * Guard: enforces that every public-facing surface only lists templates
 * from the strict allow-list in `packages/shared-app-config/templates.ts`.
 *
 * The allow-list is the set of templates with `hidden: false` (or no
 * `hidden` flag). Anything with `hidden: true` is not public-facing and
 * must NOT appear in:
 *
 *   - packages/docs/app/components/TemplateCard.tsx       (homepage catalog)
 *   - packages/docs/app/components/docsNavItems.ts        (docs sidebar)
 *   - packages/core/docs/content/template-*.md            (docs pages)
 *
 * Why this guard exists: agents kept re-adding hidden templates (calls,
 * meeting-notes, voice, scheduling, issues, recruiting, macros) to these
 * surfaces during overnight sweeps, forcing a constant whack-a-mole. The
 * allow-list lives in one file (templates.ts) and this guard enforces
 * that every other surface only references slugs from it.
 *
 * To add a template to the public-facing list:
 *   1. Set `hidden: false` (or remove the `hidden` flag) on its entry
 *      in `packages/shared-app-config/templates.ts` AND in
 *      `packages/core/src/cli/templates-meta.ts` (the CLI duplicate).
 *   2. Add the entry to TemplateCard.tsx + docsNavItems.ts as needed.
 *   3. Re-run this guard locally to confirm.
 *
 * To remove a template: flip `hidden: true` in BOTH files. This guard
 * will then fail on any surface that still mentions it, pointing you
 * at the file/line to fix.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const SOURCE_OF_TRUTH = "packages/shared-app-config/templates.ts";
const CLI_DUPLICATE = "packages/core/src/cli/templates-meta.ts";

/**
 * Parse a TEMPLATES array out of a templates-meta-shaped file. Returns
 * Map<slug, { hidden: boolean }>. Hand-rolled rather than executing the
 * file because both files are TS source — running them would require
 * compilation, and a regex-level scan is plenty for this guard.
 */
function parseTemplateMetaFile(absPath) {
  const src = fs.readFileSync(absPath, "utf-8");
  const map = new Map();
  // Match each `{ ... name: "...", ... }` block. Templates use object literals.
  const blocks = src.split(/^\s*\{\s*$/m).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/^\s*\},?\s*$/m)[0];
    const nameMatch = block.match(/\bname:\s*"([^"]+)"/);
    if (!nameMatch) continue;
    const slug = nameMatch[1];
    const hidden = /\bhidden:\s*true\b/.test(block);
    map.set(slug, { hidden });
  }
  return map;
}

const truth = parseTemplateMetaFile(path.join(repoRoot, SOURCE_OF_TRUTH));
const cli = parseTemplateMetaFile(path.join(repoRoot, CLI_DUPLICATE));

const allowed = new Set(
  [...truth.entries()]
    .filter(([slug, meta]) => !meta.hidden && slug !== "starter")
    .map(([slug]) => slug),
);
// Starter is a CLI-only scaffold. It may have a developer docs page, but it
// must not appear in public marketing/catalog template surfaces.
const CLI_ONLY_TEMPLATE_DOCS = new Set(["starter"]);
// Tolerate the legacy "video" alias for "videos" — multiple surfaces
// link to /templates/video and that alias is documented in
// `getTemplate()` in templates.ts. Whitelist it here so the guard
// doesn't punish that established URL.
if (allowed.has("videos")) allowed.add("video");

const errors = [];

// ── 1. CLI duplicate must agree with source of truth on hidden flag.
for (const [slug, truthMeta] of truth.entries()) {
  if (!cli.has(slug)) {
    errors.push(
      `${CLI_DUPLICATE}: missing entry for "${slug}" — present in ${SOURCE_OF_TRUTH}`,
    );
    continue;
  }
  const cliMeta = cli.get(slug);
  if (truthMeta.hidden !== cliMeta.hidden) {
    errors.push(
      `${CLI_DUPLICATE}: "${slug}" has hidden=${cliMeta.hidden}, ` +
        `but ${SOURCE_OF_TRUTH} has hidden=${truthMeta.hidden}. Keep them in sync.`,
    );
  }
}
for (const slug of cli.keys()) {
  if (!truth.has(slug)) {
    errors.push(
      `${CLI_DUPLICATE}: extra entry for "${slug}" — not in ${SOURCE_OF_TRUTH}`,
    );
  }
}

// ── 2. Homepage catalog (TemplateCard.tsx) must only contain allowed slugs.
const TEMPLATE_CARD_PATH = "packages/docs/app/components/TemplateCard.tsx";
{
  const src = fs.readFileSync(path.join(repoRoot, TEMPLATE_CARD_PATH), "utf-8");
  const slugRe = /\bslug:\s*"([^"]+)"/g;
  let match;
  while ((match = slugRe.exec(src)) !== null) {
    const slug = match[1];
    if (!allowed.has(slug)) {
      const line = src.slice(0, match.index).split("\n").length;
      errors.push(
        `${TEMPLATE_CARD_PATH}:${line}: slug "${slug}" is not in the public allow-list. ` +
          `Either remove the entry, or flip hidden:false in ${SOURCE_OF_TRUTH} (and ${CLI_DUPLICATE}).`,
      );
    }
  }
}

// ── 3. Docs sidebar (docsNavItems.ts) must only contain allowed slugs.
const DOCS_NAV_PATH = "packages/docs/app/components/docsNavItems.ts";
{
  const src = fs.readFileSync(path.join(repoRoot, DOCS_NAV_PATH), "utf-8");
  const inTemplatesSection = src
    .split(/title:\s*"Templates"/)[1]
    ?.split(/title:\s*"/)[0];
  if (inTemplatesSection) {
    const slugRe = /\/templates\/([a-z][a-z0-9-]*)\b/g;
    let match;
    while ((match = slugRe.exec(inTemplatesSection)) !== null) {
      const slug = match[1];
      if (!allowed.has(slug)) {
        errors.push(
          `${DOCS_NAV_PATH}: "/templates/${slug}" is in the sidebar but not in the public allow-list. ` +
            `Either remove the entry, or flip hidden:false in ${SOURCE_OF_TRUTH} (and ${CLI_DUPLICATE}).`,
        );
      }
    }
  }
}

// ── 4. Docs pages (template-*.md) must only exist for allowed slugs, plus
// explicit CLI-only scaffold references such as template-starter.md.
const DOCS_CONTENT_DIR = "packages/core/docs/content";
{
  const dir = path.join(repoRoot, DOCS_CONTENT_DIR);
  for (const file of fs.readdirSync(dir)) {
    const m = file.match(/^template-([a-z0-9-]+)\.md$/);
    if (!m) continue;
    const slug = m[1];
    if (!allowed.has(slug) && !CLI_ONLY_TEMPLATE_DOCS.has(slug)) {
      errors.push(
        `${DOCS_CONTENT_DIR}/${file}: docs page exists for "${slug}" which is not in the public allow-list. ` +
          `Delete this file, or flip hidden:false in ${SOURCE_OF_TRUTH} (and ${CLI_DUPLICATE}).`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error("");
  console.error(
    "========================================================================",
  );
  console.error("ERROR: public template list out of sync with allow-list.");
  console.error(
    "========================================================================",
  );
  console.error("");
  console.error(
    `Source of truth: ${SOURCE_OF_TRUTH} (entries with hidden:false).`,
  );
  console.error("");
  for (const err of errors) console.error(`  ${err}`);
  console.error("");
  console.error(
    "========================================================================",
  );
  process.exit(1);
}

const publicTemplateSlugs = [...allowed]
  .filter((slug) => slug !== "video")
  .sort();
const allowedList = publicTemplateSlugs.join(", ");
console.log(
  `guard-template-list: clean (${publicTemplateSlugs.length} public templates: ${allowedList}; starter is CLI-only).`,
);
