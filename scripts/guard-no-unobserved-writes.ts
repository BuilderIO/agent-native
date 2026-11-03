/**
 * guard-no-unobserved-writes.ts
 *
 * A failed write action is classified from the writes the framework SAW it
 * make. It sees every database write and every non-GET `fetch`, and nothing
 * else. A disk write, a child process, a `node:http` request or a
 * vendor SDK call is invisible unless the code calls `noteExternalWrite` right
 * before it. Without that call a failed action that wrote through one of these
 * reads as having saved nothing, so the agent retries it and the effect is
 * duplicated.
 *
 * This guard only scans lines ADDED on this branch (via
 * scripts/lib/changed-lines.mjs) in action, server and shared source of
 * templates, plus packages/dispatch/src and packages/scheduling/src. It flags:
 *   - filesystem writes and deletes (`writeFile(`, `rm(`, `fs.promises.rename(`…)
 *   - child processes (`spawn(`, `execFile(`…), only in a file that imports
 *     child_process
 *   - non-fetch HTTP clients: `http.request(`, and imports of node:http,
 *     undici, axios, got, node-fetch, superagent
 *   - vendor SDK imports known to write externally (stripe, googleapis, …)
 *
 * A flagged line passes when:
 *   - the same file calls `noteExternalWrite(`, or
 *   - the line or the line above carries an opt-out with a reason:
 *
 *       // observed-write-ok: <why this write is temp-only or retry-idempotent>
 *
 * Comments and string contents are not code, so they never match.
 *
 * Same diff-base contract as every guard built on changed-lines.mjs: if the
 * base cannot be resolved the guard exits GUARD_EXIT_COULD_NOT_RUN, which
 * run-guards.ts reports as SKIPPED, because a silent pass would look
 * identical to a real clean run.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  GUARD_EXIT_COULD_NOT_RUN,
  requireAddedLines,
} from "./lib/changed-lines.mjs";

const GUARD_NAME = "guard:no-unobserved-writes";
const rootDir = path.resolve(import.meta.dirname, "..");

const IN_SCOPE =
  /^(?:templates\/[^/]+\/(?:actions|server|shared)\/|packages\/(?:dispatch|scheduling)\/src\/)/;
const SKIPPED = /(\.spec\.|\.test\.|\/__tests__\/|\/dist\/|\/node_modules\/)/;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;

const PRAGMA = /\/\/\s*observed-write-ok:\s*\S/;
const EMPTY_PRAGMA = /\/\/\s*observed-write-ok:\s*$/;

const FS_WRITE_CALLS = [
  "writeFile",
  "writeFileSync",
  "appendFile",
  "appendFileSync",
  "createWriteStream",
  "mkdir",
  "mkdirSync",
  "rename",
  "renameSync",
  "unlink",
  "unlinkSync",
  "rm",
  "rmSync",
  "copyFile",
  "copyFileSync",
  "cp",
  "cpSync",
];
// Ordinary words in application code (a string helper is often named
// `truncate`), so these match only as a call on an fs namespace.
const FS_NAMESPACE_ONLY_CALLS = [
  "writeSync",
  "rmdir",
  "rmdirSync",
  "truncate",
  "truncateSync",
  "symlink",
  "symlinkSync",
];
const CHILD_PROCESS_CALLS = [
  "spawn",
  "spawnSync",
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
  "fork",
];

// A bare name is a call to a function imported from a module; a name after a
// `.` is a method call on something else (`regex.exec(`), so it is not matched
// unless the object is a known module namespace.
const FS_NAMESPACE = "(?<![\\w$])(?:fs|fsp|fsPromises|promises|[\\w$]*Fs)\\.";
const FS_CALL = new RegExp(
  `(?:(?<![\\w$.])(?:${FS_WRITE_CALLS.join("|")})|${FS_NAMESPACE}(?:${[...FS_WRITE_CALLS, ...FS_NAMESPACE_ONLY_CALLS].join("|")}))\\s*\\(`,
);
const CHILD_PROCESS_CALL = new RegExp(
  `(?:(?<![\\w$.])|(?<![\\w$])(?:child_process|childProcess|cp)\\.)(?:${CHILD_PROCESS_CALLS.join("|")})\\s*\\(`,
);
const HTTP_REQUEST_CALL = /(?<![\w$])(?:https?|http2)\.request\s*\(/;
const NOTE_EXTERNAL_WRITE_CALL = /(?<![\w$])noteExternalWrite\s*\(/;

const CHILD_PROCESS_MODULE = /^(?:node:)?child_process$/;
const HTTP_CLIENT_MODULE =
  /^(?:node:)?(?:https?|http2)$|^(?:undici|axios|got|node-fetch|superagent)(?:\/|$)/;
const VENDOR_SDK_MODULE =
  /^(?:googleapis|stripe|nodemailer|resend|twilio|web-push|pusher|ably)(?:\/|$)|^@(?:slack|octokit|sendgrid|aws-sdk|google-cloud|hubspot|notionhq|supabase)\/|^@(?:vercel\/blob|netlify\/blobs)(?:\/|$)/;

const IMPORT_SPECIFIER =
  /(?:\bfrom|\bimport\s*\(|\brequire\s*\(|^\s*import)\s*["']([^"']+)["']/;
const TYPE_ONLY_IMPORT = /^\s*(?:import|export)\s+type\b/;

export interface UnobservedWriteFinding {
  file: string;
  line: number;
  text: string;
  matched: string;
  channel: string;
  emptyPragma: boolean;
}

export function isUnobservedWriteScopePath(relPath: string): boolean {
  return (
    !SKIPPED.test(relPath) &&
    SOURCE_FILE.test(relPath) &&
    IN_SCOPE.test(relPath)
  );
}

/**
 * The line with comments removed and string contents blanked, so a call
 * spelled inside a string or a comment is not a call. Code inside a template
 * literal's `${...}` is kept.
 */
