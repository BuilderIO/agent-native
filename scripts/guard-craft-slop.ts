import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

export type CraftSlopRuleId =
  | "slop/unprompted-ai-gradient"
  | "slop/bare-loading-text"
  | "slop/native-browser-dialog"
  | "slop/mac-only-shortcut"
  | "slop/dead-end-empty-state"
  | "slop/god-component-state";

export interface CraftSlopFinding {
  rule: CraftSlopRuleId;
  file: string;
  line: number;
  snippet: string;
  message: string;
}

export interface CraftSlopScanResult {
  filesScanned: number;
  findings: CraftSlopFinding[];
}

const MAX_USE_STATE_CALLS = 25;

const EXCLUDED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  ".output",
  ".react-router",
  ".generated",
  ".tmp",
  "coverage",
  "storybook-static",
]);

const TEST_OR_STORY_FILE = /\.(?:test|spec|stories)\.[cm]?[jt]sx?$/;
const SCANNABLE_CODE_EXT = /\.[cm]?[jt]sx?$/;
const SCANNABLE_CSS_EXT = /\.css$/;

const TW_GRADIENT_DIR_RE = /\bbg-(?:gradient|linear)-to-[a-z]+\b/;
const TW_SLOP_STOP_RE =
  /\b(?:from|via|to)-(?:purple|indigo|violet|fuchsia|cyan)-[0-9]{2,3}\b/;
const CSS_GRADIENT_RE = /\b(?:linear|radial|conic)-gradient\s*\([^)]*\)/i;
const CSS_SLOP_COLOR_RE =
  /\b(?:purple|indigo|violet|fuchsia|cyan)\b|(?:#6366f1|#8b5cf6|#a855f7|#7c3aed|#9333ea|#06b6d4|#22d3ee)\b/i;
const BARE_LOADING_RE = /^loading(?:\.{3}|…)?$/i;
const NATIVE_DIALOG_NAMES = new Set(["confirm", "alert", "prompt"]);
const INTERACTIVE_TAG_RE =
  /^(?:button|a|link|input|form|resourcestateboundary|safedestructiveaction)$|(?:button|link|cta|action|trigger)$/i;
const INTERACTIVE_ATTRS = new Set([
  "onClick",
  "onAction",
  "onSubmit",
  "href",
  "to",
  "actionLabel",
]);

function scriptKindFor(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function lineNumberAt(source: ts.SourceFile, position: number): number {
  return source.getLineAndCharacterOfPosition(position).line + 1;
}

function compactSnippet(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 120);
}

function containsUnpromptedGradient(value: string): boolean {
  if (TW_GRADIENT_DIR_RE.test(value) && TW_SLOP_STOP_RE.test(value)) {
    return true;
  }
  const cssGradient = CSS_GRADIENT_RE.exec(value);
  return cssGradient !== null && CSS_SLOP_COLOR_RE.test(cssGradient[0]);
}

function scanCssSlop(file: string, sourceText: string): CraftSlopFinding[] {
  const findings: CraftSlopFinding[] = [];
  const lines = sourceText.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index];
    if (containsUnpromptedGradient(lineText)) {
      findings.push({
        rule: "slop/unprompted-ai-gradient",
        file,
        line: index + 1,
        snippet: compactSnippet(lineText),
        message:
          "Unprompted purple/indigo/cyan gradient detected; use semantic surface and brand tokens from craft-tokens.css.",
      });
    }
  }
  return findings;
}

function isJsxNode(node: ts.Node): boolean {
  return (
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node)
  );
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isLengthAccess(node: ts.Expression): boolean {
  const unwrapped = unwrapExpression(node);
  return (
    ts.isPropertyAccessExpression(unwrapped) && unwrapped.name.text === "length"
  );
}

function isZeroLiteral(node: ts.Expression): boolean {
  const unwrapped = unwrapExpression(node);
  return ts.isNumericLiteral(unwrapped) && unwrapped.text === "0";
}

