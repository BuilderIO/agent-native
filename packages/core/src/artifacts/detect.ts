export interface ArtifactReceipt {
  kind:
    | "document"
    | "deck"
    | "dashboard"
    | "analysis"
    | "image"
    | "design"
    | "monitor"
    | "form";
  id: string;
  url?: string;
  title?: string;
  runId?: string;
  fileCount?: number;
}

type ArtifactKind = ArtifactReceipt["kind"];
export type ArtifactReferenceKind = Exclude<ArtifactKind, "monitor" | "form">;

export interface ArtifactReference {
  kind: ArtifactReferenceKind;
  id: string;
}

// This map attributes unreadable truncated results and preserves legacy sparse
// image results. Missing entries fall back to the generic verification message;
// structurally detectable receipts remain accepted independently of this list.
const TOOL_ARTIFACT_KINDS: Readonly<Record<string, readonly ArtifactKind[]>> = {
  "submit-content-database-form": ["document"],
  "add-database-item": ["document"],
  "upsert-database-item-by-key": ["document"],
  "mutate-content-database-block": ["document"],
  "create-document": ["document"],
  "update-document": ["document"],
  "set-document-property": ["document"],
  "get-document": ["document"],
  "get-content-document": ["document"],
  "get-content-database": ["document"],
  "create-deck": ["deck"],
  "duplicate-deck": ["deck"],
  "get-deck": ["deck"],
  "list-decks": ["deck"],
  "add-slide": ["deck"],
  "update-slide": ["deck"],
  "patch-deck": ["deck"],
  "save-deck": ["deck"],
  "import-pptx": ["deck"],
  "restore-deck-version": ["deck"],
  "update-dashboard": ["dashboard"],
  "rename-dashboard": ["dashboard"],
  "get-dashboard": ["dashboard"],
  "save-analysis": ["analysis"],
  "get-analysis": ["analysis"],
  "generate-image": ["image"],
  "generate-image-api": ["image"],
  "generate-image-batch": ["image"],
  "generate-asset": ["image"],
  "edit-image": ["image"],
  "refine-image": ["image"],
  "restyle-image": ["image"],
  "get-asset": ["image"],
  "get-generation-run": ["image"],
  "refresh-generation-run": ["image"],
  "get-variant-slots": ["image"],
  "list-assets": ["image"],
  "save-generated-image": ["image"],
  "save-generated-asset": ["image"],
  "export-image": ["image"],
  "export-asset": ["image"],
  "save-monitor": ["monitor"],
  "create-form": ["form"],
  "create-design": ["design"],
  "get-design": ["design"],
  "generate-design": ["design"],
  "create-file": ["design"],
  "duplicate-design": ["design"],
};

