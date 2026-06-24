/**
 * `agent-native changelog` — author and roll up an app's user-facing changelog.
 *
 * The model mirrors changesets: instead of editing the shared CHANGELOG.md
 * directly (which conflicts when many agents work in parallel), each change
 * drops a small pending entry file under `changelog/`. A later `release` rolls
 * every pending file up into a single dated section of CHANGELOG.md.
 *
 *   agent-native changelog add "Recordings can be trimmed before sharing" --type added
 *   agent-native changelog release           # roll pending → CHANGELOG.md (today)
 *   agent-native changelog list              # show pending + released
 *
 * Runs in the current app directory (process.cwd()).
 */
import fs from "fs";
import path from "path";

import {
  parsePendingEntry,
  parseChangelog,
  rollupChangelog,
  changelogSlug,
  CHANGELOG_HEADER,
  type ChangelogChangeType,
} from "../changelog/parse.js";

const CHANGELOG_FILE = "CHANGELOG.md";
const PENDING_DIR = "changelog";

function todayIso(): string {
  // Local date in YYYY-MM-DD. The CLI is the one place a wall-clock read is
  // appropriate (unlike workflow scripts), so `new Date()` is fine here.
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Minimal flag parser: supports `--key value` and `--key=value`. */
function parseFlags(args: string[]): {
  flags: Record<string, string>;
  rest: string[];
} {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
          flags[arg.slice(2)] = next;
          i++;
        } else {
          flags[arg.slice(2)] = "true";
        }
      }
    } else {
      rest.push(arg);
    }
  }
  return { flags, rest };
}

function printUsage(): void {
  console.log(
    [
      "Usage:",
      '  agent-native changelog add "<summary>" [--type added|improved|fixed|changed|removed|security] [--date YYYY-MM-DD]',
      "  agent-native changelog release [--date YYYY-MM-DD]",
      "  agent-native changelog list",
      "",
      "Entries are user-facing notes. `add` writes a pending file under",
      `  ${PENDING_DIR}/; \`release\` rolls all pending files into ${CHANGELOG_FILE}.`,
    ].join("\n"),
  );
}

function cmdAdd(args: string[]): number {
  const { flags, rest } = parseFlags(args);
  const summary = rest.join(" ").trim();
  if (!summary) {
    console.error('Provide a summary, e.g. changelog add "Faster search"');
    return 1;
  }
  const type = (flags.type ?? "changed") as ChangelogChangeType;
  const date = flags.date?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? todayIso();

  const dir = path.resolve(PENDING_DIR);
  fs.mkdirSync(dir, { recursive: true });

  const slug = changelogSlug(summary) || "entry";
  let file = path.join(dir, `${date}-${slug}.md`);
  let n = 2;
  while (fs.existsSync(file)) {
    file = path.join(dir, `${date}-${slug}-${n++}.md`);
  }

  // Blank line after the closing frontmatter delimiter so the generated file
  // is already Prettier-clean (Markdown requires a blank line before body text)
  // and never trips the repo fmt check.
  const content = `---\ntype: ${type}\ndate: ${date}\n---\n\n${summary}\n`;
  fs.writeFileSync(file, content, "utf-8");
  console.log(`Added changelog entry: ${path.relative(process.cwd(), file)}`);
  return 0;
}

function readPending(): { file: string; content: string }[] {
  const dir = path.resolve(PENDING_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
    .sort()
    .map((f) => ({
      file: path.join(dir, f),
      content: fs.readFileSync(path.join(dir, f), "utf-8"),
    }));
}

function cmdRelease(args: string[]): number {
  const { flags } = parseFlags(args);
  const date = flags.date?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? todayIso();

  const pendingFiles = readPending();
  if (pendingFiles.length === 0) {
    console.log("No pending changelog entries to release.");
    return 0;
  }

  const pending = pendingFiles.map((p) => parsePendingEntry(p.content));
  const changelogPath = path.resolve(CHANGELOG_FILE);
  const existing = fs.existsSync(changelogPath)
    ? fs.readFileSync(changelogPath, "utf-8")
    : "";

  const next = rollupChangelog(existing, pending, date);
  fs.writeFileSync(changelogPath, next, "utf-8");

  // Remove the pending entries now that they're released.
  for (const p of pendingFiles) fs.rmSync(p.file);

  console.log(
    `Released ${pendingFiles.length} entr${
      pendingFiles.length === 1 ? "y" : "ies"
    } into ${CHANGELOG_FILE} (## ${date}).`,
  );
  return 0;
}

function cmdList(): number {
  const pending = readPending();
  const changelogPath = path.resolve(CHANGELOG_FILE);
  const released = fs.existsSync(changelogPath)
    ? parseChangelog(fs.readFileSync(changelogPath, "utf-8"))
    : [];

  console.log(`Pending (${pending.length}):`);
  for (const p of pending) {
    const entry = parsePendingEntry(p.content);
    console.log(
      `  - [${entry.type}] ${entry.text.split("\n")[0]}  (${path.basename(
        p.file,
      )})`,
    );
  }
  console.log("");
  console.log(`Released (${released.length}):`);
  for (const r of released.slice(0, 10)) console.log(`  - ${r.title}`);
  return 0;
}

export async function runChangelog(args: string[]): Promise<number> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "add":
      return cmdAdd(rest);
    case "release":
      return cmdRelease(rest);
    case "list":
      return cmdList();
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printUsage();
      return 0;
    default:
      console.error(`Unknown changelog subcommand: ${sub}\n`);
      printUsage();
      return 1;
  }
}

// Re-export header for callers that want to seed an empty CHANGELOG.md.
export { CHANGELOG_HEADER };
