#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const templatesDir = path.join(repoRoot, "templates");

const SKIP_ACTION_NAMES = new Set(["run"]);

const CLUSTER_VERBS = ["update", "set", "change", "edit", "toggle", "rename"];

function discoverTemplates() {
  if (!fs.existsSync(templatesDir)) return [];
  return fs
    .readdirSync(templatesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((slug) => fs.existsSync(path.join(templatesDir, slug, "actions")))
    .sort();
}

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

function parseActionFile(absPath) {
  const name = path.basename(absPath, ".ts");
  if (SKIP_ACTION_NAMES.has(name)) return null;
  const src = fs.readFileSync(absPath, "utf-8");
  if (!/\bdefineAction\s*\(/.test(src)) return null;

  const isGet = /\bhttp\s*:\s*\{[^}]*method\s*:\s*["']GET["']/.test(src);
  const isReadOnly = /\breadOnly\s*:\s*true\b/.test(src);
  const httpDisabled = /\bhttp\s*:\s*false\b/.test(src);
  const agentToolHidden = /\bagentTool\s*:\s*false\b/.test(src);

  return {
    name,
    absPath,
    mutating: !isGet && !isReadOnly,
    httpExposed: !httpDisabled,
    agentToolHidden,
  };
}

function referencedInApp(name, appSrc) {
  const re = new RegExp(`["'\`]${escapeRe(name)}["'\`]`);
  return re.test(appSrc);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findRedundantClusters(actions) {
  const groups = new Map();
  for (const a of actions) {
    if (!a.mutating) continue;
    const parts = a.name.split("-");
    if (parts.length < 3) continue;
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

process.exit(0);
