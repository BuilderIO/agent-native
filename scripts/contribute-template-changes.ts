#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface Replacement {
  placeholder: string;
  value: string;
}

export interface InverseResult {
  content: string;
  counts: Record<string, number>;
  ambiguous: string[];
}

export type CandidateStatus = "added" | "modified" | "deleted";

export type ClassificationKind = "write" | "manual" | "skill" | "ignored";

export interface Classification {
  kind: ClassificationKind;
  reason?: string;
}

// Mirrors `shouldSkipScaffoldEntry` in packages/core/src/cli/create.ts: these
// entries are never copied into a generated app, so they can never carry an
// app-side change worth contributing back.
const IGNORED_SEGMENTS = new Set([
  ".git",
  "node_modules",
  ".netlify",
  ".vercel",
  ".generated",
  ".react-router",
  ".output",
  ".wrangler",
  ".turbo",
  ".vite",
  ".cache",
  "build",
  "dist",
  "coverage",
  "test-results",
  "playwright-report",
]);

const IGNORED_FILE_PATTERNS = [
  /^\.DS_Store$/,
  /\.tsbuildinfo$/,
  /\.log$/,
  /\.tmp\.json$/,
  /\.db(?:-shm|-wal|-journal)?$/,
  /\.sqlite\d?$/,
];

const MANUAL_EXACT = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "netlify.toml",
  "public/manifest.json",
  "app/root.tsx",
  "server/plugins/agent-chat.ts",
  "server/plugins/auth.ts",
  "learnings.md",
  "learnings.defaults.md",
]);

const MANUAL_PREFIXES = [".agent-native/"];

const MANUAL_REASONS: Record<string, string> = {
  "package.json": "rewritten by create (name/displayName/description/scaffold)",
  "pnpm-lock.yaml": "generated per install; never contributed",
  "netlify.toml": "site-specific surgery during create",
  "public/manifest.json": "app name rewritten during create",
  "app/root.tsx": "tracking app:/template: ids rewritten during create",
  "server/plugins/agent-chat.ts": "appId rewritten / replaced by workspacify",
  "server/plugins/auth.ts": "replaced by an inherited wrapper by workspacify",
  "learnings.md": "per-app learnings, not template content",
  "learnings.defaults.md": "deleted by workspacify; no faithful inverse",
};

export function titleCaseAppName(name: string): string {
  return name
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Inverse of `replacePlaceholders` in packages/core/src/cli/create.ts.
 *
 * Longest value first, because the forward pass writes independent tokens but
 * the reverse pass does not: a short app name that is a substring of the
 * workspace name would otherwise swallow the longer match.
 */
export function inversePlaceholders(
  content: string,
  replacements: Replacement[],
  allow?: Set<string>,
): InverseResult {
  const active = replacements.filter(
    (item) =>
      item.value.length > 0 && (!allow || allow.has(item.placeholder)),
  );
  const ordered = [...active].sort((a, b) => b.value.length - a.value.length);

  const ambiguous: string[] = [];
  for (const a of active) {
    for (const b of active) {
      if (a === b || a.placeholder === b.placeholder) continue;
      if (a.value === b.value || a.value.includes(b.value)) {
        const pair = [a.placeholder, b.placeholder].sort().join(" / ");
        if (!ambiguous.includes(pair)) ambiguous.push(pair);
      }
    }
  }

  const counts: Record<string, number> = {};
  let next = content;
  for (const { placeholder, value } of ordered) {
    const pattern = new RegExp(escapeRegExp(value), "g");
    const matches = next.match(pattern);
    counts[placeholder] = matches ? matches.length : 0;
    if (matches) next = next.replace(pattern, placeholder);
  }
  return { content: next, counts, ambiguous };
}

/**
 * Which placeholders the template file at the same path actually uses. A
 * modified file inherits exactly that set, so contributing back a change to
 * `templates/slides` does not rewrite every literal "slides" in the file.
 */
export function placeholderAllowances(
  templateContent: string | undefined,
): Set<string> {
  if (templateContent === undefined) {
    return new Set(["{{APP_NAME}}", "{{APP_TITLE}}", "{{WORKSPACE_NAME}}"]);
  }
  const allowed = new Set<string>();
  for (const token of [
    "{{APP_NAME}}",
    "{{APP_TITLE}}",
    "{{WORKSPACE_NAME}}",
  ]) {
    if (templateContent.includes(token)) allowed.add(token);
  }
  return allowed;
}

/** App `.gitignore` came from the template's `_gitignore`. */
export function toTemplateRelPath(rel: string): string {
  return rel === ".gitignore" ? "_gitignore" : rel;
}

export function classifyRelPath(
  rel: string,
  opts: { rootSkills: Set<string> },
): Classification {
  const segments = rel.split("/");
  const base = segments[segments.length - 1];

  for (const segment of segments) {
    if (IGNORED_SEGMENTS.has(segment)) {
      return { kind: "ignored", reason: `under ${segment}/` };
    }
  }
  if (IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(base))) {
    return { kind: "ignored", reason: "generated or local artifact" };
  }

  if (base === ".env" || base.startsWith(".env.")) {
    return { kind: "manual", reason: "environment file; never contributed" };
  }
  if (MANUAL_EXACT.has(rel)) {
    return { kind: "manual", reason: MANUAL_REASONS[rel] ?? "create rewrites this file" };
  }
  for (const prefix of MANUAL_PREFIXES) {
    if (rel.startsWith(prefix)) {
      return { kind: "manual", reason: `under ${prefix} (framework state)` };
    }
  }

  if (rel.startsWith(".agents/skills/")) {
    const skill = segments[2];
    if (skill && opts.rootSkills.has(skill)) {
      return {
        kind: "skill",
        reason: `root .agents/skills/${skill} is canonical (sync:workspace-skills owns the template copy)`,
      };
    }
  }

  return { kind: "write" };
}

