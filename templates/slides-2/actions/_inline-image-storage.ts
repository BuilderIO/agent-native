import { fail } from "@agent-native/core/action";
import { parseBase64DataUrl } from "@agent-native/core/shared";
import * as t from "@babel/types";
import { parseFragment, type DefaultTreeAdapterTypes as P5 } from "parse5";
import postcss from "postcss";

import {
  parseSource,
  walkAll,
} from "../server/lib/slide-source-editing/babel-walk.js";
import { MAX_INLINE_IMAGE_BASE64_CHARS } from "../shared/upload-types.js";

type DataUrlOccurrence = { value: string; field: string };

const URL_ATTRIBUTES = new Set(["data", "href", "poster", "src", "srcset"]);
const DATA_URL_FIELDS = new Set(["url", "src", "dataurl", "href", "poster"]);
const SOURCE_URL_FIELDS = new Set([
  ...URL_ATTRIBUTES,
  ...DATA_URL_FIELDS,
  "background",
  "backgroundimage",
  "imageurl",
]);
const SOURCE_OBJECT_URL_FIELDS = new Set([
  ...DATA_URL_FIELDS,
  "srcset",
  "background",
  "backgroundimage",
  "imageurl",
  "css",
  "keyframes",
  "style",
]);
const CSS_FUNCTION =
  /(?:^|[^a-z0-9_-])((?:[a-z_-]|\\(?:\r\n|[\n\r\f]|[0-9a-f]{1,6}[\t\r\n\f ]?|[^\r\n\f]))(?:[a-z0-9_-]|\\(?:\r\n|[\n\r\f]|[0-9a-f]{1,6}[\t\r\n\f ]?|[^\r\n\f]))*)[\t\r\n\f ]*\(/gi;

const isElement = (node: P5.Node): node is P5.Element => "tagName" in node;
const isText = (node: P5.Node): node is P5.TextNode =>
  node.nodeName === "#text";

function isBase64(value: string): boolean {
  const unpadded = value.replace(/={1,2}$/, "");
  if (!/^[A-Za-z0-9+/]*$/.test(unpadded)) return false;
  return unpadded.length === value.length
    ? value.length % 4 !== 1
    : value.length % 4 === 0;
}

function stripCssComments(css: string): string {
  let output = "";
  let quote = "";
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index]!;
    if (quote) {
      output += character;
      if (character === "\\" && index + 1 < css.length) {
        output += css[index + 1]!;
        index += 1;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      output += character;
      continue;
    }
    if (character === "/" && css[index + 1] === "*") {
      const end = css.indexOf("*/", index + 2);
      if (end < 0) break;
      index = end + 1;
      continue;
    }
    output += character;
  }
  return output;
}

function maskCssStrings(css: string): string {
  let output = "";
  let quote = "";
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index]!;
    if (!quote && (character === "'" || character === '"')) {
      quote = character;
      output += " ";
      continue;
    }
    if (quote) {
      output += " ";
      if (character === "\\" && index + 1 < css.length) {
        output += " ";
        index += 1;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    output += character;
  }
  return output;
}

function decodeCssEscapes(value: string): string {
  return value.replace(
    /\\(?:\r\n|[\n\r\f]|([0-9a-f]{1,6})(?:[\t\r\n\f ]?)|([^\r\n\f]))/gi,
    (_match, hex: string | undefined, escaped: string | undefined) => {
      if (!hex) return escaped ?? "";
      const codePoint = Number.parseInt(hex, 16);
      return codePoint === 0 || codePoint > 0x10ffff
        ? "\uFFFD"
        : String.fromCodePoint(codePoint);
    },
  );
}

function matchingCssParen(css: string, opening: number): number {
  let depth = 0;
  let quote = "";
  for (let index = opening; index < css.length; index += 1) {
    const character = css[index]!;
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === "\\" && index + 1 < css.length) {
      index += 1;
    } else if (character === ")" && --depth === 0) {
      return index;
    }
  }
  return -1;
}

