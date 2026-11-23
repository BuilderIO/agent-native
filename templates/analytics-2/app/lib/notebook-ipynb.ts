// Deterministic Jupyter notebook (.ipynb) projection of a rebuilt project.
// The original's server-side emitter is not in either recovered corpus, so the
// document shape below is our owned decision; only markdown/text/code cells are
// mapped, and every other kind is counted as skipped instead of guessed.

export interface NotebookIpynbCell {
  kind: string;
  contents: string;
  language?: string;
}

export interface NotebookIpynbInput {
  title: string;
  language: string;
  cells: readonly NotebookIpynbCell[];
}

export interface NotebookIpynbExport {
  filename: string;
  content: string;
  skippedCells: number;
}

const FILENAME_MAX = 120;

function filenameStem(title: string): string {
  const stem = title
    .trim()
    .toLowerCase()
    .replace(/[\\/\u0000-\u001f]/g, "-")
    .replace(/[^a-z0-9._ -]+/g, "-")
    .replace(/[-\s]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, FILENAME_MAX - ".ipynb".length)
    .replace(/[-.]+$/g, "");
  return stem || "project";
}

export function notebookIpynbFilename(title: string): string {
  return `${filenameStem(title)}.ipynb`;
}

function sourceLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  return lines
    .map((line, index) =>
      index === lines.length - 1 && line === "" ? line : `${line}\n`,
    )
    .map((line, index, all) =>
      index === all.length - 1 ? line.replace(/\n$/, "") : line,
    );
}

function markdownCell(contents: string) {
  return {
    cell_type: "markdown",
    metadata: {},
    source: sourceLines(contents),
  };
}

function codeCell(contents: string, language: string) {
  return {
    cell_type: "code",
    execution_count: null,
    metadata: language ? { language } : {},
    outputs: [],
    source: sourceLines(contents),
  };
}

export function notebookToIpynb(
  input: NotebookIpynbInput,
): NotebookIpynbExport {
  let skippedCells = 0;
  const cells = input.cells.flatMap((cell) => {
    switch (cell.kind) {
      case "markdown":
      case "text":
        return [markdownCell(cell.contents)];
      case "code":
        return [codeCell(cell.contents, cell.language ?? input.language)];
      default:
        skippedCells += 1;
        return [];
    }
  });
  const language = input.language === "r" ? "r" : "python";
  const document = {
    cells,
    metadata: {
      kernelspec: {
        display_name: language === "r" ? "R" : "Python 3",
        language,
        name: language === "r" ? "ir" : "python3",
      },
      language_info: { name: language },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  return {
    filename: notebookIpynbFilename(input.title),
    content: JSON.stringify(document, null, 1),
    skippedCells,
  };
}

export function notebookIpynbBase64(input: NotebookIpynbInput): {
  filename: string;
  content: string;
  skippedCells: number;
} {
  const exported = notebookToIpynb(input);
  return {
    ...exported,
    content: Buffer.from(exported.content, "utf8").toString("base64"),
  };
}

export interface ExportableNotebookCell {
  contents: {
    kind: string;
    source?: string;
    markdown?: string;
    text?: string;
    language?: string;
  };
}

export function projectToIpynbExport(project: {
  title: string;
  language: string;
  cells: readonly ExportableNotebookCell[];
}): NotebookIpynbExport {
  return notebookToIpynb({
    title: project.title,
    language: project.language,
    cells: project.cells.map((cell) => {
      const contents = cell.contents;
      const text =
        contents.kind === "code"
          ? (contents.source ?? "")
          : contents.kind === "markdown"
            ? (contents.markdown ?? "")
            : contents.kind === "text"
              ? (contents.text ?? "")
              : "";
      if (contents.kind === "code") {
        return {
          kind: contents.kind,
          contents: text,
          ...(contents.language !== undefined
            ? { language: contents.language }
            : {}),
        };
      }
      return { kind: contents.kind, contents: text };
    }),
  });
}

export function downloadProjectIpynb(project: {
  title: string;
  language: string;
  cells: readonly ExportableNotebookCell[];
}): NotebookIpynbExport {
  const exported = projectToIpynbExport(project);
  const blob = new Blob([exported.content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exported.filename;
  link.click();
  URL.revokeObjectURL(url);
  return exported;
}
