import { createHmac, timingSafeEqual } from "node:crypto";

export interface A2AToolResultSummary {
  tool: string;
  result: string;
}

export interface A2AArtifactResponseOptions {
  baseUrl?: string;
  includeReferencedArtifacts?: boolean;
  includePersistedArtifactMarker?: boolean;
}

export interface A2AArtifactIdentity {
  resourceType:
    | "document"
    | "deck"
    | "dashboard"
    | "analysis"
    | "image"
    | "design"
    | "monitor"
    | "form";
  id: string;
  sourceAction: string;
  titleAtAction?: string;
  url?: string;
}

const ARTIFACT_IDENTITY_WRITE_TOOLS = new Set([
  "save-monitor",
  "create-form",
  "submit-content-database-form",
  "add-database-item",
  "create-document",
  "update-document",
  "create-deck",
  "duplicate-deck",
  "add-slide",
  "update-dashboard",
  "rename-dashboard",
  "save-analysis",
  "generate-image",
  "edit-image",
  "refine-image",
  "restyle-image",
  "save-generated-image",
  "save-generated-asset",
  "export-image",
  "export-asset",
  "generate-image-batch",
  "create-design",
  "generate-design",
  "create-file",
  "duplicate-design",
]);

const PERSISTED_ARTIFACT_MARKER = "agent-native:persisted-artifacts=";
const PERSISTED_ARTIFACT_MARKER_PATTERN =
  /\s*<!--\s*agent-native:persisted-artifacts=[A-Za-z0-9_-]+\.[a-f0-9]{64}\s*-->/g;
const ARTIFACT_RESOURCE_TYPES = new Set<A2AArtifactIdentity["resourceType"]>([
  "document",
  "deck",
  "dashboard",
  "analysis",
  "image",
  "design",
  "monitor",
  "form",
]);

function persistedArtifactIdentitiesFromMarker(
  result: string,
): A2AArtifactIdentity[] {
  const secret = process.env.A2A_SECRET;
  if (!secret) return [];
  const match = result.match(
    /<!--\s*agent-native:persisted-artifacts=([A-Za-z0-9_-]+)\.([a-f0-9]{64})\s*-->/,
  );
  if (!match) return [];
  try {
    const payload = match[1];
    const expected = createHmac("sha256", secret).update(payload).digest();
    const supplied = Buffer.from(match[2], "hex");
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      return [];
    }
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!Array.isArray(parsed)) return [];
    return parsed
      .slice(0, 12)
      .filter((identity): identity is A2AArtifactIdentity => {
        const item = asRecord(identity);
        return (
          !!item &&
          ARTIFACT_RESOURCE_TYPES.has(
            item.resourceType as A2AArtifactIdentity["resourceType"],
          ) &&
          typeof item.id === "string" &&
          typeof item.sourceAction === "string"
        );
      });
  } catch {
    return [];
  }
}

