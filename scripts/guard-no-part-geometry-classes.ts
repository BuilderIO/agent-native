/**
 * guard:no-part-geometry-classes
 *
 * A design-system part owns its size through its `size` prop and the system's
 * roles. A utility that restates its height, padding, radius, type size or
 * weight (`h-6` on a SelectTrigger, `!text-[11px]` on a SelectItem, a
 * `min-w-[12rem]` on a Select popup) fights the part, and the part loses in
 * some themes and wins in others. Layout utilities (`w-full`, `flex-1`,
 * margins, `truncate`, positioning) stay allowed.
 *
 * Scope: lines this branch added to .tsx files in the code already on the
 * design system (`MIGRATED_ROOTS`), except tests, stories and the design
 * system's own parts. An app joins the list when it moves onto the parts;
 * until then its old classes are migration work, not new regressions. The
 * check reads the TypeScript AST: a JSX element whose tag is a part and whose
 * `className` holds a forbidden utility in any string literal, including those
 * inside `cn(...)`, `clsx(...)` and conditionals.
 *
 * A tag counts by what it imports: `Button as ToolkitButton` from a `ui/`
 * module is a part, while a `Button` re-exported from a local wrapper outside
 * `ui/` (an unstyled `PrimitiveButton`) is not, since the wrapper owns its
 * geometry.
 *
 * Variants on arbitrary selectors (`[&_svg]:size-3`, `*:p-2`) target the
 * part's descendants, not the part, so they are not checked.
 *
 * Opt out on the class line or the line above, with a 10+ character reason:
 *   // part-geometry-ok: <reason>
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import {
  GUARD_EXIT_COULD_NOT_RUN,
  requireAddedLines,
} from "./lib/changed-lines.mjs";

const GUARD_NAME = "guard:no-part-geometry-classes";
const rootDir = path.resolve(import.meta.dirname, "..");

/** JSX tags that are design-system parts. Skeleton and Avatar are sized by the caller. */
export const PART_TAGS: ReadonlySet<string> = new Set([
  "Button",
  "IconButton",
  "Toggle",
  "ToggleGroup",
  "SegmentedControl",
  "Input",
  "TextArea",
  "Badge",
  "Select",
  "SelectTrigger",
  "SelectContent",
  "SelectItem",
  "SelectValue",
  "Tabs",
  "TabsList",
  "TabsTab",
  "Switch",
  "Checkbox",
  "Spinner",
]);

/** The shared toolkit and each app that has moved onto the design system's parts. */
export const MIGRATED_ROOTS: readonly string[] = [
  "packages/toolkit/",
  "templates/design/",
];

const TSX = /\.tsx$/;
const NOT_PRODUCT_CODE =
  /\.(?:test|spec|stories)\.[cm]?[jt]sx?$|(?:^|\/)stories\//;
const OWNED_BY_DESIGN_SYSTEM =
  /^packages\/toolkit\/src\/ui\/base-ui\/|^packages\/design-system\//;
const SKIPPED_PATH =
  /(?:^|\/)(?:node_modules|dist|build|coverage|\.output|\.generated)\//;
const PRAGMA = /part-geometry-ok:\s*(.*?)\s*(?:\*\/\s*\}?)?$/;
const MIN_REASON_LENGTH = 10;

const TEXT_SIZES = "xs|sm|base|lg|xl|[2-9]xl";
const FORBIDDEN: readonly RegExp[] = [
  // height and size
  /^(?:h-(?:\d|\[|px\b|\()|min-h-|max-h-|size-)/,
  // padding
  /^p[xytbselr]?-/,
  // radius
  /^rounded(?:-|$)/,
  // text size, with an optional line-height suffix (`text-sm/6`)
  new RegExp(`^text-(?:${TEXT_SIZES})(?:/.+)?$`),
  /^text-\[\s*[\d.]+(?:px|rem|em)\s*\]$/,
  // font weight
  /^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
  /^font-\[\d+\]$/,
  // arbitrary widths; `w-full`, `w-auto`, `w-fit` and `min-w-0` are layout
  /^(?:min-w|w|max-w)-\[/,
];

export interface PartGeometryFinding {
  file: string;
  line: number;
  tag: string;
  className: string;
}

export function isInScope(relPath: string): boolean {
  return (
    TSX.test(relPath) &&
    MIGRATED_ROOTS.some((root) => relPath.startsWith(root)) &&
    !NOT_PRODUCT_CODE.test(relPath) &&
    !OWNED_BY_DESIGN_SYSTEM.test(relPath) &&
    !SKIPPED_PATH.test(relPath)
  );
}

/** Splits `md:hover:!h-6` into its variants and the bare utility. */
function splitUtility(token: string): { variants: string[]; utility: string } {
  const variants: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < token.length; index++) {
    const char = token[index];
    if (char === "[" || char === "(") depth++;
    else if (char === "]" || char === ")") depth--;
    else if (char === ":" && depth === 0) {
      variants.push(token.slice(start, index));
      start = index + 1;
    }
  }
  const utility = token.slice(start).replace(/^!/, "").replace(/!$/, "");
  return { variants, utility };
}

function isForbidden(token: string): boolean {
  const { variants, utility } = splitUtility(token);
  if (variants.some((variant) => variant.startsWith("[") || variant === "*")) {
    return false;
  }
  return FORBIDDEN.some((pattern) => pattern.test(utility));
}

function hasPragma(lines: string[], lineNumber: number): boolean {
  for (const candidate of [lineNumber, lineNumber - 1]) {
    const match = PRAGMA.exec(lines[candidate - 1] ?? "");
    if (match && match[1].length >= MIN_REASON_LENGTH) return true;
  }
  return false;
}

function isStringPiece(node: ts.Node): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  );
}