function cssValueDataUrls(css: string, field: string): DataUrlOccurrence[] {
  const uncommented = stripCssComments(css);
  const searchable = maskCssStrings(uncommented);
  const occurrences: DataUrlOccurrence[] = [];
  for (const match of searchable.matchAll(CSS_FUNCTION)) {
    if (decodeCssEscapes(match[1] ?? "").toLowerCase() !== "url") continue;
    const opening = (match.index ?? 0) + match[0].lastIndexOf("(");
    const closing = matchingCssParen(uncommented, opening);
    if (closing < 0) continue;
    let value = uncommented.slice(opening + 1, closing).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    value = decodeCssEscapes(value).trim();
    if (value.toLowerCase().startsWith("data:")) {
      occurrences.push({ value, field });
    }
  }
  return occurrences;
}

function cssImportStringDataUrls(
  params: string,
  field: string,
): DataUrlOccurrence[] {
  const valueText = stripCssComments(params).trim();
  const quote = valueText[0];
  if (quote !== "'" && quote !== '"') return [];

  let value = "";
  for (let index = 1; index < valueText.length; index += 1) {
    const character = valueText[index]!;
    if (character === "\\" && index + 1 < valueText.length) {
      value += character + valueText[index + 1]!;
      index += 1;
    } else if (character === quote) {
      value = decodeCssEscapes(value).trim();
      return value.toLowerCase().startsWith("data:") ? [{ value, field }] : [];
    } else {
      value += character;
    }
  }
  return [];
}

function cssImportDataUrls(css: string, field: string): DataUrlOccurrence[] {
  const uncommented = stripCssComments(css);
  const searchable = maskCssStrings(uncommented);
  return [...searchable.matchAll(/@import\b/gi)].flatMap((match) =>
    cssImportStringDataUrls(
      uncommented.slice((match.index ?? 0) + match[0].length),
      field,
    ),
  );
}

function cssDataUrls(css: string, field: string): DataUrlOccurrence[] {
  try {
    const stylesheet = css.includes("{")
      ? postcss.parse(css, { from: undefined })
      : postcss.parse(`.inline-image-check { ${css} }`, { from: undefined });
    const occurrences: DataUrlOccurrence[] = [];
    stylesheet.walkDecls((declaration) => {
      occurrences.push(...cssValueDataUrls(declaration.value, field));
    });
    stylesheet.walkAtRules((atRule) => {
      const params = stripCssComments(atRule.params).trim();
      occurrences.push(...cssValueDataUrls(params, field));
      if (atRule.name.toLowerCase() === "import") {
        occurrences.push(...cssImportStringDataUrls(params, field));
      }
    });
    return occurrences;
  } catch {
    // Keep scanning legacy CSS even when another part of the stylesheet is malformed.
    return [...cssValueDataUrls(css, field), ...cssImportDataUrls(css, field)];
  }
}