function withPersistedArtifactMarker(
  text: string,
  toolResults: A2AToolResultSummary[],
): string {
  const identities = extractA2AArtifactIdentities(toolResults).slice(0, 12);
  const secret = process.env.A2A_SECRET;
  if (identities.length === 0 || !secret) return text;
  const payload = Buffer.from(JSON.stringify(identities)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  const marker = `<!-- ${PERSISTED_ARTIFACT_MARKER}${payload}.${signature} -->`;
  return text ? `${text}\n\n${marker}` : marker;
}

export function stripA2APersistedArtifactMarkers(text: string): string {
  return text.replace(PERSISTED_ARTIFACT_MARKER_PATTERN, "").trim();
}

interface CreatedDocumentArtifact {
  id: string;
  title?: string;
  url?: string;
}

interface CreatedDesignShell {
  id: string;
  title?: string;
}

interface GeneratedDesignArtifact {
  id: string;
  fileCount: number;
  url?: string;
}

interface CreatedDeckArtifact {
  id: string;
  url?: string;
}

interface CreatedDashboardArtifact {
  id: string;
  title?: string;
  url?: string;
}

interface CreatedAnalysisArtifact {
  id: string;
  title?: string;
  url?: string;
}

interface CreatedImageArtifact {
  id: string;
  runId?: string;
  title?: string;
  url?: string;
}

interface CreatedMonitorArtifact {
  id: string;
  name?: string;
  url: string;
}

interface CreatedFormArtifact {
  id: string;
  title?: string;
  url: string;
  anonymous: boolean;
}

type ReferencedArtifactKind =
  | "deck"
  | "design"
  | "document"
  | "dashboard"
  | "analysis"
  | "image";

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

function artifactUrlFromResult(
  parsed: Record<string, unknown>,
  fallbackPath: string,
  baseUrl: string | undefined,
): string {
  const explicitUrl = stringValue(parsed.url) ?? stringValue(parsed.urlPath);
  if (!explicitUrl) return artifactUrl(baseUrl, fallbackPath);
  if (explicitUrl.startsWith("/")) return artifactUrl(baseUrl, explicitUrl);
  try {
    return new URL(explicitUrl).toString();
  } catch {
    return artifactUrl(baseUrl, fallbackPath);
  }
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

function deckIdValue(parsed: Record<string, unknown>): string | undefined {
  return stringValue(parsed.id) ?? stringValue(parsed.deckId);
}

function dashboardIdValue(parsed: Record<string, unknown>): string | undefined {
  return stringValue(parsed.id) ?? stringValue(parsed.dashboardId);
}

function analysisIdValue(parsed: Record<string, unknown>): string | undefined {
  return stringValue(parsed.id) ?? stringValue(parsed.analysisId);
}

function imageIdValue(parsed: Record<string, unknown>): string | undefined {
  return (
    stringValue(parsed.assetId) ??
    stringValue(parsed.imageId) ??
    stringValue(parsed.id)
  );
}

function contentDatabaseSubmissionArtifact(
  parsed: Record<string, unknown>,
): CreatedDocumentArtifact | null {
  const id = stringValue(parsed.createdDocumentId);
  if (!id) return null;

  const verification = asRecord(parsed.verification);
  const candidates = [
    stringValue(parsed.url),
    stringValue(parsed.urlPath),
    stringValue(parsed.createdDocumentUrl),
    stringValue(verification?.url),
    stringValue(verification?.urlPath),
  ].filter((value): value is string => !!value);
  const url = candidates.find((candidate) =>
    artifactUrlReferencesId(candidate, "document", id),
  );

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const createdItem = items.map(asRecord).find((item) => {
    const document = asRecord(item?.document);
    return stringValue(document?.id) === id;
  });
  const createdDocument = asRecord(createdItem?.document);

  return {
    id,
    title:
      stringValue(parsed.createdDocumentTitle) ??
      stringValue(createdDocument?.title),
    url,
  };
}

function documentUrlForId(
  parsed: Record<string, unknown>,
  id: string,
  additionalCandidates: Array<string | undefined> = [],
  options: { requireContentOrigin?: boolean } = {},
): string | undefined {
  const candidates = [
    stringValue(parsed.url),
    stringValue(parsed.urlPath),
    stringValue(parsed.deepLink),
    stringValue(parsed.pageUrl),
    stringValue(parsed.documentUrl),
    ...additionalCandidates,
  ].filter((value): value is string => !!value);

  return candidates.find((candidate) => {
    if (!artifactUrlReferencesId(candidate, "document", id)) return false;
    return !options.requireContentOrigin || isContentDocumentUrl(candidate);
  });
}

function isContentDocumentUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).origin === "https://content.agent-native.com";
  } catch {
    return false;
  }
}

function addDocumentReadArtifact(
  documents: Map<string, CreatedDocumentArtifact>,
  parsed: Record<string, unknown>,
  options: {
    allowWithoutUrl: boolean;
    additionalUrlCandidates?: Array<string | undefined>;
    requireContentOrigin?: boolean;
  },
): void {
  const id = stringValue(parsed.documentId) ?? stringValue(parsed.id);
  if (!id) return;

  const url = documentUrlForId(parsed, id, options.additionalUrlCandidates, {
    requireContentOrigin: options.requireContentOrigin,
  });
  if (!url && !options.allowWithoutUrl) return;

  documents.set(id, {
    id,
    title: stringValue(parsed.title) ?? stringValue(parsed.name),
    url,
  });
}

function addContentDatabaseReadArtifacts(
  documents: Map<string, CreatedDocumentArtifact>,
  parsed: Record<string, unknown>,
): void {
  const resultUrls = [
    stringValue(parsed.url),
    stringValue(parsed.urlPath),
    stringValue(parsed.deepLink),
  ];
  const database = asRecord(parsed.database);
  if (database) {
    addDocumentReadArtifact(documents, database, {
      allowWithoutUrl: true,
      requireContentOrigin: true,
      additionalUrlCandidates: resultUrls,
    });
  } else {
    // Unavailable database reads still return a documentId, but they do not
    // prove that the page exists and must not authorize an artifact URL.
    if (parsed.available !== false) {
      addDocumentReadArtifact(documents, parsed, {
        allowWithoutUrl: true,
        requireContentOrigin: true,
      });
    }
  }

  if (!Array.isArray(parsed.items)) return;
  for (const item of parsed.items) {
    const itemRecord = asRecord(item);
    const document = asRecord(itemRecord?.document);
    if (!document) continue;
    addDocumentReadArtifact(documents, document, {
      allowWithoutUrl: true,
      requireContentOrigin: true,
      additionalUrlCandidates: [
        stringValue(itemRecord?.url),
        stringValue(itemRecord?.urlPath),
        stringValue(itemRecord?.deepLink),
      ],
    });
  }
}

function isGenericReadTool(tool: string): boolean {
  return /^(?:find|get|list|query|read|search)-/i.test(tool);
}

function addGenericDocumentReadArtifact(
  documents: Map<string, CreatedDocumentArtifact>,
  parsed: Record<string, unknown>,
): void {
  // Unknown read actions are accepted only when their result pairs a document
  // ID with a canonical page URL containing that exact ID. An ID by itself is
  // insufficient, preserving the fabrication guard for unrelated actions.
  addDocumentReadArtifact(documents, parsed, {
    allowWithoutUrl: false,
    requireContentOrigin: true,
  });

  const document = asRecord(parsed.document);
  if (!document) return;
  addDocumentReadArtifact(documents, document, {
    allowWithoutUrl: false,
    requireContentOrigin: true,
    additionalUrlCandidates: [
      stringValue(parsed.url),
      stringValue(parsed.urlPath),
      stringValue(parsed.deepLink),
    ],
  });
}

