export type SuggestionMark =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "link";

export type InlineMark = {
  type: SuggestionMark;
  attrs?: Record<string, unknown>;
};

export type SuggestionNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: SuggestionNode[];
  text?: string;
  marks?: InlineMark[];
};

export type TextOperation = {
  id: string;
  kind: "insert_text" | "delete_text" | "replace_text";
  from: number;
  to: number;
  before: string;
  after: string;
  baseDigest: string;
  anchor: SuggestionAnchor;
};

export type AddBlockOperation = {
  id: string;
  kind: "add_text_block";
  index: number;
  block: SuggestionNode;
  baseDigest: string;
  anchor: SuggestionAnchor;
};

export type MarkOperation = {
  id: string;
  kind: "set_inline_mark";
  from: number;
  to: number;
  mark: InlineMark;
  enabled: boolean;
  before: InlineMark[][];
  after: InlineMark[][];
  baseDigest: string;
  anchor: SuggestionAnchor;
};

export type SuggestionOperation =
  | TextOperation
  | AddBlockOperation
  | MarkOperation;

export type SuggestionAnchor = {
  prefix: string;
  suffix: string;
};

export type SuggestionDecoration = {
  operationId: string;
  kind: SuggestionOperation["kind"];
  from: number;
  to: number;
  className: string;
  attrs?: Record<string, string>;
};

export const SUPPORTED_SUGGESTION_BLOCKS = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "codeBlock",
  "horizontalRule",
]);

export const SUPPORTED_SUGGESTION_MARKS = new Set<SuggestionMark>([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "link",
]);

function walkText(
  node: SuggestionNode,
  visit: (node: SuggestionNode, from: number) => void,
  state = { offset: 0 },
): void {
  if (node.text !== undefined) {
    visit(node, state.offset);
    state.offset += node.text.length;
    return;
  }
  node.content?.forEach((child) => walkText(child, visit, state));
}

export function textContent(doc: SuggestionNode): string {
  let result = "";
  walkText(doc, (node) => {
    result += node.text ?? "";
  });
  return result;
}

/** Stable, dependency-free digest suitable for detecting a proposal base. */
export function digest(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function makeAnchor(
  text: string,
  from: number,
  to: number,
): SuggestionAnchor {
  return {
    prefix: text.slice(Math.max(0, from - 32), from),
    suffix: text.slice(to, to + 32),
  };
}

export function supportsSuggestionBlock(node: SuggestionNode): boolean {
  return SUPPORTED_SUGGESTION_BLOCKS.has(node.type);
}

export function supportsSuggestionMark(mark: InlineMark): boolean {
  return SUPPORTED_SUGGESTION_MARKS.has(mark.type);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function findTextRange(doc: SuggestionNode, from: number, to: number) {
  let match: { node: SuggestionNode; start: number } | null = null;
  walkText(doc, (node, start) => {
    if (!match && from >= start && to <= start + (node.text?.length ?? 0)) {
      match = { node, start };
    }
  });
  return match as { node: SuggestionNode; start: number } | null;
}

function replaceText(
  doc: SuggestionNode,
  from: number,
  to: number,
  value: string,
): SuggestionNode {
  const result = clone(doc);
  const found = findTextRange(result, from, to);
  if (!found)
    throw new Error("Suggestion range crosses unsupported text nodes");
  const localFrom = from - found.start;
  const localTo = to - found.start;
  found.node.text = `${found.node.text?.slice(0, localFrom) ?? ""}${value}${found.node.text?.slice(localTo) ?? ""}`;
  return result;
}

function marksEqual(a: InlineMark[], b: InlineMark[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function applyMark(
  doc: SuggestionNode,
  operation: MarkOperation,
): SuggestionNode {
  const result = clone(doc);
  const found = findTextRange(result, operation.from, operation.to);
  if (!found) throw new Error("Mark range crosses unsupported text nodes");
  const node = found.node;
  const marks = node.marks ?? [];
  const next = marks.filter(
    (candidate) => candidate.type !== operation.mark.type,
  );
  if (operation.enabled) next.push(operation.mark);
  if (!marksEqual(marks, operation.before[0] ?? marks)) {
    throw new Error("Suggestion mark before-state does not match document");
  }
  node.marks = next;
  return result;
}

export function applySuggestionOperations(
  canonical: SuggestionNode,
  operations: readonly SuggestionOperation[],
): SuggestionNode {
  let result = clone(canonical);
  for (const operation of operations) {
    if (digest(textContent(result)) !== operation.baseDigest) {
      throw new Error(`Suggestion ${operation.id} has a stale base`);
    }
    if (operation.kind === "add_text_block") {
      if (!supportsSuggestionBlock(operation.block))
        throw new Error("Unsupported suggestion block");
      const content = result.content ? [...result.content] : [];
      content.splice(operation.index, 0, clone(operation.block));
      result = { ...result, content };
    } else if (operation.kind === "set_inline_mark") {
      if (!supportsSuggestionMark(operation.mark))
        throw new Error("Unsupported suggestion mark");
      result = applyMark(result, operation);
    } else {
      const current = textContent(result).slice(operation.from, operation.to);
      if (current !== operation.before)
        throw new Error(
          `Suggestion ${operation.id} before-state does not match`,
        );
      result = replaceText(
        result,
        operation.from,
        operation.to,
        operation.after,
      );
    }
  }
  return result;
}

export function suggestionDecorations(
  canonical: SuggestionNode,
  operations: readonly SuggestionOperation[],
): SuggestionDecoration[] {
  const decorations: SuggestionDecoration[] = [];
  let delta = 0;
  for (const operation of operations) {
    if (operation.kind === "add_text_block") continue;
    const from = operation.from + delta;
    const oldLength = operation.to - operation.from;
    const newLength =
      operation.kind === "set_inline_mark" ? oldLength : operation.after.length;
    decorations.push({
      operationId: operation.id,
      kind: operation.kind,
      from,
      to: from + Math.max(oldLength, newLength),
      className:
        operation.kind === "delete_text"
          ? "suggestion-delete"
          : "suggestion-change",
      attrs: { "data-suggestion-id": operation.id },
    });
    if (operation.kind !== "set_inline_mark") delta += newLength - oldLength;
  }
  void canonical;
  return decorations;
}
