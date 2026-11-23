/**
 * Parse a Jupyter notebook (.ipynb) into the neutral cell payload the project
 * import flow creates. The original accepts .ipynb in its Import project
 * dialog; this module keeps the file-format contract separate from the
 * create-project caller.
 */
export type ImportedNotebookCell =
  | { kind: "code"; language: "python"; source: string }
  | { kind: "markdown"; markdown: string };

export type ImportedNotebook = {
  title: string | null;
  cells: ImportedNotebookCell[];
};

function textSource(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.map((part) => (typeof part === "string" ? part : "")).join("");
  return "";
}

export function parseIpynbProject(contents: string): ImportedNotebook {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("This is not a valid Jupyter notebook file.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("This is not a valid Jupyter notebook file.");
  const notebook = parsed as {
    nbformat?: unknown;
    metadata?: { title?: unknown };
    cells?: unknown;
  };
  if (notebook.nbformat !== 4 || !Array.isArray(notebook.cells))
    throw new Error("Only Jupyter notebook format 4 is supported.");
  const cells: ImportedNotebookCell[] = [];
  for (const raw of notebook.cells) {
    if (!raw || typeof raw !== "object") continue;
    const cell = raw as { cell_type?: unknown; source?: unknown };
    if (cell.cell_type === "code") {
      const source = textSource(cell.source);
      if (source.trim().length > 0)
        cells.push({ kind: "code", language: "python", source });
    } else if (cell.cell_type === "markdown") {
      const markdown = textSource(cell.source);
      if (markdown.trim().length > 0)
        cells.push({ kind: "markdown", markdown });
    }
  }
  const title =
    typeof notebook.metadata?.title === "string" &&
    notebook.metadata.title.trim().length > 0
      ? notebook.metadata.title.trim()
      : null;
  return { title, cells };
}
