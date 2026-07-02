#!/usr/bin/env node
/**
 * guard-no-action-twin-routes.mjs
 *
 * Defensive CI guard: flag any server/routes/api/**\/* file whose operation
 * overlaps an existing action in the same template's actions/ directory.
 *
 * Background: The framework architecture contract states that actions are the
 * single API surface.  REST wrapper routes that duplicate an existing action
 * create a maintenance hazard: the action is tested, agent-callable, and
 * typed; the twin route bypasses all of that and can silently diverge.  This
 * guard enforces "ratchet" semantics — new twins are rejected; the grandfathered
 * baseline listed below is allowed to shrink as migrations continue.
 *
 * Detection logic:
 *   1. For each template (templates/TEMPLATE), collect action names from
 *      actions/*.ts (kebab-case filenames, no spec/test/private-_ files).
 *   2. For each file in server/routes/api/**\/*.ts, derive a canonical
 *      "operation key":
 *        - Combine non-dynamic directory segments + the leaf filename
 *          (minus HTTP method + .ts extension).
 *        - Strip dynamic path params ([id], [key], etc.).
 *        - Normalize kebab-case and singularize nouns.
 *        - When the leaf is "index" or purely dynamic, infer the verb from
 *          the HTTP method (get→list, post→create, put/patch→update,
 *          delete→delete).
 *   3. An action and a route overlap when:
 *        - Their derived noun tokens match (ignoring pluralization), AND
 *        - Their verb tokens are equivalent (same verb group: list/get/fetch,
 *          create/add, update/patch/edit, delete/remove/trash, send/submit,
 *          search/find/query).
 *   4. Grandfathered overlaps in ALLOWLIST are printed but do not fail the
 *      guard.  Any overlap NOT in the allowlist fails with exit code 1.
 *
 * Opt-out pragma (for routes that legitimately cannot be an action, e.g. a
 * binary-streaming endpoint, a public unsigned webhook, an auth callback):
 *
 *   // guard:allow-action-twin — short reason
 *
 * Place the pragma in the first 10 lines of the route file.
 *
 * Scope: templates/* except templates/plan (fenced — separate team ownership).
 */

import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  ".cache",
  ".turbo",
  ".netlify",
  ".vercel",
  ".wrangler",
  ".react-router",
  ".generated",
  "coverage",
]);

// Opt-out pragma must appear in the first 10 lines of the route file.
const OPT_OUT_PRAGMA = /\/\/\s*guard:allow-action-twin\b/;

// ─── Verb normalization ────────────────────────────────────────────────────

/**
 * Groups of interchangeable verbs.  Two verbs are "equivalent" if they share
 * a group.  The first entry is the canonical form used for display.
 */
const VERB_GROUPS = [
  ["list", new Set(["list", "get", "fetch", "read"])],
  ["create", new Set(["create", "add", "post", "make"])],
  ["update", new Set(["update", "patch", "edit", "put", "save", "set"])],
  ["delete", new Set(["delete", "remove", "trash", "destroy"])],
  ["send", new Set(["send", "submit"])],
  ["search", new Set(["search", "find", "query"])],
  ["trigger", new Set(["trigger", "run", "execute"])],
  ["export", new Set(["export"])],
  ["import", new Set(["import"])],
  ["generate", new Set(["generate"])],
  ["duplicate", new Set(["duplicate", "copy", "clone"])],
  ["archive", new Set(["archive"])],
  ["restore", new Set(["restore"])],
  ["cancel", new Set(["cancel"])],
  ["schedule", new Set(["schedule"])],
  ["apply", new Set(["apply"])],
];

/**
 * Additional single-word verbs that appear as route leaf names and indicate
 * an action-like operation (not just a noun modifier).
 */
const OPERATION_VERBS = new Set([
  "send",
  "export",
  "import",
  "generate",
  "duplicate",
  "archive",
  "restore",
  "approve",
  "reject",
  "submit",
  "search",
  "query",
  "trigger",
  "run",
  "cancel",
  "apply",
  "schedule",
  "sync",
  "publish",
  "upload",
  "download",
  "preview",
  "validate",
  "refresh",
  "connect",
  "disconnect",
  "ingest",
]);

