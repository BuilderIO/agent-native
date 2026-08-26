export interface DocumentTextEdit {
  find: string;
  replace: string;
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