function isMarkdownEscaped(markdown: string, index: number): boolean {
  let slashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && markdown[cursor] === "\\";
    cursor -= 1
  ) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function maskMarkdownCode(markdown: string): string {
  const characters = markdown.split("");
  const blockCodeMask = new Uint8Array(markdown.length);
  const mask = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) {
      if (characters[index] !== "\n" && characters[index] !== "\r") {
        characters[index] = " ";
      }
    }
  };
  const maskBlock = (start: number, end: number) => {
    mask(start, end);
    blockCodeMask.fill(1, start, end);
  };

  let fence: { character: string; length: number } | null = null;
  let lineStart = 0;
  while (lineStart < markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline < 0 ? markdown.length : newline;
    const line = markdown.slice(lineStart, lineEnd).replace(/\r$/, "");
    if (fence) {
      maskBlock(lineStart, lineEnd);
      const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/)?.[1];
      if (closing?.[0] === fence.character && closing.length >= fence.length) {
        fence = null;
      }
    } else {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
      const marker = opening?.[1];
      if (
        marker &&
        !(marker[0] === "`" && line.slice(opening[0].length).includes("`"))
      ) {
        fence = { character: marker[0]!, length: marker.length };
        maskBlock(lineStart, lineEnd);
      } else if (/^(?: {4,}|\t)/.test(line)) {
        maskBlock(lineStart, lineEnd);
      }
    }
    lineStart = newline < 0 ? markdown.length : newline + 1;
  }

  for (let index = 0; index < characters.length; index += 1) {
    if (characters[index] !== "`" || isMarkdownEscaped(markdown, index)) {
      continue;
    }
    let runLength = 1;
    while (characters[index + runLength] === "`") runLength += 1;

    let closing = -1;
    for (let cursor = index + runLength; cursor < characters.length; ) {
      if (blockCodeMask[cursor]) break;
      if (characters[cursor] !== "`" || isMarkdownEscaped(markdown, cursor)) {
        cursor += 1;
        continue;
      }
      let candidateLength = 1;
      while (characters[cursor + candidateLength] === "`") candidateLength += 1;
      if (candidateLength === runLength) {
        closing = cursor + candidateLength;
        break;
      }
      cursor += candidateLength;
    }
    if (closing > index) {
      mask(index, closing);
      index = closing - 1;
    }
  }

  return characters.join("");
}

