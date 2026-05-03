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

type ReferencedArtifactKind = "design" | "document";

interface ReferencedArtifact {
  kind: ReferencedArtifactKind;
  id: string;
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

function isRenderableDesignFile(value: unknown): boolean {
  const file = asRecord(value);
  if (!file) return false;

  const filename = stringValue(file.filename);
  const fileType = stringValue(file.fileType);
  const hasRenderableType =
    fileType === "html" ||
    fileType === "jsx" ||
    filename?.endsWith(".html") ||
    filename?.endsWith(".jsx");
  if (!hasRenderableType) return false;

  return typeof file.content !== "string" || file.content.trim().length > 0;
}

function countRenderableDesignFiles(files: unknown): number {
  if (!Array.isArray(files)) return 0;
  return files.filter(isRenderableDesignFile).length;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
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

    if (
      toolResult.tool === "create-document" ||
      toolResult.tool === "get-document" ||
      toolResult.tool === "update-document"
    ) {
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

    if (toolResult.tool === "get-design") {
      const id = stringValue(parsed.id);
      if (!id) continue;

      const renderableFileCount = countRenderableDesignFiles(parsed.files);
      if (renderableFileCount > 0) {
        generatedDesigns.set(id, {
          id,
          fileCount: Array.isArray(parsed.files)
            ? parsed.files.length
            : renderableFileCount,
        });
      } else {
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
      const fileCount = numberValue(parsed.fileCount) ?? savedFiles.length;

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

    if (toolResult.tool === "duplicate-design") {
      const id = stringValue(parsed.id);
      const fileCount = numberValue(parsed.fileCount);
      if (id && fileCount && fileCount > 0) {
        generatedDesigns.set(id, { id, fileCount });
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

function collectReferencedArtifacts(
  text: string,
  baseUrl: string | undefined,
): ReferencedArtifact[] {
  const refs = new Map<string, ReferencedArtifact>();
  const baseOrigin = safeOrigin(baseUrl);
  const artifactUrlPattern =
    /(?:(https?:\/\/[^/\s<>()]+))?(?:\/[^\s<>()]*)?\/(design|page)\/([A-Za-z0-9_-]+)/g;

  for (const match of text.matchAll(artifactUrlPattern)) {
    const origin = safeOrigin(match[1]);
    if (origin && baseOrigin && origin !== baseOrigin) continue;

    const route = match[2];
    const id = match[3];
    const kind: ReferencedArtifactKind =
      route === "design" ? "design" : "document";
    refs.set(`${kind}:${id}`, { kind, id });
  }

  return [...refs.values()];
}

function safeOrigin(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function findUnverifiedArtifactReferences(
  text: string,
  baseUrl: string | undefined,
  documents: CreatedDocumentArtifact[],
  generatedDesigns: GeneratedDesignArtifact[],
): ReferencedArtifact[] {
  const documentIds = new Set(documents.map((document) => document.id));
  const designIds = new Set(generatedDesigns.map((design) => design.id));

  return collectReferencedArtifacts(text, baseUrl).filter((ref) => {
    if (ref.kind === "document") return !documentIds.has(ref.id);
    return !designIds.has(ref.id);
  });
}

function formatUnverifiedArtifactMessage(
  refs: ReferencedArtifact[],
  documents: CreatedDocumentArtifact[],
  generatedDesigns: GeneratedDesignArtifact[],
  baseUrl: string | undefined,
): string {
  const hasOnlyDesigns = refs.every((ref) => ref.kind === "design");
  const hasOnlyDocuments = refs.every((ref) => ref.kind === "document");
  const label = hasOnlyDesigns
    ? "design URL"
    : hasOnlyDocuments
      ? "document URL"
      : "artifact URL";
  const plural = refs.length === 1 ? label : `${label}s`;
  const message = `I could not verify the ${plural} in the final answer against a successful artifact action, so I cannot return it.`;
  const verifiedLines = [
    ...documents.map((document) => formatDocumentLine(document, baseUrl)),
    ...generatedDesigns.map((design) => formatDesignLine(design, baseUrl)),
  ];

  return verifiedLines.length > 0
    ? `${message}\n\nArtifacts:\n${verifiedLines.join("\n")}`
    : message;
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

  const unverifiedRefs = findUnverifiedArtifactReferences(
    text,
    baseUrl,
    documents,
    generatedDesigns,
  );
  if (unverifiedRefs.length > 0) {
    return formatUnverifiedArtifactMessage(
      unverifiedRefs,
      documents,
      generatedDesigns,
      baseUrl,
    );
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