function codeOf(line: string): string {
  const trimmed = line.trimStart();
  // A JSDoc continuation line opens with `*`, which is code to the scanner.
  if (trimmed.startsWith("//") || /^\*(\s|$)/.test(trimmed)) return "";
  const stack: string[] = [];
  let code = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const top = stack[stack.length - 1];
    if (top === "'" || top === '"' || top === "`") {
      if (ch === "\\") {
        code += "  ";
        i += 1;
      } else if (ch === top) {
        stack.pop();
        code += ch;
      } else if (top === "`" && ch === "$" && line[i + 1] === "{") {
        stack.push("${");
        code += "${";
        i += 1;
      } else {
        code += " ";
      }
      continue;
    }
    if (ch === "/" && line[i + 1] === "/") break;
    if (ch === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      if (end === -1) break;
      code += " ";
      i = end + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      stack.push(ch);
    } else if (ch === "{") {
      stack.push("{");
    } else if (ch === "}" && (top === "{" || top === "${")) {
      stack.pop();
    }
    code += ch;
  }
  return code;
}

function isCommentOnly(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    /^\*(\s|$)/.test(trimmed)
  );
}

function importedModule(line: string): string | null {
  if (isCommentOnly(line) || TYPE_ONLY_IMPORT.test(line)) return null;
  return IMPORT_SPECIFIER.exec(line)?.[1] ?? null;
}

interface WriteMatch {
  matched: string;
  channel: string;
}

function matchUnobservedWrite(
  line: string,
  importsChildProcess: boolean,
): WriteMatch | null {
  const module = importedModule(line);
  if (module !== null) {
    if (HTTP_CLIENT_MODULE.test(module)) {
      return { matched: `import "${module}"`, channel: "node-http" };
    }
    if (VENDOR_SDK_MODULE.test(module)) {
      return { matched: `import "${module}"`, channel: "vendor-sdk" };
    }
  }

  const code = codeOf(line);
  const fsCall = FS_CALL.exec(code);
  if (fsCall) return { matched: fsCall[0].trim(), channel: "local-disk" };
  if (importsChildProcess) {
    const childCall = CHILD_PROCESS_CALL.exec(code);
    if (childCall) {
      return { matched: childCall[0].trim(), channel: "child-process" };
    }
  }
  const httpCall = HTTP_REQUEST_CALL.exec(code);
  if (httpCall) return { matched: httpCall[0].trim(), channel: "node-http" };
  return null;
}