function markdownBracketEnd(markdown: string, opening: number): number {
  let depth = 0;
  for (let index = opening + 1; index < markdown.length; index += 1) {
    if (markdown[index] === "\\") {
      index += 1;
    } else if (markdown[index] === "[") {
      depth += 1;
    } else if (markdown[index] === "]") {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return -1;
}

function markdownInlineDestination(
  markdown: string,
  opening: number,
): string | null {
  let cursor = opening + 1;
  while (/[\t\n\r ]/.test(markdown[cursor] ?? "")) cursor += 1;

  if (markdown[cursor] === "<") {
    const start = cursor + 1;
    for (cursor = start; cursor < markdown.length; cursor += 1) {
      if (markdown[cursor] === "\\") cursor += 1;
      else if (markdown[cursor] === ">") return markdown.slice(start, cursor);
    }
    return null;
  }

  const start = cursor;
  let nestedParentheses = 0;
  for (; cursor < markdown.length; cursor += 1) {
    const character = markdown[cursor]!;
    if (character === "\\") {
      cursor += 1;
    } else if (character === "(") {
      nestedParentheses += 1;
    } else if (character === ")") {
      if (nestedParentheses === 0) break;
      nestedParentheses -= 1;
    } else if (/[\t\n\r ]/.test(character)) {
      break;
    }
  }
  const destination = markdown.slice(start, cursor);
  return destination || null;
}

function normalizeMarkdownDestination(destination: string): string {
  const unescaped = destination.replace(
    /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g,
    "$1",
  );
  return parseFragment(unescaped, { scriptingEnabled: false })
    .childNodes.filter(isText)
    .map((node) => node.value)
    .join("");
}

function markdownImageDataUrls(markdown: string): DataUrlOccurrence[] {
  const searchable = maskMarkdownCode(markdown);
  const referenceDestinations = new Map<string, string>();
  const definitions =
    /^ {0,3}\[([^\]\r\n]+)\]:[ \t]*(?:<([^>\r\n]*)>|([^\s]+))/gm;
  for (const match of searchable.matchAll(definitions)) {
    const label = match[1]?.replace(/\s+/g, " ").trim().toLowerCase();
    const destination = match[2] ?? match[3];
    if (label && destination && !referenceDestinations.has(label)) {
      referenceDestinations.set(label, destination);
    }
  }

  const occurrences: DataUrlOccurrence[] = [];
  const addIfImageDataUrl = (destination: string | null | undefined) => {
    const value = destination
      ? normalizeMarkdownDestination(destination).trim()
      : undefined;
    if (value?.toLowerCase().startsWith("data:image/")) {
      occurrences.push({ value, field: "markdown image" });
    }
  };

  for (let index = 0; index < searchable.length - 1; index += 1) {
    if (
      searchable[index] !== "!" ||
      searchable[index + 1] !== "[" ||
      isMarkdownEscaped(searchable, index)
    ) {
      continue;
    }
    const altEnd = markdownBracketEnd(searchable, index + 1);
    if (altEnd < 0) continue;
    const alt = searchable.slice(index + 2, altEnd);
    const next = altEnd + 1;
    if (searchable[next] === "(") {
      addIfImageDataUrl(markdownInlineDestination(searchable, next));
      continue;
    }
    if (searchable[next] !== "[") continue;

    const referenceEnd = markdownBracketEnd(searchable, next);
    if (referenceEnd < 0) continue;
    const explicitLabel = searchable.slice(next + 1, referenceEnd);
    const label = (explicitLabel || alt)
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    addIfImageDataUrl(referenceDestinations.get(label));
  }

  return occurrences;
}

function htmlDataUrls(html: string): DataUrlOccurrence[] {
  const occurrences: DataUrlOccurrence[] = [];
  const fragment = parseFragment(html, { scriptingEnabled: false });

  const visit = (node: P5.Node): void => {
    if (!isElement(node)) return;

    for (const attr of node.attrs) {
      const value = attr.value.trim();
      if (URL_ATTRIBUTES.has(attr.name.toLowerCase())) {
        if (value.toLowerCase().startsWith("data:")) {
          occurrences.push({ value, field: `${node.tagName}.${attr.name}` });
        } else if (
          attr.name.toLowerCase() === "srcset" &&
          value.toLowerCase().includes("data:")
        ) {
          occurrences.push({ value, field: `${node.tagName}.srcset` });
        }
      }
      if (attr.name.toLowerCase() === "style") {
        occurrences.push(...cssDataUrls(value, `${node.tagName}.style`));
      }
    }

    if (node.tagName === "style") {
      const css = node.childNodes
        .filter(isText)
        .map((child) => child.value)
        .join("");
      occurrences.push(...cssDataUrls(css, "style"));
    }

    for (const child of node.childNodes) visit(child);
  };

  for (const child of fragment.childNodes) visit(child);
  return occurrences;
}

function sourceDataUrls(source: string, field: string): DataUrlOccurrence[] {
  const ast = parseSource(source);
  if (!ast) {
    fail("Slide source must be valid before it can be saved.", {
      errorCode: "invalid_slide_source",
    });
  }

  type SourceScope = {
    parent: SourceScope | null;
    bindings: Map<string, t.Node | null>;
    functionBoundary: boolean;
  };
  const scopes = new WeakMap<t.Node, SourceScope>();
  const declarePattern = (
    pattern: t.Node,
    scope: SourceScope,
    initializer: t.Node | null = null,
  ): void => {
    if (t.isIdentifier(pattern)) {
      if (scope.bindings.has(pattern.name)) {
        scope.bindings.set(pattern.name, null);
      } else {
        scope.bindings.set(pattern.name, initializer);
      }
      return;
    }
    if (t.isObjectPattern(pattern)) {
      for (const property of pattern.properties) {
        if (t.isRestElement(property)) declarePattern(property.argument, scope);
        else declarePattern(property.value, scope);
      }
      return;
    }
    if (t.isArrayPattern(pattern)) {
      for (const element of pattern.elements) {
        if (element) declarePattern(element, scope);
      }
      return;
    }
    if (t.isAssignmentPattern(pattern)) declarePattern(pattern.left, scope);
    else if (t.isRestElement(pattern)) declarePattern(pattern.argument, scope);
  };
  const visitorKeys = t.VISITOR_KEYS as Record<string, string[]>;
  const functionScopeFor = (scope: SourceScope): SourceScope => {
    let current = scope;
    while (current.parent && !current.functionBoundary) {
      current = current.parent;
    }
    return current;
  };
  const visitSource = (node: t.Node, parentScope: SourceScope | null): void => {
    const isFunction = t.isFunction(node);
    const isScopedBlock =
      t.isBlockStatement(node) ||
      t.isCatchClause(node) ||
      t.isForStatement(node) ||
      t.isForInStatement(node) ||
      t.isForOfStatement(node) ||
      t.isSwitchStatement(node);
    const createsScope = t.isProgram(node) || isFunction || isScopedBlock;
    const scope = createsScope
      ? {
          parent: parentScope,
          bindings: new Map<string, t.Node | null>(),
          functionBoundary: t.isProgram(node) || isFunction,
        }
      : (parentScope ?? {
          parent: null,
          bindings: new Map<string, t.Node | null>(),
          functionBoundary: true,
        });

    if (t.isFunctionDeclaration(node) && node.id && parentScope) {
      declarePattern(node.id, parentScope);
    }
    if (
      (t.isFunctionExpression(node) || t.isFunctionDeclaration(node)) &&
      node.id
    ) {
      declarePattern(node.id, scope);
    }
    if (t.isFunction(node)) {
      for (const parameter of node.params) declarePattern(parameter, scope);
    }
    if (t.isCatchClause(node) && node.param) {
      declarePattern(node.param, scope);
    }
    if (t.isClassDeclaration(node) && node.id && parentScope) {
      declarePattern(node.id, parentScope);
    }
    if (t.isVariableDeclaration(node)) {
      const declarationScope =
        node.kind === "var" ? functionScopeFor(scope) : scope;
      for (const declaration of node.declarations) {
        declarePattern(
          declaration.id,
          declarationScope,
          node.kind === "const" ? declaration.init : null,
        );
      }
    }

    scopes.set(node, scope);
    for (const key of visitorKeys[node.type] ?? []) {
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === "object" && "type" in item) {
            visitSource(item as t.Node, scope);
          }
        }
      } else if (child && typeof child === "object" && "type" in child) {
        visitSource(child as t.Node, scope);
      }
    }
  };
  visitSource(ast, null);

  const resolveInitializer = (identifier: t.Identifier): t.Node | null => {
    let scope = scopes.get(identifier) ?? null;
    while (scope) {
      if (scope.bindings.has(identifier.name)) {
        return scope.bindings.get(identifier.name) ?? null;
      }
      scope = scope.parent;
    }
    return null;
  };

  const staticString = (
    node: t.Node | null | undefined,
    seen = new Set<t.Node>(),
  ): string | undefined => {
    if (!node) return undefined;
    if (t.isStringLiteral(node)) return node.value;
    if (t.isTemplateLiteral(node)) {
      let value = "";
      for (let index = 0; index < node.quasis.length; index += 1) {
        const quasi = node.quasis[index];
        value += quasi?.value.cooked ?? quasi?.value.raw ?? "";
        const expression = node.expressions[index];
        if (!expression) continue;
        const expressionValue = staticString(expression, new Set(seen));
        if (expressionValue === undefined) return undefined;
        value += expressionValue;
      }
      return value;
    }
    if (t.isBinaryExpression(node) && node.operator === "+") {
      const left = staticString(node.left, new Set(seen));
      const right = staticString(node.right, new Set(seen));
      return left === undefined || right === undefined
        ? undefined
        : left + right;
    }
    if (t.isTSAsExpression(node) || t.isTSTypeAssertion(node)) {
      return staticString(node.expression, seen);
    }
    if (t.isIdentifier(node)) {
      const initializer = resolveInitializer(node);
      if (initializer && !seen.has(initializer)) {
        const nextSeen = new Set(seen);
        nextSeen.add(initializer);
        return staticString(initializer, nextSeen);
      }
    }
    return undefined;
  };

  const partialString = (
    node: t.Node | null | undefined,
    seen = new Set<t.Node>(),
  ): string | undefined => {
    if (!node) return undefined;
    const complete = staticString(node);
    if (complete !== undefined) return complete;
    if (t.isTemplateLiteral(node)) {
      let value = "";
      for (let index = 0; index < node.quasis.length; index += 1) {
        const quasi = node.quasis[index];
        value += quasi?.value.cooked ?? quasi?.value.raw ?? "";
        const expression = node.expressions[index];
        if (!expression) continue;
        value +=
          partialString(expression, new Set(seen)) ?? "__slides2_dynamic__";
      }
      return value;
    }
    if (t.isTaggedTemplateExpression(node)) {
      return partialString(node.quasi, seen);
    }
    if (t.isBinaryExpression(node) && node.operator === "+") {
      const left = partialString(node.left, new Set(seen));
      const right = partialString(node.right, new Set(seen));
      if (left === undefined && right === undefined) return undefined;
      return `${left ?? "__slides2_dynamic__"}${right ?? "__slides2_dynamic__"}`;
    }
    if (t.isConditionalExpression(node) || t.isLogicalExpression(node)) {
      const branches = t.isConditionalExpression(node)
        ? [node.consequent, node.alternate]
        : [node.left, node.right];
      return branches
        .map((branch) => partialString(branch, new Set(seen)))
        .filter((value): value is string => value !== undefined)
        .join("\n");
    }
    if (t.isTSAsExpression(node) || t.isTSTypeAssertion(node)) {
      return partialString(node.expression, seen);
    }
    if (t.isIdentifier(node)) {
      const initializer = resolveInitializer(node);
      if (initializer && !seen.has(initializer)) {
        const nextSeen = new Set(seen);
        nextSeen.add(initializer);
        return partialString(initializer, nextSeen);
      }
    }
    return undefined;
  };

  const dataUrlPrefix = (
    node: t.Node | null | undefined,
    seen = new Set<t.Node>(),
  ): string | undefined => {
    if (!node) return undefined;
    const value = staticString(node)?.trim();
    if (value?.toLowerCase().startsWith("data:")) return value;
    if (t.isTemplateLiteral(node)) {
      const head = (
        node.quasis[0]?.value.cooked ??
        node.quasis[0]?.value.raw ??
        ""
      ).trim();
      if (head.toLowerCase().startsWith("data:")) return head;
      if (head) return undefined;
      return dataUrlPrefix(node.expressions[0], seen);
    }
    if (t.isTSAsExpression(node) || t.isTSTypeAssertion(node)) {
      return dataUrlPrefix(node.expression, seen);
    }
    if (t.isIdentifier(node)) {
      const initializer = resolveInitializer(node);
      if (initializer && !seen.has(initializer)) {
        const nextSeen = new Set(seen);
        nextSeen.add(initializer);
        return dataUrlPrefix(initializer, nextSeen);
      }
    }
    if (t.isBinaryExpression(node) && node.operator === "+") {
      const left = staticString(node.left)?.trim();
      if (left !== undefined) {
        if (left.toLowerCase().startsWith("data:")) return left;
        if (left.length > 0) return undefined;
        return dataUrlPrefix(node.right, seen);
      }
      return dataUrlPrefix(node.left, seen);
    }
    if (t.isConditionalExpression(node) || t.isLogicalExpression(node)) {
      const branches = t.isConditionalExpression(node)
        ? [node.consequent, node.alternate]
        : [node.left, node.right];
      for (const branch of branches) {
        const prefix = dataUrlPrefix(branch, new Set(seen));
        if (prefix) return prefix;
      }
    }
    return undefined;
  };

  const occurrences: DataUrlOccurrence[] = [];
  const recordUrl = (node: t.Node, targetField: string): void => {
    const value = staticString(node)?.trim();
    const dataUrlValue = value?.toLowerCase().startsWith("data:")
      ? value
      : dataUrlPrefix(node);
    if (dataUrlValue) {
      occurrences.push({
        value: dataUrlValue,
        field: `${field}.${targetField}`,
      });
    }
    if (
      targetField === "style" ||
      targetField === "background" ||
      targetField === "backgroundimage" ||
      targetField === "css" ||
      targetField === "keyframes"
    ) {
      const css = value ?? partialString(node);
      if (css) occurrences.push(...cssDataUrls(css, `${field}.${targetField}`));
    }
  };
  const propertyName = (node: t.Node): string | undefined => {
    if (t.isIdentifier(node)) return node.name;
    if (t.isStringLiteral(node)) return node.value;
    return undefined;
  };

  walkAll(ast, (node) => {
    if (
      t.isStringLiteral(node) ||
      t.isTemplateLiteral(node) ||
      (t.isBinaryExpression(node) && node.operator === "+")
    ) {
      const value = (staticString(node) ?? partialString(node))?.trim();
      const separator = value?.indexOf(",") ?? -1;
      if (
        value?.toLowerCase().startsWith("data:image/") &&
        separator >= 0 &&
        value.slice(separator + 1).trim().length > 0
      ) {
        occurrences.push({ value, field });
      }
    }

    if (
      t.isVariableDeclarator(node) &&
      t.isIdentifier(node.id) &&
      /style|css|keyframe/i.test(node.id.name) &&
      node.init
    ) {
      const css = partialString(node.init);
      if (css)
        occurrences.push(...cssDataUrls(css, `${field}.${node.id.name}`));
      return;
    }

    if (
      t.isJSXElement(node) &&
      t.isJSXIdentifier(node.openingElement.name) &&
      node.openingElement.name.name.toLowerCase() === "style"
    ) {
      for (const child of node.children) {
        if (
          t.isJSXExpressionContainer(child) &&
          !t.isJSXEmptyExpression(child.expression)
        ) {
          recordUrl(child.expression, "style");
        } else if (t.isJSXText(child)) {
          occurrences.push(...cssDataUrls(child.value, `${field}.style`));
        }
      }
      return;
    }

    if (t.isJSXAttribute(node)) {
      const name = t.isJSXIdentifier(node.name)
        ? node.name.name.toLowerCase()
        : undefined;
      if (!name) return;
      if (name === "style") {
        if (t.isStringLiteral(node.value)) recordUrl(node.value, name);
        return;
      }
      if (!SOURCE_URL_FIELDS.has(name) || !node.value) return;
      if (t.isStringLiteral(node.value)) {
        recordUrl(node.value, name);
      } else if (t.isJSXExpressionContainer(node.value)) {
        recordUrl(node.value.expression, name);
      }
      return;
    }

    if (!t.isObjectProperty(node) || node.computed) return;
    const name = propertyName(node.key)?.toLowerCase();
    if (!name || !SOURCE_OBJECT_URL_FIELDS.has(name)) return;
    recordUrl(node.value, name);
  });

  return occurrences;
}

