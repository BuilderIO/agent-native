export interface DocumentTextEdit {
  find: string;
  replace: string;
}

export interface ResolvedDocumentTextEdit extends DocumentTextEdit {
  start: number;
  end: number;
}

export function parseDocumentTextEditsJson(value: string): DocumentTextEdit[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error("--edits must be a JSON array");
  }
  return parsed.map((edit, index) => {
    if (!edit || typeof edit !== "object" || Array.isArray(edit)) {
      throw new Error(`Edit ${index + 1} must be an object`);
    }
    const candidate = edit as Record<string, unknown>;
    if (typeof candidate.find !== "string" || candidate.find.length === 0) {
      throw new Error(
        `Edit ${index + 1} must have a non-empty string 'find' field`,
      );
    }
    if (
      candidate.replace !== undefined &&
      typeof candidate.replace !== "string"
    ) {
      throw new Error(`Edit ${index + 1} must have a string 'replace' field`);
    }
    return { find: candidate.find, replace: candidate.replace ?? "" };
  });
}

export type DocumentTextEditValidationError =
  | { kind: "missing"; editIndex: number; find: string }
  | { kind: "ambiguous"; editIndex: number; find: string; matches: number }
  | { kind: "overlapping"; editIndexes: [number, number] };

export function resolveDocumentTextEdits(
  source: string,
  edits: DocumentTextEdit[],
):
  | { ok: true; content: string; ranges: ResolvedDocumentTextEdit[] }
  | { ok: false; error: DocumentTextEditValidationError } {
  const ranges: ResolvedDocumentTextEdit[] = [];
  for (const [editIndex, edit] of edits.entries()) {
    const first = source.indexOf(edit.find);
    if (first === -1) {
      return {
        ok: false,
        error: { kind: "missing", editIndex, find: edit.find },
      };
    }
    const second = source.indexOf(edit.find, first + 1);
    if (second !== -1) {
      let matches = 2;
      let cursor = second;
      while ((cursor = source.indexOf(edit.find, cursor + 1)) !== -1) matches++;
      return {
        ok: false,
        error: { kind: "ambiguous", editIndex, find: edit.find, matches },
      };
    }
    ranges.push({ ...edit, start: first, end: first + edit.find.length });
  }
  const ordered = ranges
    .map((range, editIndex) => ({ range, editIndex }))
    .sort((left, right) => left.range.start - right.range.start);
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index]!.range.start < ordered[index - 1]!.range.end) {
      return {
        ok: false,
        error: {
          kind: "overlapping",
          editIndexes: [
            ordered[index - 1]!.editIndex,
            ordered[index]!.editIndex,
          ],
        },
      };
    }
  }
  let content = source;
  for (const range of [...ranges].sort(
    (left, right) => right.start - left.start,
  )) {
    content =
      content.slice(0, range.start) + range.replace + content.slice(range.end);
  }
  return { ok: true, content, ranges };
}

export function applyDocumentTextEdits(
  source: string,
  edits: DocumentTextEdit[],
) {
  let content = source;
  const results: string[] = [];
  const appliedEdits: DocumentTextEdit[] = [];

  for (const edit of edits) {
    const index = content.indexOf(edit.find);
    if (index === -1) {
      results.push(
        `NOT FOUND: "${edit.find.slice(0, 60)}${edit.find.length > 60 ? "..." : ""}"`,
      );
      continue;
    }
    content =
      content.slice(0, index) +
      edit.replace +
      content.slice(index + edit.find.length);
    appliedEdits.push(edit);
    const action = edit.replace === "" ? "deleted" : "replaced";
    results.push(
      `${action}: "${edit.find.slice(0, 40)}${edit.find.length > 40 ? "..." : ""}"`,
    );
  }

  return {
    content,
    results,
    appliedEdits,
    changeCount: appliedEdits.length,
  };
}
