import { parseFragment, type DefaultTreeAdapterTypes as P5 } from "parse5";

import {
  BUILTIN_SLIDE_DESIGN_FONTS,
  DEFAULT_SLIDE_DESIGN_TOKENS,
  slideDesignTokensSchema,
  type SlideDesignTokens,
} from "../../shared/slide-design-tokens.js";
import { SlideSourceError } from "./slide-source.js";

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);
const SVG_TAG_NAMES: Record<string, string> = {
  clippath: "clipPath",
  lineargradient: "linearGradient",
  radialgradient: "radialGradient",
};
const JSX_ATTR_NAMES: Record<string, string> = {
  for: "htmlFor",
  fillopacity: "fillOpacity",
  fillrule: "fillRule",
  markerend: "markerEnd",
  markermid: "markerMid",
  markerstart: "markerStart",
  preserveaspectratio: "preserveAspectRatio",
  shapeRendering: "shapeRendering",
  "shape-rendering": "shapeRendering",
  stopcolor: "stopColor",
  stopopacity: "stopOpacity",
  strokedasharray: "strokeDasharray",
  strokedashoffset: "strokeDashoffset",
  strokelinecap: "strokeLinecap",
  strokelinejoin: "strokeLinejoin",
  strokeopacity: "strokeOpacity",
  strokewidth: "strokeWidth",
  textanchor: "textAnchor",
  vectorEffect: "vectorEffect",
  "vector-effect": "vectorEffect",
  viewbox: "viewBox",
};
const PRESERVED_THEME_VARIABLES = new Set([
  "--deck-accent",
  "--deck-bg",
  "--deck-body-font",
  "--deck-body-scale",
  "--deck-display-font",
  "--deck-hero-scale",
  "--deck-heading-font",
  "--deck-ink",
  "--deck-muted",
  "--deck-radius",
  "--deck-surface",
  "--deck-text",
  "--ds-accent",
  "--ds-bg",
  "--ds-surface",
  "--ds-text",
  "--ds-text-muted",
]);
const MAX_LOCAL_CUSTOM_PROPERTIES = 64;
const MAX_LOCAL_CUSTOM_PROPERTY_LENGTH = 512;
const MAX_LOCAL_CUSTOM_PROPERTY_DEPTH = 16;

type StaticCssRule = {
  selector: string;
  parts: Array<{ tag?: string; classes: string[]; nthChild?: number }>;
  specificity: number;
  order: number;
  declarations: Array<[string, string]>;
};

export function legacySlideHtmlToSource(html: string): string {
  if (!html.trim() || html.length > 256 * 1024) {
    throw new SlideSourceError(
      "Legacy slide HTML must be non-empty and under 256 KiB.",
    );
  }
  const fragment = parseFragment(html);
  const rules = collectStaticCss(fragment);
  inlineStaticCss(fragment, rules);
  const children = fragment.childNodes
    .map((node) => toJsx(node))
    .filter(Boolean);
  if (children.length === 0)
    throw new SlideSourceError("Legacy slide has no renderable content.");
  const body = children.map((child) => indent(child, 6)).join("\n");
  const source = `export default function Slide() {\n  return (\n    <>\n${body}\n    </>\n  );\n}\n`;
  if (source.length > 64 * 1024) {
    throw new SlideSourceError("Converted legacy slide source exceeds 64 KiB.");
  }
  return source;
}

