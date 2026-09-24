import { normalizeContextItem } from "./normalize.js";
import {
  asRecord,
  cursorOffset,
  positiveLimit,
  stringValue,
} from "./provider-response.js";
import type {
  ContextConnectorExecutionContext,
  ContextConnectorFetchRequest,
  ContextConnectorFetchResult,
  ContextConnectorInventoryItem,
  ContextConnectorInventoryPage,
  ContextConnectorInventoryRequest,
  ContextImportConnector,
} from "./types.js";

interface ManualEntry {
  id: string;
  title: string;
  text: string;
  kind: string;
  canonicalUrl?: string;
  mimeType?: string;
  sourceModifiedAt?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export class ManualContextConnector implements ContextImportConnector {
  readonly kind = "manual" as const;
  readonly label = "Manual text";
  readonly supportsIncremental = false;

  async inventory(
    request: ContextConnectorInventoryRequest,
    _context: ContextConnectorExecutionContext,
  ): Promise<ContextConnectorInventoryPage> {
    const entries = parseManualEntries(request.config);
    const offset = cursorOffset(request.cursor);
    const limit = positiveLimit(request.limit, 100, 1_000);
    const slice = entries.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    return {
      items: slice.map((entry, index) => ({
        externalId: entry.id,
        kind: entry.kind,
        title: entry.title,
        ...(entry.canonicalUrl ? { canonicalUrl: entry.canonicalUrl } : {}),
        ...(entry.mimeType ? { mimeType: entry.mimeType } : {}),
        ...(entry.sourceModifiedAt
          ? { sourceModifiedAt: entry.sourceModifiedAt }
          : {}),
        metadata: { entryIndex: offset + index },
      })),
      nextCursor: nextOffset < entries.length ? String(nextOffset) : null,
      complete: nextOffset >= entries.length,
      coverage: {
        inspected: slice.length,
        returned: slice.length,
        truncated: nextOffset < entries.length,
      },
    };
  }

  async fetch(
    request: ContextConnectorFetchRequest,
    _context: ContextConnectorExecutionContext,
  ): Promise<ContextConnectorFetchResult> {
    const entry = findManualEntry(request.config, request.item);
    return {
      items: [
        normalizeContextItem({
          externalId: entry.id,
          kind: entry.kind,
          title: entry.title,
          content: entry.text,
          canonicalUrl: entry.canonicalUrl,
          mimeType: entry.mimeType,
          summary: entry.summary,
          sourceModifiedAt: entry.sourceModifiedAt,
          metadata: entry.metadata,
        }),
      ],
    };
  }
}

function parseManualEntries(config: Record<string, unknown>): ManualEntry[] {
  if (!Array.isArray(config.items)) {
    throw new Error("Manual connector config.items must be an array.");
  }
  return config.items.map((value, index) => {
    const item = asRecord(value);
    const id = stringValue(item?.id) ?? `manual-${index + 1}`;
    const title = stringValue(item?.title) ?? `Manual context ${index + 1}`;
    const text = stringValue(item?.text);
    if (!text) throw new Error(`Manual context ${id} requires text.`);
    if (text.length > 250_000) {
      throw new Error(
        `Manual context ${id} is too large for inline text; use the upload connector.`,
      );
    }
    return {
      id,
      title,
      text,
      kind: stringValue(item?.kind) ?? "manual-document",
      canonicalUrl: stringValue(item?.canonicalUrl),
      mimeType: stringValue(item?.mimeType) ?? "text/plain",
      sourceModifiedAt: stringValue(item?.sourceModifiedAt),
      summary: stringValue(item?.summary),
      metadata: asRecord(item?.metadata) ?? undefined,
    };
  });
}

function findManualEntry(
  config: Record<string, unknown>,
  inventoryItem: ContextConnectorInventoryItem,
): ManualEntry {
  const entries = parseManualEntries(config);
  const index = Number(inventoryItem.metadata?.entryIndex);
  const byIndex = Number.isInteger(index) ? entries[index] : undefined;
  const entry =
    byIndex?.id === inventoryItem.externalId
      ? byIndex
      : entries.find((candidate) => candidate.id === inventoryItem.externalId);
  if (!entry)
    throw new Error(`Manual context ${inventoryItem.externalId} not found.`);
  return entry;
}