function classifyEmptyCheck(
  condition: ts.Expression,
): "empty-when-true" | "empty-when-false" | null {
  const expr = unwrapExpression(condition);
  if (ts.isPrefixUnaryExpression(expr)) {
    if (
      expr.operator === ts.SyntaxKind.ExclamationToken &&
      isLengthAccess(expr.operand)
    ) {
      return "empty-when-true";
    }
    return null;
  }

  if (ts.isIdentifier(expr) && /^isEmpty$/i.test(expr.text)) {
    return "empty-when-true";
  }

  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (
      (op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        op === ts.SyntaxKind.EqualsEqualsToken ||
        op === ts.SyntaxKind.LessThanEqualsToken) &&
      ((isLengthAccess(expr.left) && isZeroLiteral(expr.right)) ||
        (isZeroLiteral(expr.left) && isLengthAccess(expr.right)))
    ) {
      return "empty-when-true";
    }
    if (
      (op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
        op === ts.SyntaxKind.ExclamationEqualsToken ||
        op === ts.SyntaxKind.GreaterThanToken) &&
      ((isLengthAccess(expr.left) && isZeroLiteral(expr.right)) ||
        (isZeroLiteral(expr.left) && isLengthAccess(expr.right)))
    ) {
      return "empty-when-false";
    }
  }

  if (isLengthAccess(expr)) {
    return "empty-when-false";
  }

  return null;
}

function jsxTagNameText(tagName: ts.JsxTagNameExpression): string {
  if (ts.isIdentifier(tagName)) return tagName.text;
  if (ts.isPropertyAccessExpression(tagName)) return tagName.name.text;
  return tagName.getText();
}

function hasInteractiveCta(node: ts.Node): boolean {
  let found = false;
  const walk = (current: ts.Node): void => {
    if (found) return;
    if (
      ts.isJsxOpeningElement(current) ||
      ts.isJsxSelfClosingElement(current)
    ) {
      if (INTERACTIVE_TAG_RE.test(jsxTagNameText(current.tagName))) {
        found = true;
        return;
      }
      for (const attr of current.attributes.properties) {
        if (
          ts.isJsxAttribute(attr) &&
          ts.isIdentifier(attr.name) &&
          INTERACTIVE_ATTRS.has(attr.name.text)
        ) {
          found = true;
          return;
        }
      }
    }
    ts.forEachChild(current, walk);
  };
  walk(node);
  return found;
}

function hasCompanionCtrlKeyCheck(
  metaAccess: ts.PropertyAccessExpression,
): boolean {
  let scope: ts.Node = metaAccess.parent;
  while (!ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) {
    scope = scope.parent;
  }
  let foundCtrlKey = false;
  const search = (node: ts.Node): void => {
    if (foundCtrlKey) return;
    if (ts.isPropertyAccessExpression(node) && node.name.text === "ctrlKey") {
      foundCtrlKey = true;
      return;
    }
    if (ts.isIdentifier(node) && node.text === "ctrlKey") {
      foundCtrlKey = true;
      return;
    }
    ts.forEachChild(node, search);
  };
  search(scope);
  return foundCtrlKey;
}

function isUseStateCall(node: ts.CallExpression): boolean {
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text === "useState";
  }
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "React" &&
    node.expression.name.text === "useState"
  ) {
    return true;
  }
  return false;
}

function isNativeDialogCall(node: ts.CallExpression): string | null {
  if (
    ts.isIdentifier(node.expression) &&
    NATIVE_DIALOG_NAMES.has(node.expression.text)
  ) {
    return node.expression.text;
  }
  if (
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    (node.expression.expression.text === "window" ||
      node.expression.expression.text === "globalThis") &&
    NATIVE_DIALOG_NAMES.has(node.expression.name.text)
  ) {
    return `${node.expression.expression.text}.${node.expression.name.text}`;
  }
  return null;
}

