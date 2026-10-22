import { createHash } from "node:crypto";

import * as t from "@babel/types";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getDb, schema } from "../db/index.js";
import { parseSource, walkAll } from "./slide-source-editing/babel-walk.js";
import {
  isSlideSourceWithinByteLimit,
  SLIDE_SOURCE_BYTE_LIMIT_MESSAGE,
} from "./slide-source-limits.js";

const MAX_RENDERED_LENGTH = 1024 * 1024;
const MAX_AST_NODES = 8_000;
const MAX_EVALUATED_VALUES = 32_000;
// Bound module expansion separately from persisted deck rendering.
const MAX_SOURCE_PAGES = 40;
const MAX_RENDER_DEPTH = 48;
const MAX_ASSET_COUNT = 64;
const ASSET_ID = /^[A-Za-z0-9_-]{1,200}$/;

const HTML_TAGS = new Set([
  "a",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "p",
  "pre",
  "q",
  "s",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
  "video",
]);

const SVG_TAGS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "line",
  "polygon",
  "polyline",
  "rect",
  "text",
  "tspan",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "pattern",
  "marker",
  "symbol",
  "use",
]);

const SAFE_ATTRS = new Set([
  "alt",
  "align",
  "aria-label",
  "aria-hidden",
  "aria-roledescription",
  "autoPlay",
  "colSpan",
  "controls",
  "cx",
  "cy",
  "d",
  "decoding",
  "dir",
  "draggable",
  "fill",
  "fillOpacity",
  "fillRule",
  "focusable",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "height",
  "hidden",
  "href",
  "htmlFor",
  "id",
  "lang",
  "loading",
  "loop",
  "markerEnd",
  "markerStart",
  "muted",
  "markerMid",
  "offset",
  "opacity",
  "points",
  "preserveAspectRatio",
  "playsInline",
  "poster",
  "preload",
  "r",
  "rel",
  "role",
  "rowSpan",
  "scope",
  "shapeRendering",
  "stroke",
  "strokeDasharray",
  "strokeDashoffset",
  "strokeLinecap",
  "strokeLinejoin",
  "strokeOpacity",
  "strokeWidth",
  "stopColor",
  "stopOpacity",
  "tabIndex",
  "target",
  "textAnchor",
  "title",
  "transform",
  "vectorEffect",
  "viewBox",
  "width",
  "x",
  "x1",
  "x2",
  "y",
  "y1",
  "y2",
  "xmlns",
]);

const ATTR_ALIASES: Record<string, string> = {
  class: "className",
  for: "htmlFor",
  "stroke-width": "strokeWidth",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "fill-rule": "fillRule",
  "fill-opacity": "fillOpacity",
  "stroke-opacity": "strokeOpacity",
  "text-anchor": "textAnchor",
  "shape-rendering": "shapeRendering",
  "vector-effect": "vectorEffect",
  "preserve-aspect-ratio": "preserveAspectRatio",
};

const SAFE_STYLE_FUNCTIONS = new Set([
  "calc",
  "clamp",
  "color",
  "color-mix",
  "conic-gradient",
  "hsl",
  "hsla",
  "hwb",
  "lab",
  "lch",
  "linear-gradient",
  "max",
  "matrix",
  "matrix3d",
  "min",
  "oklab",
  "oklch",
  "circle",
  "ellipse",
  "inset",
  "polygon",
  "radial-gradient",
  "repeating-conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "rgb",
  "rgba",
  "rotate",
  "rotatex",
  "rotatey",
  "rotatez",
  "scale",
  "scalex",
  "scaley",
  "scalez",
  "skew",
  "skewx",
  "skewy",
  "translate",
  "translatex",
  "translatey",
  "translatez",
  "var",
]);
const GRID_TRACK_STYLE_KEYS = new Set([
  "gridAutoColumns",
  "gridAutoRows",
  "gridTemplateColumns",
  "gridTemplateRows",
]);
const CSS_GRID_TRACK_SIZE =
  /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|fr|%|rem|em)|auto|min-content|max-content)$/i;
