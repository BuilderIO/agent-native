#!/usr/bin/env node
/**
 * guard-no-action-twin-routes.mjs
 *
 * Defensive CI guard for the "actions are the single API surface" contract.
 * Two checks run over every template's server/routes/api/**\/* files:
 *
 *   A. Twin routes — the route's operation overlaps an existing action in the
 *      same template's actions/ directory.
 *   B. Untwinned app-data CRUD — the route has no action counterpart at all,
 *      but reads or writes the app's own database and returns JSON.  Check A
 *      alone lets an author who writes routes *instead of* actions from the
 *      very start pass CI clean; check B closes that hole.
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
 *   // guard:allow-api-route — short reason
 *
 * `// guard:allow-action-twin` is the older spelling and still works.  Place
 * either in the first 10 lines of the route file.  Most legitimate exceptions
 * are detected structurally and need no pragma — see EXCEPTION_SIGNALS and
 * readDeclaredPublicApiPaths below.
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
  "analytics:jira/analytics.get.ts:jira-analytics",
  "analytics:jira/search.get.ts:jira-search",
  "analytics:notion/page/[pageId].get.ts:notion-page",
  "analytics:pylon/issues.get.ts:pylon-issues",
  "analytics:twitter/tweets.get.ts:twitter-tweets",

  // mail — routes whose same-named action is NOT an equivalent replacement.
  // Each was reviewed during the templates/* CRUD migration and kept for a
  // specific behavioral reason; these are not "not yet migrated".
  //
  //   send.post          the route strips CRLF and validates the recipient
  //                      list (header-injection guard); send-email does not.
  //   emails/[id].delete the route hard-deletes locally; trash-email performs
  //                      a soft Gmail trash — different operations.
  //   emails/[id].get    get-email returns a JSON string, not a structured
  //                      body, and the route maps per-account 404/502.
  //   emails/index.get   list-emails speaks a different response contract
  //                      (format: legacy | inventory, coverage envelope).
  //   automations/trigger  trigger-automations is http:false and returns prose.
  //   hubspot/contact    the route keys the credential by session id, the
  //                      action by owner email — a real scoping difference.
  "mail:automations/trigger.post.ts:trigger-automations",
  "mail:emails/[id].delete.ts:trash-email",
  "mail:emails/[id].get.ts:get-email",
  "mail:emails/[id].get.ts:list-emails",
  "mail:emails/index.get.ts:get-email",
  "mail:emails/index.get.ts:list-emails",
  "mail:emails/send.post.ts:send-email",
  "mail:hubspot/contact.get.ts:get-hubspot-contact",
]);

// ─── App-data CRUD detection (routes with no action twin) ────────────────
//
// The twin check above only fires when a route overlaps an action that already
// exists.  That lets an author who writes routes *instead of* actions from the
// start pass CI clean — the exact failure this guard exists to prevent.  So we
// also flag routes that are plainly app-data CRUD even when no twin exists.
//
// The positive signal is deliberately narrow: the route reaches the app's own
// database directly.  That is what "should have been an action" looks like.
// Provider proxies (fetch to an external API, no DB) do not fire, because
// migrating those is the separate provider-api-catalog effort.
//
// Every exception category is detected structurally — by the API the handler
// actually calls or by a declaration elsewhere in the template — never by
// filename convention, because a guard that misfires on legitimate webhook and
// upload routes gets disabled or allowlisted into uselessness.

const APP_DATA_SIGNALS = [
  /\bgetDb\s*\(/,
  /\bgetDbExec\s*\(/,
  /from\s+["'][^"']*server\/db["']/,
  /from\s+["'][^"']*\.\.\/db(\/index)?(\.js)?["']/,
  /from\s+["']drizzle-orm/,
  /\bschema\.[a-zA-Z]/,
];

/** [regex, category] — a match means the route is a legitimate exception. */
const EXCEPTION_SIGNALS = [
  [/readMultipartFormData|readFormData|busboy|formidable/, "file upload"],
  [
    /sendStream|createEventStream|eventStream|createReadStream|streamFile|ReadableStream|text\/event-stream/,
    "streaming response",
  ],
  [
    /createHmac|timingSafeEqual|verify\w*Signature|x-hub-signature|stripe-signature|svix-/i,
    "signature-verified webhook",
  ],
  [/readRawBody|getRequestWebStream|toWebRequest/, "raw request body"],
  [
    /AGENT_ACCESS_PARAM|verifyScopedAgentAccessToken/,
    "scoped agent-access token endpoint",
  ],
  [/sendRedirect/, "redirect response"],
  [/\boauth\b|grant_type/i, "OAuth callback"],
  [
    /setResponseHeader\s*\([^)]*["'](content-type|content-disposition)["']/i,
    "explicit non-JSON response header",
  ],
  [
    /setHeader\s*\([^)]*["']content-type["']\s*,\s*["'](?!application\/json)/i,
    "non-JSON content type",
  ],
  [
    /image\/png|image\/jpeg|application\/octet-stream|application\/pdf|text\/csv|text\/html/,
    "binary or non-JSON body",
  ],
];

// General opt-out, covering both checks in this guard.
const OPT_OUT_API_ROUTE = /\/\/\s*guard:allow-api-route\b/;

/**
 * Grandfathered app-data CRUD routes that have no action twin.
 *
 * Same ratchet contract as ALLOWLIST: this list may shrink, never grow.  New
 * code uses an action, or the pragma when it is a genuine exception the
 * structural detectors cannot see.
 *
 * Format: "template:server/routes/api/ROUTE_PATH"
 */
const CRUD_ROUTE_BASELINE = new Set([
  // Infrastructure health probes. Hit by external monitoring rather than by
  // the app's own UI or agent, so an action is not a drop-in replacement.
  "calendar:db-health.get.ts",
  "content:db-health.get.ts",
  "forms:db-health.get.ts",

  // Control endpoints of the chunked recording-upload protocol. Siblings of
  // uploads/[recordingId]/chunk.post.ts, which streams a binary body; they
  // are part of that transfer protocol, not app-data CRUD.
  "clips:uploads/[recordingId]/abort.post.ts",
  "clips:uploads/[recordingId]/reset-chunks.post.ts",
  "clips:uploads/[recordingId]/status.get.ts",

  // Genuine CRUD still awaiting migration to the action surface. These are
  // the next entries to remove, not a pattern to copy.
  "calendar:booking-links/[id].delete.ts",
  "content:documents/[id]/move.patch.ts",
  "content:documents/[id]/versions/[versionId].post.ts",
]);

/**
 * Public paths a template declares on its auth plugin. Routes underneath them
 * are reachable without a session, so they cannot become actions without
 * changing the access model.
 */
function readDeclaredPublicApiPaths(templateDir) {
  const authPlugin = path.join(templateDir, "server", "plugins", "auth.ts");
  if (!existsSync(authPlugin)) return [];
  let src = "";
  try {
    src = readFileSync(authPlugin, "utf8");
  } catch {
    return [];
  }
  const block = src.match(/publicPaths\s*:\s*\[([\s\S]*?)\]/);
  if (!block) return [];
  return [...block[1].matchAll(/["'`]([^"'`]+)["'`]/g)]
    .map((m) => m[1])
    .filter((p) => p.startsWith("/api"));
}

/** Map a route file path to the URL it serves. */
function routeUrlPath(relPath) {
  const withoutMethod = relPath
    .replace(/\.(get|post|put|patch|delete|options|head)\.ts$/i, "")
    .replace(/\.ts$/, "")
    .replace(/\/index$/, "")
    .replace(/^index$/, "");
  return "/api" + (withoutMethod ? `/${withoutMethod}` : "");
}

/**
 * Route files are frequently one-line re-exports of a server/handlers/* module.
 * Detection has to read the handler, or every such route looks inert.
 */
function readRouteSource(routeFile) {
  let src = "";
  try {
    src = readFileSync(routeFile, "utf8");
  } catch {
    return "";
  }
  const reExport = src.match(/export\s*\{[^}]*\}\s*from\s*["']([^"']+)["']/);
  if (!reExport) return src;
  const base = path.resolve(
    path.dirname(routeFile),
    reExport[1].replace(/\.js$/, ""),
  );
  for (const candidate of [`${base}.ts`, path.join(base, "index.ts")]) {
    if (!existsSync(candidate)) continue;
    try {
      return `${src}\n${readFileSync(candidate, "utf8")}`;
    } catch {
      return src;
    }
  }
  return src;
}

/**
 * Returns null when the route is fine, otherwise a short reason string.
 */
function classifyCrudRoute(effectiveSrc, relPath, publicApiPaths) {
  if (!APP_DATA_SIGNALS.some((re) => re.test(effectiveSrc))) return null;

  for (const [re] of EXCEPTION_SIGNALS) {
    if (re.test(effectiveSrc)) return null;
  }

  if (/\.options\.ts$/.test(relPath)) return null; // CORS preflight

  const url = routeUrlPath(relPath);
  const isPublic = publicApiPaths.some(
    (p) => url === p || url.startsWith(p.endsWith("/") ? p : `${p}/`),
  );
  if (isPublic) return null;

  return "reads or writes the app database and returns JSON";
}

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
  /** @type {{ template: string; route: string; reason: string }[]} */
  const crudViolations = [];
  let baselinedCrudCount = 0;

  for (const entry of templateEntries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "plan") continue; // fenced — separate team ownership

    const templateName = entry.name;
    const templateDir = path.join(templatesDir, templateName);
    const actionsDir = path.join(templateDir, "actions");
    const apiRoutesDir = path.join(templateDir, "server", "routes", "api");

    if (!existsSync(actionsDir) || !existsSync(apiRoutesDir)) continue;

    const publicApiPaths = readDeclaredPublicApiPaths(templateDir);

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
      if (OPT_OUT_PRAGMA.test(head) || OPT_OUT_API_ROUTE.test(head)) continue;

      const routeParsed = parseRoutePath(rel);

      let twinned = false;
      for (const actionName of actionNames) {
        if (!isOverlap(actionName, routeParsed)) continue;

        twinned = true;
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

      // A route with a twin is already reported above; only routes with no
      // action counterpart at all fall through to the CRUD check.
      if (twinned) continue;
      if (/\.(spec|test)\.ts$/.test(rel)) continue;

      const reason = classifyCrudRoute(
        readRouteSource(routeFile),
        rel,
        publicApiPaths,
      );
      if (!reason) continue;

      if (CRUD_ROUTE_BASELINE.has(`${templateName}:${rel}`)) {
        baselinedCrudCount += 1;
      } else {
        crudViolations.push({
          template: templateName,
          route: rel,
          reason,
        });
      }
    }
  }

  if (newViolations.length === 0 && crudViolations.length === 0) {
    const baselined = grandfathered.length + baselinedCrudCount;
    console.log(
      `guard-no-action-twin-routes: OK` +
        (baselined > 0
          ? ` (${baselined} grandfathered route${baselined === 1 ? "" : "s"} remaining in baseline)`
          : ""),
    );
    process.exit(0);
  }

  const bar = "=".repeat(72);
  console.error(`\n${bar}`);
  console.error("ERROR: new app-data routes detected under server/routes/api.");
  console.error(bar);
  console.error(`
The framework architecture contract: actions are the single API surface.
An action is agent-callable, typed, validated, and testable; a hand-rolled
route is none of those, and it hides the operation from every agent.
`);

  if (newViolations.length > 0) {
    console.error(`
These route files duplicate an operation that an action in the same
template's actions/ directory already performs:
`);
    for (const v of newViolations) {
      console.error(`  templates/${v.template}/server/routes/api/${v.route}`);
      console.error(`    duplicates action: ${v.action}`);
    }
  }

  if (crudViolations.length > 0) {
    console.error(`
These route files have no action twin at all, but they reach the app
database directly and return JSON — which is what an action is for.
Writing routes instead of actions from the start is the failure this
check exists to catch:
`);
    for (const v of crudViolations) {
      console.error(`  templates/${v.template}/server/routes/api/${v.route}`);
      console.error(`    ${v.reason}`);
    }
  }

  console.error(`
Fix options:
  1. Write a defineAction in templates/<template>/actions/ and delete the
     route. Call it from the UI with useActionQuery / useActionMutation (or
     callAction), and the agent gets the same capability for free.
     See .agents/skills/actions/SKILL.md.
  2. If the route genuinely cannot be an action — file upload, streaming/SSE,
     inbound webhook, OAuth callback, public unauthenticated URL, or a
     binary/non-JSON response — declare it with a pragma in the first 10
     lines of the route file, and say why:
       // guard:allow-api-route — <reason>
     Most such routes are already detected structurally (multipart parsing,
     sendStream, signature verification, sendRedirect, non-JSON content
     types, and paths listed in the auth plugin's publicPaths). Needing the
     pragma usually means the route is doing something unusual — say what.
  3. Only if this is a reviewed migration-in-progress, add an entry to
     ALLOWLIST or CRUD_ROUTE_BASELINE in
     scripts/guard-no-action-twin-routes.mjs. Those lists are a ratchet:
     they may shrink, never grow.
`);
  console.error(bar);
  process.exit(1);
}

main().catch((err) => {
  console.error("guard-no-action-twin-routes: unexpected error:", err);
  process.exit(1);
});