export function artifactKindsForTool(
  toolName: string,
): readonly ArtifactKind[] {
  return TOOL_ARTIFACT_KINDS[toolName] ?? [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function parseArtifactReferenceUrl(
  rawUrl: string,
): ArtifactReference | null {
  const baseUrl = "https://agent-native-artifact.invalid";
  if (!URL.canParse(rawUrl, baseUrl)) return null;
  const url = new URL(rawUrl, baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const path = url.pathname.replace(/\/+$/, "");
  const patterns: Array<[ArtifactReferenceKind, RegExp]> = [
    ["deck", /(?:^|\/)deck\/([A-Za-z0-9_-]+)(?:\/present)?$/],
    ["design", /(?:^|\/)design\/([A-Za-z0-9_-]+)$/],
    ["document", /(?:^|\/)page\/([A-Za-z0-9_-]+)$/],
    ["dashboard", /(?:^|\/)adhoc\/([A-Za-z0-9_-]+)$/],
    ["analysis", /(?:^|\/)analyses\/([A-Za-z0-9_-]+)$/],
    ["image", /(?:^|\/)image\/([A-Za-z0-9_-]+)$/],
    ["image", /(?:^|\/)asset\/([A-Za-z0-9_-]+)\/embed$/],
    ["image", /(?:^|\/)asset\/([A-Za-z0-9_-]+)$/],
    ["image", /(?:^|\/)api\/assets\/([A-Za-z0-9_-]+)\/content$/],
  ];
  for (const [kind, pattern] of patterns) {
    const match = path.match(pattern);
    if (match) return { kind, id: match[1] };
  }
  const legacyAsset = path.match(/(?:^|\/)assets\/([A-Za-z0-9_-]+)$/);
  if (legacyAsset && !/(?:^|\/)api\/assets\//.test(path)) {
    return { kind: "image", id: legacyAsset[1] };
  }
  return null;
}

function resultUrl(record: Record<string, unknown>): string | undefined {
  return (
    stringValue(record.pageUrl) ??
    stringValue(record.detailUrl) ??
    stringValue(record.url) ??
    stringValue(record.urlPath) ??
    stringValue(record.monitorAppUrl) ??
    stringValue(record.publicUrl)
  );
}

function receipt(
  kind: ArtifactKind,
  id: string | undefined,
  record: Record<string, unknown>,
  url: string | null = resultUrl(record) ?? null,
): ArtifactReceipt | null {
  if (!id) return null;
  return {
    kind,
    id,
    ...(url ? { url } : {}),
    ...((stringValue(record.title) ?? stringValue(record.name))
      ? { title: stringValue(record.title) ?? stringValue(record.name) }
      : {}),
    ...((stringValue(record.runId) ?? stringValue(record.generationRunId))
      ? {
          runId:
            stringValue(record.runId) ?? stringValue(record.generationRunId),
        }
      : {}),
  };
}

function imageReceipt(
  record: Record<string, unknown>,
  assumeImage = false,
): ArtifactReceipt | null {
  const id =
    stringValue(record.assetId) ??
    stringValue(record.imageId) ??
    stringValue(record.id);
  const url = resultUrl(record);
  const reference = url ? parseArtifactReferenceUrl(url) : null;
  const explicitlyImage = stringValue(record.artifactType) === "image";
  const explicitlyOtherKind =
    stringValue(record.artifactType) !== undefined && !explicitlyImage;
  if (explicitlyOtherKind) return null;
  if (!assumeImage && !explicitlyImage && reference?.kind !== "image") {
    return null;
  }
  if (reference?.kind === "image" && id && reference.id !== id) return null;
  return receipt("image", id ?? reference?.id, record, url);
}

function isContentDocumentUrl(rawUrl: string): boolean {
  return (
    URL.canParse(rawUrl) &&
    new URL(rawUrl).origin === "https://content.agent-native.com"
  );
}

function documentReceipt(
  record: Record<string, unknown>,
  options: {
    allowWithoutUrl: boolean;
    requireContentOrigin: boolean;
    additionalUrls?: Array<string | undefined>;
  },
): ArtifactReceipt | null {
  const id = stringValue(record.documentId) ?? stringValue(record.id);
  if (!id) return null;
  const candidates = [
    resultUrl(record),
    ...(options.additionalUrls ?? []),
  ].filter((value): value is string => !!value);
  const url = candidates.find((candidate) => {
    const reference = parseArtifactReferenceUrl(candidate);
    return (
      reference?.kind === "document" &&
      reference.id === id &&
      (!options.requireContentOrigin || isContentDocumentUrl(candidate))
    );
  });
  if (!url && !options.allowWithoutUrl) return null;
  return receipt("document", id, record, url ?? null);
}

function designReceipt(
  id: string | undefined,
  record: Record<string, unknown>,
  fileCount?: number,
): ArtifactReceipt | null {
  const candidate = receipt("design", id, record);
  return candidate && fileCount !== undefined
    ? { ...candidate, fileCount }
    : candidate;
}

function renderableDesignFile(value: unknown): boolean {
  const file = asRecord(value);
  if (!file) return false;
  const filename = stringValue(file.filename);
  const fileType = stringValue(file.fileType);
  return (
    fileType === "html" ||
    fileType === "jsx" ||
    filename?.endsWith(".html") === true ||
    filename?.endsWith(".jsx") === true
  );
}

function remember(
  receipts: Map<string, ArtifactReceipt>,
  candidate: ArtifactReceipt | null,
): void {
  if (candidate) receipts.set(`${candidate.kind}:${candidate.id}`, candidate);
}

function detectFromRecord(
  result: Record<string, unknown>,
  toolName: string,
  receipts: Map<string, ArtifactReceipt>,
): void {
  const url = resultUrl(result);
  const reference = url ? parseArtifactReferenceUrl(url) : null;

  if (toolName === "generate-image-batch" && Array.isArray(result.images)) {
    for (const value of result.images) {
      const image = asRecord(value);
      if (!image || image.ok === false) continue;
      remember(receipts, imageReceipt(image, true));
    }
    return;
  }

  remember(
    receipts,
    imageReceipt(result, artifactKindsForTool(toolName).includes("image")),
  );

  const deckId = stringValue(result.deckId);
  if (deckId) {
    remember(
      receipts,
      receipt(
        "deck",
        deckId,
        result,
        reference?.kind === "deck" && reference.id === deckId ? url : null,
      ),
    );
  } else if (reference?.kind === "deck") {
    remember(receipts, receipt("deck", reference.id, result, url));
  } else if (
    toolName === "create-deck" ||
    toolName === "duplicate-deck" ||
    toolName === "get-deck"
  ) {
    remember(receipts, receipt("deck", stringValue(result.id), result));
  }

  if (
    toolName === "submit-content-database-form" ||
    toolName === "add-database-item"
  ) {
    const id = stringValue(result.createdDocumentId);
    remember(
      receipts,
      receipt("document", id, {
        ...result,
        title: result.createdDocumentTitle,
      }),
    );
    return;
  }

  if (
    toolName === "upsert-database-item-by-key" ||
    toolName === "mutate-content-database-block"
  ) {
    const mutationReceipt = asRecord(result.receipt);
    const row = asRecord(mutationReceipt?.row);
    const target = asRecord(mutationReceipt?.target);
    const rowLink = asRecord(mutationReceipt?.rowLink);
    const id =
      stringValue(row?.documentId) ?? stringValue(target?.rowDocumentId);
    remember(
      receipts,
      receipt(
        "document",
        id,
        result,
        stringValue(row?.urlPath) ?? stringValue(rowLink?.urlPath),
      ),
    );
    return;
  }

  if (
    toolName === "create-document" ||
    toolName === "update-document" ||
    toolName === "set-document-property"
  ) {
    if (result.conflict === true) return;
    const document = asRecord(result.document) ?? result;
    remember(
      receipts,
      receipt(
        "document",
        stringValue(document.documentId) ?? stringValue(document.id),
        document,
        resultUrl(document) ?? url,
      ),
    );
    return;
  }

  if (toolName === "get-document" || toolName === "get-content-document") {
    const document = asRecord(result.document) ?? result;
    remember(
      receipts,
      documentReceipt(document, {
        allowWithoutUrl: true,
        requireContentOrigin: true,
        additionalUrls: [url],
      }),
    );
    return;
  }

  if (toolName === "get-content-database") {
    const database = asRecord(result.database);
    if (database) {
      remember(
        receipts,
        documentReceipt(database, {
          allowWithoutUrl: true,
          requireContentOrigin: true,
          additionalUrls: [url],
        }),
      );
    } else if (result.available !== false) {
      remember(
        receipts,
        documentReceipt(result, {
          allowWithoutUrl: true,
          requireContentOrigin: true,
        }),
      );
    }
    const candidates = Array.isArray(result.items) ? result.items : [];
    for (const value of candidates) {
      const item = asRecord(value);
      const document = asRecord(item?.document) ?? item;
      if (!document) continue;
      remember(
        receipts,
        documentReceipt(document, {
          allowWithoutUrl: true,
          requireContentOrigin: true,
          additionalUrls: [resultUrl(item ?? {}), url],
        }),
      );
    }
    return;
  }

  if (toolName === "list-decks" && Array.isArray(result.decks)) {
    for (const value of result.decks) {
      const deck = asRecord(value);
      if (!deck) continue;
      remember(
        receipts,
        receipt("deck", stringValue(deck.deckId) ?? stringValue(deck.id), deck),
      );
    }
    return;
  }

  if (/^(?:find|get|list|query|read|search)-/i.test(toolName)) {
    remember(
      receipts,
      documentReceipt(result, {
        allowWithoutUrl: false,
        requireContentOrigin: true,
      }),
    );
    const document = asRecord(result.document);
    if (document) {
      remember(
        receipts,
        documentReceipt(document, {
          allowWithoutUrl: false,
          requireContentOrigin: true,
          additionalUrls: [url],
        }),
      );
    }
  }

  if (
    toolName === "update-dashboard" ||
    toolName === "rename-dashboard" ||
    toolName === "get-dashboard"
  ) {
    remember(
      receipts,
      receipt(
        "dashboard",
        stringValue(result.dashboardId) ?? stringValue(result.id),
        result,
      ),
    );
    return;
  }

  if (toolName === "save-analysis" || toolName === "get-analysis") {
    remember(
      receipts,
      receipt(
        "analysis",
        stringValue(result.analysisId) ?? stringValue(result.id),
        result,
      ),
    );
    return;
  }

  if (toolName === "save-monitor") {
    remember(
      receipts,
      receipt(
        "monitor",
        stringValue(result.id),
        result,
        stringValue(result.monitorAppUrl),
      ),
    );
    return;
  }

  if (
    toolName === "create-form" &&
    stringValue(result.status) === "published"
  ) {
    remember(
      receipts,
      receipt(
        "form",
        stringValue(result.id),
        result,
        stringValue(result.publicUrl),
      ),
    );
    return;
  }

  if (toolName === "create-design") {
    remember(receipts, designReceipt(stringValue(result.id), result));
    return;
  }

  if (toolName === "get-design") {
    const files = Array.isArray(result.files) ? result.files : [];
    if (files.some(renderableDesignFile)) {
      remember(
        receipts,
        designReceipt(stringValue(result.id), result, files.length),
      );
    }
    return;
  }

  if (toolName === "generate-design") {
    const savedFiles = Array.isArray(result.savedFiles)
      ? result.savedFiles
      : [];
    const fileCount = numberValue(result.fileCount) ?? savedFiles.length;
    if (fileCount > 0) {
      remember(
        receipts,
        designReceipt(stringValue(result.designId), result, fileCount),
      );
    }
    return;
  }

  if (toolName === "create-file") {
    const renderable =
      result.renderable === true ||
      stringValue(result.fileType) === "html" ||
      stringValue(result.fileType) === "jsx";
    if (renderable) {
      remember(
        receipts,
        designReceipt(stringValue(result.designId), result, 1),
      );
    }
    return;
  }

  if (toolName === "duplicate-design" && numberValue(result.fileCount)) {
    remember(
      receipts,
      designReceipt(
        stringValue(result.id),
        result,
        numberValue(result.fileCount),
      ),
    );
  }
}

export function detectArtifactReceipts(
  result: unknown,
  toolName: string,
): ArtifactReceipt[] {
  const record = asRecord(result);
  if (!record) return [];
  const receipts = new Map<string, ArtifactReceipt>();
  detectFromRecord(record, toolName, receipts);
  return [...receipts.values()];
}