const MAX_GRID_TRACK_LIST_LENGTH = 512;
const MAX_GRID_TRACKS = 24;
const MAX_GRID_REPEAT_COUNT = 12;
const MAX_FILTER_BLUR_PX = 64;
const MAX_STATIC_MASK_LENGTH = 128;
const SAFE_VAR_REFERENCE = /var\(\s*--(?:deck|ds)-[A-Za-z0-9_-]+\s*\)/gi;
const CSS_FUNCTION = /([a-z][a-z0-9-]*)\s*\(/gi;
const QUOTED_STYLE_KEYS = new Set(["font", "fontFamily"]);
const SVG_LOCAL_REFERENCE_STYLE_KEYS = new Set([
  "clipPath",
  "fill",
  "markerEnd",
  "markerMid",
  "markerStart",
  "mask",
  "stroke",
]);
const SVG_LOCAL_REFERENCE_ATTRS = new Set([
  "fill",
  "markerEnd",
  "markerMid",
  "markerStart",
  "stroke",
]);
const RESOURCE_STYLE_KEYS = new Set([
  "borderImage",
  "borderImageSource",
  "content",
  "cursor",
  "filter",
  "listStyle",
  "listStyleImage",
  "mask",
  "maskBorder",
  "maskBorderSource",
  "maskImage",
  "offsetPath",
  "shapeOutside",
  "backdropFilter",
]);
const VARIABLE_IMAGE_STYLE_KEYS = new Set([
  "background",
  "backgroundImage",
  "clipPath",
  "fill",
  "markerEnd",
  "markerMid",
  "markerStart",
  "stroke",
]);
const SAFE_STYLE_KEY = /^(?:[a-z][A-Za-z0-9]*|--[A-Za-z0-9_-]+)$/;
const SAFE_THEME_VARIABLE = /^var\(\s*--(?:deck|ds)-[A-Za-z0-9_-]+\s*\)$/i;
const SAFE_THEME_COLOR_VARIABLES = new Set([
  "--cs-clay",
  "--cs-forest",
  "--cs-peach",
  "--deck-accent",
  "--deck-bg",
  "--deck-ink",
  "--deck-muted",
  "--deck-surface",
  "--deck-text",
  "--ds-accent",
  "--ds-bg",
  "--ds-surface",
  "--ds-text",
  "--ds-text-muted",
  "--qt-amber",
  "--qt-grid",
  "--qt-loss",
  "--up-line",
  "--up-ok",
  "--up-risk",
  "--up-warn",
  "--ws-dot",
  "--ws-mint",
  "--ws-peach",
  "--ws-pink",
  "--ws-sky",
]);
const SAFE_THEME_FONT_VARIABLES = new Set([
  "--deck-body-font",
  "--deck-display-font",
  "--deck-heading-font",
]);

export class SlideSourceError extends Error {
  readonly statusCode = 422;
  readonly errorCode = "invalid_slide_source";

  constructor(message: string) {
    super(message);
    this.name = "SlideSourceError";
  }
}

export function hashSlideSource(sourceTsx: string): string {
  return createHash("sha256").update(sourceTsx, "utf8").digest("hex");
}

export interface StaticSlidePageSource {
  sourceTsx: string;
  notes?: string;
}

export function findStaticLocalPageArray(
  ast: t.File,
  expression: t.Node,
): t.ArrayExpression | null {
  const candidate = unwrapTypeScriptExpression(expression);
  if (!t.isIdentifier(candidate)) return null;

  for (const statement of ast.program.body) {
    const declaration = t.isExportNamedDeclaration(statement)
      ? statement.declaration
      : statement;
    if (!t.isVariableDeclaration(declaration) || declaration.kind !== "const")
      continue;

    const binding = declaration.declarations.find(
      (item) => t.isIdentifier(item.id) && item.id.name === candidate.name,
    );
    if (!binding?.init) continue;
    const initializer = unwrapTypeScriptExpression(binding.init);
    return t.isArrayExpression(initializer) ? initializer : null;
  }

  return null;
}

export function splitSlideSourcePages(
  sourceTsx: string,
): StaticSlidePageSource[] {
  const ast = parse(sourceTsx);
  const defaultExport = ast.program.body.find(t.isExportDefaultDeclaration);
  if (!defaultExport || !t.isExportDefaultDeclaration(defaultExport)) {
    throw new SlideSourceError(
      "Slide source must have a default component export.",
    );
  }

  let declaration = unwrapTypeScriptExpression(defaultExport.declaration);
  const localPageArray = findStaticLocalPageArray(ast, declaration);
  if (localPageArray) declaration = localPageArray;
  let pageExpressions: t.Node[];
  if (!t.isArrayExpression(declaration)) {
    if (
      t.isIdentifier(declaration) ||
      t.isArrowFunctionExpression(declaration) ||
      t.isFunctionExpression(declaration) ||
      t.isFunctionDeclaration(declaration)
    ) {
      pageExpressions = [declaration];
    } else {
      throw new SlideSourceError(
        "Default export must be a static component or a static local Page array.",
      );
    }
  } else {
    if (
      declaration.elements.length === 0 ||
      declaration.elements.length > MAX_SOURCE_PAGES
    ) {
      throw new SlideSourceError(
        `A source module must contain between 1 and ${MAX_SOURCE_PAGES} static pages.`,
      );
    }
    pageExpressions = declaration.elements.map((page) => {
      if (!page || t.isSpreadElement(page) || t.isJSXNamespacedName(page)) {
        throw new SlideSourceError(
          "Page arrays must contain explicit local components.",
        );
      }
      let component = page;
      while (
        t.isTSAsExpression(component) ||
        t.isTSTypeAssertion(component) ||
        t.isTSNonNullExpression(component) ||
        t.isTSSatisfiesExpression(component)
      ) {
        component = component.expression;
      }
      if (
        !t.isIdentifier(component) &&
        !t.isArrowFunctionExpression(component) &&
        !t.isFunctionExpression(component)
      ) {
        throw new SlideSourceError(
          "Page arrays may contain only local component functions or names.",
        );
      }
      return component;
    });
  }

  const moduleNotes = readModuleNotes(ast, pageExpressions.length);
  const componentTransitions = readComponentTransitions(ast, pageExpressions);
  return pageExpressions.map((component, index) => {
    const declarationStart = defaultExport.declaration.start;
    const declarationEnd = defaultExport.declaration.end;
    if (
      declarationStart == null ||
      declarationEnd == null ||
      component.start == null ||
      component.end == null
    ) {
      throw new SlideSourceError(
        "Slide source page locations are unavailable.",
      );
    }
    const edits: Array<{ start: number; end: number; replacement: string }> =
      [];
    if (t.isArrayExpression(declaration)) {
      edits.push({
        start: declarationStart,
        end: declarationEnd,
        replacement: sourceTsx.slice(component.start, component.end),
      });
    }
    for (const assignment of componentTransitions.assignments) {
      if (assignment.start == null || assignment.end == null) {
        throw new SlideSourceError(
          "A page transition assignment has no source location.",
        );
      }
      edits.push({
        start: assignment.start,
        end: assignment.end,
        replacement: sourceTsx
          .slice(assignment.start, assignment.end)
          .replace(/[^\n]/g, " "),
      });
    }
    const pageTransition = componentTransitions.byPage.get(
      getComponentName(component) ?? "",
    );
    if (pageTransition) {
      if (pageTransition.start == null || pageTransition.end == null) {
        throw new SlideSourceError("A page transition has no source location.");
      }
      const transitionExport = componentTransitions.exportedTransition;
      if (
        transitionExport &&
        transitionExport.start != null &&
        transitionExport.end != null
      ) {
        edits.push({
          start: transitionExport.start,
          end: transitionExport.end,
          replacement: sourceTsx.slice(
            pageTransition.start,
            pageTransition.end,
          ),
        });
      } else {
        edits.push({
          start: sourceTsx.length,
          end: sourceTsx.length,
          replacement: `\nexport const transition = ${sourceTsx.slice(pageTransition.start, pageTransition.end)};\n`,
        });
      }
    }
    if (moduleNotes.exportNode) {
      const notesDeclaration = moduleNotes.exportNode.declaration;
      if (
        !notesDeclaration ||
        moduleNotes.exportNode.start == null ||
        notesDeclaration.start == null
      ) {
        throw new SlideSourceError(
          "Speaker notes export has no source location.",
        );
      }
      edits.push({
        start: moduleNotes.exportNode.start,
        end: notesDeclaration.start,
        replacement: "",
      });
    }
    let pageSource = sourceTsx;
    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      pageSource =
        pageSource.slice(0, edit.start) +
        edit.replacement +
        pageSource.slice(edit.end);
    }
    return {
      sourceTsx: pageSource,
      ...(moduleNotes.values ? { notes: moduleNotes.values[index] ?? "" } : {}),
    };
  });
}