function addImageArtifact(
  images: Map<string, CreatedImageArtifact>,
  parsed: Record<string, unknown>,
): void {
  const id = imageIdValue(parsed);
  if (!id) return;
  images.set(id, {
    id,
    runId: stringValue(parsed.runId) ?? stringValue(parsed.generationRunId),
    title: stringValue(parsed.title),
    url:
      stringValue(parsed.pageUrl) ??
      stringValue(parsed.detailUrl) ??
      stringValue(parsed.url) ??
      stringValue(parsed.urlPath),
  });
}

function isReadyDeckArtifact(parsed: Record<string, unknown>): boolean {
  const slideCount = numberValue(parsed.slideCount);
  if (slideCount !== undefined) return slideCount > 0;
  if (Array.isArray(parsed.slides)) return parsed.slides.length > 0;
  return true;
}

function addDeckArtifact(
  decks: Map<string, CreatedDeckArtifact>,
  parsed: Record<string, unknown>,
  options: { requireReady: boolean },
): void {
  const id = deckIdValue(parsed);
  if (!id) return;
  if (options.requireReady && !isReadyDeckArtifact(parsed)) return;
  decks.set(id, {
    id,
    url: stringValue(parsed.url) ?? stringValue(parsed.urlPath),
  });
}

function addListedDeckArtifacts(
  decks: Map<string, CreatedDeckArtifact>,
  parsed: Record<string, unknown>,
): void {
  const items = parsed.decks;
  if (!Array.isArray(items)) return;
  for (const item of items) {
    const deck = asRecord(item);
    if (!deck) continue;
    addDeckArtifact(decks, deck, { requireReady: false });
  }
}

