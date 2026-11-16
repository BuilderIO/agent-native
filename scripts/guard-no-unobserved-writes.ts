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
 *     counts as one: its note is a top-level statement that no earlier `return`
 *     can skip. If an earlier `await` can delay it, only a call that awaits the
 *     helper counts. A name declared twice in the
 *     file is not resolved to a helper. A note in another function, after the
 *     write, inside a callback beside it, or only on some paths (`if (x)
 *     note();`, `x && note()`) covers nothing. Neither does a note outside the
 *     function declaration that holds the write, because a declaration is
 *     hoisted and may run before the note. An import of an HTTP client or
 *     vendor SDK has no write
 *     site to place a call before, so it passes when the file calls
 *     `noteExternalWrite(` anywhere, or
 *   - the line or the line above carries an opt-out with a reason:
 *
 *       // observed-write-ok: <why this write is temp-only or retry-idempotent>
 *
 * `noteExternalWrite` counts only when it is the framework's: imported (or
 * loaded with `require` / `import()`) from `@agent-native/core`, or a bare call
 * the file never declares itself. `logger.noteExternalWrite()` observes nothing.
 * An fs `open` with anything but a read-only flag is itself a write, as is a
 * write method on an opened or `FileHandle`-typed handle.
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
  "write",
  "writeSync",
  "writev",
  "writevSync",
  "rmdir",
  "rmdirSync",
  "truncate",
  "truncateSync",
  "ftruncate",
  "ftruncateSync",
  "symlink",
  "symlinkSync",
  "link",
  "linkSync",
  "chmod",
  "chmodSync",
  "chown",
  "chownSync",
  "utimes",
  "utimesSync",
  "mkdtemp",
  "mkdtempSync",
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
// A FileHandle (`(await fsp.open(p, "w")).writeFile(...)`) has no namespace
// name. `write` and the rest are common words on other objects (`res.write`),
// so a handle's own are matched only on a variable bound from `fs.open`.
const FILE_HANDLE_CALL = /\.\s*(?:writeFile|appendFile|writev)\s*\(/;
const FILE_HANDLE_METHODS = [
  "write",
  "writev",
  "truncate",
  "chmod",
  "chown",
  "utimes",
];

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

interface ModuleBindings {
  /** Local names of the listed exports. */
  calls: string[];
  /** Local names of the whole module. */
  namespaces: string[];
}

/** The module named by `require("x")` or `import("x")`, with any `await` around it. */
function requiredModule(expression: ts.Expression): string | undefined {
  let call: ts.Expression = expression;
  while (ts.isAwaitExpression(call) || ts.isParenthesizedExpression(call)) {
    call = call.expression;
  }
  if (!ts.isCallExpression(call)) return undefined;
  const callee = call.expression;
  const loads =
    callee.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(callee) && callee.text === "require");
  const [specifier] = call.arguments;
  return loads && specifier && ts.isStringLiteralLike(specifier)
    ? specifier.text
    : undefined;
}