function unwrapTypeScriptExpression(expression: t.Node): t.Node {
  let current = expression;
  while (
    t.isTSAsExpression(current) ||
    t.isTSTypeAssertion(current) ||
    t.isTSNonNullExpression(current) ||
    t.isTSSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function readComponentTransitions(
  ast: t.File,
  pages: t.Node[],
): {
  assignments: t.ExpressionStatement[];
  byPage: Map<string, t.Expression>;
  exportedTransition?: t.Expression;
} {
  const pageNames = new Set(
    pages.map(getComponentName).filter((name): name is string => name !== null),
  );
  const assignments: t.ExpressionStatement[] = [];
  const byPage = new Map<string, t.Expression>();
  for (const statement of ast.program.body) {
    if (
      !t.isExpressionStatement(statement) ||
      !t.isAssignmentExpression(statement.expression)
    )
      continue;
    const assignment = statement.expression;
    const left = assignment.left;
    if (
      assignment.operator !== "=" ||
      !t.isMemberExpression(left) ||
      left.computed ||
      !t.isIdentifier(left.object) ||
      !t.isIdentifier(left.property) ||
      left.property.name !== "transition" ||
      !pageNames.has(left.object.name)
    ) {
      continue;
    }
    assignments.push(statement);
    byPage.set(left.object.name, assignment.right as t.Expression);
  }

  let exportedTransition: t.Expression | undefined;
  for (const statement of ast.program.body) {
    if (
      !t.isExportNamedDeclaration(statement) ||
      !t.isVariableDeclaration(statement.declaration)
    )
      continue;
    for (const declaration of statement.declaration.declarations) {
      if (
        t.isIdentifier(declaration.id) &&
        declaration.id.name === "transition" &&
        declaration.init
      ) {
        exportedTransition = declaration.init as t.Expression;
      }
    }
  }
  return { assignments, byPage, exportedTransition };
}

function getComponentName(node: t.Node): string | null {
  if (t.isIdentifier(node)) return node.name;
  if (
    (t.isFunctionExpression(node) || t.isFunctionDeclaration(node)) &&
    node.id
  ) {
    return node.id.name;
  }
  return null;
}

function readModuleNotes(
  ast: t.File,
  pageCount: number,
): { exportNode?: t.ExportNamedDeclaration; values?: string[] } {
  const notesExports = ast.program.body.filter(
    (statement): statement is t.ExportNamedDeclaration => {
      if (
        !t.isExportNamedDeclaration(statement) ||
        !t.isVariableDeclaration(statement.declaration)
      ) {
        return false;
      }
      return statement.declaration.declarations.some(
        (declaration) =>
          t.isIdentifier(declaration.id) && declaration.id.name === "notes",
      );
    },
  );
  if (notesExports.length === 0) return {};
  if (notesExports.length !== 1)
    throw new SlideSourceError(
      "Slide source may contain only one notes export.",
    );

  const exportNode = notesExports[0]!;
  const declaration = exportNode.declaration;
  if (
    !t.isVariableDeclaration(declaration) ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1
  ) {
    throw new SlideSourceError(
      "Speaker notes must be one static const array export.",
    );
  }
  const notesDeclaration = declaration.declarations[0]!;
  if (
    !t.isIdentifier(notesDeclaration.id) ||
    notesDeclaration.id.name !== "notes" ||
    !t.isArrayExpression(notesDeclaration.init)
  ) {
    throw new SlideSourceError("Speaker notes must be a static string array.");
  }
  if (notesDeclaration.init.elements.length > pageCount) {
    throw new SlideSourceError(
      "Speaker notes cannot contain more entries than the slide page array.",
    );
  }
  const values = notesDeclaration.init.elements.map((entry) => {
    if (!entry) return "";
    if (t.isIdentifier(entry, { name: "undefined" }) || t.isNullLiteral(entry))
      return "";
    if (t.isStringLiteral(entry)) return entry.value;
    if (t.isTemplateLiteral(entry) && entry.expressions.length === 0) {
      const value = entry.quasis[0]?.value.cooked;
      if (value !== null && value !== undefined) return value;
    }
    throw new SlideSourceError(
      "Speaker notes entries must be static strings or empty values.",
    );
  });
  return { exportNode, values };
}

export function collectSlideAssetIds(sourceTsx: string): string[] {
  const ast = parse(sourceTsx);
  const ids = new Set<string>();

  walkAll(ast, (node) => {
    if (!t.isJSXElement(node)) return;
    for (const attribute of node.openingElement.attributes) {
      if (!t.isJSXAttribute(attribute) || !t.isJSXIdentifier(attribute.name))
        continue;
      if (
        attribute.name.name !== "src" &&
        !(
          attribute.name.name === "poster" &&
          jsxTagName(node.openingElement.name) === "video"
        )
      ) {
        continue;
      }
      const value = jsxAttributeLiteral(attribute);
      if (typeof value !== "string") {
        throw new SlideSourceError(
          `${attribute.name.name} must use an asset:// reference.`,
        );
      }
      if (!value.startsWith("asset://")) {
        throw new SlideSourceError(
          `${attribute.name.name} must use an asset:// reference.`,
        );
      }
      const id = value.slice("asset://".length);
      if (!ASSET_ID.test(id))
        throw new SlideSourceError("Invalid asset handle.");
      ids.add(id);
    }
  });

  if (ids.size > MAX_ASSET_COUNT) {
    throw new SlideSourceError(
      `A slide can reference at most ${MAX_ASSET_COUNT} uploaded assets.`,
    );
  }
  return [...ids];
}

export async function resolveSlideAssets(
  sourceTsx: string,
  scope: { ownerEmail: string; orgId?: string | null },
): Promise<Map<string, string>> {
  const ids = collectSlideAssetIds(sourceTsx);
  if (ids.length === 0) return new Map();

  const ownerScope = and(
    eq(schema.uploadedAssets.ownerEmail, scope.ownerEmail),
    scope.orgId
      ? eq(schema.uploadedAssets.orgId, scope.orgId)
      : isNull(schema.uploadedAssets.orgId),
  );
  const assetScope = scope.orgId
    ? or(ownerScope, eq(schema.uploadedAssets.orgId, scope.orgId))
    : ownerScope;

  const rows = await getDb()
    .select({ id: schema.uploadedAssets.id, url: schema.uploadedAssets.url })
    .from(schema.uploadedAssets)
    .where(and(inArray(schema.uploadedAssets.id, ids), assetScope));
  const resolved = new Map<string, string>();
  for (const row of rows) {
    resolved.set(row.id, assertStoredAssetUrl(row.url));
  }
  const missing = ids.filter((id) => !resolved.has(id));
  if (missing.length) {
    throw Object.assign(
      new Error("One or more slide assets are unavailable to this deck."),
      { statusCode: 404, errorCode: "slide_asset_unavailable" },
    );
  }
  return resolved;
}

export function slideAssetOrigins(assetUrls: Iterable<string>): string[] {
  const origins = new Set<string>();
  for (const url of assetUrls) {
    const parsed = new URL(url);
    origins.add(parsed.origin);
  }
  return [...origins].sort();
}

export function renderSlideSource(
  sourceTsx: string,
  assetUrls: ReadonlyMap<string, string>,
): string {
  const ast = parse(sourceTsx);
  const renderer = new StaticSlideRenderer(ast, assetUrls);
  const markup = renderToStaticMarkup(renderer.render());
  if (markup.length > MAX_RENDERED_LENGTH) {
    throw new SlideSourceError("Rendered slide is too large.");
  }
  if (
    /<\/?(?:script|style|iframe|frame|object|embed|link|meta|base|form|input|audio)\b/i.test(
      markup,
    )
  ) {
    throw new SlideSourceError("Rendered slide contains a disallowed element.");
  }
  return markup;
}

function assertStoredAssetUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw Object.assign(new Error("Uploaded asset URL is invalid."), {
      statusCode: 422,
      errorCode: "invalid_stored_slide_asset",
    });
  }
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && isLocalHost(parsed.hostname))
  ) {
    throw Object.assign(
      new Error("Uploaded asset URL must use HTTPS or the local app origin."),
      {
        statusCode: 422,
        errorCode: "invalid_stored_slide_asset",
      },
    );
  }
  return parsed.href;
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  );
}

