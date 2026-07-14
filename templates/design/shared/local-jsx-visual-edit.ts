import { previewSourceDiff } from "./source-workspace.js";

export interface LocalJsxSourceAnchor {
  line: number;
  column: number;
  runtimeMultiplicity?: number;
  scope?:
    | "single-instance"
    | "repeated-render"
    | "shared-component-definition"
    | "unknown";
}

export type LocalJsxLeafIntent =
  | {
      kind: "textContent";
      value: string;
    }
  | {
      kind: "class";
      operation: "add" | "remove" | "replace" | "set";
      className?: string;
      classNames?: string[];
      from?: string;
      to?: string;
    }
  | { kind: "style"; property: string; value: string };

export interface LocalJsxVisualEditResult {
  content: string;
  result: {
    status: "applied" | "conflict" | "needsAgent" | "unsupported";
    changed: boolean;
    message: string;
  };
  proposedDiff?: ReturnType<typeof previewSourceDiff>;
}

interface OpeningTag {
  start: number;
  end: number;
  name: string;
  selfClosing: boolean;
}

function offsetAt(
  content: string,
  line: number,
  column: number,
): number | null {
  if (
    !Number.isInteger(line) ||
    !Number.isInteger(column) ||
    line < 1 ||
    column < 1
  )
    return null;
  let offset = 0;
  for (let currentLine = 1; currentLine < line; currentLine += 1) {
    const newline = content.indexOf("\n", offset);
    if (newline === -1) return null;
    offset = newline + 1;
  }
  const result = offset + column - 1;
  return result <= content.length ? result : null;
}