export function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        i += 1;
        if (glob[i + 1] === "/") i += 1;
        out += "(?:.*/)?";
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    out += escapeRegExp(ch);
  }
  return new RegExp(`^${out}$`);
}

export function matchesAnyGlob(rel: string, globs: string[]): boolean {
  if (globs.length === 0) return true;
  return globs.some((glob) => globToRegExp(glob).test(rel));
}

export function isBinary(buf: Buffer): boolean {
  const window = buf.subarray(0, 8000);
  return window.includes(0);
}

export function listFilesRecursive(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs).split(path.sep).join("/");
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (IGNORED_SEGMENTS.has(entry.name)) continue;
      out.push(...listFilesRecursive(abs, base));
      continue;
    }
    if (!entry.isFile()) continue;
    out.push(rel);
  }
  return out.sort();
}

export interface Candidate {
  rel: string;
  status: CandidateStatus;
}

export function diffTrees(baselineDir: string, appDir: string): Candidate[] {
  const baselineFiles = new Set(listFilesRecursive(baselineDir));
  const appFiles = new Set(listFilesRecursive(appDir));
  const out: Candidate[] = [];
  for (const rel of appFiles) {
    if (!baselineFiles.has(rel)) {
      out.push({ rel, status: "added" });
      continue;
    }
    const a = fs.readFileSync(path.join(baselineDir, rel));
    const b = fs.readFileSync(path.join(appDir, rel));
    if (!a.equals(b)) out.push({ rel, status: "modified" });
  }
  for (const rel of baselineFiles) {
    if (!appFiles.has(rel)) out.push({ rel, status: "deleted" });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/* ─────────────────────────────────────────────────────────────────────────
 * CLI
 * ───────────────────────────────────────────────────────────────────────── */

interface Options {
  app: string;
  template?: string;
  framework?: string;
  baseline?: string;
  dryRun: boolean;
  include: string[];
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { app: "", dryRun: false, include: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return value;
    };
    if (arg === "--app") opts.app = next();
    else if (arg === "--template") opts.template = next();
    else if (arg === "--framework") opts.framework = next();
    else if (arg === "--baseline") opts.baseline = next();
    else if (arg === "--include") opts.include.push(next());
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!opts.app) {
    printHelp();
    throw new Error("--app <path-to-app-dir> is required");
  }
  return opts;
}

function printHelp(): void {
  console.log(
    [
      "Land changes made to a template-derived app back into templates/<name>/.",
      "",
      "  pnpm contribute:template --app <path-to-app-dir> [options]",
      "",
      "  --app <dir>        App directory inside your workspace (required)",
      "  --template <name>  Template to contribute to (defaults to",
      "                     agent-native.scaffold.template in the app package.json)",
      "  --framework <dir>  Framework checkout (defaults to this repo)",
      "  --baseline <dir>   Pristine generated-app baseline to diff against",
      "  --include <glob>   Only consider matching app-relative paths (repeatable)",
      "  --dry-run          Print the plan and write nothing",
      "",
      "Writes unstaged working-tree edits on the current branch. Never stages,",
      "commits, or moves branches.",
    ].join("\n"),
  );
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryGit(cwd: string, args: string[]): string | undefined {
  try {
    return git(cwd, args);
  } catch {
    return undefined;
  }
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return undefined;
  }
}

interface Baseline {
  dir: string;
  source: string;
  approximate: boolean;
}

function resolveBaseline(
  appDir: string,
  templateDir: string,
  explicit: string | undefined,
  tmpRoot: string,
): Baseline {
  if (explicit) {
    const dir = path.resolve(explicit);
    if (!fs.existsSync(dir)) {
      throw new Error(`--baseline directory not found: ${dir}`);
    }
    return { dir, source: `--baseline ${dir}`, approximate: false };
  }

  const toplevel = tryGit(appDir, ["rev-parse", "--show-toplevel"]);
  if (toplevel) {
    const appRel =
      path.relative(toplevel, appDir).split(path.sep).join("/") || ".";
    const ref = `refs/agent-native/template-baseline/${appRel}`;
    const resolved = tryGit(toplevel, ["rev-parse", "--verify", "--quiet", ref]);
    if (resolved) {
      const entries =
        tryGit(toplevel, ["ls-tree", "--name-only", `${ref}^{tree}`]) ?? "";
      const names = entries.split("\n").filter(Boolean);
      const spec = names.includes("package.json") ? `${ref}^{tree}` : `${ref}:${appRel}`;
      const dir = path.join(tmpRoot, "baseline");
      fs.mkdirSync(dir, { recursive: true });
      const tarPath = path.join(tmpRoot, "baseline.tar");
      try {
        execFileSync("git", ["archive", "--format=tar", "-o", tarPath, spec], {
          cwd: toplevel,
          stdio: ["ignore", "pipe", "pipe"],
        });
        execFileSync("tar", ["-xf", tarPath, "-C", dir], { stdio: "pipe" });
        return { dir, source: `${ref} (${resolved.slice(0, 8)})`, approximate: false };
      } catch (error) {
        console.warn(
          `[contribute:template] Found ${ref} but could not extract it (${
            error instanceof Error ? error.message : String(error)
          }). Falling back.`,
        );
      }
    }
  }

  return {
    dir: templateDir,
    source: `current ${path.basename(path.dirname(templateDir))}/${path.basename(templateDir)} in the framework checkout`,
    approximate: true,
  };
}

function numstat(basePath: string | undefined, appPath: string | undefined): string {
  const a = basePath && fs.existsSync(basePath) ? basePath : "/dev/null";
  const b = appPath && fs.existsSync(appPath) ? appPath : "/dev/null";
  try {
    execFileSync("git", ["diff", "--no-index", "--numstat", "--", a, b], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return "no textual change";
  } catch (error) {
    const out = String((error as { stdout?: string }).stdout ?? "").trim();
    const first = out.split("\n")[0] ?? "";
    const [added, removed] = first.split("\t");
    if (added === "-" || removed === "-") return "binary change";
    if (!added) return "changed";
    return `+${added} -${removed}`;
  }
}

interface MergeOutcome {
  text: string;
  conflicts: number;
}

function threeWayMerge(
  oursText: string,
  baseText: string,
  theirsText: string,
  labels: [string, string, string],
  tmpRoot: string,
): MergeOutcome {
  const dir = fs.mkdtempSync(path.join(tmpRoot, "merge-"));
  const ours = path.join(dir, "ours");
  const base = path.join(dir, "base");
  const theirs = path.join(dir, "theirs");
  fs.writeFileSync(ours, oursText);
  fs.writeFileSync(base, baseText);
  fs.writeFileSync(theirs, theirsText);
  const args = [
    "merge-file",
    "-p",
    "--diff3",
    "-L",
    labels[0],
    "-L",
    labels[1],
    "-L",
    labels[2],
    ours,
    base,
    theirs,
  ];
  try {
    const text = execFileSync("git", args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { text, conflicts: 0 };
  } catch (error) {
    const status = (error as { status?: number }).status ?? -1;
    const text = String((error as { stdout?: string }).stdout ?? "");
    if (status < 0 || !text) {
      throw new Error(`git merge-file failed: ${String(error)}`);
    }
    return { text, conflicts: status };
  }
}

interface Outcome {
  rel: string;
  target: string;
  status: CandidateStatus;
  note?: string;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const frameworkDir = path.resolve(
    opts.framework ?? path.resolve(import.meta.dirname, ".."),
  );
  const appDir = path.resolve(opts.app);
  if (!fs.existsSync(appDir)) throw new Error(`App directory not found: ${appDir}`);

  const appPkg = readJson(path.join(appDir, "package.json"));
  const scaffold = (appPkg?.["agent-native"] as Record<string, unknown> | undefined)
    ?.scaffold as Record<string, unknown> | undefined;
  const templateName =
    opts.template ??
    (typeof scaffold?.template === "string" ? scaffold.template : undefined);
  if (!templateName) {
    throw new Error(
      `Cannot determine the source template. ${path.join(appDir, "package.json")} has no ` +
        '"agent-native".scaffold.template — pass --template <name> explicitly.',
    );
  }
  const templateDir = path.join(frameworkDir, "templates", templateName);
  if (!fs.existsSync(templateDir)) {
    throw new Error(`Template not found: ${templateDir}`);
  }

  const appName =
    (typeof appPkg?.name === "string" ? appPkg.name.replace(/^@[^/]+\//, "") : "") ||
    path.basename(appDir);
  const appTitle = titleCaseAppName(appName);
  const displayName =
    typeof appPkg?.displayName === "string" ? appPkg.displayName : undefined;
  const workspaceName = resolveWorkspaceName(appDir, appPkg);

  const replacements: Replacement[] = [
    { placeholder: "{{APP_TITLE}}", value: appTitle },
    { placeholder: "{{APP_NAME}}", value: appName },
  ];
  if (displayName && displayName !== appTitle) {
    replacements.push({ placeholder: "{{APP_TITLE}}", value: displayName });
  }
  if (workspaceName) {
    replacements.push({ placeholder: "{{WORKSPACE_NAME}}", value: workspaceName });
  }

  const rootSkillsDir = path.join(frameworkDir, ".agents", "skills");
  const rootSkills = new Set(
    fs.existsSync(rootSkillsDir)
      ? fs
          .readdirSync(rootSkillsDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : [],
  );

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "contribute-template-"));
  try {
    const baseline = resolveBaseline(appDir, templateDir, opts.baseline, tmpRoot);
    const branch =
      tryGit(frameworkDir, ["rev-parse", "--abbrev-ref", "HEAD"]) ?? "(unknown)";

    console.log(`app         ${appDir}`);
    console.log(`template    templates/${templateName}`);
    console.log(`framework   ${frameworkDir} (branch ${branch})`);
    console.log(`baseline    ${baseline.source}`);
    console.log(
      `tokens      {{APP_NAME}}=${appName} {{APP_TITLE}}=${appTitle}` +
        (workspaceName ? ` {{WORKSPACE_NAME}}=${workspaceName}` : ""),
    );
    if (baseline.approximate) {
      console.log("");
      console.log(
        "!! APPROXIMATE BASE: no template-baseline ref and no --baseline. The\n" +
          "!! three-way base is the CURRENT template, so upstream template work done\n" +
          "!! since this app was generated can be silently reverted. Writes below are\n" +
          "!! plain overwrites, not merges. Review every hunk.",
      );
    }
    console.log("");

    const candidates = diffTrees(baseline.dir, appDir).filter((c) =>
      matchesAnyGlob(c.rel, opts.include),
    );

    const written: Outcome[] = [];
    const conflicted: Outcome[] = [];
    const manual: Outcome[] = [];
    const skipped: Outcome[] = [];
    const warnings: string[] = [];

    for (const candidate of candidates) {
      const { rel, status } = candidate;
      const classification = classifyRelPath(rel, { rootSkills });
      if (classification.kind === "ignored") continue;

      const appPath = path.join(appDir, rel);
      const basePath = path.join(baseline.dir, rel);

      if (status === "deleted") {
        manual.push({
          rel,
          target: "—",
          status,
          note: `deleted in the app (${classification.kind === "skill" ? "root skill" : "template"} copy left intact)`,
        });
        continue;
      }

      if (classification.kind === "manual") {
        manual.push({
          rel,
          target: "—",
          status,
          note: `${classification.reason}; ${numstat(status === "added" ? undefined : basePath, appPath)}`,
        });
        continue;
      }

      const isSkill = classification.kind === "skill";
      const targetRel = isSkill ? rel : toTemplateRelPath(rel);
      const targetAbs = isSkill
        ? path.join(frameworkDir, targetRel)
        : path.join(templateDir, targetRel);
      const targetLabel = isSkill
        ? targetRel
        : `templates/${templateName}/${targetRel}`;

      const appBuf = fs.readFileSync(appPath);
      if (isBinary(appBuf)) {
        if (!opts.dryRun) {
          fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
          fs.writeFileSync(targetAbs, appBuf);
        }
        written.push({ rel, target: targetLabel, status, note: "binary; copied verbatim" });
        continue;
      }

      const appText = appBuf.toString("utf-8");
      if (workspaceName && appText.includes(`@${workspaceName}/shared`)) {
        manual.push({
          rel,
          target: targetLabel,
          status,
          note: `imports @${workspaceName}/shared, which templates never have — no faithful inverse`,
        });
        continue;
      }

      const templateText = fs.existsSync(targetAbs)
        ? fs.readFileSync(targetAbs, "utf-8")
        : undefined;
      const allow = placeholderAllowances(templateText);
      const inverse = inversePlaceholders(appText, replacements, allow);
      const substituted = Object.entries(inverse.counts)
        .filter(([, n]) => n > 0)
        .map(([token, n]) => `${token}×${n}`)
        .join(" ");
      if (inverse.ambiguous.length > 0) {
        warnings.push(
          `${rel}: placeholder values overlap (${inverse.ambiguous.join(", ")}); the inverse is a guess`,
        );
      }
      if (templateText === undefined && substituted) {
        warnings.push(`${rel}: new file; all placeholders applied (${substituted})`);
      }

      let outText = inverse.content;
      let conflicts = 0;
      if (templateText !== undefined && !baseline.approximate) {
        const baseText = fs.existsSync(basePath)
          ? inversePlaceholders(
              fs.readFileSync(basePath, "utf-8"),
              replacements,
              allow,
            ).content
          : "";
        const merged = threeWayMerge(
          templateText,
          baseText,
          inverse.content,
          [targetLabel, "generated-app baseline", `${appName}/${rel}`],
          tmpRoot,
        );
        outText = merged.text;
        conflicts = merged.conflicts;
      }

      if (templateText !== undefined && outText === templateText) {
        skipped.push({ rel, target: targetLabel, status, note: "already identical" });
        continue;
      }

      if (!opts.dryRun) {
        fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
        fs.writeFileSync(targetAbs, outText);
      }
      const note = [
        substituted || undefined,
        baseline.approximate && templateText !== undefined
          ? "plain overwrite (approximate base)"
          : undefined,
        isSkill ? classification.reason : undefined,
      ]
        .filter(Boolean)
        .join("; ");
      if (conflicts > 0) {
        conflicted.push({
          rel,
          target: targetLabel,
          status,
          note: `${conflicts} conflict(s)${note ? `; ${note}` : ""}`,
        });
      } else {
        written.push({ rel, target: targetLabel, status, note: note || undefined });
      }
    }

    report({
      dryRun: opts.dryRun,
      written,
      conflicted,
      manual,
      skipped,
      warnings,
      reroutedSkills: [...written, ...conflicted].some((o) =>
        o.target.startsWith(".agents/skills/"),
      ),
      templateName,
      approximate: baseline.approximate,
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function resolveWorkspaceName(
  appDir: string,
  appPkg: Record<string, unknown> | undefined,
): string | undefined {
  const deps = {
    ...((appPkg?.dependencies as Record<string, string> | undefined) ?? {}),
    ...((appPkg?.devDependencies as Record<string, string> | undefined) ?? {}),
  };
  for (const key of Object.keys(deps)) {
    const match = key.match(/^@([^/]+)\/shared$/);
    if (match) return match[1];
  }
  let dir = path.dirname(appDir);
  for (let i = 0; i < 5; i += 1) {
    const pkg = readJson(path.join(dir, "package.json"));
    const core = (pkg?.["agent-native"] as Record<string, unknown> | undefined)
      ?.workspaceCore;
    if (typeof core === "string") {
      const match = core.match(/^@([^/]+)\//);
      if (match) return match[1];
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function printGroup(title: string, items: Outcome[]): void {
  console.log(`${title} (${items.length})`);
  if (items.length === 0) {
    console.log("  none");
    return;
  }
  for (const item of items) {
    const flag = item.status === "added" ? "A" : item.status === "deleted" ? "D" : "M";
    console.log(
      `  ${flag} ${item.target === "—" ? item.rel : item.target}${
        item.note ? `  — ${item.note}` : ""
      }`,
    );
  }
}

function report(input: {
  dryRun: boolean;
  written: Outcome[];
  conflicted: Outcome[];
  manual: Outcome[];
  skipped: Outcome[];
  warnings: string[];
  reroutedSkills: boolean;
  templateName: string;
  approximate: boolean;
}): void {
  printGroup(input.dryRun ? "Would write" : "Written", input.written);
  console.log("");
  printGroup("Conflicted (resolve the markers by hand)", input.conflicted);
  console.log("");
  printGroup("Manual porting required", input.manual);
  if (input.skipped.length > 0) {
    console.log("");
    printGroup("Unchanged", input.skipped);
  }
  if (input.warnings.length > 0) {
    console.log("");
    console.log(`Warnings (${input.warnings.length})`);
    for (const warning of input.warnings) console.log(`  ! ${warning}`);
  }

  console.log("");
  console.log("Next steps");
  if (input.dryRun) {
    console.log("  0. Re-run without --dry-run to apply.");
  }
  console.log("  1. git status / git diff — everything above is unstaged.");
  console.log("  2. pnpm fmt");
  console.log("  3. pnpm guard:template-standard");
  console.log("  4. pnpm guard:template-ui-imports");
  console.log("  5. pnpm guard:no-unscoped-queries && pnpm guard:request-storms");
  console.log("     (or just `pnpm guards` for the full set)");
  if (input.reroutedSkills) {
    console.log(
      "  6. pnpm sync:workspace-skills — skill edits landed in root .agents/skills;",
    );
    console.log(
      "     the templates/*/.agents/skills copies are generated from there.",
    );
    console.log("     Verify with pnpm guard:workspace-skills.");
  }
  console.log("");
  console.log(
    `  Changesets: changes confined to templates/${input.templateName} do NOT need a`,
  );
  console.log(
    "  .changeset/*.md. Only publishable package source (packages/core, dispatch,",
  );
  console.log("  scheduling, pinpoint) does.");
  console.log(
    `  User-facing change? From templates/${input.templateName} run:`,
  );
  console.log(
    '    agent-native changelog add "<one user-facing sentence>" --type added|improved|fixed',
  );
  if (input.approximate) {
    console.log("");
    console.log(
      "  Reminder: the base was approximate. Diff against origin/main to confirm no",
    );
    console.log("  upstream template work was reverted.");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(
      `[contribute:template] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