function parse(sourceTsx: string): t.File {
  if (!sourceTsx.trim() || !isSlideSourceWithinByteLimit(sourceTsx)) {
    throw new SlideSourceError(SLIDE_SOURCE_BYTE_LIMIT_MESSAGE);
  }
  const ast = parseSource(sourceTsx);
  if (!ast) throw new SlideSourceError("Slide source has a syntax error.");
  let count = 0;
  walkAll(ast, () => {
    count += 1;
    if (count > MAX_AST_NODES)
      throw new SlideSourceError("Slide source is too complex.");
  });
  return ast;
}

function jsxAttributeLiteral(attribute: t.JSXAttribute): unknown {
  if (!attribute.value) return true;
  if (t.isStringLiteral(attribute.value)) return attribute.value.value;
  if (
    t.isJSXExpressionContainer(attribute.value) &&
    t.isStringLiteral(attribute.value.expression)
  ) {
    return attribute.value.expression.value;
  }
  return undefined;
}

class StaticFunction {
  constructor(
    readonly node:
      | t.ArrowFunctionExpression
      | t.FunctionExpression
      | t.FunctionDeclaration,
    readonly closure: Map<string, unknown>,
  ) {}
}

class StaticSlideRenderer {
  private readonly components = new Map<string, StaticFunction>();
  private readonly variables = new Map<string, unknown>();
  private renderedNodeCount = 0;
  private evaluatedValueCount = 0;

  constructor(
    private readonly ast: t.File,
    private readonly assetUrls: ReadonlyMap<string, string>,
  ) {
    this.prepareProgram();
  }

  render(): ReactNode {
    const declaration = this.defaultExport();
    const component = this.toStaticFunction(declaration, this.variables);
    if (!component)
      throw new SlideSourceError(
        "Default export must be a local slide component.",
      );
    const output = this.invoke(component, [{}], 0);
    return this.asChild(output);
  }

  private prepareProgram(): void {
    let defaultCount = 0;
    for (const statement of this.ast.program.body) {
      if (t.isExportDefaultDeclaration(statement)) {
        defaultCount += 1;
        continue;
      }
      if (
        t.isTSInterfaceDeclaration(statement) ||
        t.isTSTypeAliasDeclaration(statement)
      )
        continue;
      if (t.isFunctionDeclaration(statement)) {
        if (!statement.id)
          throw new SlideSourceError(
            "Anonymous helper declarations are not supported.",
          );
        this.components.set(
          statement.id.name,
          new StaticFunction(statement, this.variables),
        );
        continue;
      }
      if (t.isVariableDeclaration(statement) && statement.kind === "const") {
        for (const declaration of statement.declarations) {
          if (!t.isIdentifier(declaration.id) || !declaration.init) {
            throw new SlideSourceError(
              "Top-level declarations must be initialized const values.",
            );
          }
          const fn = this.toStaticFunction(declaration.init, this.variables);
          if (fn) this.components.set(declaration.id.name, fn);
          else
            this.variables.set(
              declaration.id.name,
              this.evaluate(declaration.init, this.variables, 0),
            );
        }
        continue;
      }
      if (t.isEmptyStatement(statement)) continue;
      throw new SlideSourceError(
        "Slide source cannot import modules or execute top-level code.",
      );
    }
    if (defaultCount !== 1)
      throw new SlideSourceError(
        "Slide source must have exactly one default export.",
      );
  }

  private defaultExport(): t.Node {
    const statement = this.ast.program.body.find(t.isExportDefaultDeclaration);
    if (!statement || !t.isExportDefaultDeclaration(statement)) {
      throw new SlideSourceError(
        "Slide source must have a default component export.",
      );
    }
    return statement.declaration;
  }

  private toStaticFunction(
    node: t.Node,
    closure: Map<string, unknown>,
  ): StaticFunction | null {
    if (
      t.isArrowFunctionExpression(node) ||
      t.isFunctionExpression(node) ||
      t.isFunctionDeclaration(node)
    ) {
      if (node.async || node.generator)
        throw new SlideSourceError(
          "Async and generator components are not supported.",
        );
      return new StaticFunction(node, new Map(closure));
    }
    if (t.isIdentifier(node)) {
      const value = closure.get(node.name) ?? this.components.get(node.name);
      return isStaticFunction(value) ? value : null;
    }
    return null;
  }