function importedBindings(
  sourceFile: ts.SourceFile,
  module: RegExp,
  exported: readonly string[],
): ModuleBindings {
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
  // `const disk = require("node:fs")`, `const { writeFile: persist } = await
  // import("node:fs/promises")`: loaded anywhere in the file, not only on top.
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const loaded = requiredModule(node.initializer);
      if (loaded !== undefined && module.test(loaded)) {
        if (ts.isIdentifier(node.name)) namespaces.push(node.name.text);
        if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            const imported = element.propertyName ?? element.name;
            if (
              ts.isIdentifier(element.name) &&
              (ts.isIdentifier(imported) || ts.isStringLiteral(imported)) &&
              exported.includes(imported.text)
            ) {
              calls.push(element.name.text);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { calls, namespaces };
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
  const { calls, namespaces } = importedBindings(sourceFile, module, exported);
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

/** Recognizes `open(...)`, `fs.open(...)` and `fsp.openSync(...)` on the fs module, under any name this file gives it. */
function fsOpenMatcher(
  sourceFile: ts.SourceFile,
): (call: ts.CallExpression) => boolean {
  const opened = importedBindings(sourceFile, FS_MODULE, ["open", "openSync"]);
  const fsNamespace = new RegExp(
    `(?:^|\\.)(?:fs|fsp|fsPromises|promises|[\\w$]*Fs${opened.namespaces.map((name) => `|${escapeRegExp(name)}`).join("")})$`,
  );
  return (call) => {
    const callee = call.expression;
    return ts.isPropertyAccessExpression(callee)
      ? (callee.name.text === "open" || callee.name.text === "openSync") &&
          fsNamespace.test(callee.expression.getText(sourceFile))
      : ts.isIdentifier(callee) && opened.calls.includes(callee.text);
  };
}

function isFileHandleType(type: ts.TypeNode): boolean {
  if (!ts.isTypeReferenceNode(type)) return false;
  const name = type.typeName;
  return (ts.isIdentifier(name) ? name : name.right).text === "FileHandle";
}

/**
 * A FileHandle's own write methods, on a variable this file binds from an
 * `open` of the fs module (`const handle = await fsp.open(path, "w")`) or a
 * variable or parameter it types as a `FileHandle` (`writeAll(handle:
 * FileHandle)`), which a helper receives from its caller.
 */
function fileHandlePatterns(sourceFile: ts.SourceFile): RegExp[] {
  const isFsOpen = fsOpenMatcher(sourceFile);
  const handles: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      ts.isIdentifier(node.name)
    ) {
      let init: ts.Expression | undefined = node.initializer;
      while (
        init !== undefined &&
        (ts.isAwaitExpression(init) || ts.isParenthesizedExpression(init))
      ) {
        init = init.expression;
      }
      if (
        (init && ts.isCallExpression(init) && isFsOpen(init)) ||
        (node.type !== undefined && isFileHandleType(node.type))
      ) {
        handles.push(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (handles.length === 0) return [];
  return [
    new RegExp(
      `(?<![\\w$.])(?:${handles.map(escapeRegExp).join("|")})\\.(?:${FILE_HANDLE_METHODS.join("|")})\\s*\\(`,
    ),
  ];
}

/** Whether an fs `open` can create, truncate or write: anything but a read-only flag string. */
function opensForWrite(call: ts.CallExpression): boolean {
  const flags = call.arguments[1];
  if (flags === undefined || ts.isFunctionLike(flags)) return false;
  return ts.isStringLiteralLike(flags)
    ? !/^(?:r|rs|sr)$/.test(flags.text)
    : true;
}

/**
 * Writes a regex over one line cannot see, keyed by the 1-based line the call
 * starts on: an fs `open` that can create or truncate a file (`"w"`, `"a"`,
 * `"r+"`, or flags the guard cannot read), and a write method called directly
 * on an opened handle, `(await fsp.open(path, "r")).write(buffer)`.
 */
function openWriteSites(sourceFile: ts.SourceFile): Map<number, WriteMatch> {
  const isFsOpen = fsOpenMatcher(sourceFile);
  const sites = new Map<number, WriteMatch>();
  const add = (node: ts.Node, matched: string) => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    if (!sites.has(line + 1)) {
      sites.set(line + 1, {
        matched,
        channel: "local-disk",
        kind: "call",
        column: character,
      });
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (isFsOpen(node) && opensForWrite(node)) {
        add(node, "open(…) with write flags");
      }
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        FILE_HANDLE_METHODS.includes(callee.name.text)
      ) {
        let target: ts.Expression = callee.expression;
        while (
          ts.isAwaitExpression(target) ||
          ts.isParenthesizedExpression(target)
        ) {
          target = target.expression;
        }
        if (ts.isCallExpression(target) && isFsOpen(target)) {
          add(node, `open(…).${callee.name.text}(`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
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
      ...fileHandlePatterns(sourceFile),
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

const CORE_ACTION_MODULE = /^@agent-native\/core(?:\/action)?$/;

/**
 * Whether a call is the framework's `noteExternalWrite`: a name this file
 * imports (or loads with `require` / `import()`) from `@agent-native/core`, a
 * method on a namespace of it, or a bare `noteExternalWrite` the file never
 * declares itself. A local function or a `logger.noteExternalWrite()` that
 * only shares the name observes nothing.
 */
function frameworkNoteMatcher(
  sourceFile: ts.SourceFile,
  declared: ReadonlyMap<string, number>,
): (node: ts.CallExpression) => boolean {
  const core = importedBindings(sourceFile, CORE_ACTION_MODULE, [
    "noteExternalWrite",
  ]);
  const bare = new Set(core.calls);
  if (!declared.has("noteExternalWrite")) bare.add("noteExternalWrite");
  return (node) => {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) return bare.has(callee.text);
    return (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "noteExternalWrite" &&
      ts.isIdentifier(callee.expression) &&
      core.namespaces.includes(callee.expression.text)
    );
  };
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

/** Whether a call is a top-level statement of the body of `scope`. */
function isTopLevelOf(call: ts.CallExpression, scope: ts.Node): boolean {
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

/** Whether a call is the operand of an `await`, so its caller waits for it. */
function isAwaited(call: ts.CallExpression): boolean {
  let up: ts.Node = call.parent;
  while (ts.isParenthesizedExpression(up)) up = up.parent;
  return ts.isAwaitExpression(up);
}

/**
 * What the code before a call can do to it: `leaves` when a `return` can skip
 * it, `waits` when an `await` can delay it past a caller that does not await.
 * A statement that wraps the call, such as `await note()`, runs the call first.
 */
function flowBefore(
  call: ts.CallExpression,
  scope: ts.Node,
): { leaves: boolean; waits: boolean } {
  const flow = { leaves: false, waits: false };
  const visit = (node: ts.Node) => {
    if (node.getStart() >= call.getStart() || ts.isFunctionLike(node)) return;
    const wrapsCall =
      node.getStart() <= call.getStart() && node.getEnd() >= call.getEnd();
    if (!wrapsCall) {
      if (ts.isReturnStatement(node)) flow.leaves = true;
      else if (ts.isAwaitExpression(node) || ts.isYieldExpression(node)) {
        flow.waits = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(scope, visit);
  return flow;
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
  const isNoteExternalWrite = frameworkNoteMatcher(sourceFile, declared);
  // `immediate`: the helper has noted by the time it returns control. `awaited`:
  // an `await` comes first, so only a caller that awaits it can count on it.
  const helpers = new Map<string, "immediate" | "awaited">();
  const notes = (
    node: ts.CallExpression,
  ): "immediate" | "awaited" | undefined => {
    if (isNoteExternalWrite(node)) return "immediate";
    const mode = ts.isIdentifier(node.expression)
      ? helpers.get(node.expression.text)
      : undefined;
    if (mode === "immediate") return mode;
    return mode === "awaited" && isAwaited(node) ? "awaited" : undefined;
  };
  for (let grew = true; grew; ) {
    grew = false;
    for (const { node, scope } of calls) {
      const name = boundName(scope);
      const how = notes(node);
      if (
        name === undefined ||
        how === undefined ||
        (declared.get(name) ?? 0) > 1 ||
        helpers.get(name) === "immediate" ||
        !isTopLevelOf(node, scope)
      ) {
        continue;
      }
      const flow = flowBefore(node, scope);
      if (flow.leaves) continue;
      const mode = how === "awaited" || flow.waits ? "awaited" : "immediate";
      if (helpers.get(name) !== mode) {
        helpers.set(name, mode);
        grew = true;
      }
    }
  }

  return calls
    .filter(({ node }) => notes(node) !== undefined)
    .map(({ node }) => {
      const list = statementList(node);
      return {
        end: node.getEnd(),
        coverEnd: list ? list.getEnd() : node.getEnd(),
        moduleLevel: list !== undefined && ts.isSourceFile(list),
      };
    });
}

interface FunctionRange {
  start: number;
  end: number;
  /** A declaration is hoisted: it can run before the code above it. */
  hoisted: boolean;
}

/** Every function in the file, to tell code in none from code in one. */
function functionRanges(sourceFile: ts.SourceFile): FunctionRange[] {
  const ranges: FunctionRange[] = [];
  const visit = (node: ts.Node) => {
    if (isFunctionScope(node) && !ts.isSourceFile(node)) {
      ranges.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        hoisted: ts.isFunctionDeclaration(node),
      });
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
  const openSites = openWriteSites(sourceFile);

  const findings: UnobservedWriteFinding[] = [];
  for (const lineNo of [...addedLines].sort((a, b) => a - b)) {
    const text = lines[lineNo - 1];
    if (text === undefined) continue;
    const match =
      matchUnobservedWrite(text, patterns) ?? openSites.get(lineNo) ?? null;
    if (match === null || hasPragma(lines, lineNo)) continue;
    // A note covers the write only when it ends before the write call starts,
    // so `write(); note();` on one line is not covered.
    const writeAt =
      sourceFile.getPositionOfLineAndCharacter(lineNo - 1, 0) + match.column;
    const enclosing = functions.filter(
      ({ start, end }) => start <= writeAt && writeAt < end,
    );
    const inFunction = enclosing.length > 0;
    const innermost = enclosing.reduce<FunctionRange | undefined>(
      (best, fn) => (best === undefined || fn.start > best.start ? fn : best),
      undefined,
    );
    const noted =
      match.kind === "import"
        ? notes.length > 0
        : notes.some(
            (note) =>
              note.end <= writeAt &&
              writeAt < note.coverEnd &&
              !(note.moduleLevel && inFunction) &&
              // A declaration can run before a note above it, so only a note
              // inside the declaration itself is known to come first.
              !(
                innermost?.hoisted &&
                !(innermost.start <= note.end && note.end <= innermost.end)
              ),
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
