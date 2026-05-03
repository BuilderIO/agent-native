export interface A2AToolResultSummary {
  tool: string;
  result: string;
}

export interface A2AArtifactResponseOptions {
  baseUrl?: string;
}

interface CreatedDocumentArtifact {
  id: string;
  title?: string;
}

interface CreatedDesignShell {
  id: string;
  title?: string;
}

interface GeneratedDesignArtifact {
  id: string;
  fileCount: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseToolResultJson(result: string): Record<string, unknown> | null {
  const trimmed = result.trim();
  if (!trimmed || /^Error(?:\s|:)/i.test(trimmed)) return null;

  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    // Dev shell wrappers may include console output before the returned JSON.
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) return null;
    try {
      return asRecord(JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)));
    } catch {
      return null;
    }
  }
}

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  const trimmed = baseUrl?.trim();
  return trimmed ? trimmed.replace(/\/+$/, "") : undefined;
}

function artifactUrl(baseUrl: string | undefined, path: string): string {
  const base = normalizeBaseUrl(baseUrl);
  return base ? `${base}${path}` : path;
}

function responseAlreadyMentionsPath(text: string, path: string): boolean {
  return text.includes(path);
}

function responseMentionsDesignShell(
  text: string,
  shell: CreatedDesignShell,
): boolean {
  if (!text.trim()) return true;
  return text.includes(shell.id) || text.includes(`/design/${shell.id}`);
}

function responseAlreadyWarnsIncompleteDesign(text: string): boolean {
  return /(?:not ready|still working|processing|no renderable|no files|failed|could not|cannot|can't)/i.test(
    text,
  );
}

function collectArtifacts(results: A2AToolResultSummary[]): {
  documents: CreatedDocumentArtifact[];
  designShells: CreatedDesignShell[];
  generatedDesigns: GeneratedDesignArtifact[];
} {
  const documents = new Map<string, CreatedDocumentArtifact>();
  const designShells = new Map<string, CreatedDesignShell>();
  const generatedDesigns = new Map<string, GeneratedDesignArtifact>();

  for (const toolResult of results) {
    const parsed = parseToolResultJson(toolResult.result);
    if (!parsed) continue;

    if (toolResult.tool === "create-document") {
      const id = stringValue(parsed.id);
      if (id) {
        documents.set(id, { id, title: stringValue(parsed.title) });
      }
      continue;
    }

    if (toolResult.tool === "create-design") {
      const id = stringValue(parsed.id);
      if (id) {
        designShells.set(id, { id, title: stringValue(parsed.title) });
      }
      continue;
    }

    if (toolResult.tool === "generate-design") {
      const id = stringValue(parsed.designId);
      if (!id) continue;

      const savedFiles = Array.isArray(parsed.savedFiles)
        ? parsed.savedFiles
        : [];
      const rawFileCount = parsed.fileCount;
      const fileCount =
        typeof rawFileCount === "number" && Number.isFinite(rawFileCount)
          ? rawFileCount
          : savedFiles.length;

      if (fileCount > 0) {
        generatedDesigns.set(id, { id, fileCount });
      }
      continue;
    }

    if (toolResult.tool === "create-file") {
      const id = stringValue(parsed.designId);
      if (!id) continue;
      const renderable =
        parsed.renderable === true ||
        stringValue(parsed.fileType) === "html" ||
        stringValue(parsed.fileType) === "jsx";

      if (renderable) {
        const previous = generatedDesigns.get(id);
        generatedDesigns.set(id, {
          id,
          fileCount: (previous?.fileCount ?? 0) + 1,
        });
      }
    }
  }

  return {
    documents: [...documents.values()],
    designShells: [...designShells.values()],
    generatedDesigns: [...generatedDesigns.values()],
  };
}

function formatDocumentLine(
  document: CreatedDocumentArtifact,
  baseUrl: string | undefined,
): string {
  const label = document.title ? `Document "${document.title}"` : "Document";
  return `- ${label}: ${artifactUrl(baseUrl, `/page/${document.id}`)} (ID: ${document.id})`;
}

function formatDesignLine(
  design: GeneratedDesignArtifact,
  baseUrl: string | undefined,
): string {
  const fileLabel =
    design.fileCount === 1 ? "1 file" : `${design.fileCount} files`;
  return `- Design: ${artifactUrl(baseUrl, `/design/${design.id}`)} (ID: ${design.id}, ${fileLabel})`;
}

function formatIncompleteDesignMessage(shells: CreatedDesignShell[]): string {
  const ids = shells.map((shell) => shell.id).join(", ");
  const noun = shells.length === 1 ? "project shell" : "project shells";
  return (
    `The design is not ready yet. Design ${noun} ${ids} ` +
    "exists, but no renderable files were saved, so I cannot return it as a completed artifact."
  );
}

export function appendA2AArtifactLinks(
  responseText: string,
  toolResults: A2AToolResultSummary[],
  options: A2AArtifactResponseOptions = {},
): string {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const { documents, designShells, generatedDesigns } =
    collectArtifacts(toolResults);
  const generatedDesignIds = new Set(
    generatedDesigns.map((design) => design.id),
  );
  const incompleteShells = designShells.filter(
    (shell) => !generatedDesignIds.has(shell.id),
  );

  let text = responseText.trim() === "(no response)" ? "" : responseText.trim();

  if (
    generatedDesigns.length === 0 &&
    incompleteShells.length > 0 &&
    !responseAlreadyWarnsIncompleteDesign(text) &&
    (incompleteShells.some((shell) =>
      responseMentionsDesignShell(text, shell),
    ) ||
      /\b(?:done|created|ready|here(?:'s| is)|complete|finished)\b/i.test(text))
  ) {
    return formatIncompleteDesignMessage(incompleteShells);
  }

  const missingLines: string[] = [];
  for (const document of documents) {
    const path = `/page/${document.id}`;
    if (!responseAlreadyMentionsPath(text, path)) {
      missingLines.push(formatDocumentLine(document, baseUrl));
    }
  }
  for (const design of generatedDesigns) {
    const path = `/design/${design.id}`;
    if (!responseAlreadyMentionsPath(text, path)) {
      missingLines.push(formatDesignLine(design, baseUrl));
    }
  }

  if (missingLines.length === 0) return text;
  const artifactBlock = `Artifacts:\n${missingLines.join("\n")}`;
  return text ? `${text}\n\n${artifactBlock}` : artifactBlock;
}