  private evaluate(
    node: t.Node,
    scope: Map<string, unknown>,
    depth: number,
  ): unknown {
    if (depth > MAX_RENDER_DEPTH)
      throw new SlideSourceError("Slide source nesting is too deep.");
    this.reserveEvaluatedValues(1);
    if (
      t.isStringLiteral(node) ||
      t.isNumericLiteral(node) ||
      t.isBooleanLiteral(node)
    )
      return node.value;
    if (t.isNullLiteral(node)) return null;
    if (t.isJSXElement(node)) return this.renderElement(node, scope, depth + 1);
    if (t.isJSXFragment(node)) {
      return createElement(
        Fragment,
        null,
        ...this.renderChildren(node.children, scope, depth + 1),
      );
    }
    if (t.isIdentifier(node)) {
      if (node.name === "undefined") return undefined;
      if (scope.has(node.name)) return scope.get(node.name);
      if (this.components.has(node.name)) return this.components.get(node.name);
      throw new SlideSourceError(`Unknown identifier "${node.name}".`);
    }
    if (t.isArrayExpression(node)) {
      this.reserveEvaluatedValues(node.elements.length);
      return node.elements.map((entry) => {
        if (!entry) return null;
        if (t.isSpreadElement(entry))
          throw new SlideSourceError("Spread expressions are not supported.");
        return this.evaluate(entry, scope, depth + 1);
      });
    }
    if (t.isObjectExpression(node)) {
      const result: Record<string, unknown> = Object.create(null);
      for (const property of node.properties) {
        if (
          !t.isObjectProperty(property) ||
          property.computed ||
          property.shorthand
        ) {
          throw new SlideSourceError(
            "Object values must use explicit static properties.",
          );
        }
        const key = t.isIdentifier(property.key)
          ? property.key.name
          : t.isStringLiteral(property.key)
            ? property.key.value
            : null;
        if (!key || isBlockedProperty(key))
          throw new SlideSourceError("Object key is not allowed.");
        result[key] = this.evaluate(property.value, scope, depth + 1);
      }
      return result;
    }
    if (t.isTemplateLiteral(node)) {
      return node.quasis
        .map((part, index) => {
          const value = part.value.cooked;
          if (value === null)
            throw new SlideSourceError("Invalid template string escape.");
          return (
            value +
            (index < node.expressions.length
              ? String(
                  this.evaluate(node.expressions[index], scope, depth + 1) ??
                    "",
                )
              : "")
          );
        })
        .join("");
    }
    if (t.isBinaryExpression(node)) {
      const left = this.evaluate(node.left, scope, depth + 1);
      const right = this.evaluate(node.right, scope, depth + 1);
      if (node.operator === "+") {
        if (typeof left === "string" || typeof right === "string") {
          return String(left ?? "") + String(right ?? "");
        }
        if (typeof left === "number" && typeof right === "number")
          return left + right;
      }
      if (typeof left === "number" && typeof right === "number") {
        if (node.operator === "-") return left - right;
        if (node.operator === "*") return left * right;
        if (node.operator === "/") return right === 0 ? null : left / right;
        if (node.operator === "%") return right === 0 ? null : left % right;
      }
      throw new SlideSourceError(
        "Only static addition and numeric arithmetic are supported.",
      );
    }
    if (t.isConditionalExpression(node)) {
      const test = this.evaluate(node.test, scope, depth + 1);
      return this.evaluate(
        test ? node.consequent : node.alternate,
        scope,
        depth + 1,
      );
    }
    if (t.isLogicalExpression(node)) {
      const left = this.evaluate(node.left, scope, depth + 1);
      if (node.operator === "&&")
        return left ? this.evaluate(node.right, scope, depth + 1) : left;
      if (node.operator === "||")
        return left ? left : this.evaluate(node.right, scope, depth + 1);
      if (node.operator === "??")
        return left == null
          ? this.evaluate(node.right, scope, depth + 1)
          : left;
    }
    if (t.isMemberExpression(node)) {
      const object = this.evaluate(node.object, scope, depth + 1);
      const property = node.computed
        ? this.evaluate(node.property, scope, depth + 1)
        : t.isIdentifier(node.property)
          ? node.property.name
          : null;
      if (typeof property !== "string" && typeof property !== "number") {
        throw new SlideSourceError("Dynamic property access is not supported.");
      }
      if (isBlockedProperty(String(property)))
        throw new SlideSourceError("Prototype access is not allowed.");
      if (
        (Array.isArray(object) || isPlainObject(object)) &&
        Object.hasOwn(object, property)
      ) {
        return (object as Record<string | number, unknown>)[property];
      }
      if (typeof object === "string" && property === "length")
        return object.length;
      throw new SlideSourceError(
        "Slide source reads only own properties of static values.",
      );
    }
    if (t.isCallExpression(node))
      return this.evaluateCall(node, scope, depth + 1);
    if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) {
      const fn = this.toStaticFunction(node, scope);
      if (fn) return fn;
    }
    if (
      t.isTSAsExpression(node) ||
      t.isTSTypeAssertion(node) ||
      t.isTSNonNullExpression(node) ||
      t.isTSSatisfiesExpression(node)
    ) {
      return this.evaluate(node.expression, scope, depth + 1);
    }
    if (t.isUnaryExpression(node)) {
      const value = this.evaluate(node.argument, scope, depth + 1);
      if (
        node.operator === "!" &&
        (value === null || typeof value !== "object")
      )
        return !value;
      if (typeof value === "number" && node.operator === "-") return -value;
    }
    throw new SlideSourceError(`Unsupported expression: ${node.type}.`);
  }

  private evaluateCall(
    node: t.CallExpression,
    scope: Map<string, unknown>,
    depth: number,
  ): unknown {
    const args = node.arguments.map((argument) => {
      if (t.isSpreadElement(argument) || t.isJSXNamespacedName(argument)) {
        throw new SlideSourceError("Spread arguments are not supported.");
      }
      return this.evaluate(argument, scope, depth + 1);
    });
    if (t.isIdentifier(node.callee)) {
      const fn =
        scope.get(node.callee.name) ?? this.components.get(node.callee.name);
      if (isStaticFunction(fn)) return this.invoke(fn, args, depth + 1);
    }
    if (
      t.isMemberExpression(node.callee) &&
      !node.callee.computed &&
      t.isIdentifier(node.callee.property)
    ) {
      const object = this.evaluate(node.callee.object, scope, depth + 1);
      const method = node.callee.property.name;
      if (
        Array.isArray(object) &&
        method === "map" &&
        isStaticFunction(args[0])
      ) {
        this.reserveEvaluatedValues(object.length);
        return object.map((value, index) =>
          this.invoke(args[0] as StaticFunction, [value, index], depth + 1),
        );
      }
      if (Array.isArray(object) && method === "join")
        return object.join(String(args[0] ?? ","));
      if (typeof object === "string") {
        if (method === "toUpperCase") return object.toUpperCase();
        if (method === "toLowerCase") return object.toLowerCase();
        if (method === "trim") return object.trim();
        if (method === "slice")
          return object.slice(
            Number(args[0] ?? 0),
            args[1] === undefined ? undefined : Number(args[1]),
          );
      }
    }
    throw new SlideSourceError(
      "Only local pure helpers and static array/string methods may be called.",
    );
  }

  private invoke(fn: StaticFunction, args: unknown[], depth: number): unknown {
    if (depth > MAX_RENDER_DEPTH)
      throw new SlideSourceError("Slide component nesting is too deep.");
    this.reserveEvaluatedValues(1);
    const scope = new Map(fn.closure);
    fn.node.params.forEach((parameter, index) =>
      bindParameter(parameter, args[index], scope),
    );
    if (
      t.isArrowFunctionExpression(fn.node) &&
      !t.isBlockStatement(fn.node.body)
    ) {
      return this.evaluate(fn.node.body, scope, depth + 1);
    }
    const body = fn.node.body;
    if (!t.isBlockStatement(body))
      throw new SlideSourceError("Invalid component body.");
    for (const statement of body.body) {
      if (t.isVariableDeclaration(statement) && statement.kind === "const") {
        for (const declaration of statement.declarations) {
          if (!t.isIdentifier(declaration.id) || !declaration.init) {
            throw new SlideSourceError(
              "Component locals must be initialized const values.",
            );
          }
          scope.set(
            declaration.id.name,
            this.evaluate(declaration.init, scope, depth + 1),
          );
        }
        continue;
      }
      if (t.isReturnStatement(statement)) {
        return statement.argument
          ? this.evaluate(statement.argument, scope, depth + 1)
          : null;
      }
      if (t.isEmptyStatement(statement)) continue;
      throw new SlideSourceError(
        "Components may contain only const declarations and a return.",
      );
    }
    throw new SlideSourceError("Every slide component must return markup.");
  }

  private renderElement(
    node: t.JSXElement,
    scope: Map<string, unknown>,
    depth: number,
  ): ReactNode {
    if (depth > MAX_RENDER_DEPTH || ++this.renderedNodeCount > MAX_AST_NODES) {
      throw new SlideSourceError("Slide output is too complex.");
    }
    const name = jsxTagName(node.openingElement.name);
    if (!name)
      throw new SlideSourceError(
        "Namespaced and member JSX tags are not supported.",
      );
    const sourceLoc = node.loc?.start;
    const props: Record<string, unknown> = {};
    if (sourceLoc)
      props["data-slide-loc"] = `${sourceLoc.line}:${sourceLoc.column}`;

    for (const attribute of node.openingElement.attributes) {
      if (t.isJSXSpreadAttribute(attribute))
        throw new SlideSourceError("Spread attributes are not supported.");
      if (!t.isJSXIdentifier(attribute.name))
        throw new SlideSourceError(
          "Namespaced JSX attributes are not supported.",
        );
      const rawName = attribute.name.name;
      if (
        /^on/i.test(rawName) ||
        rawName === "dangerouslySetInnerHTML" ||
        rawName === "data-slide-loc"
      ) {
        throw new SlideSourceError(`Attribute "${rawName}" is not allowed.`);
      }
      const propName = ATTR_ALIASES[rawName] ?? rawName;
      if (
        propName !== "style" &&
        propName !== "src" &&
        !isSafeAttribute(propName)
      ) {
        throw new SlideSourceError(`Attribute "${rawName}" is not allowed.`);
      }
      if (propName === "src" && name !== "img" && name !== "video") {
        throw new SlideSourceError(
          "Only <img> and <video> elements may load uploaded assets.",
        );
      }
      if (propName === "poster" && name !== "video") {
        throw new SlideSourceError("Only <video> elements may use a poster.");
      }
      let value: unknown;
      if (!attribute.value) value = true;
      else if (t.isStringLiteral(attribute.value))
        value = attribute.value.value;
      else if (t.isJSXExpressionContainer(attribute.value)) {
        value = this.evaluate(attribute.value.expression, scope, depth + 1);
      } else {
        throw new SlideSourceError(
          `Attribute "${rawName}" has an unsupported value.`,
        );
      }
      if (propName === "src" || propName === "poster")
        value = this.resolveAsset(value);
      if (propName === "href") {
        value = safeHref(value);
        if (
          name !== "a" &&
          !(name === "use" && String(value).startsWith("#"))
        ) {
          throw new SlideSourceError(
            "Links are allowed only on anchors and local SVG references.",
          );
        }
      }
      if (SVG_LOCAL_REFERENCE_ATTRS.has(propName)) value = safeSvgPaint(value);
      if (propName === "style") value = safeStyle(value);
      if (value !== null && value !== undefined) {
        if (!isPrimitive(value) && propName !== "style") {
          throw new SlideSourceError(
            `Attribute "${rawName}" must have a static primitive value.`,
          );
        }
        props[propName] = value;
      }
    }

    const children = this.renderChildren(node.children, scope, depth + 1);
    if (isComponentName(name)) {
      const component = this.components.get(name);
      if (!component)
        throw new SlideSourceError(`Unknown local component "${name}".`);
      if (children.length === 1) props.children = children[0];
      if (children.length > 1) props.children = children;
      return this.asChild(this.invoke(component, [props], depth + 1));
    }
    if (!HTML_TAGS.has(name) && !SVG_TAGS.has(name)) {
      throw new SlideSourceError(`Element <${name}> is not allowed.`);
    }
    if (name === "img" && children.length > 0)
      throw new SlideSourceError("Images cannot have child elements.");
    if (name === "video" && children.length > 0)
      throw new SlideSourceError("Videos cannot have child elements.");
    if (name === "use" && typeof props.href === "string") {
      if (!props.href.startsWith("#"))
        throw new SlideSourceError("SVG external references are not allowed.");
    }
    if ((name === "img" || name === "video") && typeof props.src !== "string") {
      throw new SlideSourceError("Media must use a resolved asset handle.");
    }
    if (children.length === 0) return createElement(name, props);
    return createElement(name, props, ...children);
  }

  private renderChildren(
    children: Array<
      | t.JSXText
      | t.JSXExpressionContainer
      | t.JSXSpreadChild
      | t.JSXElement
      | t.JSXFragment
    >,
    scope: Map<string, unknown>,
    depth: number,
  ): ReactNode[] {
    const result: ReactNode[] = [];
    for (const child of children) {
      if (t.isJSXText(child)) {
        const value = normalizeJsxText(child.value);
        if (value) result.push(value);
        continue;
      }
      if (t.isJSXSpreadChild(child))
        throw new SlideSourceError("Spread children are not supported.");
      if (t.isJSXExpressionContainer(child)) {
        if (t.isJSXEmptyExpression(child.expression)) continue;
        const value = this.evaluate(child.expression, scope, depth + 1);
        result.push(this.asChild(value));
        continue;
      }
      if (t.isJSXElement(child) || t.isJSXFragment(child)) {
        const value = this.evaluate(child, scope, depth + 1);
        result.push(this.asChild(value));
      }
    }
    return result;
  }

  private resolveAsset(value: unknown): string {
    if (typeof value !== "string" || !value.startsWith("asset://")) {
      throw new SlideSourceError("Media sources must use asset:// handles.");
    }
    const id = value.slice("asset://".length);
    const url = this.assetUrls.get(id);
    if (!url)
      throw new SlideSourceError(
        "Media references an unresolved asset handle.",
      );
    return url;
  }

  private asChild(value: unknown): ReactNode {
    if (value === null || value === undefined || typeof value === "boolean")
      return null;
    if (typeof value === "string" || typeof value === "number") return value;
    if (Array.isArray(value)) {
      this.reserveEvaluatedValues(value.length);
      return value.map((child) => this.asChild(child));
    }
    if (isReactNode(value)) return value;
    throw new SlideSourceError(
      "Markup children must be text, numbers, arrays, or JSX elements.",
    );
  }

  private reserveEvaluatedValues(count: number): void {
    if (count < 0 || this.evaluatedValueCount + count > MAX_EVALUATED_VALUES) {
      throw new SlideSourceError(
        "Slide output expands beyond the static evaluation limit.",
      );
    }
    this.evaluatedValueCount += count;
  }
}

