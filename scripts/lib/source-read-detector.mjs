/**
 * Detects tests that read one of the repo's own source modules as text.
 * Used by scripts/guard-no-source-reading-tests.mjs (see its header for the
 * why); kept separate so it can be unit-tested on in-memory snippets.
 *
 * The file is parsed with the TypeScript compiler (a root devDependency) so
 * strings, comments, template literals and multi-line calls are read the way
 * the language reads them. The rest is a small, deliberately shallow
 * "where does this path come from" resolver: same-file consts, for-of and
 * it.each rows, same-file helper functions. It gives up (and does not flag)
 * where it cannot tell, because a guard that cries wolf gets a blanket
 * pragma.
 */

import ts from "typescript";

const TEST_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TESTS_DIR_RE = /(?:^|\/)__tests__\/.*\.[cm]?[jt]sx?$/;
const SKIP_PATH_RE =
  /(?:^|\/)(?:node_modules|dist|coverage|\.next|\.output|\.nitro|\.turbo|\.tmp|\.git)\//;

const SOURCE_EXT_RE = /\.(?:tsx?|jsx?|mjs|cjs|mts|cts)$/i;
// `./X.tsx?raw`, `./X.ts?raw&inline`, `./X.ts?foo&raw`
const RAW_SOURCE_RE =
  /\.(?:tsx?|jsx?|mjs|cjs|mts|cts)\?(?:[^#]*&)?raw(?:[&#].*)?$/i;

const FS_MODULE_RE = /^(?:node:)?fs(?:\/promises)?$|^fs-extra$/;
const FS_RECEIVER_NAME_RE =
  /^(?:fs|fsp|fsPromises|nodeFs|fse|realFs|actualFs)$/i;
const READ_METHODS = new Set(["readFileSync", "readFile"]);

// Path atoms that mean "this is data for the test, not source under test".
// A directory segment that mentions fixtures/snapshots/testdata (so
// `test-fixtures/` and `__fixtures__/` count), or a bare extension-less
// segment like the "fixtures" in path.join(__dirname, "fixtures", "a.ts").
const FIXTURE_RE =
  /(?:^|[\\/])(?:[^\\/]*(?:fixtures?|snapshots?|testdata)[^\\/]*[\\/]|(?:[^\\/.]*(?:fixtures?|snapshots?|testdata)[^\\/.]*|__mocks__)$|__mocks__[\\/])/i;
const FIXTURE_WORDS = new Set([
  "fixture",
  "fixtures",
  "snapshot",
  "snapshots",
  "testdata",
]);

function isFixtureName(name) {
  return name
    .split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/)
    .some((word) => FIXTURE_WORDS.has(word.toLowerCase()));
}
// Identifiers/calls that build a scratch directory the test owns (tmpDir,
// TMP_DIR, mkdtempSync, os.tmpdir, createTempDir, ...). Split into words so
// "template" and "attempt" do not count.
const TEMP_WORDS = new Set([
  "tmp",
  "temp",
  "tmpdir",
  "tempdir",
  "temporary",
  "mkdtemp",
  "mkdtempsync",
]);

function isTempName(name) {
  return name
    .split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/)
    .some((word) => TEMP_WORDS.has(word.toLowerCase()));
}

// A string literal rooted in the OS temp directory: POSIX /tmp or /var/tmp,
// macOS /var/folders (also under /private), or a Windows drive path with a
// Temp segment, like C:\Users\x\AppData\Local\Temp\gen.ts. A repo-relative
// `src/tmp/` or `temp/` does not count.
const TEMP_LITERAL_RE =
  /^(?:\/(?:private\/)?(?:tmp|var\/tmp|var\/folders)(?:\/|$)|[A-Za-z]:[\\/](?:.*[\\/])?temp(?:[\\/]|$))/i;

// Names that mean "the repo checkout" (REPO_ROOT, workspaceRoot, cwd, HERE,
// or an ALL_CAPS ...ROOT/...DIR constant). Only used for identifiers that are
// imported rather than declared in the file: a local `root` is resolved, and
// a destructured or parameter `root` is as likely a scratch directory.
const REPO_WORDS = new Set([
  "repo",
  "workspace",
  "monorepo",
  "cwd",
  "here",
  "dirname",
]);

function isRepoRootName(name) {
  if (isTempName(name)) return false;
  const words = name
    .split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/)
    .map((word) => word.toLowerCase());
  if (words.some((word) => REPO_WORDS.has(word))) return true;
  return (
    /^[A-Z][A-Z0-9_]*$/.test(name) &&
    words.some((word) => word === "root" || word === "dir")
  );
}

const PRAGMA_RE = /(?:\/\/|\/\*)\s*source-read-ok:(.*)$/i;