function classAttribute(
  attributes: ts.JsxAttributes,
): ts.JsxAttribute | undefined {
  for (const attribute of attributes.properties) {
    if (
      ts.isJsxAttribute(attribute) &&
      ts.isIdentifier(attribute.name) &&
      attribute.name.text === "className"
    ) {
      return attribute;
    }
  }
  return undefined;
}

/**
 * Each imported JSX name, mapped to the part it is, or to null when it comes
 * from a relative module outside a `ui/` directory. Names the file doesn't
 * import are judged by their own spelling.
 */
function importedParts(
  file: string,
  sourceFile: ts.SourceFile,
  parts: ReadonlySet<string>,
): Map<string, string | null> {
  const imported = new Map<string, string | null>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const partModule =
      !specifier.startsWith(".") ||
      /(?:^|\/)ui\//.test(path.posix.join(path.posix.dirname(file), specifier));
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const name = (element.propertyName ?? element.name).text;
      imported.set(
        element.name.text,
        partModule && parts.has(name) ? name : null,
      );
    }
  }
  return imported;
}

export function findPartGeometryClasses(
  file: string,
  source: string,
  addedLines: ReadonlySet<number> | null,
  parts: ReadonlySet<string> = PART_TAGS,
): PartGeometryFinding[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const lines = source.split("\n");
  const imports = importedParts(file, sourceFile, parts);
  const partOf = (tag: string): string | null =>
    imports.has(tag) ? (imports.get(tag) ?? null) : parts.has(tag) ? tag : null;
  const findings: PartGeometryFinding[] = [];
  const seen = new Set<string>();

  const lineOf = (position: number): number =>
    sourceFile.getLineAndCharacterOfPosition(position).line + 1;

  const inspectString = (tag: string, node: ts.Node): void => {
    const start = node.getStart(sourceFile);
    const raw = source.slice(start, node.end);
    // Quotes, backticks and `${` `}` delimiters are not part of a class token.
    for (const match of raw.matchAll(/[^\s"'`{}$]+/g)) {
      const token = match[0];
      if (!isForbidden(token)) continue;
      const line = lineOf(start + match.index);
      if (addedLines !== null && !addedLines.has(line)) continue;
      if (hasPragma(lines, line)) continue;
      const key = `${line}:${tag}:${token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ file, line, tag, className: token });
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sourceFile);
      if (partOf(tag) !== null) {
        const attribute = classAttribute(node.attributes);
        if (attribute?.initializer) {
          const collect = (child: ts.Node): void => {
            if (isStringPiece(child)) inspectString(tag, child);
            ts.forEachChild(child, collect);
          };
          collect(attribute.initializer);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return findings.sort((a, b) => a.line - b.line);
}

function main(): void {
  const added = requireAddedLines(rootDir, GUARD_NAME);
  let inspected = 0;
  const findings: PartGeometryFinding[] = [];
  for (const [absPath, lineNumbers] of added) {
    const rel = path.relative(rootDir, absPath).replace(/\\/g, "/");
    if (!isInScope(rel)) continue;
    inspected++;
    findings.push(
      ...findPartGeometryClasses(
        rel,
        readFileSync(absPath, "utf8"),
        lineNumbers,
      ),
    );
  }
  if (findings.length === 0) {
    console.log(`${GUARD_NAME}: OK (${inspected} changed file(s) inspected)`);
    return;
  }
  console.error(
    `${GUARD_NAME}: ${findings.length} class(es) restate the geometry of a design-system part.\n`,
  );
  for (const finding of findings) {
    console.error(
      `  ${finding.file}:${finding.line}  <${finding.tag}>  ${finding.className}\n` +
        "    the part sets this through its size prop (`size`) or the design-system roles; remove the class or use `size`",
    );
  }
  console.error(
    "\nIf this really must override the part, add on the class line or the line above:\n" +
      "  // part-geometry-ok: <reason of 10+ characters>\n",
  );
  process.exit(1);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    console.error(`${GUARD_NAME}: could not run: ${String(error)}`);
    process.exit(GUARD_EXIT_COULD_NOT_RUN);
  }
}