function bindParameter(
  parameter: t.Node,
  value: unknown,
  scope: Map<string, unknown>,
): void {
  if (t.isIdentifier(parameter)) {
    scope.set(parameter.name, value);
    return;
  }
  if (t.isObjectPattern(parameter) && isPlainObject(value)) {
    for (const property of parameter.properties) {
      if (
        !t.isObjectProperty(property) ||
        property.computed ||
        property.shorthand
      ) {
        throw new SlideSourceError(
          "Component props must use simple property destructuring.",
        );
      }
      const key = t.isIdentifier(property.key)
        ? property.key.name
        : t.isStringLiteral(property.key)
          ? property.key.value
          : null;
      if (!key || isBlockedProperty(key))
        throw new SlideSourceError("Invalid component prop.");
      const target = property.value;
      if (!t.isIdentifier(target))
        throw new SlideSourceError(
          "Nested prop destructuring is not supported.",
        );
      scope.set(target.name, value[key]);
    }
    return;
  }
  if (t.isRestElement(parameter) || t.isAssignmentPattern(parameter)) {
    throw new SlideSourceError(
      "Rest and default component parameters are not supported.",
    );
  }
  throw new SlideSourceError(
    "Component parameters must be props or simple prop destructuring.",
  );
}

function safeStyle(value: unknown): Record<string, string | number> {
  if (!isPlainObject(value))
    throw new SlideSourceError("Style must be a static object literal.");
  const result: Record<string, string | number> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!SAFE_STYLE_KEY.test(key) || isBlockedProperty(key))
      throw new SlideSourceError(`CSS property "${key}" is not allowed.`);
    const safeStaticMask =
      key === "mask" &&
      typeof rawValue === "string" &&
      isSafeStaticRadialGradientMask(rawValue);
    if (RESOURCE_STYLE_KEYS.has(key) && key !== "filter" && !safeStaticMask)
      throw new SlideSourceError(
        `CSS property "${key}" can initiate network requests and is not allowed.`,
      );
    if (
      key === "filter" &&
      rawValue !== null &&
      rawValue !== undefined &&
      typeof rawValue !== "string"
    ) {
      throw new SlideSourceError(
        "CSS filter values must use a bounded blur() function.",
      );
    }
    if (typeof rawValue === "number") {
      if (!Number.isFinite(rawValue))
        throw new SlideSourceError("CSS values must be finite.");
      result[key] = rawValue;
    } else if (typeof rawValue === "string") {
      result[key] = key.startsWith("--")
        ? safeCustomPropertyValue(key, rawValue)
        : safeStyleValue(rawValue, key);
    } else if (rawValue !== null && rawValue !== undefined) {
      throw new SlideSourceError(`CSS value for "${key}" is not allowed.`);
    }
  }
  return result;
}