function verbsEquivalent(a, b) {
  if (a === b) return true;
  for (const [, group] of VERB_GROUPS) {
    if (group.has(a) && group.has(b)) return true;
  }
  return false;
}

// ─── Noun normalization ───────────────────────────────────────────────────

/** Very small singularizer sufficient for the token vocabulary here. */
function singularize(word) {
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (word.endsWith("ses") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && word.length > 3) return word.slice(0, -1);
  return word;
}

function nounsMatch(aTokens, bTokens) {
  if (aTokens.length !== bTokens.length) return false;
  return aTokens.every(
    (t, i) => t === bTokens[i] || singularize(t) === singularize(bTokens[i]),
  );
}

// ─── Action name parsing ──────────────────────────────────────────────────

/**
 * Parse a kebab-case action filename into { verb, nouns }.
 * e.g. "list-decks" -> { verb:"list", nouns:["deck"] }
 *      "create-deck" -> { verb:"create", nouns:["deck"] }
 *      "send-email"  -> { verb:"send", nouns:["email"] }
 *      "get-hubspot-contact" -> { verb:"get", nouns:["hubspot","contact"] }
 */
function parseActionName(name) {
  const tokens = name
    .toLowerCase()
    .replace(/[._]/g, "-")
    .split("-")
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const [verb, ...nouns] = tokens;
  // Confirm the first token is actually a verb-like word; if not, the action
  // name doesn't follow the convention and we skip it.
  if (!verbsEquivalent(verb, verb) && !OPERATION_VERBS.has(verb)) return null;
  return { verb, nouns: nouns.map(singularize) };
}

// ─── Route path parsing ───────────────────────────────────────────────────

/**
 * Parse a route path (relative to server/routes/api/) into { verb, nouns }.
 *
 * Examples:
 *   decks/index.post.ts          -> { verb:"create",  nouns:["deck"] }
 *   decks/index.get.ts           -> { verb:"list",    nouns:["deck"] }
 *   decks/[id].get.ts            -> { verb:"list",    nouns:["deck"] }
 *   decks/[id].delete.ts         -> { verb:"delete",  nouns:["deck"] }
 *   emails/send.post.ts          -> { verb:"send",    nouns:["email"] }
 *   emails/[id].delete.ts        -> { verb:"delete",  nouns:["email"] }
 *   hubspot/contact.get.ts       -> { verb:"get",     nouns:["hubspot","contact"] }
 *   automations/trigger.post.ts  -> { verb:"trigger", nouns:["automation"] }
 *   twitter/tweets.get.ts        -> { verb:"list",    nouns:["twitter","tweet"] }
 */
function parseRoutePath(relPath) {
  const parts = relPath.replace(/\\/g, "/").split("/");
  const filename = parts[parts.length - 1];
  const dirParts = parts.slice(0, -1);

  const methodMatch = filename.match(/\.(get|post|put|patch|delete)\.ts$/i);
  const httpMethod = methodMatch ? methodMatch[1].toLowerCase() : null;

  // Method → canonical verb
  const METHOD_VERB = {
    get: "list",
    post: "create",
    put: "update",
    patch: "update",
    delete: "delete",
  };

  // Static dir segments (no dynamic params)
  const staticDirs = dirParts
    .filter((p) => !p.startsWith("["))
    .map((p) => p.replace(/\[.*?\]/g, ""))
    .filter(Boolean);

  // Leaf operation name (strip method + .ts)
  const leafRaw = filename
    .replace(/\.(get|post|put|patch|delete)\.ts$/i, "")
    .replace(/\[.*?\]/g, "");

  const leafIsIndexOrDynamic =
    leafRaw === "index" || leafRaw === "" || leafRaw.startsWith("[");

  // Resource nouns from directory segments
  const resourceNouns = staticDirs
    .flatMap((p) => p.split("-"))
    .map((t) => t.toLowerCase())
    .map(singularize)
    .filter(Boolean);

  if (leafIsIndexOrDynamic) {
    // index.get.ts = list resource, index.post.ts = create resource, etc.
    const verb = METHOD_VERB[httpMethod ?? "get"] ?? "list";
    return { verb, nouns: resourceNouns, httpMethod };
  }

  // Leaf has a semantic name
  const leafTokens = leafRaw.toLowerCase().split("-").filter(Boolean);

  const leafFirst = leafTokens[0];

  // Case 1: leaf first token is an operation verb  (send, export, trigger…)
  if (OPERATION_VERBS.has(leafFirst)) {
    // e.g. emails/send.post.ts -> verb=send, nouns=[email]
    //      automations/trigger.post.ts -> verb=trigger, nouns=[automation]
    const extraNouns = leafTokens.slice(1).map(singularize).filter(Boolean);
    const nouns = extraNouns.length > 0 ? extraNouns : resourceNouns;
    return { verb: leafFirst, nouns, httpMethod };
  }

  // Case 2: leaf is purely a noun modifier appended to the resource
  // e.g. hubspot/contact.get.ts -> verb=get (from method), nouns=[hubspot, contact]
  //      twitter/tweets.get.ts  -> verb=list (from method), nouns=[twitter, tweet]
  const verb = METHOD_VERB[httpMethod ?? "get"] ?? "list";
  const combinedNouns = [
    ...resourceNouns,
    ...leafTokens.map(singularize),
  ].filter(Boolean);
  return { verb, nouns: combinedNouns, httpMethod };
}