function positionAt(
  content: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (content.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

function scanOpeningTags(content: string): OpeningTag[] {
  const tags: OpeningTag[] = [];
  for (let start = 0; start < content.length; start += 1) {
    if (content[start] === "/" && content[start + 1] === "/") {
      const newline = content.indexOf("\n", start + 2);
      start = newline === -1 ? content.length : newline;
      continue;
    }
    if (content[start] === "/" && content[start + 1] === "*") {
      const close = content.indexOf("*/", start + 2);
      start = close === -1 ? content.length : close + 1;
      continue;
    }
    if (
      content[start] === '"' ||
      content[start] === "'" ||
      content[start] === "`"
    ) {
      const quote = content[start];
      for (start += 1; start < content.length; start += 1) {
        if (content[start] === quote && content[start - 1] !== "\\") break;
      }
      continue;
    }
    if (content[start] !== "<" || /[!/?]/.test(content[start + 1] ?? ""))
      continue;
    const nameMatch = /^[A-Za-z][A-Za-z0-9_.:-]*/.exec(
      content.slice(start + 1),
    );
    if (!nameMatch) continue;
    let quote = "";
    let braces = 0;
    for (
      let index = start + 1 + nameMatch[0].length;
      index < content.length;
      index += 1
    ) {
      const char = content[index] ?? "";
      if (quote) {
        if (char === quote && content[index - 1] !== "\\") quote = "";
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === "{") braces += 1;
      else if (char === "}") braces -= 1;
      else if (char === ">" && braces === 0) {
        const before = content.slice(start, index).trimEnd();
        tags.push({
          start,
          end: index + 1,
          name: nameMatch[0],
          selfClosing: before.endsWith("/"),
        });
        start = index;
        break;
      }
      if (braces < 0) break;
    }
  }
  return tags;
}

function fail(
  content: string,
  status: LocalJsxVisualEditResult["result"]["status"],
  message: string,
): LocalJsxVisualEditResult {
  return { content, result: { status, changed: false, message } };
}

function replaceRange(
  content: string,
  start: number,
  end: number,
  replacement: string,
  message: string,
): LocalJsxVisualEditResult {
  const next = `${content.slice(0, start)}${replacement}${content.slice(end)}`;
  return {
    content: next,
    result: { status: "applied", changed: next !== content, message },
    proposedDiff: previewSourceDiff(content, next),
  };
}

function jsxText(value: string): string {
  return value
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;")
    .split("{")
    .join("&#123;")
    .split("}")
    .join("&#125;");
}

function camelProperty(property: string): string | null {
  const value = property
    .trim()
    .replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : null;
}

export function planLocalJsxVisualEdit(args: {
  content: string;
  anchor: LocalJsxSourceAnchor;
  intent: LocalJsxLeafIntent;
}): LocalJsxVisualEditResult {
  const { content, anchor, intent } = args;
  if (
    (anchor.runtimeMultiplicity ?? 1) !== 1 ||
    anchor.scope === "repeated-render" ||
    anchor.scope === "shared-component-definition"
  ) {
    return fail(
      content,
      "needsAgent",
      "The source anchor renders more than one instance or belongs to a shared component; inspect its call sites before editing.",
    );
  }
  const anchorOffset = offsetAt(content, anchor.line, anchor.column);
  if (anchorOffset === null) {
    return fail(
      content,
      "conflict",
      "The source anchor is outside the current file.",
    );
  }
  const candidates = scanOpeningTags(content).filter((tag) => {
    const position = positionAt(content, tag.start);
    return (
      position.line === anchor.line &&
      Math.abs(position.column - anchor.column) <= 1
    );
  });
  if (candidates.length !== 1) {
    return fail(
      content,
      "conflict",
      candidates.length === 0
        ? "No JSX element starts at the supplied source anchor. Re-resolve the live selection."
        : "The supplied source anchor is ambiguous.",
    );
  }
  const tag = candidates[0]!;
  const opening = content.slice(tag.start, tag.end);
  if (/\{\s*\.\.\./.test(opening)) {
    return fail(
      content,
      "needsAgent",
      "JSX spread attributes require semantic source inspection.",
    );
  }

  if (intent.kind === "textContent") {
    if (tag.selfClosing)
      return fail(
        content,
        "unsupported",
        "A self-closing JSX element has no leaf text to edit.",
      );
    const close = `</${tag.name}>`;
    const closeStart = content.indexOf(close, tag.end);
    if (closeStart === -1)
      return fail(
        content,
        "conflict",
        "The JSX closing tag could not be resolved.",
      );
    const inner = content.slice(tag.end, closeStart);
    if (/[<>{}]/.test(inner)) {
      return fail(
        content,
        "needsAgent",
        "Only leaf JSX text without child elements or expressions can be edited deterministically.",
      );
    }
    return replaceRange(
      content,
      tag.end,
      closeStart,
      jsxText(intent.value),
      "Leaf JSX text updated.",
    );
  }

  if (intent.kind === "class") {
    const attr = /\s(className|class)\s*=\s*(["'])(.*?)\2/s.exec(opening);
    if (!attr && /\s(?:className|class)\s*=/.test(opening)) {
      return fail(
        content,
        "needsAgent",
        "Dynamic JSX class expressions require semantic source inspection.",
      );
    }
    let classes = attr?.[3]?.split(/\s+/).filter(Boolean) ?? [];
    const requested =
      intent.classNames ?? (intent.className ? [intent.className] : []);
    const replacementTokens = [
      ...requested,
      ...(intent.from ? [intent.from] : []),
      ...(intent.to ? [intent.to] : []),
    ];
    if (
      replacementTokens.some((token) => !token || /[\s"'`<>{}=]/.test(token))
    ) {
      return fail(
        content,
        "unsupported",
        "Class tokens must be plain non-whitespace tokens without JSX delimiters.",
      );
    }
    if (intent.operation === "set") classes = requested;
    else if (intent.operation === "add") classes = [...classes, ...requested];
    else if (intent.operation === "remove")
      classes = classes.filter((item) => !requested.includes(item));
    else {
      if (!intent.from || !intent.to || !classes.includes(intent.from))
        return fail(
          content,
          "conflict",
          "The class replacement guard does not match the current literal class list.",
        );
      classes = classes.map((item) =>
        item === intent.from ? intent.to! : item,
      );
    }
    classes = [...new Set(classes)];
    const replacement = classes.join(" ");
    let nextOpening: string;
    if (attr) {
      const valueStart = attr.index! + attr[0].indexOf(attr[3]!);
      nextOpening = `${opening.slice(0, valueStart)}${replacement}${opening.slice(valueStart + attr[3]!.length)}`;
    } else if (intent.operation === "add" || intent.operation === "set") {
      const insertAt = opening.lastIndexOf(tag.selfClosing ? "/>" : ">");
      nextOpening = `${opening.slice(0, insertAt)} className="${replacement.split('"').join("&quot;")}"${opening.slice(insertAt)}`;
    } else {
      return fail(
        content,
        "conflict",
        "The anchored JSX element has no literal className/class attribute.",
      );
    }
    return replaceRange(
      content,
      tag.start,
      tag.end,
      nextOpening,
      "Literal JSX classes updated.",
    );
  }

  const property = camelProperty(intent.property);
  if (!property)
    return fail(
      content,
      "unsupported",
      "The CSS property cannot be represented as a JSX style key.",
    );
  const styleAttr = /\sstyle\s*=\s*\{\{([\s\S]*?)\}\}/.exec(opening);
  let nextOpening: string;
  if (!styleAttr) {
    if (/\sstyle\s*=/.test(opening))
      return fail(
        content,
        "needsAgent",
        "Dynamic JSX style expressions require semantic source inspection.",
      );
    const insertAt = opening.lastIndexOf(tag.selfClosing ? "/>" : ">");
    const value = JSON.stringify(intent.value);
    nextOpening = `${opening.slice(0, insertAt)} style={{ ${property}: ${value} }}${opening.slice(insertAt)}`;
  } else {
    const body = styleAttr[1]!;
    const literalStyleObject =
      /^\s*(?:[A-Za-z_$][A-Za-z0-9_$]*\s*:\s*(?:"[^"\n]*"|'[^'\n]*'|-?\d+(?:\.\d+)?)(?:\s*,\s*[A-Za-z_$][A-Za-z0-9_$]*\s*:\s*(?:"[^"\n]*"|'[^'\n]*'|-?\d+(?:\.\d+)?)\s*,?)*|)\s*$/;
    if (!literalStyleObject.test(body))
      return fail(
        content,
        "needsAgent",
        "Only flat literal JSX style objects can be edited deterministically.",
      );
    const propertyPattern = new RegExp(
      `(^|[,\\s])(${property})\\s*:\\s*((?:["'][^"'\\n]*["'])|-?\\d+(?:\\.\\d+)?)`,
      "s",
    );
    const match = propertyPattern.exec(body);
    const nextBody = match
      ? `${body.slice(0, match.index + match[1]!.length)}${property}: ${JSON.stringify(intent.value)}${body.slice(match.index + match[0].length)}`
      : `${body.trimEnd()}${body.trim() ? ", " : ""}${property}: ${JSON.stringify(intent.value)}${body.endsWith(" ") ? " " : ""}`;
    const bodyStart = styleAttr.index! + styleAttr[0].indexOf(body);
    nextOpening = `${opening.slice(0, bodyStart)}${nextBody}${opening.slice(bodyStart + body.length)}`;
  }
  return replaceRange(
    content,
    tag.start,
    tag.end,
    nextOpening,
    "Literal JSX style updated.",
  );
}