function safeStyleValue(value: string, key: string): string {
  if (
    /[\u0000-\u001f\u007f\\;{}<>@]/.test(value) ||
    value.includes("/*") ||
    value.includes("*/") ||
    (!QUOTED_STYLE_KEYS.has(key) && /['"]/.test(value))
  ) {
    throw new SlideSourceError(`CSS value for "${key}" is not allowed.`);
  }

  if (SVG_LOCAL_REFERENCE_STYLE_KEYS.has(key) && isLocalSvgReference(value)) {
    return value;
  }

  if (VARIABLE_IMAGE_STYLE_KEYS.has(key)) {
    const references = [...value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/gi)];
    const withoutVariables = value.replace(SAFE_VAR_REFERENCE, "");
    if (/\bvar\s*\(/i.test(withoutVariables)) {
      throw new SlideSourceError(
        `CSS value for "${key}" has an unsupported variable reference.`,
      );
    }
    if (
      references.some(
        (match) => !SAFE_THEME_COLOR_VARIABLES.has(match[1]!.toLowerCase()),
      )
    ) {
      throw new SlideSourceError(
        `CSS value for "${key}" cannot use CSS variables.`,
      );
    }
  }

  const withoutVariables = value.replace(SAFE_VAR_REFERENCE, "");
  if (/\bvar\s*\(/i.test(withoutVariables)) {
    throw new SlideSourceError(
      `CSS value for "${key}" has an unsupported variable reference.`,
    );
  }

  let parenDepth = 0;
  for (const character of value) {
    if (character === "(") {
      parenDepth += 1;
    } else if (character === ")") {
      parenDepth -= 1;
      if (parenDepth < 0) {
        throw new SlideSourceError(
          `CSS value for "${key}" has unbalanced parentheses.`,
        );
      }
    }
  }
  if (parenDepth !== 0) {
    throw new SlideSourceError(
      `CSS value for "${key}" has unbalanced parentheses.`,
    );
  }

  if (GRID_TRACK_STYLE_KEYS.has(key) && isSafeGridTrackList(value)) {
    return value;
  }
  if (key === "filter" && isSafeBlurFilter(value)) {
    return value;
  }

  for (const match of value.matchAll(CSS_FUNCTION)) {
    if (!SAFE_STYLE_FUNCTIONS.has(match[1]!.toLowerCase())) {
      throw new SlideSourceError(`CSS function "${match[1]}" is not allowed.`);
    }
  }
  if (key === "filter") {
    throw new SlideSourceError(
      "CSS filter values must use a bounded blur() function.",
    );
  }
  return value;
}

function isSafeGridTrackList(value: string): boolean {
  if (value.length > MAX_GRID_TRACK_LIST_LENGTH) return false;
  const tracks = splitTopLevelWhitespace(value);
  if (tracks.length === 0 || tracks.length > MAX_GRID_TRACKS) return false;

  let totalTracks = 0;
  for (const track of tracks) {
    if (CSS_GRID_TRACK_SIZE.test(track)) {
      totalTracks += 1;
    } else {
      const repeat = /^repeat\(\s*(\d{1,2})\s*,\s*(.+?)\s*\)$/i.exec(track);
      const minmax = /^minmax\(\s*(.+?)\s*,\s*(.+?)\s*\)$/i.exec(track);
      if (repeat) {
        const count = Number(repeat[1]);
        if (
          count < 1 ||
          count > MAX_GRID_REPEAT_COUNT ||
          !CSS_GRID_TRACK_SIZE.test(repeat[2]!)
        ) {
          return false;
        }
        totalTracks += count;
      } else if (
        minmax &&
        CSS_GRID_TRACK_SIZE.test(minmax[1]!) &&
        CSS_GRID_TRACK_SIZE.test(minmax[2]!)
      ) {
        totalTracks += 1;
      } else {
        return false;
      }
    }
    if (totalTracks > MAX_GRID_TRACKS) return false;
  }
  return true;
}

function splitTopLevelWhitespace(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (/\s/.test(character) && depth === 0) {
      const part = value.slice(start, index).trim();
      if (part) parts.push(part);
      start = index + 1;
    }
  }
  const finalPart = value.slice(start).trim();
  if (finalPart) parts.push(finalPart);
  return parts;
}

function isSafeBlurFilter(value: string): boolean {
  const match = /^blur\(\s*(\d+(?:\.\d+)?|\.\d+)px\s*\)$/i.exec(value);
  return Boolean(match && Number(match[1]) <= MAX_FILTER_BLUR_PX);
}

function isSafeStaticRadialGradientMask(value: string): boolean {
  if (value.length > MAX_STATIC_MASK_LENGTH) return false;
  const match =
    /^radial-gradient\(\s*circle\s*,\s*transparent\s+(\d+(?:\.\d+)?%)\s*,\s*#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\s+(\d+(?:\.\d+)?%)\s*\)$/i.exec(
      value,
    );
  return Boolean(
    match &&
    Number(match[1]!.slice(0, -1)) <= 100 &&
    Number(match[2]!.slice(0, -1)) <= 100,
  );
}

function safeCustomPropertyValue(key: string, value: string): string {
  if (SAFE_THEME_FONT_VARIABLES.has(key.toLowerCase())) {
    return safeStyleValue(value, "fontFamily");
  }
  if (key.toLowerCase() === "--deck-radius") {
    if (!/^(?:0|(?:\d+(?:\.\d+)?)(?:px|rem|em))$/i.test(value.trim())) {
      throw new SlideSourceError(
        `CSS value for "${key}" must be a static radius.`,
      );
    }
    return value;
  }
  if (!SAFE_THEME_COLOR_VARIABLES.has(key.toLowerCase())) {
    return safeStyleValue(value, key);
  }
  const trimmed = value.trim();
  const variable = trimmed.match(SAFE_THEME_VARIABLE);
  if (variable) {
    const referencedName = variable[0].slice(4, -1).trim().toLowerCase();
    if (SAFE_THEME_COLOR_VARIABLES.has(referencedName)) return value;
    throw new SlideSourceError(
      `CSS value for "${key}" references an unsupported theme color.`,
    );
  }
  if (
    !/^#[0-9a-f]{3,8}$/i.test(trimmed) &&
    !/^(?:transparent|currentcolor|black|white|red|blue|green|gray|grey|orange|purple)$/i.test(
      trimmed,
    ) &&
    !/^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color-mix)\(/i.test(trimmed)
  ) {
    throw new SlideSourceError(
      `CSS value for "${key}" must be a static theme color.`,
    );
  }
  return safeStyleValue(trimmed, "color");
}

function safeSvgPaint(value: unknown): unknown {
  if (typeof value !== "string") {
    throw new SlideSourceError("SVG paint values must be static strings.");
  }
  if (isLocalSvgReference(value)) return value;
  if (/\bvar\s*\(/i.test(value)) {
    throw new SlideSourceError("SVG paint values cannot use CSS variables.");
  }
  return safeStyleValue(value, "color");
}

function isLocalSvgReference(value: string): boolean {
  return /^url\(\s*#[A-Za-z][A-Za-z0-9_.:-]*\s*\)$/i.test(value);
}

function safeHref(value: unknown): string {
  if (typeof value !== "string")
    throw new SlideSourceError("Link targets must be static strings.");
  const href = value.trim();
  if (href.startsWith("#") || /^(?:https?:|mailto:|tel:)/i.test(href))
    return href;
  throw new SlideSourceError(
    "Links may use https, http, mailto, tel, or a local fragment.",
  );
}

function isSafeAttribute(name: string): boolean {
  if (SAFE_ATTRS.has(name)) return true;
  return (
    /^(?:aria-[a-z0-9-]+|data-[a-z0-9-]+)$/.test(name) &&
    name !== "data-slide-loc"
  );
}

function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function jsxTagName(node: t.JSXOpeningElement["name"]): string | null {
  return t.isJSXIdentifier(node) ? node.name : null;
}

function normalizeJsxText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/);
  const last = lines.length - 1;
  return lines
    .map((line, index) => {
      let normalized = line.replace(/\t/g, " ");
      if (index !== 0) normalized = normalized.replace(/^ +/, "");
      if (index !== last) normalized = normalized.replace(/ +$/, "");
      if (!normalized.trim()) return "";
      if (index !== last) normalized += " ";
      return normalized;
    })
    .join("");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === null ||
      Object.getPrototypeOf(value) === Object.prototype)
  );
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isStaticFunction(value: unknown): value is StaticFunction {
  return value instanceof StaticFunction;
}

function isBlockedProperty(value: string): boolean {
  return (
    value === "__proto__" || value === "prototype" || value === "constructor"
  );
}

function isReactNode(value: unknown): value is ReactNode {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    Array.isArray(value) ||
    (typeof value === "object" && value !== null && "$$typeof" in value)
  );
}
