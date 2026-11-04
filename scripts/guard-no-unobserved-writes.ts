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
 *   - a `noteExternalWrite(` call comes before the write call as a statement of
 *     a block that contains it (or at module level, for code outside any
 *     function). A call to a function in the same file that notes on every path
 *     counts as one; a name declared twice in the file is not resolved to a
 *     helper. A note in another function, after the write, inside a callback
 *     beside it, or only on some paths (`if (x) note();`, `x && note()`)
 *     covers nothing. An import of an HTTP client or vendor SDK has no write
 *     site to place a call before, so it passes when the file calls
 *     `noteExternalWrite(` anywhere, or
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
// A FileHandle (`(await fsp.open(p, "w")).writeFile(...)`) has no namespace name.
const FILE_HANDLE_CALL = /\.\s*(?:writeFile|appendFile)\s*\(/;

const FS_MODULE = /^(?:node:)?fs(?:\/promises)?$/;
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
      // Same width, so a match's column is its column in the line.
      code += " ".repeat(end + 2 - i);
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
  /** Where the write call starts in the line; a note must come before it. */
  column: number;
}

/** What a file's own imports add to the call patterns: aliases and namespace names. */
interface FilePatterns {
  fs: readonly RegExp[];
  childProcess: readonly RegExp[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Calls to a module's write functions under the names this file binds them to:
 * `import { writeFile as persist } from "node:fs/promises"` is `persist(`, and
 * `import * as disk from "node:fs"` is `disk.writeFile(`.
 */
function importedCallPatterns(
  sourceFile: ts.SourceFile,
  module: RegExp,
  exported: readonly string[],
): RegExp[] {
  const calls: string[] = [];
  const namespaces: string[] = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !module.test(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) namespaces.push(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      namespaces.push(bindings.name.text);
    }
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (
          !element.isTypeOnly &&
          exported.includes((element.propertyName ?? element.name).text)
        ) {
          calls.push(element.name.text);
        }
      }
    }
  }
  const named = (list: readonly string[]) => list.map(escapeRegExp).join("|");
  const patterns: RegExp[] = [];
  if (calls.length > 0) {
    patterns.push(new RegExp(`(?<![\\w$.])(?:${named(calls)})\\s*\\(`));
  }
  if (namespaces.length > 0) {
    patterns.push(
      new RegExp(
        `(?<![\\w$])(?:${named(namespaces)})\\.(?:${exported.join("|")})\\s*\\(`,
      ),
    );
  }
  return patterns;
}

function filePatterns(sourceFile: ts.SourceFile, lines: readonly string[]) {
  const importsChildProcess = lines.some((line) => {
    const module = importedModule(line);
    return module !== null && CHILD_PROCESS_MODULE.test(module);
  });
  return {
    fs: [
      FS_CALL,
      FILE_HANDLE_CALL,
      ...importedCallPatterns(sourceFile, FS_MODULE, [
        ...FS_WRITE_CALLS,
        ...FS_NAMESPACE_ONLY_CALLS,
      ]),
    ],
    childProcess: importsChildProcess
      ? [
          CHILD_PROCESS_CALL,
          ...importedCallPatterns(
            sourceFile,
            CHILD_PROCESS_MODULE,
            CHILD_PROCESS_CALLS,
          ),
        ]
      : [],
  } satisfies FilePatterns;
}

function earliestMatch(
  code: string,
  patterns: readonly RegExp[],
): RegExpExecArray | null {
  let first: RegExpExecArray | null = null;
  for (const pattern of patterns) {
    const found = pattern.exec(code);
    if (found && (first === null || found.index < first.index)) first = found;
  }
  return first;
}