export function scanCraftSlopSource(
  file: string,
  sourceText: string,
): CraftSlopFinding[] {
  if (SCANNABLE_CSS_EXT.test(file)) {
    return scanCssSlop(file, sourceText);
  }
  if (!SCANNABLE_CODE_EXT.test(file)) {
    return [];
  }

  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file),
  );

  const findings: CraftSlopFinding[] = [];
  const reportedEmptyBranches = new Set<number>();
  const useStatePositions: number[] = [];

  const checkEmptyBranch = (branch: ts.Expression): void => {
    const unwrapped = unwrapExpression(branch);
    if (!isJsxNode(unwrapped)) {
      return;
    }
    const pos = unwrapped.getStart(source);
    if (reportedEmptyBranches.has(pos)) {
      return;
    }
    if (!hasInteractiveCta(unwrapped)) {
      reportedEmptyBranches.add(pos);
      findings.push({
        rule: "slop/dead-end-empty-state",
        file,
        line: lineNumberAt(source, pos),
        snippet: compactSnippet(unwrapped.getText(source)),
        message:
          "Empty-state branch has no interactive CTA; wrap with ResourceStateBoundary or provide a primary action button.",
      });
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) {
      if (containsUnpromptedGradient(node.text)) {
        findings.push({
          rule: "slop/unprompted-ai-gradient",
          file,
          line: lineNumberAt(source, node.getStart(source)),
          snippet: compactSnippet(node.text),
          message:
            "Unprompted purple/indigo/cyan gradient detected; use semantic surface and brand tokens from craft-tokens.css.",
        });
      }
      if (
        BARE_LOADING_RE.test(node.text.trim()) &&
        (ts.isJsxExpression(node.parent) || ts.isReturnStatement(node.parent))
      ) {
        findings.push({
          rule: "slop/bare-loading-text",
          file,
          line: lineNumberAt(source, node.getStart(source)),
          snippet: compactSnippet(node.getText(source)),
          message:
            'Bare "Loading..." text detected; render a layout-matched Skeleton via ResourceStateBoundary.',
        });
      }
    }

    if (ts.isTemplateExpression(node)) {
      const staticText = [
        node.head.text,
        ...node.templateSpans.map((span) => span.literal.text),
      ].join(" ");
      if (containsUnpromptedGradient(staticText)) {
        findings.push({
          rule: "slop/unprompted-ai-gradient",
          file,
          line: lineNumberAt(source, node.getStart(source)),
          snippet: compactSnippet(node.getText(source)),
          message:
            "Unprompted purple/indigo/cyan gradient detected; use semantic surface and brand tokens from craft-tokens.css.",
        });
      }
    }

    if (ts.isJsxText(node) && BARE_LOADING_RE.test(node.text.trim())) {
      findings.push({
        rule: "slop/bare-loading-text",
        file,
        line: lineNumberAt(source, node.getStart(source)),
        snippet: compactSnippet(node.text),
        message:
          'Bare "Loading..." text detected; render a layout-matched Skeleton via ResourceStateBoundary.',
      });
    }

    if (ts.isCallExpression(node)) {
      const nativeDialog = isNativeDialogCall(node);
      if (nativeDialog !== null) {
        findings.push({
          rule: "slop/native-browser-dialog",
          file,
          line: lineNumberAt(source, node.getStart(source)),
          snippet: compactSnippet(node.getText(source)),
          message: `Native browser dialog "${nativeDialog}()" detected; use SafeDestructiveAction or AlertDialog instead.`,
        });
      }
      if (isUseStateCall(node)) {
        useStatePositions.push(node.getStart(source));
      }
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "metaKey" &&
      !hasCompanionCtrlKeyCheck(node)
    ) {
      findings.push({
        rule: "slop/mac-only-shortcut",
        file,
        line: lineNumberAt(source, node.getStart(source)),
        snippet: compactSnippet(node.parent.getText(source)),
        message:
          "Mac-only metaKey shortcut without ctrlKey fallback; use useCommandRegistry (Mod+...) or check (metaKey || ctrlKey).",
      });
    }

    if (ts.isConditionalExpression(node)) {
      const kind = classifyEmptyCheck(node.condition);
      if (kind === "empty-when-true") {
        checkEmptyBranch(node.whenTrue);
      } else if (kind === "empty-when-false") {
        checkEmptyBranch(node.whenFalse);
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      classifyEmptyCheck(node.left) === "empty-when-true"
    ) {
      checkEmptyBranch(node.right);
    }

    if (
      ts.isIfStatement(node) &&
      classifyEmptyCheck(node.expression) === "empty-when-true"
    ) {
      const checkStatement = (statement: ts.Statement): void => {
        if (ts.isReturnStatement(statement) && statement.expression) {
          checkEmptyBranch(statement.expression);
        } else if (ts.isBlock(statement)) {
          for (const child of statement.statements) {
            if (ts.isReturnStatement(child) && child.expression) {
              checkEmptyBranch(child.expression);
            }
          }
        }
      };
      checkStatement(node.thenStatement);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  if (useStatePositions.length > MAX_USE_STATE_CALLS) {
    const thresholdPos = useStatePositions[MAX_USE_STATE_CALLS] ?? 0;
    findings.push({
      rule: "slop/god-component-state",
      file,
      line: lineNumberAt(source, thresholdPos),
      snippet: `${useStatePositions.length} useState calls (max ${MAX_USE_STATE_CALLS})`,
      message: `File declares ${useStatePositions.length} useState calls (limit ${MAX_USE_STATE_CALLS}); split into focused sub-components or a reducer/controller hook.`,
    });
  }

  findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return findings;
}

function collectScannableFiles(targetPath: string, out: string[]): void {
  const stats = statSync(targetPath);
  if (stats.isFile()) {
    if (
      SCANNABLE_CODE_EXT.test(targetPath) ||
      SCANNABLE_CSS_EXT.test(targetPath)
    ) {
      out.push(targetPath);
    }
    return;
  }
  if (!stats.isDirectory()) {
    return;
  }

  for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      collectScannableFiles(fullPath, out);
    } else if (
      entry.isFile() &&
      !TEST_OR_STORY_FILE.test(entry.name) &&
      (SCANNABLE_CODE_EXT.test(entry.name) ||
        SCANNABLE_CSS_EXT.test(entry.name))
    ) {
      out.push(fullPath);
    }
  }
}