function structuredDataUrls(
  value: unknown,
  rootField: string,
): DataUrlOccurrence[] {
  const occurrences: DataUrlOccurrence[] = [];
  const visit = (current: unknown, path: string, key: string): void => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`, key));
      return;
    }
    if (typeof current === "string") {
      if (
        (DATA_URL_FIELDS.has(key.toLowerCase()) ||
          key.toLowerCase() === "referenceurls" ||
          key.toLowerCase() === "imageurls" ||
          key.toLowerCase() === "background") &&
        current.trim().toLowerCase().startsWith("data:")
      ) {
        occurrences.push({
          value: current.trim(),
          field: `${rootField}.${path}`,
        });
      }
      if (/css|background/i.test(key)) {
        occurrences.push(...cssDataUrls(current, `${rootField}.${path}`));
      }
      return;
    }
    if (!current || typeof current !== "object") return;

    for (const [childKey, child] of Object.entries(current)) {
      const childPath = path ? `${path}.${childKey}` : childKey;
      visit(child, childPath, childKey);
    }
  };

  visit(value, "", "");
  return occurrences;
}

function slideDataUrls(
  slide: Record<string, unknown>,
  inspectChangedExcalidrawData: boolean,
): DataUrlOccurrence[] {
  const occurrences =
    typeof slide.content === "string"
      ? [
          ...htmlDataUrls(slide.content),
          ...markdownImageDataUrls(slide.content),
        ]
      : [];

  for (const field of ["imageUrl", "background"] as const) {
    const value = slide[field];
    if (typeof value !== "string") continue;
    if (value.trim().toLowerCase().startsWith("data:")) {
      occurrences.push({ value: value.trim(), field });
    }
    if (field === "background") {
      occurrences.push(...cssDataUrls(value, field));
    }
  }

  if (typeof slide.sourceTsx === "string") {
    occurrences.push(...sourceDataUrls(slide.sourceTsx, "sourceTsx"));
  }

  if (
    inspectChangedExcalidrawData &&
    typeof slide.excalidrawData === "string" &&
    slide.excalidrawData.length > 0
  ) {
    let data: unknown;
    try {
      data = JSON.parse(slide.excalidrawData);
    } catch {
      fail("Excalidraw slide data must be valid JSON.", {
        errorCode: "invalid_excalidraw_data",
      });
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      fail("Excalidraw slide data must be a JSON object.", {
        errorCode: "invalid_excalidraw_data",
      });
    }
    occurrences.push(...structuredDataUrls(data, "excalidrawData"));
  }

  return occurrences;
}

function occurrencesAdded(
  previous: readonly DataUrlOccurrence[],
  next: readonly DataUrlOccurrence[],
): DataUrlOccurrence[] {
  const previousCounts = new Map<string, number>();
  for (const occurrence of previous) {
    const key = `${occurrence.field}\0${occurrence.value}`;
    previousCounts.set(key, (previousCounts.get(key) ?? 0) + 1);
  }

  const added: DataUrlOccurrence[] = [];
  for (const occurrence of next) {
    const key = `${occurrence.field}\0${occurrence.value}`;
    const count = previousCounts.get(key) ?? 0;
    if (count > 0) {
      previousCounts.set(key, count - 1);
    } else {
      added.push(occurrence);
    }
  }
  return added;
}

function assertDataUrlIsNotPersisted(
  occurrence: DataUrlOccurrence,
  resource: "slide" | "design-system",
): void {
  if (occurrence.value.length > MAX_INLINE_IMAGE_BASE64_CHARS) {
    fail(
      `The inline image in ${occurrence.field} exceeds the ${MAX_INLINE_IMAGE_BASE64_CHARS.toLocaleString()} character limit. Upload it and use the returned asset URL.`,
      {
        errorCode: "inline_image_data_url_too_large",
        statusCode: 413,
        details: { field: occurrence.field, resource },
      },
    );
  }

  const parsed = parseBase64DataUrl(occurrence.value);
  if (!parsed || !isBase64(parsed.data)) {
    fail(
      `The inline image in ${occurrence.field} is not a valid base64 data URL. Upload it and use the returned asset URL.`,
      {
        errorCode: "invalid_inline_image_data_url",
        details: { field: occurrence.field, resource },
      },
    );
  }

  fail(
    `Inline image data URLs cannot be saved in ${resource} data. Upload the image and use the returned asset URL.`,
    {
      errorCode: "inline_image_data_url_not_persistable",
      details: { field: occurrence.field, resource },
    },
  );
}

export function assertSlideInlineImagesPersistable(
  previousSlide: Record<string, unknown>,
  nextSlide: Record<string, unknown>,
  slideId: string,
): void {
  const added = occurrencesAdded(
    slideDataUrls(previousSlide, false),
    slideDataUrls(
      nextSlide,
      previousSlide.excalidrawData !== nextSlide.excalidrawData,
    ),
  );
  const occurrence = added[0];
  if (occurrence) {
    assertDataUrlIsNotPersisted(
      { ...occurrence, field: `slide ${slideId} ${occurrence.field}` },
      "slide",
    );
  }
}

export function assertDesignSystemAssetUrlsPersistable(
  value: unknown,
  field: "data" | "assets",
): void {
  const occurrences = structuredDataUrls(value, field);
  const occurrence = occurrences[0];
  if (occurrence) assertDataUrlIsNotPersisted(occurrence, "design-system");
}
