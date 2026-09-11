#!/usr/bin/env node
/**
 * ADVISORY audit of a template's `actions/` directory. Helps keep the agent's
 * action surface small and orthogonal — every action is a tool in the model's
 * context window, so each one has a real cost.
 *
 * It prints two kinds of suggestions and ALWAYS exits 0. This is a hint, not a
 * gate: it does a regex-level static scan (no TypeScript compilation) and uses
 * deliberately conservative heuristics, so false positives are expected. Never
 * wire it into CI as a failing check.
 *
 *   1. UI-dead mutating actions — HTTP-exposed mutating actions (NOT `readOnly`,
 *      NOT `http: { method: "GET" }`, and NOT `http: false`) whose action name
 *      never appears anywhere under the template's `app/` directory. Being
 *      HTTP-exposed signals the action was meant to be UI-callable, yet the UI
 *      no longer names it — so it is likely UI-dead while still costing a slot
 *      in the model's tool list. Consider deleting it, or hiding it from the
 *      model with `agentTool: false` if it must stay on a programmatic / HTTP
 *      path. `http: false` actions (e.g. `navigate`, `view-screen`) are
 *      deliberately agent-only and are intentionally NOT flagged.
 *
 *   2. Redundant action clusters — groups of actions that share a common
 *      verb + noun prefix (e.g. `update-name`, `update-order`, `update-color`)
 *      that could likely collapse into one orthogonal CRUD-style action (e.g. a
 *      single `update` that takes a patch of fields).
 *
 * Usage:
 *   node scripts/audit-template-actions.mjs                 # all templates
 *   node scripts/audit-template-actions.mjs forms           # one template
 *   node scripts/audit-template-actions.mjs forms mail      # several templates
 *
 * Also runnable via `pnpm actions:audit [template ...]`.
 *
 * Action-name convention: an action's name is its filename without `.ts`
 * (e.g. `actions/update-form.ts` → `update-form`). UI/agent/CLI callers
 * reference it by that string (`useActionMutation("update-form")`,
 * `callAction("update-form")`, `pnpm action update-form`). A custom
 * `http: { path }` only changes the HTTP route, not the agent tool name, so we
 * key everything off the filename.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const templatesDir = path.join(repoRoot, "templates");

// Action filenames that are never agent tools (dispatcher / plumbing).
const SKIP_ACTION_NAMES = new Set(["run"]);

// Verbs that commonly front per-field mutation actions worth collapsing into
// one orthogonal action. Conservative on purpose — read-ish verbs like `get`
// or `list` are intentionally excluded because the provider-api / db-query
// escape hatches, not the cluster check, are the answer for reads.
const CLUSTER_VERBS = ["update", "set", "change", "edit", "toggle", "rename"];

/** Discover template slugs that actually have an `actions/` directory. */
function discoverTemplates() {
  if (!fs.existsSync(templatesDir)) return [];
  return fs
    .readdirSync(templatesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((slug) => fs.existsSync(path.join(templatesDir, slug, "actions")))
    .sort();
}

/** Recursively collect file paths under `dir` matching `extRe`. */
function walk(dir, extRe, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".generated")
        continue;
      walk(full, extRe, out);
    } else if (extRe.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Parse a single `actions/<name>.ts` file. Returns null for files that are not
 * a `defineAction` (e.g. the `run.ts` dispatcher or helper modules).
 *
 * `mutating` mirrors the framework's own inference: an action is treated as
 * mutating unless it is `readOnly: true` or `http: { method: "GET" }`.
 */
function parseActionFile(absPath) {
  const name = path.basename(absPath, ".ts");
  if (SKIP_ACTION_NAMES.has(name)) return null;
  const src = fs.readFileSync(absPath, "utf-8");
  if (!/\bdefineAction\s*\(/.test(src)) return null;

  const isGet = /\bhttp\s*:\s*\{[^}]*method\s*:\s*["']GET["']/.test(src);
  const isReadOnly = /\breadOnly\s*:\s*true\b/.test(src);
  // `http: false` actions are agent-only by design (navigate, view-screen,
  // db plumbing). The UI never names them, so "not referenced under app/" is
  // expected — not a UI-death signal. We only flag HTTP-exposed actions.
  const httpDisabled = /\bhttp\s*:\s*false\b/.test(src);
  // `agentTool: false` already hides it from the model, so it isn't UI-dead
  // "exposed to the model" tool debt even if the UI never calls it.
  const agentToolHidden = /\bagentTool\s*:\s*false\b/.test(src);

  return {
    name,
    absPath,
    mutating: !isGet && !isReadOnly,
    httpExposed: !httpDisabled,
    agentToolHidden,
  };
}

/** True if `name` appears as a string literal anywhere in `appSrc`. */
function referencedInApp(name, appSrc) {
  // Match the action name only when quoted, to avoid matching substrings of
  // unrelated identifiers. Covers "update-form", 'update-form', `update-form`.
  const re = new RegExp(`["'\`]${escapeRe(name)}["'\`]`);
  return re.test(appSrc);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Group mutating actions by `<verb>-<noun>` prefix where verb ∈ CLUSTER_VERBS.
 * Returns clusters with 2+ members sharing the same verb+noun, e.g.
 * `update-form-title`, `update-form-fields` → suggest one `update-form`.
 */
function findRedundantClusters(actions) {
  const groups = new Map(); // key "verb noun" → string[] of action names
  for (const a of actions) {
    if (!a.mutating) continue;
    const parts = a.name.split("-");
    if (parts.length < 3) continue; // need verb + noun + qualifier to be redundant
    const verb = parts[0];
    if (!CLUSTER_VERBS.includes(verb)) continue;
    const noun = parts[1];
    const key = `${verb}-${noun}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a.name);
  }
  const clusters = [];
  for (const [prefix, members] of groups) {
    if (members.length >= 2) {
      clusters.push({ prefix, members: members.sort() });
    }
  }
  return clusters.sort((a, b) => a.prefix.localeCompare(b.prefix));
}

function auditTemplate(slug) {
  const actionsDir = path.join(templatesDir, slug, "actions");
  const appDir = path.join(templatesDir, slug, "app");

  const actionFiles = walk(actionsDir, /\.ts$/);
  const actions = actionFiles.map(parseActionFile).filter((a) => a !== null);

  if (actions.length === 0) {
    return { slug, total: 0, uiDead: [], clusters: [] };
  }

  // Concatenate the whole app/ tree once; we only need substring presence.
  const appSrc = walk(appDir, /\.(ts|tsx|js|jsx)$/)
    .map((f) => fs.readFileSync(f, "utf-8"))
    .join("\n");

  const uiDead = actions
    .filter((a) => a.mutating && a.httpExposed && !a.agentToolHidden)
    .filter((a) => !referencedInApp(a.name, appSrc))
    .map((a) => a.name)
    .sort();

  const clusters = findRedundantClusters(actions);

  return { slug, total: actions.length, uiDead, clusters };
}

// ── Run ────────────────────────────────────────────────────────────────────

const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const all = discoverTemplates();
const targets =
  requested.length > 0
    ? requested.filter((slug) => {
        const ok = all.includes(slug);
        if (!ok) {
          console.warn(
            `audit-template-actions: skipping "${slug}" — no templates/${slug}/actions directory.`,
          );
        }
        return ok;
      })
    : all;

console.log("");
console.log(
  "audit-template-actions (ADVISORY — suggestions only, never fails CI)",
);
console.log(
  "Every action is a tool in the model's context window. Prefer the fewest,",
);
console.log("most orthogonal actions. See the `actions` skill for guidance.");
console.log("");

let totalFindings = 0;

for (const slug of targets) {
  const { total, uiDead, clusters } = auditTemplate(slug);
  const findings = uiDead.length + clusters.length;
  totalFindings += findings;

  if (findings === 0) {
    console.log(`  ${slug}: clean (${total} actions, no suggestions)`);
    continue;
  }

  console.log(`  ${slug}: ${total} actions, ${findings} suggestion(s)`);

  if (uiDead.length > 0) {
    console.log(
      `    Possibly UI-dead mutating actions still exposed to the model:`,
    );
    for (const name of uiDead) {
      console.log(
        `      - ${name}  → name never referenced under app/. Delete it, or set ` +
          `agentTool: false if it must stay HTTP/programmatic-only.`,
      );
    }
  }

  if (clusters.length > 0) {
    console.log(`    Possibly redundant per-field action clusters:`);
    for (const { prefix, members } of clusters) {
      console.log(
        `      - ${members.join(", ")}  → consider collapsing into one ` +
          `orthogonal "${prefix}" action that takes a patch of fields.`,
      );
    }
  }
  console.log("");
}

console.log("");
console.log(
  totalFindings === 0
    ? "audit-template-actions: no suggestions."
    : `audit-template-actions: ${totalFindings} advisory suggestion(s) across ${targets.length} template(s). These are hints, not errors.`,
);

// ADVISORY ONLY — never fail CI.
process.exit(0);
