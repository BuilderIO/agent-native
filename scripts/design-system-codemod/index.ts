import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { type CodemodResult, type Finding, runCodemod } from "./codemod.ts";
import { COMPONENT_NAMES, type ComponentName } from "./types.ts";

const ALIASES: Readonly<Record<string, ComponentName>> = {
  textarea: "text-area",
  sonner: "toast",
};

const REPO = path.resolve(import.meta.dirname, "../..");

export function formatOxfmt(files: string[]) {
  if (files.length === 0) return;
  execFileSync(path.join(REPO, "node_modules/.bin/oxfmt"), files, {
    cwd: REPO,
    stdio: "pipe",
  });
}

function unifiedDiff(before: string, after: string, name: string): string {
  fs.mkdirSync(path.join(REPO, ".tmp"), { recursive: true });
  const scratch = fs.mkdtempSync(path.join(REPO, ".tmp", "codemod-diff-"));
  try {
    const a = path.join(scratch, "a");
    const b = path.join(scratch, "b");
    fs.writeFileSync(a, before);
    fs.writeFileSync(b, after);
    try {
      execFileSync("diff", ["-u", "--label", name, "--label", name, a, b]);
      return "";
    } catch (error) {
      const output = (error as { stdout?: Buffer }).stdout;
      if (!output) throw error;
      return output.toString().replace(/^/gm, "    ");
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function sites(findings: Finding[]): number {
  return new Set(findings.map((finding) => `${finding.file}:${finding.offset}`))
    .size;
}

function group(findings: Finding[], dir: string): string[] {
  const byReason = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = `[${finding.component}] ${finding.reason}`;
    byReason.set(key, [...(byReason.get(key) ?? []), finding]);
  }
  const lines: string[] = [];
  for (const [reason, list] of [...byReason].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  )) {
    lines.push(`  ${reason} (${list.length})`);
    for (const finding of list) {
      lines.push(`    ${path.join(dir, finding.file)}:${finding.line}`);
    }
  }
  return lines;
}

export function formatReport(
  result: CodemodResult,
  dir: string,
  { write, diff }: { write: boolean; diff: boolean },
): string {
  const lines: string[] = [];
  lines.push(
    write ? "Changed files:" : "Would change (dry run, nothing written):",
  );
  for (const change of result.changes) {
    const counts = Object.entries(change.sites)
      .map(([name, count]) => `${name} ${count}`)
      .join(", ");
    lines.push(
      `  ${path.join(dir, change.file)}${counts ? `  (${counts})` : "  (shim)"}`,
    );
    if (diff) lines.push(unifiedDiff(change.before, change.after, change.file));
  }
  lines.push("", "Sites transformed:");
  for (const name of COMPONENT_NAMES) {
    lines.push(`  ${name.padEnd(10)} ${result.counts[name]}`);
  }
  lines.push("", "Shims:");
  for (const shim of result.shims) {
    lines.push(
      shim.swapped
        ? `  ${path.join(dir, shim.file)}: swapped to the new module`
        : `  ${path.join(dir, shim.file)}: left on the legacy module; held by ${shim.blockers.length} importer(s): ${shim.blockers.join(", ")}`,
    );
  }
  lines.push(
    "",
    `Not transformed (${result.skipped.length} sites), by reason:`,
    ...group(result.skipped, dir),
    "",
    `Transformed, needs a look (${sites(result.review)} sites), by reason:`,
    ...group(result.review, dir),
    "",
    `Test mocks of a legacy module (${result.mocks.length}):`,
    ...group(result.mocks, dir),
  );
  return `${lines.join("\n")}\n`;
}

function main(argv: string[]) {
  const args = [...argv];
  let write = false;
  let diff = false;
  let transforms: ComponentName[] | undefined;
  let toasterProps: string | undefined;
  let dir: string | undefined;
  for (let arg = args.shift(); arg !== undefined; arg = args.shift()) {
    if (arg === "--write") write = true;
    else if (arg === "--diff") diff = true;
    else if (arg === "--transform") {
      transforms = (args.shift() ?? "").split(",").map((raw) => {
        const name = ALIASES[raw] ?? raw;
        if (!(COMPONENT_NAMES as readonly string[]).includes(name)) {
          throw new Error(
            `unknown transform "${raw}"; one of ${COMPONENT_NAMES.join(", ")}`,
          );
        }
        return name as ComponentName;
      });
    } else if (arg === "--toaster-props") toasterProps = args.shift();
    else if (arg.startsWith("--")) throw new Error(`unknown flag ${arg}`);
    else dir = arg;
  }
  if (!dir) {
    throw new Error(
      "usage: tsx scripts/design-system-codemod/index.ts <dir> [--transform button,...] [--toaster-props '...'] [--write]",
    );
  }
  const result = runCodemod(dir, {
    ...(transforms ? { transforms } : {}),
    ...(toasterProps ? { toasterProps } : {}),
  });
  if (write) {
    const written = result.changes.map((change) => {
      const file = path.join(path.resolve(dir), change.file);
      fs.writeFileSync(file, change.after);
      return file;
    });
    formatOxfmt(written);
  }
  process.stdout.write(formatReport(result, dir, { write, diff }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