function matchUnobservedWrite(
  line: string,
  patterns: FilePatterns,
): WriteMatch | null {
  const module = importedModule(line);
  if (module !== null) {
    if (HTTP_CLIENT_MODULE.test(module)) {
      return {
        matched: `import "${module}"`,
        channel: "node-http",
        kind: "import",
        column: 0,
      };
    }
    if (VENDOR_SDK_MODULE.test(module)) {
      return {
        matched: `import "${module}"`,
        channel: "vendor-sdk",
        kind: "import",
        column: 0,
      };
    }
  }

  const code = codeOf(line);
  const channels: Array<[string, readonly RegExp[]]> = [
    ["local-disk", patterns.fs],
    ["child-process", patterns.childProcess],
    ["node-http", [HTTP_REQUEST_CALL]],
  ];
  for (const [channel, candidates] of channels) {
    const found = earliestMatch(code, candidates);
    if (found) {
      return {
        matched: found[0].trim(),
        channel,
        kind: "call",
        column: found.index,
      };
    }
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
  /**
   * Where its cover ends: the block it is a statement of. A call that runs
   * only on some paths (`if (x) note();`, `x && note()`, an argument, a callback
   * body) is not a statement of a block, so it covers nothing after itself.
   */
  coverEnd: number;
  /** A statement of the file itself covers only code that is in no function. */
  moduleLevel: boolean;
}

function isFunctionScope(node: ts.Node): boolean {
  return (
    ts.isFunctionLike(node) ||
    ts.isClassStaticBlockDeclaration(node) ||
    ts.isSourceFile(node)
  );
}

function isNoteExternalWrite(node: ts.CallExpression): boolean {
  const callee = node.expression;
  return (
    (ts.isIdentifier(callee) && callee.text === "noteExternalWrite") ||
    (ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "noteExternalWrite")
  );
}

/** The call with any `await` or parentheses around it. */
function outermost(call: ts.CallExpression): ts.Node {
  let top: ts.Node = call;
  while (
    ts.isAwaitExpression(top.parent) ||
    ts.isParenthesizedExpression(top.parent)
  ) {
    top = top.parent;
  }
  return top;
}

/** The block, file or case a call is a whole statement of, if it is one. */
function statementList(call: ts.CallExpression): ts.Node | undefined {
  const statement = outermost(call).parent;
  if (!ts.isExpressionStatement(statement)) return undefined;
  const list = statement.parent;
  return ts.isBlock(list) ||
    ts.isSourceFile(list) ||
    ts.isCaseClause(list) ||
    ts.isDefaultClause(list) ||
    ts.isModuleBlock(list)
    ? list
    : undefined;
}

/** Whether a call in `scope` runs on every path through it. */
function runsEveryTime(call: ts.CallExpression, scope: ts.Node): boolean {
  const body = ts.isSourceFile(scope)
    ? scope
    : "body" in scope
      ? scope.body
      : undefined;
  return (
    body !== undefined &&
    (statementList(call) === body || outermost(call) === body)
  );
}

/**
 * How many times each name is declared in the file, at any depth. A call to a
 * name declared twice may reach a shadowing no-op, so it is not a helper.
 */
function declarationCounts(sourceFile: ts.SourceFile): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (name: ts.Node | undefined) => {
    if (name !== undefined && ts.isIdentifier(name)) {
      counts.set(name.text, (counts.get(name.text) ?? 0) + 1);
    }
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node) ||
      ts.isVariableDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isBindingElement(node) ||
      ts.isImportClause(node) ||
      ts.isImportSpecifier(node) ||
      ts.isNamespaceImport(node)
    ) {
      add(node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return counts;
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
 * that makes one on every path (a helper such as `noteLocalFileWrite()`). A
 * helper that calls such a helper makes one too.
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

  const declared = declarationCounts(sourceFile);
  const helpers = new Set<string>();
  const isNote = (node: ts.CallExpression) =>
    isNoteExternalWrite(node) ||
    (ts.isIdentifier(node.expression) && helpers.has(node.expression.text));
  for (let grew = true; grew; ) {
    grew = false;
    for (const { node, scope } of calls) {
      const name = boundName(scope);
      if (
        name !== undefined &&
        !helpers.has(name) &&
        (declared.get(name) ?? 0) <= 1 &&
        isNote(node) &&
        runsEveryTime(node, scope)
      ) {
        helpers.add(name);
        grew = true;
      }
    }
  }

  return calls
    .filter(({ node }) => isNote(node))
    .map(({ node }) => {
      const list = statementList(node);
      return {
        end: node.getEnd(),
        coverEnd: list ? list.getEnd() : node.getEnd(),
        moduleLevel: list !== undefined && ts.isSourceFile(list),
      };
    });
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
  const patterns = filePatterns(sourceFile, lines);

  const findings: UnobservedWriteFinding[] = [];
  for (const lineNo of [...addedLines].sort((a, b) => a - b)) {
    const text = lines[lineNo - 1];
    if (text === undefined) continue;
    const match = matchUnobservedWrite(text, patterns);
    if (match === null || hasPragma(lines, lineNo)) continue;
    // A note covers the write only when it ends before the write call starts,
    // so `write(); note();` on one line is not covered.
    const writeAt =
      sourceFile.getPositionOfLineAndCharacter(lineNo - 1, 0) + match.column;
    const inFunction = functions.some(
      ([start, end]) => start <= writeAt && writeAt < end,
    );
    const noted =
      match.kind === "import"
        ? notes.length > 0
        : notes.some(
            (note) =>
              note.end <= writeAt &&
              writeAt < note.coverEnd &&
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
      "accepts a call that is a statement of a block containing the write and\n" +
      "comes before it, or a call to a helper in this file that notes on every\n" +
      "path, so place it unconditionally in the function that makes the write.\n",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
