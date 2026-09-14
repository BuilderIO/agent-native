import { docToNfm, nfmToDoc, type PMNode } from "./nfm";
import { suggestionFormattingSourceSlice } from "./suggestion-formatting";

export type SuggestionPresentationContext = {
  source: string;
  from: number;
  to: number;
};

export type SuggestionPresentationNode =
  | { type: "text"; value: string }
  | { type: "indent"; value: string }
  | {
      type: "strong" | "emphasis" | "strike" | "code" | "underline";
      children: SuggestionPresentationNode[];
    }
  | {
      type: "link";
      children: SuggestionPresentationNode[];
      url: string;
    };

export function suggestionAnchorText(content: string): string {
  let result = "";
  let index = 0;
  while (index < content.length) {
    if (content[index] === "\\" && index + 1 < content.length) {
      result += content.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (content[index] === "`") {
      const delimiter = /^`+/.exec(content.slice(index))![0];
      let end = index + delimiter.length;
      let close = -1;
      while (end < content.length) {
        const candidate = content.indexOf(delimiter, end);
        if (candidate < 0) break;
        const run = /^`+/.exec(content.slice(candidate))![0];
        if (run.length === delimiter.length) {
          close = candidate + run.length;
          break;
        }
        end = candidate + run.length;
      }
      if (close >= 0) {
        result += content.slice(index, close);
        index = close;
        continue;
      }
    }
    const hardBreak = /^<br\/?>/.exec(content.slice(index));
    if (hardBreak) {
      result += "\n";
      index += hardBreak[0].length;
    } else {
      result += content[index];
      index += 1;
    }
  }
  return result;
}

export function suggestionTextForDisplay(content: string): string {
  const text = suggestionAnchorText(content);
  if (/^\s+$/.test(text)) {
    return text.replace(/ /g, "·").replace(/\t/g, "⇥").replace(/\n/g, "↵");
  }
  return text.replace(/\n/g, "↵");
}

function presentationNode(
  node: PMNode,
  restore: (text: string) => string,
): SuggestionPresentationNode[] {
  let children: SuggestionPresentationNode[] =
    node.text === undefined
      ? (node.content?.flatMap((child) => presentationNode(child, restore)) ??
        [])
      : [{ type: "text", value: restore(node.text) }];
  if (node.text === undefined && !node.content?.length) {
    children = [
      {
        type: "text",
        value: restore(docToNfm({ type: "doc", content: [node] })),
      },
    ];
  }
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") children = [{ type: "strong", children }];
    if (mark.type === "italic") children = [{ type: "emphasis", children }];
    if (mark.type === "strike") children = [{ type: "strike", children }];
    if (mark.type === "code") children = [{ type: "code", children }];
    if (
      mark.type === "underline" ||
      (mark.type === "notionSpan" &&
        (mark.attrs?.underline === "true" || mark.attrs?.underline === true))
    )
      children = [{ type: "underline", children }];
    if (mark.type === "link" && typeof mark.attrs?.href === "string") {
      children = [{ type: "link", children, url: mark.attrs.href }];
    }
  }
  return children;
}

function stripInlineContext(
  nodes: SuggestionPresentationNode[],
  context: string,
): SuggestionPresentationNode[] {
  let stripped = false;
  const stripNode = (
    node: SuggestionPresentationNode,
  ): SuggestionPresentationNode | null => {
    if (stripped) return node;
    if (node.type === "text") {
      if (!node.value.startsWith(context)) return node;
      stripped = true;
      const value = node.value.slice(context.length);
      return value ? { type: "text", value } : null;
    }
    if (node.type === "indent") return node;
    const children = node.children.flatMap((child) => {
      const strippedChild = stripNode(child);
      return strippedChild ? [strippedChild] : [];
    });
    return { ...node, children };
  };
  const result = nodes.flatMap((node) => {
    const strippedNode = stripNode(node);
    return strippedNode ? [strippedNode] : [];
  });
  if (!stripped) {
    throw new Error("Suggestion inline parsing lost its context marker");
  }
  return result;
}

export function suggestionTextPresentation(
  content: string,
): SuggestionPresentationNode[] {
  const display = suggestionTextForDisplay(content);
  if (
    /^(`{3,})[^\r\n]*\r?\n[\s\S]*\r?\n\1[ \t]*(?:\r?\n[ \t]*)?$/.test(content)
  ) {
    return [{ type: "text", value: display }];
  }
  const trailing = display.match(/[ \t]+$/)?.[0] ?? "";
  const literals: string[] = [];
  let prefix = "suggestionliteralbreak";
  while (display.includes(prefix)) prefix += "z";
  const protectedDisplay = (
    trailing ? display.slice(0, -trailing.length) : display
  ).replace(
    /!\[|<br\/?>/g,
    (literal) => `<${prefix}${literals.push(literal) - 1}>`,
  );
  const restore = (text: string) =>
    text.replace(
      new RegExp(`<${prefix}(\\d+)>`, "g"),
      (_token, index: string) => literals[Number(index)]!,
    );
  let context = "suggestioninlinecontext";
  while (protectedDisplay.includes(context)) context += "z";
  const doc = nfmToDoc(`${context}${protectedDisplay}`);
  const nodes = stripInlineContext(
    doc.content.flatMap((node) => presentationNode(node, restore)),
    context,
  );
  if (trailing) nodes.push({ type: "text", value: trailing });
  return nodes;
}

export function suggestionTextPresentationForSource(
  content: string,
  context: SuggestionPresentationContext,
): SuggestionPresentationNode[] | null {
  if (context.source.slice(context.from, context.to) !== content) return null;
  if (content.length === 0 && context.from === context.to) return [];
  const parts = suggestionFormattingSourceSlice(
    context.source,
    context.from,
    context.to,
  );
  if (!parts) return null;
  const whitespaceOnly =
    parts.some((part) => part.type !== "text" || part.text.length > 0) &&
    parts.every((part) => part.type !== "text" || /^\s*$/.test(part.text));
  const visibleText = (text: string) =>
    (whitespaceOnly
      ? text.replace(/ /g, "·").replace(/\t/g, "⇥")
      : text
    ).replace(/\n/g, "↵");
  return parts.flatMap((part) =>
    part.type === "indent"
      ? [{ type: "indent" as const, value: part.text }]
      : part.type === "break"
        ? [{ type: "text" as const, value: part.text }]
        : presentationNode(
            { type: "text", text: visibleText(part.text), marks: part.marks },
            (text) => text,
          ),
  );
}
