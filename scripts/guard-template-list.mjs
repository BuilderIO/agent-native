#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const SOURCE_OF_TRUTH = "packages/shared-app-config/templates.ts";
const CLI_DUPLICATE = "packages/core/src/cli/templates-meta.ts";
const HOSTED_GA_MEASUREMENT_ID = "G-ESF7FYXGN9";
const HOSTED_GTM_CONTAINER_ID = "GTM-N3WSTXZ";

function parseTemplateMetaFile(absPath) {
  const src = fs.readFileSync(absPath, "utf-8");
  const map = new Map();
  const blocks = src.split(/^\s*\{\s*$/m).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/^\s*\},?\s*$/m)[0];
    const nameMatch = block.match(/\bname:\s*"([^"]+)"/);
    if (!nameMatch) continue;
    const slug = nameMatch[1];
    const hidden = /\bhidden:\s*true\b/.test(block);
    const prodUrl = block.match(/\bprodUrl:\s*"([^"]+)"/)?.[1] ?? null;
    map.set(slug, { hidden, prodUrl });
  }
  return map;
}

const truth = parseTemplateMetaFile(path.join(repoRoot, SOURCE_OF_TRUTH));
const cli = parseTemplateMetaFile(path.join(repoRoot, CLI_DUPLICATE));

const allowed = new Set(
  [...truth.entries()].filter(([, meta]) => !meta.hidden).map(([slug]) => slug),
);

function isAllowedTemplateDocSlug(slug) {
  return (
    allowed.has(slug) ||
    [...allowed].some((templateSlug) => slug.startsWith(`${templateSlug}-`))
  );
}

const errors = [];

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
  if (truthMeta.prodUrl !== cliMeta.prodUrl) {
    errors.push(
      `${CLI_DUPLICATE}: "${slug}" has prodUrl=${cliMeta.prodUrl}, ` +
        `but ${SOURCE_OF_TRUTH} has prodUrl=${truthMeta.prodUrl}. Keep them in sync.`,
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

const PRODUCTION_SITES_PATH = "scripts/netlify-production-sites.json";
{
  const sites = JSON.parse(
    fs.readFileSync(path.join(repoRoot, PRODUCTION_SITES_PATH), "utf-8"),
  );
  for (const [slug, meta] of truth.entries()) {
    const site = sites[slug];
    if (!meta.prodUrl || !site?.host) continue;
    let declaredHost;
    try {
      declaredHost = new URL(meta.prodUrl).host;
    } catch {
      errors.push(
        `${SOURCE_OF_TRUTH}: "${slug}" has an unparseable prodUrl ${meta.prodUrl}.`,
      );
      continue;
    }
    if (declaredHost !== site.host) {
      errors.push(
        `${SOURCE_OF_TRUTH}: "${slug}" declares prodUrl host ${declaredHost}, ` +
          `but ${PRODUCTION_SITES_PATH} deploys it to ${site.host}. ` +
          `Sign-in redirects and email links use the declared host, so these must match.`,
      );
    }
  }
}

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

const DOCS_NAV_PATH = "packages/docs/app/components/docsNavItems.ts";
{
  const src = fs.readFileSync(path.join(repoRoot, DOCS_NAV_PATH), "utf-8");
  const inTemplatesSection = src
    .split(/title:\s*"Templates"/)[1]
    ?.split(/title:\s*"/)[0];
  if (inTemplatesSection) {
    const landingSlugRe = /\/templates\/([a-z][a-z0-9-]*)\b/g;
    let match;
    while ((match = landingSlugRe.exec(inTemplatesSection)) !== null) {
      const slug = match[1];
      errors.push(
        `${DOCS_NAV_PATH}: "/templates/${slug}" is a landing page link. ` +
          `Docs sidebar template entries must link to "/docs/template-${slug}".`,
      );
    }

    const docsSlugRe = /\/docs\/template-([a-z][a-z0-9-]*)\b/g;
    while ((match = docsSlugRe.exec(inTemplatesSection)) !== null) {
      const slug = match[1];
      if (!isAllowedTemplateDocSlug(slug)) {
        errors.push(
          `${DOCS_NAV_PATH}: "/docs/template-${slug}" is in the sidebar but not in the public allow-list. ` +
            `Either remove the entry, or flip hidden:false in ${SOURCE_OF_TRUTH} (and ${CLI_DUPLICATE}).`,
        );
      }
    }
  }
}

const DOCS_CONTENT_DIR = "packages/core/docs/content";
{
  const dir = path.join(repoRoot, DOCS_CONTENT_DIR);
  for (const file of fs.readdirSync(dir)) {
    const m = file.match(/^template-([a-z0-9-]+)\.(?:mdx|md)$/);
    if (!m) continue;
    const slug = m[1];
    if (!isAllowedTemplateDocSlug(slug)) {
      errors.push(
        `${DOCS_CONTENT_DIR}/${file}: docs page is not for a public template or its topic "${slug}". ` +
          `Delete this file, or flip hidden:false in ${SOURCE_OF_TRUTH} (and ${CLI_DUPLICATE}).`,
      );
    }
  }
}

for (const slug of allowed) {
  const relPath = path.join("templates", slug, "netlify.toml");
  const absPath = path.join(repoRoot, relPath);
  if (!fs.existsSync(absPath)) {
    errors.push(
      `${relPath}: missing Netlify config for public hosted template "${slug}".`,
    );
    continue;
  }
  const src = fs.readFileSync(absPath, "utf-8");
  const expectedAnalyticsConfig = [
    ["GA_MEASUREMENT_ID", HOSTED_GA_MEASUREMENT_ID],
    ["GTM_CONTAINER_ID", HOSTED_GTM_CONTAINER_ID],
  ];
  for (const [key, value] of expectedAnalyticsConfig) {
    const expected = `${key} = "${value}"`;
    if (!src.includes(expected)) {
      errors.push(
        `${relPath}: missing ${expected}. Hosted template analytics will not be wired.`,
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

const publicTemplateSlugs = [...allowed].sort();
const allowedList = publicTemplateSlugs.join(", ");
console.log(
  `guard-template-list: clean (${publicTemplateSlugs.length} public templates: ${allowedList}).`,
);