export function scanCraftSlopPaths(
  targetPaths: readonly string[],
  cwd: string = process.cwd(),
): CraftSlopScanResult {
  const files: string[] = [];
  for (const target of targetPaths) {
    const absoluteTarget = path.resolve(cwd, target);
    collectScannableFiles(absoluteTarget, files);
  }
  files.sort();

  const findings: CraftSlopFinding[] = [];
  for (const absoluteFile of files) {
    const relativeFile = path.relative(cwd, absoluteFile).replaceAll("\\", "/");
    const sourceText = readFileSync(absoluteFile, "utf8");
    findings.push(...scanCraftSlopSource(relativeFile, sourceText));
  }

  return { filesScanned: files.length, findings };
}

function main(): void {
  const rawArgs = process.argv.slice(2);
  const asJson = rawArgs.includes("--json");
  const advisory = rawArgs.includes("--advisory");
  const targets = rawArgs.filter((arg) => !arg.startsWith("--"));

  if (targets.length === 0) {
    console.error(
      "Usage: pnpm tsx scripts/guard-craft-slop.ts [--advisory] [--json] <dir-or-file> [...]",
    );
    process.exitCode = 2;
    return;
  }

  const result = scanCraftSlopPaths(targets, process.cwd());

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.findings.length === 0) {
    console.log(
      `guard-craft-slop: OK (${result.filesScanned} file(s) scanned, 0 findings)`,
    );
  } else {
    console.error(
      `guard-craft-slop: ${result.findings.length} finding(s) across ${result.filesScanned} file(s):`,
    );
    for (const finding of result.findings) {
      console.error(
        `  ${finding.file}:${finding.line} [${finding.rule}] ${finding.message}`,
      );
      console.error(`    ${finding.snippet}`);
    }
  }

  if (result.findings.length > 0 && !advisory) {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