function collectArtifacts(results: A2AToolResultSummary[]): {
  documents: CreatedDocumentArtifact[];
  decks: CreatedDeckArtifact[];
  dashboards: CreatedDashboardArtifact[];
  analyses: CreatedAnalysisArtifact[];
  images: CreatedImageArtifact[];
  designShells: CreatedDesignShell[];
  generatedDesigns: GeneratedDesignArtifact[];
  monitors: CreatedMonitorArtifact[];
  forms: CreatedFormArtifact[];
} {
  const documents = new Map<string, CreatedDocumentArtifact>();
  const decks = new Map<string, CreatedDeckArtifact>();
  const dashboards = new Map<string, CreatedDashboardArtifact>();
  const analyses = new Map<string, CreatedAnalysisArtifact>();
  const images = new Map<string, CreatedImageArtifact>();
  const designShells = new Map<string, CreatedDesignShell>();
  const generatedDesigns = new Map<string, GeneratedDesignArtifact>();
  const monitors = new Map<string, CreatedMonitorArtifact>();
  const forms = new Map<string, CreatedFormArtifact>();

  for (const toolResult of results) {
    if (toolResult.tool === "call-agent") {
      for (const artifact of parseDownstreamArtifactBlock(toolResult.result)) {
        if (artifact.kind === "deck") {
          decks.set(artifact.id, {
            id: artifact.id,
            url: artifact.url,
          });
        } else if (artifact.kind === "document") {
          documents.set(artifact.id, {
            id: artifact.id,
            title: artifact.title,
            url: artifact.url,
          });
        } else if (artifact.kind === "dashboard") {
          dashboards.set(artifact.id, {
            id: artifact.id,
            title: artifact.title,
            url: artifact.url,
          });
        } else if (artifact.kind === "analysis") {
          analyses.set(artifact.id, {
            id: artifact.id,
            title: artifact.title,
            url: artifact.url,
          });
        } else if (artifact.kind === "image") {
          images.set(artifact.id, {
            id: artifact.id,
            title: artifact.title,
            url: artifact.url,
            runId: artifact.runId,
          });
        } else if (artifact.kind === "design" && artifact.fileCount > 0) {
          generatedDesigns.set(artifact.id, {
            id: artifact.id,
            fileCount: artifact.fileCount,
            url: artifact.url,
          });
        }
      }
      continue;
    }

    const parsed = parseToolResultJson(toolResult.result);
    if (!parsed) continue;

    if (toolResult.tool === "save-monitor") {
      const id = stringValue(parsed.id);
      const url = stringValue(parsed.monitorAppUrl);
      if (id && url) {
        monitors.set(id, {
          id,
          name: stringValue(parsed.name),
          url,
        });
      }
      continue;
    }

    if (toolResult.tool === "create-form") {
      const id = stringValue(parsed.id);
      const url = stringValue(parsed.publicUrl);
      if (id && url && stringValue(parsed.status) === "published") {
        const settings = asRecord(parsed.settings);
        forms.set(id, {
          id,
          title: stringValue(parsed.title),
          url,
          anonymous: settings?.anonymous === true,
        });
      }
      continue;
    }

    if (
      toolResult.tool === "submit-content-database-form" ||
      toolResult.tool === "add-database-item"
    ) {
      const artifact = contentDatabaseSubmissionArtifact(parsed);
      if (artifact) documents.set(artifact.id, artifact);
      continue;
    }

    if (
      toolResult.tool === "create-document" ||
      toolResult.tool === "update-document"
    ) {
      const id = stringValue(parsed.id);
      if (id) {
        documents.set(id, {
          id,
          title: stringValue(parsed.title),
          url: stringValue(parsed.url) ?? stringValue(parsed.urlPath),
        });
      }
      continue;
    }

    if (
      toolResult.tool === "get-document" ||
      toolResult.tool === "get-content-document"
    ) {
      const document = asRecord(parsed.document);
      addDocumentReadArtifact(documents, document ?? parsed, {
        allowWithoutUrl: true,
        requireContentOrigin: true,
        additionalUrlCandidates: document
          ? [
              stringValue(parsed.url),
              stringValue(parsed.urlPath),
              stringValue(parsed.deepLink),
            ]
          : [],
      });
      continue;
    }

    if (toolResult.tool === "get-content-database") {
      addContentDatabaseReadArtifacts(documents, parsed);
      continue;
    }

    if (isGenericReadTool(toolResult.tool)) {
      addGenericDocumentReadArtifact(documents, parsed);
    }

    if (
      toolResult.tool === "create-deck" ||
      toolResult.tool === "duplicate-deck"
    ) {
      addDeckArtifact(decks, parsed, { requireReady: true });
      continue;
    }

    if (toolResult.tool === "get-deck") {
      addDeckArtifact(decks, parsed, { requireReady: false });
      continue;
    }

    if (toolResult.tool === "list-decks") {
      addListedDeckArtifacts(decks, parsed);
      continue;
    }

    if (toolResult.tool === "add-slide") {
      const id = stringValue(parsed.deckId);
      const slideCount = numberValue(parsed.slideCount);
      if (id && slideCount !== undefined && slideCount > 0) {
        decks.set(id, {
          id,
          url: stringValue(parsed.url) ?? stringValue(parsed.urlPath),
        });
      }
      continue;
    }

    if (
      toolResult.tool === "update-dashboard" ||
      toolResult.tool === "rename-dashboard" ||
      toolResult.tool === "get-dashboard"
    ) {
      const id = dashboardIdValue(parsed);
      if (id) {
        dashboards.set(id, {
          id,
          title: stringValue(parsed.name) ?? stringValue(parsed.title),
          url: stringValue(parsed.url) ?? stringValue(parsed.urlPath),
        });
      }
      continue;
    }

    if (
      toolResult.tool === "save-analysis" ||
      toolResult.tool === "get-analysis"
    ) {
      const id = analysisIdValue(parsed);
      if (id) {
        analyses.set(id, {
          id,
          title: stringValue(parsed.name) ?? stringValue(parsed.title),
          url: stringValue(parsed.url) ?? stringValue(parsed.urlPath),
        });
      }
      continue;
    }

    if (
      toolResult.tool === "generate-image" ||
      toolResult.tool === "edit-image" ||
      toolResult.tool === "refine-image" ||
      toolResult.tool === "restyle-image" ||
      toolResult.tool === "get-asset" ||
      toolResult.tool === "save-generated-image" ||
      toolResult.tool === "save-generated-asset" ||
      toolResult.tool === "export-image"
    ) {
      addImageArtifact(images, parsed);
      continue;
    }

    if (toolResult.tool === "export-asset") {
      if (stringValue(parsed.artifactType) === "image") {
        addImageArtifact(images, parsed);
      }
      continue;
    }

    if (toolResult.tool === "generate-image-batch") {
      if (Array.isArray(parsed.images)) {
        for (const item of parsed.images) {
          const image = asRecord(item);
          if (!image || image.ok === false) continue;
          addImageArtifact(images, image);
        }
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
          url: stringValue(parsed.url) ?? stringValue(parsed.urlPath),
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
        generatedDesigns.set(id, {
          id,
          fileCount,
          url: stringValue(parsed.url) ?? stringValue(parsed.urlPath),
        });
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
          url:
            stringValue(parsed.url) ??
            stringValue(parsed.urlPath) ??
            previous?.url,
          fileCount: (previous?.fileCount ?? 0) + 1,
        });
      }
    }

    if (toolResult.tool === "duplicate-design") {
      const id = stringValue(parsed.id);
      const fileCount = numberValue(parsed.fileCount);
      if (id && fileCount && fileCount > 0) {
        generatedDesigns.set(id, {
          id,
          fileCount,
          url: stringValue(parsed.url) ?? stringValue(parsed.urlPath),
        });
      }
    }
  }

  return {
    documents: [...documents.values()],
    decks: [...decks.values()],
    dashboards: [...dashboards.values()],
    analyses: [...analyses.values()],
    images: [...images.values()],
    designShells: [...designShells.values()],
    generatedDesigns: [...generatedDesigns.values()],
    monitors: [...monitors.values()],
    forms: [...forms.values()],
  };
}

/**
 * Extract a compact, verified identity ledger from successful artifact tools.
 * The ledger deliberately excludes raw tool results so it is safe to retain in
 * long-lived thread context and stable even when a resource is later renamed.
 */