// ─── Overlap check ────────────────────────────────────────────────────────

/** Returns true when the route operation appears to twin an action. */
function isOverlap(actionName, routeParsed) {
  const ap = parseActionName(actionName);
  if (!ap) return false;
  if (!verbsEquivalent(ap.verb, routeParsed.verb)) return false;
  return nounsMatch(ap.nouns, routeParsed.nouns);
}

// ─── Allowlist (grandfathered overlaps) ──────────────────────────────────
//
// These are the overlaps that existed when this guard was introduced.
// Each entry is "template/route:action-name".
// The goal is a ratchet: shrink this list as migrations are completed;
// never add new entries here for new code — use the pragma instead.
//
// Format: "template:server/routes/api/ROUTE_PATH:action-name"

const ALLOWLIST = new Set([
  // analytics — provider-proxy routes that mirror action names; kept until
  // migrated to the provider-api-catalog pattern.
  "analytics:ga4/report.post.ts:ga4-report",
  "analytics:github/prs.get.ts:github-prs",
  "analytics:jira/analytics.get.ts:jira-analytics",
  "analytics:jira/search.get.ts:jira-search",
  "analytics:notion/page/[pageId].get.ts:notion-page",
  "analytics:pylon/issues.get.ts:pylon-issues",
  "analytics:twitter/tweets.get.ts:twitter-tweets",

  // calendar — booking + availability routes that have action twins
  "calendar:events/[id].delete.ts:delete-event",
  "calendar:events/[id].get.ts:get-event",
  "calendar:events/[id].get.ts:list-events",
  "calendar:events/[id].put.ts:update-event",

  // content — comment and document-version routes with action twins
  "content:comments/[id].delete.ts:delete-comment",
  "content:comments/[id].patch.ts:update-comment",
  "content:documents/[id]/versions.get.ts:list-document-versions",

  // mail — email CRUD and trigger routes with action twins
  "mail:automations/trigger.post.ts:trigger-automations",
  "mail:emails/[id].delete.ts:trash-email",
  "mail:emails/[id].get.ts:get-email",
  "mail:emails/[id].get.ts:list-emails",
  "mail:emails/index.get.ts:get-email",
  "mail:emails/index.get.ts:list-emails",
  "mail:emails/send.post.ts:send-email",
  "mail:hubspot/contact.get.ts:get-hubspot-contact",

  // slides — deck CRUD routes with action twins
  "slides:decks/[id].get.ts:get-deck",
  "slides:decks/[id].get.ts:list-decks",
  "slides:decks/[id].put.ts:patch-deck",
  "slides:decks/index.get.ts:get-deck",
  "slides:decks/index.get.ts:list-decks",
  "slides:decks/index.post.ts:create-deck",
]);

// ─── File collection ──────────────────────────────────────────────────────