export function legacySlideDesignTokensFromHtml(
  html: string,
): SlideDesignTokens {
  const fragment = parseFragment(html);
  const root = findSlideRoot(fragment);
  const style = root?.attrs.find((attr) => attr.name === "style")?.value;
  const declarations = new Map(
    (style ? parseStaticDeclarations(style) : []).map(([key, value]) => [
      key,
      value,
    ]),
  );
  const fontOptions = BUILTIN_SLIDE_DESIGN_FONTS;
  const readFont = (
    key: string,
    fallback: SlideDesignTokens["displayFont"],
  ) => {
    const names = (declarations.get(key) ?? "")
      .split(",")
      .map((name) => name.trim().replace(/^['"]|['"]$/g, ""));
    return (
      names.find((name): name is (typeof fontOptions)[number] =>
        fontOptions.includes(name as (typeof fontOptions)[number]),
      ) ?? fallback
    );
  };
  const radius = declarations
    .get("--deck-radius")
    ?.match(/^(\d+(?:\.\d+)?)px$/)?.[1];
  const parsed = slideDesignTokensSchema.safeParse({
    background:
      declarations.get("--deck-bg") ?? DEFAULT_SLIDE_DESIGN_TOKENS.background,
    text: declarations.get("--deck-ink") ?? DEFAULT_SLIDE_DESIGN_TOKENS.text,
    accent:
      declarations.get("--deck-accent") ?? DEFAULT_SLIDE_DESIGN_TOKENS.accent,
    displayFont: readFont(
      "--deck-heading-font",
      DEFAULT_SLIDE_DESIGN_TOKENS.displayFont,
    ),
    bodyFont: readFont(
      "--deck-body-font",
      DEFAULT_SLIDE_DESIGN_TOKENS.bodyFont,
    ),
    heroScale: DEFAULT_SLIDE_DESIGN_TOKENS.heroScale,
    bodyScale: DEFAULT_SLIDE_DESIGN_TOKENS.bodyScale,
    radius:
      radius === undefined
        ? DEFAULT_SLIDE_DESIGN_TOKENS.radius
        : Number(radius),
  });
  if (!parsed.success) {
    throw new SlideSourceError(
      "Built-in slide theme cannot be represented by Slides 2 design tokens.",
    );
  }
  return parsed.data;
}

function collectStaticCss(fragment: P5.DocumentFragment): StaticCssRule[] {
  const styles: string[] = [];
  const removeStyleNodes = (parent: P5.Node & { childNodes?: P5.Node[] }) => {
    if (!Array.isArray(parent.childNodes)) return;
    const kept: P5.Node[] = [];
    for (const child of parent.childNodes) {
      if ("tagName" in child && child.tagName.toLowerCase() === "style") {
        const text = child.childNodes
          .filter((node): node is P5.TextNode => node.nodeName === "#text")
          .map((node) => node.value)
          .join("");
        styles.push(text);
        continue;
      }
      removeStyleNodes(child as P5.Node & { childNodes?: P5.Node[] });
      kept.push(child);
    }
    parent.childNodes = kept;
  };
  removeStyleNodes(fragment);

  const rules: StaticCssRule[] = [];
  let order = 0;
  for (const source of styles) {
    const css = stripStaticMediaRules(source);
    const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
    let match: RegExpExecArray | null;
    let consumed = "";
    while ((match = rulePattern.exec(css))) {
      consumed += match[0];
      const declarations = parseStaticDeclarations(match[2]!);
      for (const selector of match[1]!.split(",")) {
        const parsed = parseStaticSelector(selector);
        rules.push({
          ...parsed,
          selector: selector.trim(),
          order: order++,
          declarations,
        });
      }
    }
    if (css.replace(rulePattern, "").trim()) {
      throw new SlideSourceError(
        "Legacy slide contains unsupported stylesheet syntax.",
      );
    }
  }
  return rules;
}

function stripStaticMediaRules(source: string): string {
  let css = source;
  const mediaStart = /@media\s*\([^{}]+\)\s*\{/gi;
  let match: RegExpExecArray | null;
  const ranges: Array<[number, number]> = [];
  while ((match = mediaStart.exec(css))) {
    let depth = 1;
    let end = mediaStart.lastIndex;
    for (; end < css.length && depth > 0; end += 1) {
      if (css[end] === "{") depth += 1;
      else if (css[end] === "}") depth -= 1;
    }
    if (depth !== 0)
      throw new SlideSourceError("Legacy slide stylesheet is incomplete.");
    ranges.push([match.index, end]);
    mediaStart.lastIndex = end;
  }
  for (const [start, end] of ranges.reverse()) {
    css = `${css.slice(0, start)}${css.slice(end)}`;
  }
  if (/@|\/\*|\*\//.test(css)) {
    throw new SlideSourceError(
      "Legacy slide stylesheet contains unsupported rules.",
    );
  }
  return css;
}

function parseStaticSelector(
  source: string,
): Omit<StaticCssRule, "selector" | "order" | "declarations"> {
  const parts = source
    .trim()
    .split(/\s+/)
    .map((part) => {
      let remaining = part;
      let tag: string | undefined;
      const tagMatch = remaining.match(/^[A-Za-z][A-Za-z0-9-]*/);
      if (tagMatch) {
        tag = tagMatch[0].toLowerCase();
        remaining = remaining.slice(tagMatch[0].length);
      }
      const classes: string[] = [];
      let nthChild: number | undefined;
      while (remaining) {
        const classMatch = remaining.match(/^\.([A-Za-z_][A-Za-z0-9_-]*)/);
        if (classMatch) {
          classes.push(classMatch[1]!);
          remaining = remaining.slice(classMatch[0].length);
          continue;
        }
        const nthMatch = remaining.match(/^:nth-child\(([1-9][0-9]*)\)/);
        if (nthMatch) {
          nthChild = Number(nthMatch[1]);
          remaining = remaining.slice(nthMatch[0].length);
          continue;
        }
        throw new SlideSourceError(
          "Legacy slide stylesheet selector is not supported.",
        );
      }
      if (!tag && classes.length === 0) {
        throw new SlideSourceError(
          "Legacy slide stylesheet selector is empty.",
        );
      }
      return {
        ...(tag ? { tag } : {}),
        classes,
        ...(nthChild ? { nthChild } : {}),
      };
    });
  return {
    parts,
    specificity: parts.reduce(
      (sum, part) => sum + part.classes.length * 100 + (part.tag ? 1 : 0),
      0,
    ),
  };
}

function parseStaticDeclarations(source: string): Array<[string, string]> {
  return splitCssDeclarations(source).map((declaration) => {
    const colon = declaration.indexOf(":");
    if (colon <= 0)
      throw new SlideSourceError(
        "Legacy slide has an invalid stylesheet declaration.",
      );
    const key = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    if (!key || !value || /[\\{}<>@]/.test(key + value)) {
      throw new SlideSourceError(
        "Legacy slide has an invalid stylesheet declaration.",
      );
    }
    return [key, value];
  });
}

function inlineStaticCss(
  fragment: P5.DocumentFragment,
  rules: StaticCssRule[],
): void {
  const orderedRules = [...rules].sort(
    (a, b) => a.specificity - b.specificity || a.order - b.order,
  );
  const visit = (
    parent: P5.Node & { childNodes?: P5.Node[] },
    inheritedCustomProperties = new Map<string, string>(),
  ) => {
    if (!Array.isArray(parent.childNodes)) return;
    for (const child of parent.childNodes) {
      let childCustomProperties = inheritedCustomProperties;
      if ("tagName" in child) {
        const element = child as P5.Element;
        const styleAttr = element.attrs.find((attr) => attr.name === "style");
        const style = new Map<string, string>();
        for (const rule of orderedRules) {
          if (!matchesSelector(element, rule.parts)) continue;
          for (const [key, value] of rule.declarations) style.set(key, value);
        }
        if (styleAttr) {
          for (const [key, value] of parseStaticDeclarations(styleAttr.value))
            style.set(key, value);
        }
        childCustomProperties = new Map(inheritedCustomProperties);
        for (const [key, value] of style) {
          if (!key.startsWith("--")) continue;
          validateLocalCustomProperty(key, value);
          childCustomProperties.set(key, value);
        }
        if (childCustomProperties.size > MAX_LOCAL_CUSTOM_PROPERTIES) {
          throw new SlideSourceError(
            "Legacy slide has too many inherited custom properties.",
          );
        }
        for (const [key, value] of [...style]) {
          if (key.startsWith("--")) {
            if (!PRESERVED_THEME_VARIABLES.has(key)) style.delete(key);
            continue;
          }
          style.set(
            key,
            resolveLocalCustomProperties(value, childCustomProperties),
          );
        }
        const rootTokens = element.attrs.some(
          (attr) =>
            attr.name === "class" &&
            attr.value.split(/\s+/).includes("fmd-slide"),
        );
        if (rootTokens) {
          for (const key of [...style.keys()]) {
            if (
              /^--deck-(?:bg|ink|muted|accent|surface|heading-font|body-font|radius)$/.test(
                key,
              )
            )
              style.delete(key);
          }
          style.set("transform", "scale(2)");
          style.set("transform-origin", "top left");
        }
        const scaleVariable = /^h[12]$/.test(element.tagName.toLowerCase())
          ? "--deck-hero-scale"
          : "--deck-body-scale";
        const fontSize = style.get("font-size");
        if (fontSize && /^(?:\d+(?:\.\d+)?)(?:px|rem|em|%)$/.test(fontSize)) {
          style.set("font-size", `calc(${fontSize} * var(${scaleVariable}))`);
        }
        element.attrs = element.attrs.filter((attr) => attr.name !== "style");
        if (style.size) {
          element.attrs.push({
            name: "style",
            value: [...style]
              .map(([key, value]) => `${key}: ${value}`)
              .join("; "),
            namespace: undefined,
            prefix: undefined,
          });
        }
      }
      visit(
        child as P5.Node & { childNodes?: P5.Node[] },
        childCustomProperties,
      );
    }
  };
  visit(fragment);
  const removeClasses = (parent: P5.Node & { childNodes?: P5.Node[] }) => {
    if (!Array.isArray(parent.childNodes)) return;
    for (const child of parent.childNodes) {
      if ("tagName" in child) {
        const element = child as P5.Element;
        element.attrs = element.attrs.filter((attr) => attr.name !== "class");
      }
      removeClasses(child as P5.Node & { childNodes?: P5.Node[] });
    }
  };
  removeClasses(fragment);
}

function validateLocalCustomProperty(key: string, value: string): void {
  if (
    !/^--[A-Za-z0-9_-]{1,64}$/.test(key) ||
    value.length > MAX_LOCAL_CUSTOM_PROPERTY_LENGTH ||
    /[\u0000-\u001f\u007f\\;{}<>@]/.test(value) ||
    value.includes("/*") ||
    value.includes("*/") ||
    /\b(?:url|expression|attr|env)\s*\(/i.test(value)
  ) {
    throw new SlideSourceError(
      `Legacy slide custom property "${key}" is not a safe static value.`,
    );
  }
  splitCssDeclarations(value);
}

function resolveLocalCustomProperties(
  value: string,
  properties: Map<string, string>,
  stack = new Set<string>(),
  depth = 0,
): string {
  if (depth > MAX_LOCAL_CUSTOM_PROPERTY_DEPTH) {
    throw new SlideSourceError(
      "Legacy slide custom property expansion is too deep.",
    );
  }
  let output = "";
  let quote: string | null = null;
  for (let index = 0; index < value.length; ) {
    const character = value[index]!;
    if (quote) {
      output += character;
      if (character === quote) quote = null;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      output += character;
      index += 1;
      continue;
    }
    const startsFunction =
      index === 0 || !/[A-Za-z0-9_-]/.test(value[index - 1]!);
    const reference = /^var\(\s*(--[A-Za-z0-9_-]{1,64})\s*\)/i.exec(
      startsFunction ? value.slice(index) : "",
    );
    if (reference) {
      const name = reference[1]!;
      if (PRESERVED_THEME_VARIABLES.has(name)) {
        output += reference[0];
      } else {
        const localValue = properties.get(name);
        if (localValue === undefined) {
          throw new SlideSourceError(
            `Legacy slide references undefined custom property "${name}".`,
          );
        }
        if (stack.has(name)) {
          throw new SlideSourceError(
            `Legacy slide custom property "${name}" is cyclic.`,
          );
        }
        const nextStack = new Set(stack);
        nextStack.add(name);
        output += resolveLocalCustomProperties(
          localValue,
          properties,
          nextStack,
          depth + 1,
        );
      }
      index += reference[0].length;
      continue;
    }
    if (startsFunction && /^var\s*\(/i.test(value.slice(index))) {
      throw new SlideSourceError(
        "Legacy slide uses an unsupported custom property reference.",
      );
    }
    output += character;
    index += 1;
  }
  if (output.length > MAX_LOCAL_CUSTOM_PROPERTY_LENGTH) {
    throw new SlideSourceError(
      "Legacy slide custom property expansion is too long.",
    );
  }
  return output;
}

function matchesSelector(
  element: P5.Element,
  selector: StaticCssRule["parts"],
): boolean {
  let current: P5.Node | undefined = element;
  for (let index = selector.length - 1; index >= 0; index -= 1) {
    if (!current || !("tagName" in current)) return false;
    if (!matchesCompound(current as P5.Element, selector[index]!)) return false;
    if (index > 0) {
      let ancestor: P5.ParentNode | null = current.parentNode;
      while (
        ancestor &&
        "parentNode" in ancestor &&
        !(
          "tagName" in ancestor &&
          matchesCompound(ancestor as P5.Element, selector[index - 1]!)
        )
      ) {
        ancestor = ancestor.parentNode;
      }
      if (!ancestor) return false;
      current = ancestor;
    }
  }
  return true;
}

function matchesCompound(
  element: P5.Element,
  part: StaticCssRule["parts"][number],
): boolean {
  if (part.tag && element.tagName.toLowerCase() !== part.tag) return false;
  const classes =
    element.attrs.find((attr) => attr.name === "class")?.value.split(/\s+/) ??
    [];
  if (part.classes.some((className) => !classes.includes(className)))
    return false;
  if (part.nthChild) {
    const siblings =
      element.parentNode?.childNodes.filter((node) => "tagName" in node) ?? [];
    const index = siblings.indexOf(element) + 1;
    if (index !== part.nthChild) return false;
  }
  return true;
}

function findSlideRoot(fragment: P5.DocumentFragment): P5.Element | undefined {
  const visit = (
    parent: P5.Node & { childNodes?: P5.Node[] },
  ): P5.Element | undefined => {
    if (!Array.isArray(parent.childNodes)) return undefined;
    for (const child of parent.childNodes) {
      if ("tagName" in child) {
        const element = child as P5.Element;
        if (
          element.attrs.some(
            (attr) =>
              attr.name === "class" &&
              attr.value.split(/\s+/).includes("fmd-slide"),
          )
        ) {
          return element;
        }
        const nested = visit(element);
        if (nested) return nested;
      }
    }
    return undefined;
  };
  return visit(fragment);
}

function toJsx(node: P5.Node): string {
  if (node.nodeName === "#text" && "value" in node) {
    return `{${JSON.stringify(node.value)}}`;
  }
  if (node.nodeName === "#comment" || node.nodeName === "#documentType")
    return "";
  if (!("tagName" in node)) {
    if ("childNodes" in node && Array.isArray(node.childNodes)) {
      return node.childNodes
        .map((child) => toJsx(child))
        .filter(Boolean)
        .join("\n");
    }
    return "";
  }

  const rawTag = node.tagName.toLowerCase();
  const tag = SVG_TAG_NAMES[rawTag] ?? rawTag;
  const attributes = node.attrs.map(({ name, value }) =>
    toJsxAttribute(name, value),
  );
  const opening = `<${tag}${attributes.length ? ` ${attributes.join(" ")}` : ""}`;
  if (VOID_TAGS.has(rawTag)) return `${opening} />`;
  const children = node.childNodes.map((child) => toJsx(child)).filter(Boolean);
  if (children.length === 0) return `${opening}></${tag}>`;
  return `${opening}>\n${children.map((child) => indent(child, 2)).join("\n")}\n</${tag}>`;
}

function toJsxAttribute(name: string, value: string): string {
  if (/^on/i.test(name) || name === "dangerouslysetinnerhtml") {
    throw new SlideSourceError(
      `Legacy slide attribute "${name}" is not allowed.`,
    );
  }
  if (name === "style") return `style={${toStyleObject(value)}}`;
  if (name === "src" && !value.startsWith("asset://")) {
    throw new SlideSourceError(
      "Legacy slide images must already use an uploaded asset handle.",
    );
  }
  const propName = JSX_ATTR_NAMES[name] ?? name;
  return `${propName}={${JSON.stringify(value)}}`;
}

function toStyleObject(source: string): string {
  const declarations = splitCssDeclarations(source);
  const entries = declarations.map((declaration) => {
    const colon = declaration.indexOf(":");
    if (colon <= 0)
      throw new SlideSourceError("Legacy slide has an invalid inline style.");
    const rawKey = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    if (!rawKey || !value)
      throw new SlideSourceError("Legacy slide has an invalid inline style.");
    const key = rawKey.startsWith("--")
      ? rawKey
      : rawKey.replace(/-([a-z])/g, (_, letter: string) =>
          letter.toUpperCase(),
        );
    const safeKey =
      key === "listStyle" && value.toLowerCase() === "none"
        ? "listStyleType"
        : key;
    return `${JSON.stringify(safeKey)}: ${JSON.stringify(value)}`;
  });
  return `{${entries.join(", ")}}`;
}

function splitCssDeclarations(value: string): string[] {
  const declarations: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === "\\")
      throw new SlideSourceError("Legacy slide CSS escapes are not allowed.");
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === ";" && depth === 0) {
      const declaration = value.slice(start, index).trim();
      if (declaration) declarations.push(declaration);
      start = index + 1;
    }
    if (depth < 0)
      throw new SlideSourceError(
        "Legacy slide CSS has unbalanced parentheses.",
      );
  }
  if (quote || depth !== 0)
    throw new SlideSourceError("Legacy slide CSS is incomplete.");
  const finalDeclaration = value.slice(start).trim();
  if (finalDeclaration) declarations.push(finalDeclaration);
  return declarations;
}

function indent(value: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
