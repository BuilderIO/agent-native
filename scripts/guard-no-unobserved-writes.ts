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
 *   - a `noteExternalWrite(` call comes before it in the same function (or in
 *     one that contains it, or at module level for code outside any function).
 *     A call to a function in the same file that itself calls
 *     `noteExternalWrite(` counts as one. A note in another function, after the
 *     write, or inside a callback beside it covers nothing. An import of an
 *     HTTP client or vendor SDK has no write site to place a call before, so it
 *     passes when the file calls `noteExternalWrite(` anywhere, or
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

import ts from "typescript";

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
  /** An import has no write site, so only a call in the file can cover it. */
  kind: "import" | "call";
}

function matchUnobservedWrite(
  line: string,
  importsChildProcess: boolean,
): WriteMatch | null {
  const module = importedModule(line);
  if (module !== null) {
    if (HTTP_CLIENT_MODULE.test(module)) {
      return {
        matched: `import "${module}"`,
        channel: "node-http",
        kind: "import",
      };
    }
    if (VENDOR_SDK_MODULE.test(module)) {
      return {
        matched: `import "${module}"`,
        channel: "vendor-sdk",
        kind: "import",
      };
    }
  }

  const code = codeOf(line);
  const fsCall = FS_CALL.exec(code);
  if (fsCall) {
    return { matched: fsCall[0].trim(), channel: "local-disk", kind: "call" };
  }
  if (importsChildProcess) {
    const childCall = CHILD_PROCESS_CALL.exec(code);
    if (childCall) {
      return {
        matched: childCall[0].trim(),
        channel: "child-process",
        kind: "call",
      };
    }
  }
  const httpCall = HTTP_REQUEST_CALL.exec(code);
  if (httpCall) {
    return { matched: httpCall[0].trim(), channel: "node-http", kind: "call" };
  }
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

interface NoteCall {
  /** Where the call ends: a write is covered only by a call before it. */
  end: number;
  /** The function the call is in, or the file, which covers writes inside it. */
  scopeStart: number;
  scopeEnd: number;
  /** In no function: it covers only code that is in none either. */
  moduleLevel: boolean;
}

function isFunctionScope(node: ts.Node): boolean {
  return (
    ts.isFunctionLike(node) ||
    ts.isClassStaticBlockDeclaration(node) ||
    ts.isSourceFile(node)
  );
}

function calleeName(node: ts.CallExpression): string | undefined {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
}

/** The name a function is declared or bound to, for a call to find it by. */
function boundName(fn: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(fn)) return fn.name?.text;
  const parent = fn.parent;
  if (
    (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) &&
    ts.isVariableDeclaration(parent) &&
    ts.isIdentifier(parent.name)
  ) {
    return parent.name.text;
  }
  return undefined;
}

/**
 * Every `noteExternalWrite(` call, and every call to a function in this file
 * that makes one (a helper such as `noteLocalFileWrite()`), with the function
 * it sits in. A helper that calls such a helper makes one too.
 */
function noteExternalWriteCalls(sourceFile: ts.SourceFile): NoteCall[] {
  const calls: Array<{ node: ts.CallExpression; scope: ts.Node }> = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      let scope: ts.Node = node;
      while (!isFunctionScope(scope)) scope = scope.parent;
      calls.push({ node, scope });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const noting = new Set(["noteExternalWrite"]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const { node, scope } of calls) {
      const name = boundName(scope);
      const callee = calleeName(node);
      if (
        name !== undefined &&
        callee !== undefined &&
        noting.has(callee) &&
        !noting.has(name)
      ) {
        noting.add(name);
        grew = true;
      }
    }
  }

  return calls
    .filter(({ node }) => noting.has(calleeName(node) ?? ""))
    .map(({ node, scope }) => ({
      end: node.getEnd(),
      scopeStart: scope.getStart(sourceFile),
      scopeEnd: scope.getEnd(),
      moduleLevel: ts.isSourceFile(scope),
    }));
}

/** The start of every function body in the file, to tell code in none from code in one. */
function functionRanges(sourceFile: ts.SourceFile): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const visit = (node: ts.Node) => {
    if (isFunctionScope(node) && !ts.isSourceFile(node)) {
      ranges.push([node.getStart(sourceFile), node.getEnd()]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return ranges;
}

export function findUnobservedWrites(
  file: string,
  source: string,
  addedLines: ReadonlySet<number>,
): UnobservedWriteFinding[] {
  const lines = source.split(/\r?\n/);
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const notes = noteExternalWriteCalls(sourceFile);
  const functions = functionRanges(sourceFile);
  const importsChildProcess = lines.some((line) => {
    const module = importedModule(line);
    return module !== null && CHILD_PROCESS_MODULE.test(module);
  });

  const findings: UnobservedWriteFinding[] = [];
  for (const lineNo of [...addedLines].sort((a, b) => a - b)) {
    const text = lines[lineNo - 1];
    if (text === undefined) continue;
    const match = matchUnobservedWrite(text, importsChildProcess);
    if (match === null || hasPragma(lines, lineNo)) continue;
    // A note counts up to the end of the write's line, so a call earlier on the
    // same line still covers it; the write belongs to the scope it starts in.
    const starts = sourceFile.getPositionOfLineAndCharacter(
      lineNo - 1,
      text.length - text.trimStart().length,
    );
    const ends = sourceFile.getPositionOfLineAndCharacter(
      lineNo - 1,
      text.length,
    );
    const inFunction = functions.some(
      ([start, end]) => start <= starts && starts < end,
    );
    const noted =
      match.kind === "import"
        ? notes.length > 0
        : notes.some(
            (note) =>
              note.end <= ends &&
              note.scopeStart <= starts &&
              starts < note.scopeEnd &&
              !(note.moduleLevel && inFunction),
          );
    if (noted) continue;
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
      "accepts a call that comes before the write in the same function, or in a\n" +
      "function that contains it, or a call to a helper in this file that makes\n" +
      "one, so place it in the function that makes the write.\n",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