function hasPragma(lines: readonly string[], lineNo: number): boolean {
  return (
    PRAGMA.test(lines[lineNo - 1] ?? "") || PRAGMA.test(lines[lineNo - 2] ?? "")
  );
}

function hasEmptyPragma(lines: readonly string[], lineNo: number): boolean {
  return (
    EMPTY_PRAGMA.test(lines[lineNo - 1] ?? "") ||
    EMPTY_PRAGMA.test(lines[lineNo - 2] ?? "")
  );
}

export function findUnobservedWrites(
  file: string,
  source: string,
  addedLines: ReadonlySet<number>,
): UnobservedWriteFinding[] {
  const lines = source.split(/\r?\n/);
  const observedInFile = lines.some((line) =>
    NOTE_EXTERNAL_WRITE_CALL.test(codeOf(line)),
  );
  const importsChildProcess = lines.some((line) => {
    const module = importedModule(line);
    return module !== null && CHILD_PROCESS_MODULE.test(module);
  });

  const findings: UnobservedWriteFinding[] = [];
  for (const lineNo of [...addedLines].sort((a, b) => a - b)) {
    const text = lines[lineNo - 1];
    if (text === undefined) continue;
    const match = matchUnobservedWrite(text, importsChildProcess);
    if (match === null || observedInFile || hasPragma(lines, lineNo)) continue;
    findings.push({
      file,
      line: lineNo,
      text: text.trim(),
      matched: match.matched,
      channel: match.channel,
      emptyPragma: hasEmptyPragma(lines, lineNo),
    });
  }
  return findings;
}

function main() {
  const added = requireAddedLines(rootDir, GUARD_NAME);

  let inspected = 0;
  const findings: UnobservedWriteFinding[] = [];
  for (const [absPath, lineNumbers] of added) {
    const rel = path.relative(rootDir, absPath).replace(/\\/g, "/");
    if (!isUnobservedWriteScopePath(rel)) continue;

    let source: string;
    try {
      source = readFileSync(absPath, "utf8");
    } catch (error) {
      console.error(
        `${GUARD_NAME}: could not read ${rel}: ${(error as Error).message}`,
      );
      process.exit(GUARD_EXIT_COULD_NOT_RUN);
    }
    inspected += 1;
    findings.push(...findUnobservedWrites(rel, source, lineNumbers));
  }

  if (findings.length === 0) {
    console.log(
      `${GUARD_NAME}: OK (${inspected} changed file(s) in scope inspected)`,
    );
    return;
  }

  console.error(
    `${GUARD_NAME}: ${findings.length} write(s) through an unobserved channel added on lines this branch added.`,
  );
  console.error(
    "\nThe framework reads a failed write action from the writes it saw. It sees\n" +
      "database statements and non-GET fetch, not these. Without the call below, a\n" +
      "failed action that wrote through here reads as having saved nothing, and the\n" +
      "agent retries it.\n",
  );
  for (const finding of findings) {
    console.error(
      `  ${finding.file}:${finding.line}  ${finding.text}\n` +
        `    matched \`${finding.matched}\` (channel: ${finding.channel})\n` +
        `    fix: call noteExternalWrite("${finding.channel}") immediately before this write,\n` +
        "         or add `// observed-write-ok: <reason>` on this line or the line above when\n" +
        "         the write is temp-only or retry-idempotent, or the call only reads.\n" +
        (finding.emptyPragma
          ? "         (An empty observed-write-ok reason does not count.)\n"
          : ""),
    );
  }
  console.error(
    "noteExternalWrite is exported from @agent-native/core/action. The guard\n" +
      "accepts any such call in the file, so place it by each write it covers.\n",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