export function extractA2AArtifactIdentities(
  results: A2AToolResultSummary[],
): A2AArtifactIdentity[] {
  const identities = new Map<string, A2AArtifactIdentity>();

  const remember = (identity: A2AArtifactIdentity) => {
    identities.set(`${identity.resourceType}:${identity.id}`, identity);
  };

  for (const result of results) {
    if (result.tool === "call-agent") {
      for (const identity of persistedArtifactIdentitiesFromMarker(
        result.result,
      )) {
        remember({ ...identity, sourceAction: "call-agent" });
      }
      continue;
    }
    if (!ARTIFACT_IDENTITY_WRITE_TOOLS.has(result.tool)) continue;
    const artifacts = collectArtifacts([result]);
    for (const document of artifacts.documents) {
      remember({
        resourceType: "document",
        id: document.id,
        sourceAction: result.tool,
        titleAtAction: document.title,
        url: document.url,
      });
    }
    for (const deck of artifacts.decks) {
      remember({
        resourceType: "deck",
        id: deck.id,
        sourceAction: result.tool,
        url: deck.url,
      });
    }
    for (const dashboard of artifacts.dashboards) {
      remember({
        resourceType: "dashboard",
        id: dashboard.id,
        sourceAction: result.tool,
        titleAtAction: dashboard.title,
        url: dashboard.url,
      });
    }
    for (const analysis of artifacts.analyses) {
      remember({
        resourceType: "analysis",
        id: analysis.id,
        sourceAction: result.tool,
        titleAtAction: analysis.title,
        url: analysis.url,
      });
    }
    for (const image of artifacts.images) {
      remember({
        resourceType: "image",
        id: image.id,
        sourceAction: result.tool,
        titleAtAction: image.title,
        url: image.url,
      });
    }
    for (const design of artifacts.designShells) {
      remember({
        resourceType: "design",
        id: design.id,
        sourceAction: result.tool,
        titleAtAction: design.title,
      });
    }
    for (const design of artifacts.generatedDesigns) {
      remember({
        resourceType: "design",
        id: design.id,
        sourceAction: result.tool,
        url: design.url,
      });
    }
    for (const monitor of artifacts.monitors) {
      remember({
        resourceType: "monitor",
        id: monitor.id,
        sourceAction: result.tool,
        titleAtAction: monitor.name,
        url: monitor.url,
      });
    }
    for (const form of artifacts.forms) {
      remember({
        resourceType: "form",
        id: form.id,
        sourceAction: result.tool,
        titleAtAction: form.title,
        url: form.url,
      });
    }
  }

  return [...identities.values()];
}

type DownstreamArtifact =
  | { kind: "deck"; id: string; url: string }
  | { kind: "document"; id: string; url: string; title?: string }
  | { kind: "dashboard"; id: string; url: string; title?: string }
  | { kind: "analysis"; id: string; url: string; title?: string }
  | { kind: "image"; id: string; url: string; title?: string; runId?: string }
  | { kind: "design"; id: string; url: string; fileCount: number };

function parseDownstreamArtifactBlock(result: string): DownstreamArtifact[] {
  const artifacts: DownstreamArtifact[] = [];
  for (const line of downstreamArtifactLines(result)) {
    const deck = line.match(
      /^- Deck(?:\s+"[^"]+")?(?:\s+\([^)]*\))?:\s+(\S+)\s+\(ID:\s*([A-Za-z0-9_-]+)\)$/,
    );
    if (deck) {
      const id = deck[2];
      if (!artifactUrlReferencesId(deck[1], "deck", id)) continue;
      artifacts.push({
        kind: "deck",
        url: deck[1],
        id,
      });
      continue;
    }

    const document = line.match(
      /^- Document(?:\s+"([^"]+)")?:\s+(\S+)\s+\(ID:\s*([A-Za-z0-9_-]+)\)$/,
    );
    if (document) {
      const id = document[3];
      if (!artifactUrlReferencesId(document[2], "document", id)) continue;
      artifacts.push({
        kind: "document",
        title: document[1],
        url: document[2],
        id,
      });
      continue;
    }

    const dashboard = line.match(
      /^- Dashboard(?:\s+"([^"]+)")?:\s+(\S+)\s+\(ID:\s*([A-Za-z0-9_-]+)\)$/,
    );
    if (dashboard) {
      const id = dashboard[3];
      if (!artifactUrlReferencesId(dashboard[2], "dashboard", id)) continue;
      artifacts.push({
        kind: "dashboard",
        title: dashboard[1],
        url: dashboard[2],
        id,
      });
      continue;
    }

    const analysis = line.match(
      /^- (?:Analysis|Report)(?:\s+"([^"]+)")?:\s+(\S+)\s+\(ID:\s*([A-Za-z0-9_-]+)\)$/,
    );
    if (analysis) {
      const id = analysis[3];
      if (!artifactUrlReferencesId(analysis[2], "analysis", id)) continue;
      artifacts.push({
        kind: "analysis",
        title: analysis[1],
        url: analysis[2],
        id,
      });
      continue;
    }

    const image = line.match(
      /^- Image(?:\s+"([^"]+)")?:\s+(\S+)\s+\(ID:\s*([A-Za-z0-9_-]+)(?:,\s*Run:\s*([A-Za-z0-9_-]+))?\)$/,
    );
    if (image) {
      const id = image[3];
      if (!artifactUrlReferencesId(image[2], "image", id)) continue;
      artifacts.push({
        kind: "image",
        title: image[1],
        url: image[2],
        id,
        runId: image[4],
      });
      continue;
    }

    const design = line.match(
      /^- Design:\s+(\S+)\s+\(ID:\s*([A-Za-z0-9_-]+),\s*(\d+)\s+files?\)$/,
    );
    if (design) {
      const id = design[2];
      if (!artifactUrlReferencesId(design[1], "design", id)) continue;
      artifacts.push({
        kind: "design",
        url: design[1],
        id,
        fileCount: Number(design[3]),
      });
    }
  }
  return artifacts;
}