async function collectTs(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTs(full)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const templatesDir = path.join(REPO_ROOT, "templates");
  let templateEntries;
  try {
    templateEntries = await readdir(templatesDir, { withFileTypes: true });
  } catch {
    console.log(
      "guard-no-action-twin-routes: templates/ not found — nothing to check.",
    );
    process.exit(0);
  }

  /** @type {{ template: string; route: string; action: string }[]} */
  const newViolations = [];
  /** @type {{ template: string; route: string; action: string }[]} */
  const grandfathered = [];

  for (const entry of templateEntries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "plan") continue; // fenced — separate team ownership

    const templateName = entry.name;
    const templateDir = path.join(templatesDir, templateName);
    const actionsDir = path.join(templateDir, "actions");
    const apiRoutesDir = path.join(templateDir, "server", "routes", "api");

    if (!existsSync(actionsDir) || !existsSync(apiRoutesDir)) continue;

    // Collect action basenames
    let actionFiles;
    try {
      actionFiles = await collectTs(actionsDir);
    } catch {
      continue;
    }

    const actionNames = actionFiles
      .map((f) => path.relative(actionsDir, f).replace(/\\/g, "/"))
      .filter(
        (f) =>
          !f.includes(".spec.") &&
          !f.includes(".test.") &&
          !path.basename(f).startsWith("_"),
      )
      .map((f) => f.replace(/\.ts$/, ""))
      // Only top-level actions (no subdirectory nesting)
      .filter((f) => !f.includes("/"));

    // Collect route files
    let routeFiles;
    try {
      routeFiles = await collectTs(apiRoutesDir);
    } catch {
      continue;
    }

    for (const routeFile of routeFiles) {
      const rel = path.relative(apiRoutesDir, routeFile).replace(/\\/g, "/");

      // Per-file pragma opt-out
      let src = "";
      try {
        src = readFileSync(routeFile, "utf8");
      } catch {
        continue;
      }
      const head = src.split("\n").slice(0, 10).join("\n");
      if (OPT_OUT_PRAGMA.test(head)) continue;

      const routeParsed = parseRoutePath(rel);

      for (const actionName of actionNames) {
        if (!isOverlap(actionName, routeParsed)) continue;

        const key = `${templateName}:${rel}:${actionName}`;
        if (ALLOWLIST.has(key)) {
          grandfathered.push({
            template: templateName,
            route: rel,
            action: actionName,
          });
        } else {
          newViolations.push({
            template: templateName,
            route: rel,
            action: actionName,
          });
        }
      }
    }
  }

  if (newViolations.length === 0) {
    const gCount = grandfathered.length;
    console.log(
      `guard-no-action-twin-routes: OK` +
        (gCount > 0
          ? ` (${gCount} grandfathered twin route${gCount === 1 ? "" : "s"} remaining in baseline)`
          : ""),
    );
    process.exit(0);
  }

  const bar = "=".repeat(72);
  console.error(`\n${bar}`);
  console.error("ERROR: new action-twin routes detected.");
  console.error(bar);
  console.error(`
The following server/routes/api/* files duplicate operations that are
already handled by an action in the same template's actions/ directory.

The framework architecture contract: actions are the single API surface.
REST wrapper routes that duplicate an existing action create divergence —
the action is agent-callable, typed, and tested; the twin route is not.

New twins (not in the grandfathered baseline):
`);
  for (const v of newViolations) {
    console.error(`  templates/${v.template}/server/routes/api/${v.route}`);
    console.error(`    duplicates action: ${v.action}`);
  }
  console.error(`
Fix options:
  1. Remove the route file and point callers to the action surface via
     useActionMutation / useActionQuery (or the agent action directly).
  2. If the route is a binary-stream, public webhook, auth callback, or
     otherwise cannot be replaced by an action, add the opt-out pragma
     in the first 10 lines of the route file:
       // guard:allow-action-twin — <reason>
  3. If this is a migration-in-progress and the twin is intentional for
     now, add an entry to the ALLOWLIST in scripts/guard-no-action-twin-routes.mjs
     (requires reviewer approval — these entries should shrink over time).
`);
  console.error(bar);
  process.exit(1);
}

main().catch((err) => {
  console.error("guard-no-action-twin-routes: unexpected error:", err);
  process.exit(1);
});