const MIGHT_READ_RE = /readFile|\?(?:[^"'`\s]*&)?raw/;

function toPosix(file) {
  return file.replace(/\\/g, "/");
}

/**
 * True for a test file this guard looks at: `*.test.*`, `*.spec.*`, or a
 * script under `__tests__/`, minus vendored/build output.
 */
export function isTestFile(file) {
  const posix = toPosix(file);
  if (SKIP_PATH_RE.test(posix)) return false;
  return TEST_FILE_RE.test(posix) || TESTS_DIR_RE.test(posix);
}

function scriptKindFor(file) {
  if (/\.tsx$/i.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(file)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/i.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function unwrap(node) {
  let current = node;
  for (;;) {
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isAwaitExpression(current)
    ) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

function isFunctionLike(node) {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node)
  );
}

function stringValue(node) {
  const inner = unwrap(node);
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) {
    return inner.text;
  }
  return null;
}

/**
 * Offsets [start, end) of every comment in the file. Only the text outside
 * string, template, regex and JSX-text tokens is scanned, so a
 * "// source-read-ok:" that lives inside one of those is never a comment.
 */
function collectCommentRanges(sf) {
  const literals = [];
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) {
      literals.push([node.pos, node.end]);
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isRegularExpressionLiteral(node)
    ) {
      literals.push([node.getStart(sf), node.end]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  literals.sort((a, b) => a[0] - b[0]);

  const scanner = ts.createScanner(
    sf.languageVersion,
    false, // keep comments as tokens instead of skipping them
    sf.languageVariant,
  );
  const ranges = [];
  const scanCode = (start, end) => {
    if (end <= start) return;
    scanner.setText(sf.text, start, end - start);
    for (
      let kind = scanner.scan();
      kind !== ts.SyntaxKind.EndOfFileToken;
      kind = scanner.scan()
    ) {
      if (
        kind === ts.SyntaxKind.SingleLineCommentTrivia ||
        kind === ts.SyntaxKind.MultiLineCommentTrivia
      ) {
        ranges.push([scanner.getTokenStart(), scanner.getTokenEnd()]);
      }
    }
  };
  let cursor = 0;
  for (const [start, end] of literals) {
    scanCode(cursor, start);
    cursor = Math.max(cursor, end);
  }
  scanCode(cursor, sf.text.length);
  return ranges;
}

/**
 * Reads `source-read-ok` pragmas from the lines of `sf`. A pragma only counts
 * when it is inside a real comment; the same characters in a string, template,
 * regex or JSX text do not allow a read.
 */
function createPragmaReader(sf, lines) {
  const lineStarts = sf.getLineStarts();
  let comments = null; // found on first use: most files never need them
  const inComment = (position) => {
    comments ??= collectCommentRanges(sf);
    return comments.some(([start, end]) => position >= start && position < end);
  };

  // The first PRAGMA_RE match on 1-based line `lineNo` that is inside a
  // comment (an earlier look-alike inside a string is skipped over).
  const pragmaOnLine = (lineNo) => {
    const line = lines[lineNo - 1] ?? "";
    for (let from = 0; from < line.length; ) {
      const match = PRAGMA_RE.exec(line.slice(from));
      if (!match) return null;
      const at = from + match.index;
      if (inComment(lineStarts[lineNo - 1] + at)) return match;
      from = at + 2; // past this `//` or `/*`
    }
    return null;
  };

  const commentBlockHasPragma = (lineNo) => {
    // Walk up through the contiguous comment block directly above `lineNo`.
    for (let index = lineNo - 2; index >= 0; index -= 1) {
      const line = (lines[index] ?? "").trim();
      if (!/^(?:\/\/|\/\*|\*)/.test(line)) return null;
      const match = pragmaOnLine(index + 1);
      if (match) return match;
    }
    return null;
  };

  /**
   * Returns "ok" (a pragma with a reason), "empty" (a pragma with no reason),
   * or null (no pragma) for a read reported at `line`. Only that line and the
   * comment block directly above it count, not the rest of a multi-line call.
   */
  return (line) => {
    let sawEmpty = false;
    // The comment block directly above (a trailing comment on the previous
    // code line belongs to that line, not this one).
    const candidates = [pragmaOnLine(line), commentBlockHasPragma(line)];
    for (const match of candidates) {
      if (!match) continue;
      // A block comment's reason ends at its `*/`; code after it is not one.
      const text = match[0].startsWith("/*")
        ? match[1].split("*/")[0]
        : match[1];
      if (text.trim()) return "ok";
      sawEmpty = true;
    }
    return sawEmpty ? "empty" : null;
  };
}

// The expression of every `return x;` in a function, not counting returns
// inside nested functions (an arrow with an expression body is its own return).
function returnExpressions(fn) {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const out = [];
  const walk = (node) => {
    if (isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression)
      out.push(node.expression);
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(fn.body, walk);
  return out;
}

// The value of `key` in an object literal expression, if it is one.
function objectProperty(node, key) {
  const object = unwrap(node);
  if (!ts.isObjectLiteralExpression(object)) return null;
  for (const property of object.properties) {
    if (
      (ts.isPropertyAssignment(property) ||
        ts.isShorthandPropertyAssignment(property)) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === key
    ) {
      return ts.isPropertyAssignment(property)
        ? property.initializer
        : property.name;
    }
  }
  return null;
}

// `null` or `undefined`: no encoding, which Node reads as a Buffer.
const isNullish = (node) => {
  const inner = unwrap(node);
  return (
    inner.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(inner) && inner.text === "undefined")
  );
};

// A read that yields text: it names an encoding, or the result is turned
// into a string on the spot. A bare readFileSync(path) is a Buffer, which
// is how tests copy, compare, serve, or existence-check a file, and so is
// one with `{ encoding: null }` or `{ encoding: undefined }`.
const isTextRead = (call) => {
  const options = call.arguments[1] && unwrap(call.arguments[1]);
  if (options) {
    if (stringValue(options) !== null) return true;
    if (ts.isObjectLiteralExpression(options)) {
      const encoding = objectProperty(options, "encoding");
      if (encoding) return !isNullish(encoding);
      return options.properties.some((property) =>
        ts.isSpreadAssignment(property),
      );
    }
    return !isNullish(options);
  }
  return toStringConversion(call) !== null;
};

// The `.toString` that turns a read's Buffer into text on the spot, or null.
const toStringConversion = (call) => {
  let current = call;
  while (
    current.parent &&
    (ts.isParenthesizedExpression(current.parent) ||
      ts.isAwaitExpression(current.parent))
  ) {
    current = current.parent;
  }
  const parent = current.parent;
  return parent !== undefined &&
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === current &&
    parent.name.text === "toString"
    ? parent.name
    : null;
};

// The named function (declaration, or const arrow/function expression) that
// most closely encloses `node`, as { name, fn }.
const nearestNamedFunction = (node) => {
  for (let current = node.parent; current; current = current.parent) {
    if (!isFunctionLike(current)) continue;
    if (ts.isFunctionDeclaration(current) && current.name) {
      return { name: current.name.text, fn: current };
    }
    if (
      current.parent &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return { name: current.parent.name.text, fn: current };
    }
    return null;
  }
  return null;
};

/**
 * Pass 1: every binding, fs import, and call in the file, with scoping.
 */
function collectModel(sf) {
  // ---- pass 1: collect declarations, fs bindings, calls -------------------
  // Every binding the file introduces, by name. Each entry has the `scope`
  // node it is visible in, and one of:
  //   { init }         a `const x = <init>` / `x = <init>` initializer
  //   { from, path }   an element of the array `from`, drilled into by `path`
  //                    (for-of variables, it.each / forEach callback params)
  //   { param }        a function parameter (value unknown; shadows outer names)
  //   {}               a bare `let x;`
  const decls = new Map();
  const fsReceivers = new Set();
  const fsReaders = new Set();
  // Names the file binds to something other than the fs module (a variable,
  // parameter, function, class, or a non-fs import). A name that looks like fs
  // (`fs`, `fsp`) or is `readFileSync` only stands for the real thing when the
  // file does not define it itself, like `const fs = { readFileSync: vi.fn() }`.
  const localBindings = new Set();
  const calls = [];
  const rawSpecifiers = [];

  const addDecl = (name, scope, entry) => {
    if (!decls.has(name)) decls.set(name, []);
    decls.get(name).push({ scope, ...entry });
  };

  // The declarations of `name` visible at `ref`: the ones in the innermost
  // enclosing scope that declares it.
  const visibleDecls = (name, ref) => {
    let innermost = null;
    for (const entry of decls.get(name) ?? []) {
      if (entry.scope.pos > ref.pos || ref.end > entry.scope.end) continue;
      if (!innermost || entry.scope.pos >= innermost.pos) {
        innermost = entry.scope;
      }
    }
    return innermost
      ? decls.get(name).filter((entry) => entry.scope === innermost)
      : [];
  };

  const declarationScope = (node) => {
    for (let current = node.parent; current; current = current.parent) {
      if (
        ts.isBlock(current) ||
        ts.isSourceFile(current) ||
        ts.isModuleBlock(current) ||
        ts.isCaseBlock(current) ||
        ts.isForStatement(current) ||
        ts.isForOfStatement(current) ||
        ts.isForInStatement(current) ||
        ts.isCatchClause(current)
      ) {
        return current;
      }
    }
    return sf;
  };

  const isFsExpression = (expr) => {
    const inner = unwrap(expr);
    if (ts.isIdentifier(inner)) {
      return (
        fsReceivers.has(inner.text) ||
        (FS_RECEIVER_NAME_RE.test(inner.text) && !localBindings.has(inner.text))
      );
    }
    if (
      ts.isPropertyAccessExpression(inner) &&
      inner.name.text === "promises"
    ) {
      return isFsExpression(inner.expression);
    }
    if (ts.isCallExpression(inner)) {
      const spec = inner.arguments[0] && stringValue(inner.arguments[0]);
      if (spec === null || spec === undefined || !FS_MODULE_RE.test(spec)) {
        return false;
      }
      const callee = inner.expression;
      return (
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === "require") ||
        (ts.isPropertyAccessExpression(callee) &&
          /^import(?:Actual|Original)$/.test(callee.name.text))
      );
    }
    return false;
  };

  const bindFsBinding = (nameNode) => {
    if (ts.isIdentifier(nameNode)) {
      fsReceivers.add(nameNode.text);
      return;
    }
    if (!ts.isObjectBindingPattern(nameNode)) return;
    for (const element of nameNode.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const imported = (element.propertyName ?? element.name).text;
      if (READ_METHODS.has(imported)) fsReaders.add(element.name.text);
      else if (imported === "promises") fsReceivers.add(element.name.text);
    }
  };

  // Bind the names in a destructuring pattern to "element of `from`".
  function bindPattern(nameNode, scope, from, keyPath) {
    if (ts.isIdentifier(nameNode)) {
      addDecl(nameNode.text, scope, { from, path: keyPath });
    } else if (ts.isArrayBindingPattern(nameNode)) {
      nameNode.elements.forEach((element, index) => {
        if (ts.isBindingElement(element)) {
          bindPattern(element.name, scope, from, [...keyPath, index]);
        }
      });
    } else if (ts.isObjectBindingPattern(nameNode)) {
      for (const element of nameNode.elements) {
        const key = element.propertyName ?? element.name;
        if (ts.isIdentifier(key) || ts.isStringLiteral(key)) {
          bindPattern(element.name, scope, from, [...keyPath, key.text]);
        }
      }
    }
  }

  // Every identifier a binding name or destructuring pattern introduces.
  function bindingNames(nameNode) {
    if (ts.isIdentifier(nameNode)) return [nameNode.text];
    return nameNode.elements.flatMap((element) =>
      ts.isBindingElement(element) ? bindingNames(element.name) : [],
    );
  }

  function bindParameterNames(nameNode, scope) {
    for (const name of bindingNames(nameNode)) localBindings.add(name);
    if (ts.isIdentifier(nameNode)) {
      addDecl(nameNode.text, scope, { param: scope });
    } else {
      for (const element of nameNode.elements) {
        if (ts.isBindingElement(element)) {
          bindParameterNames(element.name, scope);
        }
      }
    }
  }

  // it.each(TABLE)("name", (file) => ...) and TABLE.forEach((file) => ...)
  // give the callback's parameters the values of TABLE's rows. (These
  // override the plain { param } entry a callback's parameters also get.)
  function bindCallbackParameters(call) {
    const callee = call.expression;
    if (
      ts.isCallExpression(callee) &&
      ts.isPropertyAccessExpression(callee.expression) &&
      callee.expression.name.text === "each" &&
      callee.arguments[0]
    ) {
      const fn = call.arguments.map(unwrap).find(isFunctionLike);
      if (!fn) return;
      fn.parameters.forEach((parameter, index) => {
        bindPattern(parameter.name, fn, callee.arguments[0], [index]);
      });
    } else if (
      ts.isPropertyAccessExpression(callee) &&
      /^(?:forEach|map|flatMap|filter|some|every|find)$/.test(callee.name.text)
    ) {
      const fn = call.arguments[0] && unwrap(call.arguments[0]);
      if (fn && isFunctionLike(fn) && fn.parameters[0]) {
        bindPattern(fn.parameters[0].name, fn, callee.expression, []);
      }
    }
  }

  // import("node:fs").then((fs) => ...): the callback gets the fs module.
  function bindFsCallbackParameter(call) {
    const callee = call.expression;
    if (
      !ts.isPropertyAccessExpression(callee) ||
      callee.name.text !== "then" ||
      !isFsExpression(callee.expression)
    ) {
      return;
    }
    const fn = call.arguments[0] && unwrap(call.arguments[0]);
    if (fn && isFunctionLike(fn) && fn.parameters[0]) {
      bindFsBinding(fn.parameters[0].name);
    }
  }

  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const spec = node.moduleSpecifier.text;
      if (RAW_SOURCE_RE.test(spec)) rawSpecifiers.push(node.moduleSpecifier);
      const clause = node.importClause;
      if (clause && !FS_MODULE_RE.test(spec)) {
        if (clause.name) localBindings.add(clause.name.text);
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          localBindings.add(bindings.name.text);
        } else if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            localBindings.add(element.name.text);
          }
        }
      }
      if (clause && FS_MODULE_RE.test(spec)) {
        if (clause.name) fsReceivers.add(clause.name.text);
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          fsReceivers.add(bindings.name.text);
        } else if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const imported = (element.propertyName ?? element.name).text;
            if (READ_METHODS.has(imported)) fsReaders.add(element.name.text);
            else if (imported === "promises")
              fsReceivers.add(element.name.text);
          }
        }
      }
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      localBindings.add(node.name.text);
      if (node.body) {
        addDecl(node.name.text, declarationScope(node), { init: node });
      }
    } else if (ts.isClassDeclaration(node) && node.name) {
      localBindings.add(node.name.text);
    } else if (ts.isVariableDeclaration(node)) {
      if (!node.initializer || !isFsExpression(node.initializer)) {
        for (const name of bindingNames(node.name)) localBindings.add(name);
      }
      if (ts.isIdentifier(node.name)) {
        // A bare `let x;` still declares x here, so a later assignment lands
        // in this scope instead of leaking to same-named variables elsewhere.
        addDecl(
          node.name.text,
          declarationScope(node),
          node.initializer ? { init: node.initializer } : {},
        );
      } else {
        // `const { root } = makeSandbox()`: declared, value unknown.
        bindPattern(node.name, declarationScope(node), null, []);
      }
      if (node.initializer && isFsExpression(node.initializer)) {
        bindFsBinding(node.name);
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      const declared = visibleDecls(node.left.text, node.left)[0];
      addDecl(node.left.text, declared ? declared.scope : sf, {
        init: node.right,
      });
      // `let fs; fs = await import("node:fs")` is still the fs module.
      if (isFsExpression(node.right)) bindFsBinding(node.left);
    } else if (
      ts.isForOfStatement(node) &&
      ts.isVariableDeclarationList(node.initializer)
    ) {
      for (const declaration of node.initializer.declarations) {
        bindPattern(declaration.name, node, node.expression, []);
      }
    }
    if (isFunctionLike(node)) {
      for (const parameter of node.parameters) {
        bindParameterNames(parameter.name, node);
      }
    }
    if (ts.isCallExpression(node)) {
      calls.push(node);
      bindCallbackParameters(node);
      bindFsCallbackParameter(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return {
    visibleDecls,
    isFsExpression,
    isLocalBinding: (name) => localBindings.has(name),
    fsReaders,
    calls,
    rawSpecifiers,
  };
}

/**
 * Describes the path an expression evaluates to (see `analyze`).
 */
function createPathAnalyzer({ visibleDecls }) {
  // ---- path analysis -------------------------------------------------------
  // Describes the path an expression evaluates to:
  //   tail        kind of the final segment: "source" | "other" | "unknown"
  //   fixture     it lives under a fixtures/snapshots directory (test data)
  //   temp        it is rooted in a scratch directory the test created
  //   anchored    it is rooted in the repo checkout: __dirname, import.meta,
  //               process.cwd(), or a root-named constant we cannot resolve
  //   literalOnly it is built from string literals alone (cwd-relative)
  //   sourceLines the lines of the string literals that give it a "source"
  //               tail, so a diff that only edits where the path is defined
  //               (a const, a table row) still reaches the read
  // Only a "source" tail that is anchored (or literal-only) and neither
  // fixture nor temp counts: reads of generated output under a build or temp
  // directory are testing what the code produced, not what it says.
  //
  // merge() combines the alternatives a loop, table, ternary or helper can
  // resolve to. A fixture or temp alternative is test data, so next to a
  // source path it is dropped and the read is judged by the source path (a
  // list of ["src/Editor.tsx", "fixtures/sample.tsx"] still reads source).
  // Only a source-tailed alternative outranks it: a directory or a `let dir =
  // ""` placeholder next to a scratch directory is still the scratch directory.
  const isTestData = (facts) => facts.fixture || facts.temp;
  const merge = (a, b) => {
    if (isTestData(a) !== isTestData(b)) {
      const real = isTestData(a) ? b : a;
      if (real.tail === "source") return real;
    }
    return {
      tail:
        a.tail === "source" || b.tail === "source"
          ? "source"
          : a.tail === "other" || b.tail === "other"
            ? "other"
            : "unknown",
      fixture: a.fixture || b.fixture,
      temp: a.temp || b.temp,
      anchored: a.anchored || b.anchored,
      literalOnly: a.literalOnly && b.literalOnly,
      sourceLines: [...a.sourceLines, ...b.sourceLines],
    };
  };
  const UNKNOWN = {
    tail: "unknown",
    fixture: false,
    temp: false,
    anchored: false,
    literalOnly: false,
    sourceLines: [],
  };
  const ANCHOR = { ...UNKNOWN, anchored: true };

  const lineOf = (node) => {
    const sf = node.getSourceFile();
    return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  };

  const literalFacts = (text, node) => {
    const source = SOURCE_EXT_RE.test(text);
    return {
      tail: source ? "source" : "other",
      fixture: FIXTURE_RE.test(text),
      temp: TEMP_LITERAL_RE.test(text),
      anchored: false,
      literalOnly: true,
      sourceLines: source ? [lineOf(node)] : [],
    };
  };

  const analyze = (node, depth = 0, seen = new Set()) => {
    const inner = unwrap(node);
    const text = stringValue(inner);
    if (text !== null) return literalFacts(text, inner);

    if (ts.isTemplateExpression(inner)) {
      const head = inner.head.text;
      const facts = {
        ...UNKNOWN,
        fixture: FIXTURE_RE.test(head),
      };
      let lastLiteral = inner.head;
      let lastFacts = null;
      for (const span of inner.templateSpans) {
        if (FIXTURE_RE.test(span.literal.text)) facts.fixture = true;
        lastLiteral = span.literal;
        const spanFacts = analyze(span.expression, depth + 1, seen);
        lastFacts = spanFacts;
        facts.fixture ||= spanFacts.fixture;
        facts.temp ||= spanFacts.temp;
        facts.anchored ||= spanFacts.anchored;
      }
      if (lastLiteral.text) {
        const source = SOURCE_EXT_RE.test(lastLiteral.text);
        facts.tail = source ? "source" : "other";
        facts.sourceLines = source ? [lineOf(lastLiteral)] : [];
      } else if (lastFacts) {
        facts.tail = lastFacts.tail;
        facts.sourceLines = lastFacts.sourceLines;
      }
      return facts;
    }

    if (ts.isIdentifier(inner)) {
      const name = inner.text;
      let result = {
        ...UNKNOWN,
        temp: isTempName(name),
        fixture: isFixtureName(name),
        anchored: name === "__dirname" || name === "__filename",
      };
      if (depth > 6 || seen.has(name)) return result;
      const next = new Set(seen).add(name);
      let resolved = null;
      for (const entry of visibleDecls(name, inner)) {
        if (entry.init) {
          const facts = analyze(entry.init, depth + 1, next);
          resolved = resolved ? merge(resolved, facts) : facts;
        } else if (entry.from) {
          for (const element of elementNodes(entry, depth + 1, next)) {
            const facts = analyze(element, depth + 1, next);
            resolved = resolved ? merge(resolved, facts) : facts;
          }
        }
      }
      if (resolved) {
        result = {
          ...resolved,
          temp: resolved.temp || result.temp,
          anchored: resolved.anchored || result.anchored,
        };
      } else if (!visibleDecls(name, inner).length && isRepoRootName(name)) {
        // Not declared in this file (an import): trust a strong name.
        result.anchored = true;
      }
      return result;
    }

    if (ts.isBinaryExpression(inner)) {
      if (inner.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = analyze(inner.left, depth + 1, seen);
        const right = analyze(inner.right, depth + 1, seen);
        return {
          tail: right.tail,
          fixture: left.fixture || right.fixture,
          temp: left.temp || right.temp,
          anchored: left.anchored || right.anchored,
          literalOnly: left.literalOnly && right.literalOnly,
          sourceLines: right.sourceLines,
        };
      }
      return UNKNOWN;
    }

    if (ts.isConditionalExpression(inner)) {
      return merge(
        analyze(inner.whenTrue, depth + 1, seen),
        analyze(inner.whenFalse, depth + 1, seen),
      );
    }

    if (ts.isNewExpression(inner) || ts.isCallExpression(inner)) {
      const callee = inner.expression;
      const calleeName = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : "";
      const args = inner.arguments ? [...inner.arguments] : [];
      if (
        ts.isCallExpression(inner) &&
        ts.isIdentifier(callee) &&
        depth <= 6 &&
        !seen.has(callee.text)
      ) {
        // A same-file function: the path is whatever it returns.
        const next = new Set(seen).add(callee.text);
        let returned = null;
        for (const entry of visibleDecls(callee.text, callee)) {
          const fn = entry.init && unwrap(entry.init);
          if (!fn || !isFunctionLike(fn)) continue;
          for (const expression of returnExpressions(fn)) {
            const facts = analyze(expression, depth + 1, next);
            returned = returned ? merge(returned, facts) : facts;
          }
        }
        if (returned) return returned;
      }
      const receiver = ts.isPropertyAccessExpression(callee)
        ? analyze(callee.expression, depth + 1, seen)
        : UNKNOWN;
      const argFacts = args.map((arg) =>
        ts.isSpreadElement(arg) ? UNKNOWN : analyze(arg, depth + 1, seen),
      );
      const temp =
        isTempName(calleeName) ||
        receiver.temp ||
        argFacts.some((facts) => facts.temp);
      const anchored =
        (ts.isPropertyAccessExpression(callee) &&
          calleeName === "cwd" &&
          ts.isIdentifier(callee.expression) &&
          callee.expression.text === "process") ||
        isRepoRootName(calleeName) ||
        argFacts.some((facts) => facts.anchored);
      const fixture = argFacts.some((facts) => facts.fixture);
      if (ts.isPropertyAccessExpression(callee) && args.length === 0) {
        // `url.toString()` / `process.cwd()`: the receiver is the path.
        return {
          tail: receiver.tail,
          fixture: receiver.fixture,
          temp,
          anchored: anchored || receiver.anchored,
          literalOnly: false,
          sourceLines: receiver.sourceLines,
        };
      }
      // new URL(path, base) / fileURLToPath(url) / pathToFileURL(path) /
      // String(x): the first argument is the path. path.join/resolve and
      // anything else handed arguments: the last one is the path's tail.
      const firstArgIsPath =
        ts.isNewExpression(inner) ||
        /^(?:fileURLToPath|pathToFileURL|String)$/.test(calleeName);
      const isPathFunction =
        firstArgIsPath ||
        /^(?:join|resolve|normalize|relative)$/.test(calleeName);
      const decisive = firstArgIsPath
        ? argFacts[0]
        : argFacts[argFacts.length - 1];
      return {
        tail: decisive ? decisive.tail : "unknown",
        fixture,
        temp,
        anchored,
        literalOnly:
          isPathFunction &&
          argFacts.length > 0 &&
          argFacts.every((facts) => facts.literalOnly),
        sourceLines: decisive ? decisive.sourceLines : [],
      };
    }

    if (
      ts.isPropertyAccessExpression(inner) ||
      ts.isElementAccessExpression(inner)
    ) {
      const key = ts.isPropertyAccessExpression(inner)
        ? inner.name.text
        : stringValue(inner.argumentExpression);
      const receiver = unwrap(inner.expression);
      if (ts.isMetaProperty(receiver)) return ANCHOR; // import.meta.url / dirname
      if (
        ts.isIdentifier(receiver) &&
        key !== null &&
        depth <= 6 &&
        !seen.has(receiver.text)
      ) {
        const next = new Set(seen).add(receiver.text);
        for (const entry of visibleDecls(receiver.text, receiver)) {
          const objects = entry.init
            ? [entry.init]
            : entry.from
              ? elementNodes(entry, depth + 1, next)
              : [];
          for (const object of objects) {
            const value = objectProperty(object, key);
            if (value) return analyze(value, depth + 1, next);
          }
        }
      }
      if (
        ts.isPropertyAccessExpression(inner) &&
        /^(?:pathname|href|path)$/.test(inner.name.text)
      ) {
        return analyze(inner.expression, depth + 1, seen);
      }
      return ts.isIdentifier(receiver)
        ? { ...UNKNOWN, temp: isTempName(receiver.text) }
        : UNKNOWN;
    }

    return UNKNOWN;
  };

  // The array literal(s) an expression stands for (through const bindings).
  function arrayLiterals(node, depth, seen) {
    const inner = unwrap(node);
    if (ts.isArrayLiteralExpression(inner)) return [inner];
    if (!ts.isIdentifier(inner) || depth > 6 || seen.has(inner.text)) return [];
    const next = new Set(seen).add(inner.text);
    const out = [];
    for (const entry of visibleDecls(inner.text, inner)) {
      if (entry.init) out.push(...arrayLiterals(entry.init, depth + 1, next));
    }
    return out;
  }

  // Nodes an { from, path } binding can hold: each element of `from`,
  // drilled into by `path` (an index into a row, or a key of an object row).
  // A non-array row read at index 0 is the row itself (it.each(["a", "b"])).
  function elementNodes({ from, path: keyPath }, depth, seen) {
    let nodes = [];
    for (const array of arrayLiterals(from, depth, seen)) {
      for (const element of array.elements) {
        if (!ts.isSpreadElement(element)) nodes.push(element);
      }
    }
    for (const key of keyPath) {
      const next = [];
      for (const node of nodes) {
        const row = unwrap(node);
        if (typeof key === "number") {
          if (ts.isArrayLiteralExpression(row)) {
            const cell = row.elements[key];
            if (cell && !ts.isSpreadElement(cell)) next.push(cell);
          } else if (key === 0) {
            next.push(node);
          }
        } else {
          const value = objectProperty(row, key);
          if (value) next.push(value);
        }
      }
      nodes = next;
    }
    return nodes;
  }

  // Does the expression depend on a parameter of `fn`?
  const mentionsParam = (node, fn, depth = 0, seen = new Set()) => {
    let found = false;
    const walk = (current) => {
      if (found) return;
      if (ts.isPropertyAccessExpression(current)) {
        walk(current.expression);
        return;
      }
      if (ts.isIdentifier(current)) {
        const entries = visibleDecls(current.text, current);
        if (entries.some((entry) => entry.param === fn)) {
          found = true;
          return;
        }
        if (depth < 3 && !seen.has(current.text)) {
          const next = new Set(seen).add(current.text);
          for (const entry of entries) {
            if (entry.init && mentionsParam(entry.init, fn, depth + 1, next)) {
              found = true;
            }
          }
        }
        return;
      }
      ts.forEachChild(current, walk);
    };
    walk(node);
    return found;
  };

  return { analyze, mentionsParam, UNKNOWN };
}

/**
 * Finds tests in `source` (the text of `file`) that read a source module as
 * text. `addedLines` is a Set of 1-based line numbers this branch added; when
 * given, only reads that touch an added line are reported: a line of the read
 * itself, the string literal naming the source file it reads (a const or a
 * table row elsewhere), or a `.toString()` that turns it into text.
 * Pass null to report every read (the `--all` measurement mode).
 *
 * Returns [{ file, line, text, reason }].
 */
export function findSourceReadViolations(file, source, addedLines = null) {
  const rel = toPosix(file);
  if (!isTestFile(rel)) return [];
  if (!MIGHT_READ_RE.test(source)) return [];

  const sf = ts.createSourceFile(
    rel,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(rel),
  );
  // Lines as the compiler counts them (so offsets line up), without their
  // terminators: a checkout with Windows line endings still sees the pragma
  // text without a trailing carriage return.
  const lineStarts = sf.getLineStarts();
  const lines = lineStarts.map((start, index) =>
    source
      .slice(start, lineStarts[index + 1] ?? source.length)
      .replace(/[\r\n\u2028\u2029]+$/u, ""),
  );
  const pragmaStatus = createPragmaReader(sf, lines);
  const lineOfNode = (node) =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const model = collectModel(sf);
  const { analyze, mentionsParam, UNKNOWN } = createPathAnalyzer(model);
  const { isFsExpression, isLocalBinding, fsReaders, calls, rawSpecifiers } =
    model;

  const readReceiverIsFs = (callee) => {
    if (ts.isIdentifier(callee)) {
      return (
        fsReaders.has(callee.text) ||
        (callee.text === "readFileSync" && !isLocalBinding(callee.text))
      );
    }
    if (
      ts.isPropertyAccessExpression(callee) &&
      READ_METHODS.has(callee.name.text)
    ) {
      return isFsExpression(callee.expression);
    }
    return false;
  };

  // { node, reason, alsoLines }: alsoLines are lines outside the node that
  // still make the read new when added (where the source path is named, or
  // a `.toString()` that turns the read into text).
  const found = [];
  // Same-file helpers that read a path built from their parameters:
  // name -> { anchoredInside } (whether the helper roots the path in the repo)
  const helpers = new Map();
  const countsAsSource = (facts) =>
    facts.tail === "source" &&
    !facts.fixture &&
    !facts.temp &&
    (facts.anchored || facts.literalOnly);

  for (const call of calls) {
    const callee = call.expression;

    // ?raw: import("./X.tsx?raw"), require, vi.importActual
    if (
      callee.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(callee) && callee.text === "require") ||
      (ts.isPropertyAccessExpression(callee) &&
        /^import(?:Actual|Original)$/.test(callee.name.text))
    ) {
      const spec = call.arguments[0] && stringValue(call.arguments[0]);
      if (spec && RAW_SOURCE_RE.test(spec)) {
        found.push({
          node: call.arguments[0],
          reason: `imports ${spec} as raw text`,
        });
      }
      continue;
    }
    if (readReceiverIsFs(callee)) {
      const pathArg = call.arguments[0];
      if (!pathArg || !isTextRead(call)) continue;
      const facts = analyze(pathArg);
      if (facts.temp || facts.fixture) continue;
      if (countsAsSource(facts)) {
        const conversion = toStringConversion(call);
        found.push({
          node: call,
          reason: "reads a source file as text",
          alsoLines: conversion
            ? [...facts.sourceLines, lineOfNode(conversion)]
            : facts.sourceLines,
        });
      } else if (facts.tail === "unknown") {
        const named = nearestNamedFunction(call);
        if (named && mentionsParam(pathArg, named.fn)) {
          helpers.set(named.name, { anchoredInside: facts.anchored });
        }
      }
      continue;
    }
  }

  // Calls to same-file helpers that read their argument as text.
  if (helpers.size > 0) {
    for (const call of calls) {
      const callee = call.expression;
      if (!ts.isIdentifier(callee) || !helpers.has(callee.text)) continue;
      const argFacts = call.arguments.map((arg) =>
        ts.isSpreadElement(arg) ? UNKNOWN : analyze(arg),
      );
      if (argFacts.some((facts) => facts.temp || facts.fixture)) continue;
      const rooted =
        helpers.get(callee.text).anchoredInside ||
        argFacts.some((facts) => facts.anchored) ||
        call.arguments.every((arg) => {
          const value = unwrap(arg);
          return (
            stringValue(value) !== null || ts.isObjectLiteralExpression(value)
          );
        });
      if (rooted && argFacts.some((facts) => facts.tail === "source")) {
        found.push({
          node: call,
          reason: `${callee.text}() reads a source file as text`,
          alsoLines: argFacts.flatMap((facts) => facts.sourceLines),
        });
      }
    }
  }

  for (const specifier of rawSpecifiers) {
    found.push({
      node: specifier,
      reason: `imports ${specifier.text} as raw text`,
    });
  }

  // ---- scope to added lines, apply pragma, report -------------------------
  const violations = [];
  const seenReports = new Set();
  for (const { node, reason, alsoLines = [] } of found) {
    const startLine = lineOfNode(node);
    const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    if (addedLines) {
      let touched = alsoLines.some((line) => addedLines.has(line));
      for (let line = startLine; !touched && line <= endLine; line += 1) {
        touched = addedLines.has(line);
      }
      if (!touched) continue;
    }
    const status = pragmaStatus(startLine);
    if (status === "ok") continue;
    const key = `${startLine}:${reason}`;
    if (seenReports.has(key)) continue;
    seenReports.add(key);
    violations.push({
      file: rel,
      line: startLine,
      text: (lines[startLine - 1] ?? "").trim(),
      reason:
        status === "empty"
          ? `${reason}; the source-read-ok pragma needs a reason after the colon`
          : reason,
    });
  }
  violations.sort((a, b) => a.line - b.line);
  return violations;
}