function downstreamArtifactLines(result: string): string[] {
  const lines = result.split(/\r?\n/);
  const artifactLines: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim() !== "Artifacts:") continue;

    let sawBlockLine = false;
    for (let j = i + 1; j < lines.length; j += 1) {
      const trimmed = lines[j].trim();
      if (!trimmed) {
        if (!sawBlockLine) continue;
        break;
      }
      if (!trimmed.startsWith("- ")) break;
      sawBlockLine = true;
      artifactLines.push(trimmed);
    }
  }

  return artifactLines;
}

function artifactUrlReferencesId(
  rawUrl: string,
  kind: ReferencedArtifactKind,
  id: string,
): boolean {
  const reference = parseArtifactReferenceUrl(rawUrl);
  return reference?.kind === kind && reference.id === id;
}

function parseArtifactReferenceUrl(rawUrl: string): ReferencedArtifact | null {
  let url: URL;
  try {
    url = new URL(rawUrl, "https://agent-native-artifact.invalid");
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const path = url.pathname.replace(/\/+$/, "");
  const deck = path.match(/(?:^|\/)deck\/([A-Za-z0-9_-]+)(?:\/present)?$/);
  if (deck) return { kind: "deck", id: deck[1] };

  const design = path.match(/(?:^|\/)design\/([A-Za-z0-9_-]+)$/);
  if (design) return { kind: "design", id: design[1] };

  const document = path.match(/(?:^|\/)page\/([A-Za-z0-9_-]+)$/);
  if (document) return { kind: "document", id: document[1] };

  const dashboard = path.match(/(?:^|\/)adhoc\/([A-Za-z0-9_-]+)$/);
  if (dashboard) return { kind: "dashboard", id: dashboard[1] };

  const analysis = path.match(/(?:^|\/)analyses\/([A-Za-z0-9_-]+)$/);
  if (analysis) return { kind: "analysis", id: analysis[1] };

  const image = path.match(/(?:^|\/)image\/([A-Za-z0-9_-]+)$/);
  if (image) return { kind: "image", id: image[1] };

  const imageEmbed = path.match(/(?:^|\/)asset\/([A-Za-z0-9_-]+)\/embed$/);
  if (imageEmbed) return { kind: "image", id: imageEmbed[1] };

  const imageContent = path.match(
    /(?:^|\/)api\/assets\/([A-Za-z0-9_-]+)\/content$/,
  );
  if (imageContent) return { kind: "image", id: imageContent[1] };

  return null;
}

function formatDocumentLine(
  document: CreatedDocumentArtifact,
  baseUrl: string | undefined,
): string {
  const label = document.title ? `Document "${document.title}"` : "Document";
  return `- ${label}: ${artifactUrlFromResult({ url: document.url }, `/page/${document.id}`, baseUrl)} (ID: ${document.id})`;
}

function formatDeckLine(
  deck: CreatedDeckArtifact,
  baseUrl: string | undefined,
): string {
  return `- Deck: ${artifactUrlFromResult({ url: deck.url }, `/deck/${deck.id}`, baseUrl)} (ID: ${deck.id})`;
}

function formatDashboardLine(
  dashboard: CreatedDashboardArtifact,
  baseUrl: string | undefined,
): string {
  const label = dashboard.title
    ? `Dashboard "${dashboard.title}"`
    : "Dashboard";
  return `- ${label}: ${artifactUrlFromResult({ url: dashboard.url }, `/adhoc/${dashboard.id}`, baseUrl)} (ID: ${dashboard.id})`;
}

function formatAnalysisLine(
  analysis: CreatedAnalysisArtifact,
  baseUrl: string | undefined,
): string {
  const label = analysis.title ? `Report "${analysis.title}"` : "Report";
  return `- ${label}: ${artifactUrlFromResult({ url: analysis.url }, `/analyses/${analysis.id}`, baseUrl)} (ID: ${analysis.id})`;
}

function formatImageLine(
  image: CreatedImageArtifact,
  baseUrl: string | undefined,
): string {
  const label = image.title ? `Image "${image.title}"` : "Image";
  const run = image.runId ? `, Run: ${image.runId}` : "";
  return `- ${label}: ${artifactUrlFromResult({ url: image.url }, `/image/${image.id}`, baseUrl)} (ID: ${image.id}${run})`;
}

function formatDesignLine(
  design: GeneratedDesignArtifact,
  baseUrl: string | undefined,
): string {
  const fileLabel =
    design.fileCount === 1 ? "1 file" : `${design.fileCount} files`;
  return `- Design: ${artifactUrlFromResult({ url: design.url }, `/design/${design.id}`, baseUrl)} (ID: ${design.id}, ${fileLabel})`;
}

function formatMonitorLine(monitor: CreatedMonitorArtifact): string {
  const label = monitor.name ? `Monitor "${monitor.name}"` : "Monitor";
  return `- ${label}: ${monitor.url} (ID: ${monitor.id})`;
}

function formatFormLine(form: CreatedFormArtifact): string {
  const kind = form.anonymous ? "Anonymous form" : "Public form";
  const label = form.title ? `${kind} "${form.title}"` : kind;
  return `- ${label}: ${form.url} (ID: ${form.id})`;
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
    /(?:(https?:\/\/[^/\s<>()]+))?(?:\/[^\s<>()]*)?\/(deck|design|page|adhoc|analyses|image|asset|assets)\/([A-Za-z0-9_-]+)/g;

  for (const match of text.matchAll(artifactUrlPattern)) {
    const origin = safeOrigin(match[1]);
    const route = match[2];
    const id = match[3];
    const kind: ReferencedArtifactKind =
      route === "deck"
        ? "deck"
        : route === "design"
          ? "design"
          : route === "page"
            ? "document"
            : route === "adhoc"
              ? "dashboard"
              : route === "analyses"
                ? "analysis"
                : "image";
    if (!shouldValidateArtifactReference(origin, baseOrigin, kind)) continue;
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

const KNOWN_AGENT_NATIVE_ARTIFACT_HOSTS: Record<
  ReferencedArtifactKind,
  ReadonlySet<string>
> = {
  deck: new Set(["slides.agent-native.com"]),
  design: new Set(["design.agent-native.com"]),
  document: new Set(["content.agent-native.com"]),
  dashboard: new Set(["analytics.agent-native.com"]),
  analysis: new Set(["analytics.agent-native.com"]),
  image: new Set(["assets.agent-native.com", "images.agent-native.com"]),
};

function safeHostnameFromOrigin(
  origin: string | undefined,
): string | undefined {
  if (!origin) return undefined;
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function shouldValidateArtifactReference(
  origin: string | undefined,
  baseOrigin: string | undefined,
  kind: ReferencedArtifactKind,
): boolean {
  if (!origin || !baseOrigin || origin === baseOrigin) return true;

  const hostname = safeHostnameFromOrigin(origin);
  return !!hostname && KNOWN_AGENT_NATIVE_ARTIFACT_HOSTS[kind].has(hostname);
}

function findUnverifiedArtifactReferences(
  text: string,
  baseUrl: string | undefined,
  documents: CreatedDocumentArtifact[],
  decks: CreatedDeckArtifact[],
  dashboards: CreatedDashboardArtifact[],
  analyses: CreatedAnalysisArtifact[],
  images: CreatedImageArtifact[],
  generatedDesigns: GeneratedDesignArtifact[],
): ReferencedArtifact[] {
  const documentIds = new Set(documents.map((document) => document.id));
  const deckIds = new Set(decks.map((deck) => deck.id));
  const dashboardIds = new Set(dashboards.map((dashboard) => dashboard.id));
  const analysisIds = new Set(analyses.map((analysis) => analysis.id));
  const imageIds = new Set(images.map((image) => image.id));
  const designIds = new Set(generatedDesigns.map((design) => design.id));

  return collectReferencedArtifacts(text, baseUrl).filter((ref) => {
    if (ref.kind === "document") return !documentIds.has(ref.id);
    if (ref.kind === "deck") return !deckIds.has(ref.id);
    if (ref.kind === "dashboard") return !dashboardIds.has(ref.id);
    if (ref.kind === "analysis") return !analysisIds.has(ref.id);
    if (ref.kind === "image") return !imageIds.has(ref.id);
    return !designIds.has(ref.id);
  });
}

function formatUnverifiedArtifactMessage(
  refs: ReferencedArtifact[],
  documents: CreatedDocumentArtifact[],
  decks: CreatedDeckArtifact[],
  dashboards: CreatedDashboardArtifact[],
  analyses: CreatedAnalysisArtifact[],
  images: CreatedImageArtifact[],
  generatedDesigns: GeneratedDesignArtifact[],
  baseUrl: string | undefined,
): string {
  const hasOnlyDesigns = refs.every((ref) => ref.kind === "design");
  const hasOnlyDocuments = refs.every((ref) => ref.kind === "document");
  const hasOnlyDecks = refs.every((ref) => ref.kind === "deck");
  const hasOnlyDashboards = refs.every((ref) => ref.kind === "dashboard");
  const hasOnlyAnalyses = refs.every((ref) => ref.kind === "analysis");
  const hasOnlyImages = refs.every((ref) => ref.kind === "image");
  const label = hasOnlyDesigns
    ? "design URL"
    : hasOnlyDocuments
      ? "document URL"
      : hasOnlyDecks
        ? "deck URL"
        : hasOnlyDashboards
          ? "dashboard URL"
          : hasOnlyAnalyses
            ? "report URL"
            : hasOnlyImages
              ? "image URL"
              : "artifact URL";
  const plural = refs.length === 1 ? label : `${label}s`;
  const message = `I could not verify the ${plural} in the final answer against a successful artifact action that saved app data, so I cannot return it.`;
  const verifiedLines = [
    ...documents.map((document) => formatDocumentLine(document, baseUrl)),
    ...decks.map((deck) => formatDeckLine(deck, baseUrl)),
    ...dashboards.map((dashboard) => formatDashboardLine(dashboard, baseUrl)),
    ...analyses.map((analysis) => formatAnalysisLine(analysis, baseUrl)),
    ...images.map((image) => formatImageLine(image, baseUrl)),
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
  const includeReferencedArtifacts =
    options.includeReferencedArtifacts ?? false;
  const finalize = (value: string) =>
    options.includePersistedArtifactMarker
      ? withPersistedArtifactMarker(value, toolResults)
      : value;
  const {
    documents,
    decks,
    dashboards,
    analyses,
    images,
    designShells,
    generatedDesigns,
    monitors,
    forms,
  } = collectArtifacts(toolResults);
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
    return finalize(formatIncompleteDesignMessage(incompleteShells));
  }

  const unverifiedRefs = findUnverifiedArtifactReferences(
    text,
    baseUrl,
    documents,
    decks,
    dashboards,
    analyses,
    images,
    generatedDesigns,
  );
  if (unverifiedRefs.length > 0) {
    return finalize(
      formatUnverifiedArtifactMessage(
        unverifiedRefs,
        documents,
        decks,
        dashboards,
        analyses,
        images,
        generatedDesigns,
        baseUrl,
      ),
    );
  }

  const missingLines: string[] = [];
  for (const document of documents) {
    const path = `/page/${document.id}`;
    if (
      includeReferencedArtifacts ||
      !responseAlreadyMentionsPath(text, path)
    ) {
      missingLines.push(formatDocumentLine(document, baseUrl));
    }
  }
  for (const deck of decks) {
    const path = `/deck/${deck.id}`;
    if (
      includeReferencedArtifacts ||
      !responseAlreadyMentionsPath(text, path)
    ) {
      missingLines.push(formatDeckLine(deck, baseUrl));
    }
  }
  for (const dashboard of dashboards) {
    const path = `/adhoc/${dashboard.id}`;
    if (
      includeReferencedArtifacts ||
      !responseAlreadyMentionsPath(text, path)
    ) {
      missingLines.push(formatDashboardLine(dashboard, baseUrl));
    }
  }
  for (const analysis of analyses) {
    const path = `/analyses/${analysis.id}`;
    if (
      includeReferencedArtifacts ||
      !responseAlreadyMentionsPath(text, path)
    ) {
      missingLines.push(formatAnalysisLine(analysis, baseUrl));
    }
  }
  for (const image of images) {
    const path = `/image/${image.id}`;
    if (
      includeReferencedArtifacts ||
      !responseAlreadyMentionsPath(text, path)
    ) {
      missingLines.push(formatImageLine(image, baseUrl));
    }
  }
  for (const design of generatedDesigns) {
    const path = `/design/${design.id}`;
    if (
      includeReferencedArtifacts ||
      !responseAlreadyMentionsPath(text, path)
    ) {
      missingLines.push(formatDesignLine(design, baseUrl));
    }
  }
  for (const monitor of monitors) {
    if (
      includeReferencedArtifacts ||
      !responseAlreadyMentionsPath(text, monitor.url)
    ) {
      missingLines.push(formatMonitorLine(monitor));
    }
  }
  for (const form of forms) {
    if (
      includeReferencedArtifacts ||
      !responseAlreadyMentionsPath(text, form.url)
    ) {
      missingLines.push(formatFormLine(form));
    }
  }

  if (missingLines.length === 0) {
    return finalize(text);
  }
  const artifactBlock = `Artifacts:\n${missingLines.join("\n")}`;
  return finalize(text ? `${text}\n\n${artifactBlock}` : artifactBlock);
}

export function buildA2ARecoverableArtifactMessage(
  toolResults: A2AToolResultSummary[],
  options: A2AArtifactResponseOptions = {},
): string | null {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const {
    documents,
    decks,
    dashboards,
    analyses,
    images,
    generatedDesigns,
    monitors,
    forms,
  } = collectArtifacts(toolResults);
  const lines = [
    ...documents.map((document) => formatDocumentLine(document, baseUrl)),
    ...decks.map((deck) => formatDeckLine(deck, baseUrl)),
    ...dashboards.map((dashboard) => formatDashboardLine(dashboard, baseUrl)),
    ...analyses.map((analysis) => formatAnalysisLine(analysis, baseUrl)),
    ...images.map((image) => formatImageLine(image, baseUrl)),
    ...generatedDesigns.map((design) => formatDesignLine(design, baseUrl)),
    ...monitors.map(formatMonitorLine),
    ...forms.map(formatFormLine),
  ];

  if (lines.length === 0) return null;
  return [
    "The agent is still working on the full response, but these verified artifacts already exist:",
    "",
    "Artifacts:",
    ...lines,
  ].join("\n");
}
