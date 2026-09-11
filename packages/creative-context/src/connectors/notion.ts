import { notionBlocksToMarkdown } from "@agent-native/core/ingestion";

import type { ContextMediaInput, NormalizedContextChunk } from "../types.js";
import { collectProviderText, normalizeContextItem } from "./normalize.js";
import {
  rehostRemoteMedia,
  sanitizeProvenanceUrl,
} from "./private-artifacts.js";
import {
  asRecord,
  connectorConnectionId,
  cursorOffset,
  executeConnectorProviderRequest,
  positiveLimit,
  stringArray,
  stringValue,
} from "./provider-response.js";
import type {
  ContextConnectorExecutionContext,
  ContextConnectorFetchRequest,
  ContextConnectorFetchResult,
  ContextConnectorInventoryPage,
  ContextConnectorInventoryRequest,
  ContextImportConnector,
} from "./types.js";

export class NotionContextConnector implements ContextImportConnector {
  readonly kind = "notion" as const;
  readonly label = "Notion";
  readonly supportsIncremental = true;

  async inventory(
    request: ContextConnectorInventoryRequest,
    context: ContextConnectorExecutionContext,
  ): Promise<ContextConnectorInventoryPage> {
    const connectionId = await connectorConnectionId(
      "notion",
      request.config,
      context.resolveConnection,
    );
    const roots = notionBoundaryRoots(request.config);
    const limit = positiveLimit(request.limit, 100, 100);
    const maxPages = positiveLimit(request.config.maxPages, 500, 2_000);
    const maxDepth = positiveLimit(request.config.maxDepth, 20, 50);
    const state = parseNotionInventoryCursor(request.cursor);
    const items: ContextConnectorInventoryPage["items"] = [];
    while (items.length < limit && state.seen.length < maxPages) {
      if (state.queue.length === 0) {
        const root = roots[state.rootIndex];
        if (!root) break;
        state.rootIndex++;
        state.queue.push({
          ...root,
          selectedRootId: root.id,
          depth: 0,
        });
      }
      const candidate = state.queue.shift()!;
      if (state.seen.includes(candidate.id)) continue;
      const page = asRecord(
        await executeConnectorProviderRequest(context.providerApi, {
          provider: "notion",
          method: "GET",
          path: `/pages/${encodeURIComponent(candidate.id)}`,
          connectionId,
        }),
      );
      if (!page) continue;
      const discovery = await fetchNotionBlocks(
        candidate.id,
        connectionId,
        context,
        positiveLimit(request.config.maxDiscoveryBlocksPerPage, 500, 2_000),
      );
      state.seen.push(candidate.id);
      if (candidate.depth < maxDepth) {
        for (const child of discovery.childPages) {
          if (
            state.seen.includes(child.id) ||
            state.queue.some((queued) => queued.id === child.id) ||
            state.seen.length + state.queue.length >= maxPages
          ) {
            continue;
          }
          state.queue.push({
            id: child.id,
            title: child.title,
            boundary: candidate.boundary,
            selectedRootId: candidate.selectedRootId,
            parentId: candidate.id,
            depth: candidate.depth + 1,
          });
        }
      }
      items.push({
        externalId: candidate.id,
        kind: "notion-page",
        title:
          notionPageTitle(page) ??
          candidate.title ??
          (candidate.depth === 0 ? "Notion root page" : "Notion child page"),
        canonicalUrl: stringValue(page.url) ?? candidate.url ?? undefined,
        mimeType: "application/vnd.notion.page",
        sourceModifiedAt: stringValue(page.last_edited_time),
        upstreamAccess: notionPageAccess(page),
        metadata: {
          boundary: candidate.boundary,
          selectedRootPageId: candidate.selectedRootId,
          parentPageId: candidate.parentId ?? null,
          depth: candidate.depth,
          childPageIds: discovery.childPages.map((child) => child.id),
        },
      });
    }
    const hasMore =
      state.seen.length < maxPages &&
      (state.queue.length > 0 || state.rootIndex < roots.length);
    const nextCursor = hasMore ? encodeNotionInventoryCursor(state) : null;
    return {
      items,
      nextCursor,
      complete: !nextCursor,
      coverage: {
        inspected: items.length,
        returned: items.length,
        truncated: Boolean(nextCursor) || state.seen.length >= maxPages,
      },
    };
  }

  async fetch(
    request: ContextConnectorFetchRequest,
    context: ContextConnectorExecutionContext,
  ): Promise<ContextConnectorFetchResult> {
    const connectionId = await connectorConnectionId(
      "notion",
      request.config,
      context.resolveConnection,
    );
    const page = asRecord(
      await executeConnectorProviderRequest(context.providerApi, {
        provider: "notion",
        method: "GET",
        path: `/pages/${encodeURIComponent(request.item.externalId)}`,
        connectionId,
      }),
    );
    if (!page) {
      throw new Error(
        `Notion page ${request.item.externalId} returned no data.`,
      );
    }
    const discovery = await fetchNotionBlocks(
      request.item.externalId,
      connectionId,
      context,
      positiveLimit(request.config.maxBlocks, 500, 2_000),
    );
    const blocks = discovery.blocks;
    const indexableBlocks = blocks.map(sanitizeNotionBlockMediaUrl);
    const markdown = notionBlocksToMarkdown(indexableBlocks);
    const content =
      markdown.markdown ||
      collectProviderText(
        { properties: page.properties, blocks: indexableBlocks },
        {
          skipKeys: ["id", "created_by", "last_edited_by", "request_id"],
        },
      );
    const chunks = notionHeadingChunks(markdown.sections);
    const media = await rehostNotionMedia(blocks, context);
    return {
      items: [
        normalizeContextItem({
          externalId: request.item.externalId,
          kind: request.item.kind,
          title: notionPageTitle(page) ?? request.item.title,
          canonicalUrl: stringValue(page.url) ?? request.item.canonicalUrl,
          mimeType: request.item.mimeType,
          content,
          chunks,
          sourceModifiedAt:
            stringValue(page.last_edited_time) ?? request.item.sourceModifiedAt,
          sourceVersion: stringValue(page.last_edited_time),
          parseStatus: "parsed",
          upstreamAccess: notionPageAccess(page),
          curationStatus:
            notionPageAccess(page) === "restricted" ? "review" : "included",
          provenance: {
            provider: "notion",
            pageId: request.item.externalId,
          },
          metadata: {
            provider: "notion",
            blockCount: blocks.length,
            archived: page.archived === true,
            inTrash: page.in_trash === true,
            selectedRootPageId:
              stringValue(request.item.metadata?.selectedRootPageId) ??
              request.item.externalId,
            parentPageId:
              stringValue(request.item.metadata?.parentPageId) ?? null,
            depth: finiteNonNegative(request.item.metadata?.depth),
            childPageIds: discovery.childPages.map((child) => child.id),
          },
          media,
          edges: [
            ...discovery.childPages.map((child) => ({
              relation: "contains-page",
              toExternalId: child.id,
            })),
            ...(stringValue(request.item.metadata?.parentPageId)
              ? [
                  {
                    relation: "parent-page",
                    toExternalId: stringValue(
                      request.item.metadata?.parentPageId,
                    )!,
                  },
                ]
              : []),
          ],
        }),
      ],
    };
  }
}

function sanitizeNotionBlockMediaUrl(value: unknown): unknown {
  const block = asRecord(value);
  const type = stringValue(block?.type);
  if (
    !block ||
    !type ||
    !(["image", "video", "audio", "file", "pdf"] as string[]).includes(type)
  ) {
    return value;
  }
  const payload = asRecord(block[type]);
  if (!payload) return value;
  const location = payload.file ? "file" : payload.external ? "external" : null;
  const providerFile = location ? asRecord(payload[location]) : null;
  const url = stringValue(providerFile?.url);
  if (!location || !providerFile || !url) return value;
  return {
    ...block,
    [type]: {
      ...payload,
      [location]: {
        ...providerFile,
        url: sanitizeProvenanceUrl(url),
      },
    },
  };
}

interface NotionInventoryCandidate {
  id: string;
  title?: string;
  url?: string;
  boundary: "root-page" | "teamspace-root";
  selectedRootId: string;
  parentId?: string;
  depth: number;
}

interface NotionInventoryCursor {
  rootIndex: number;
  queue: NotionInventoryCandidate[];
  seen: string[];
}

function parseNotionInventoryCursor(
  value?: string | null,
): NotionInventoryCursor {
  if (!value) return { rootIndex: 0, queue: [], seen: [] };
  if (/^\d+$/.test(value)) {
    return { rootIndex: cursorOffset(value), queue: [], seen: [] };
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<NotionInventoryCursor>;
    return {
      rootIndex: finiteNonNegative(parsed.rootIndex),
      queue: Array.isArray(parsed.queue)
        ? parsed.queue.filter(isNotionInventoryCandidate).slice(0, 2_000)
        : [],
      seen: stringArray(parsed.seen).slice(0, 2_000),
    };
  } catch {
    throw new Error("Notion inventory cursor is invalid.");
  }
}

function encodeNotionInventoryCursor(state: NotionInventoryCursor): string {
  return Buffer.from(JSON.stringify(state)).toString("base64url");
}

function isNotionInventoryCandidate(
  value: unknown,
): value is NotionInventoryCandidate {
  const candidate = asRecord(value);
  return Boolean(
    stringValue(candidate?.id) &&
    stringValue(candidate?.selectedRootId) &&
    (candidate?.boundary === "root-page" ||
      candidate?.boundary === "teamspace-root") &&
    Number.isInteger(candidate?.depth) &&
    Number(candidate?.depth) >= 0,
  );
}

export function notionRecommendedRootPageIds(
  config: Record<string, unknown>,
): string[] {
  return stringArray(config.recommendedRootPageIds);
}

function notionBoundaryRoots(config: Record<string, unknown>): Array<{
  id: string;
  title?: string;
  url?: string;
  boundary: "root-page" | "teamspace-root";
}> {
  const roots = new Map<
    string,
    {
      id: string;
      title?: string;
      url?: string;
      boundary: "root-page" | "teamspace-root";
    }
  >();
  for (const id of stringArray(config.rootPageIds)) {
    roots.set(id, { id, boundary: "root-page" });
  }
  for (const url of stringArray(config.rootPageUrls)) {
    const id = notionPageIdFromUrl(url);
    roots.set(id, { id, url, boundary: "root-page" });
  }
  for (const id of stringArray(config.teamspaceRootPageIds)) {
    roots.set(id, { id, boundary: "teamspace-root" });
  }
  for (const url of stringArray(config.teamspaceRootPageUrls)) {
    const id = notionPageIdFromUrl(url);
    roots.set(id, { id, url, boundary: "teamspace-root" });
  }
  for (const value of Array.isArray(config.roots) ? config.roots : []) {
    const root = asRecord(value);
    const id = stringValue(root?.id);
    if (!id) continue;
    const boundary =
      root?.boundary === "teamspace-root" ? "teamspace-root" : "root-page";
    roots.set(id, {
      id,
      boundary,
      title: stringValue(root?.title),
      url: stringValue(root?.url),
    });
  }
  if (roots.size === 0) {
    throw new Error(
      "Notion connector config requires rootPageIds or teamspaceRootPageIds. Search recommendations are not an import boundary.",
    );
  }
  return [...roots.values()];
}

function notionPageIdFromUrl(value: string): string {
  const url = new URL(value);
  if (url.hostname !== "notion.so" && !url.hostname.endsWith(".notion.so")) {
    throw new Error("Notion root page URLs must use notion.so.");
  }
  const compact = url.pathname.match(/([a-f0-9]{32})(?:$|[/?#])/i)?.[1];
  if (!compact) throw new Error(`Could not find a Notion page ID in ${value}.`);
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ].join("-");
}

function notionHeadingChunks(
  sections: ReturnType<typeof notionBlocksToMarkdown>["sections"],
): NormalizedContextChunk[] {
  return sections.map((section, ordinal) => ({
    ordinal,
    kind: "notion-section",
    text: section.markdown,
    metadata: {
      ...(section.heading ? { heading: section.heading } : {}),
      ...(section.headingLevel ? { headingLevel: section.headingLevel } : {}),
    },
  }));
}

async function rehostNotionMedia(
  blocks: unknown[],
  context: ContextConnectorExecutionContext,
): Promise<ContextMediaInput[]> {
  const candidates: Array<{
    url: string;
    kind: ContextMediaInput["kind"];
    mimeType?: string;
    filename: string;
    blockId?: string;
  }> = [];
  for (const value of blocks) {
    const block = asRecord(value);
    const type = stringValue(block?.type);
    if (
      !block ||
      !type ||
      !(["image", "video", "audio", "file", "pdf"] as string[]).includes(type)
    ) {
      continue;
    }
    const payload = asRecord(block[type]);
    const providerFile = asRecord(payload?.file) ?? asRecord(payload?.external);
    const url = stringValue(providerFile?.url);
    if (!url) continue;
    const blockId = stringValue(block.id);
    candidates.push({
      url,
      kind:
        type === "file" || type === "pdf"
          ? "document"
          : (type as "image" | "video" | "audio"),
      mimeType: type === "pdf" ? "application/pdf" : undefined,
      filename: `${blockId ?? `notion-media-${candidates.length + 1}`}${type === "pdf" ? ".pdf" : ""}`,
      blockId,
    });
  }
  return Promise.all(
    candidates.slice(0, 50).map((candidate) =>
      rehostRemoteMedia({
        ...candidate,
        context,
        metadata: { provider: "notion", blockId: candidate.blockId },
      }),
    ),
  );
}

async function fetchNotionBlocks(
  rootId: string,
  connectionId: string | undefined,
  context: ContextConnectorExecutionContext,
  maxBlocks: number,
): Promise<{
  blocks: unknown[];
  childPages: Array<{ id: string; title?: string }>;
}> {
  const blocks: unknown[] = [];
  const childPages = new Map<string, { id: string; title?: string }>();
  const queue = [rootId];
  while (queue.length > 0 && blocks.length < maxBlocks) {
    if (context.signal?.aborted) throw context.signal.reason;
    const blockId = queue.shift()!;
    let cursor: string | undefined;
    do {
      const payload = asRecord(
        await executeConnectorProviderRequest(context.providerApi, {
          provider: "notion",
          method: "GET",
          path: `/blocks/${encodeURIComponent(blockId)}/children`,
          query: {
            page_size: Math.min(100, maxBlocks - blocks.length),
            ...(cursor ? { start_cursor: cursor } : {}),
          },
          connectionId,
        }),
      );
      const results = Array.isArray(payload?.results) ? payload.results : [];
      for (const value of results) {
        if (blocks.length >= maxBlocks) break;
        blocks.push(value);
        const block = asRecord(value);
        const id = stringValue(block?.id);
        if (id && block?.type === "child_page") {
          const child = asRecord(block.child_page);
          childPages.set(id, { id, title: stringValue(child?.title) });
        } else if (id && block?.has_children === true) {
          queue.push(id);
        }
      }
      cursor =
        payload?.has_more === true
          ? stringValue(payload.next_cursor)
          : undefined;
    } while (cursor && blocks.length < maxBlocks);
  }
  return { blocks, childPages: [...childPages.values()] };
}

function finiteNonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function notionPageTitle(page: Record<string, unknown>): string | undefined {
  const properties = asRecord(page.properties);
  if (!properties) return undefined;
  for (const value of Object.values(properties)) {
    const property = asRecord(value);
    if (property?.type !== "title" || !Array.isArray(property.title)) continue;
    const title = property.title
      .map((part) => {
        const rich = asRecord(part);
        return stringValue(rich?.plain_text);
      })
      .filter(Boolean)
      .join("")
      .trim();
    if (title) return title;
  }
  return undefined;
}

function notionPageAccess(
  page: Record<string, unknown>,
): "available" | "restricted" | "unknown" {
  if (page.archived === true || page.in_trash === true) return "restricted";
  if (stringValue(page.public_url)) return "available";
  return "unknown";
}
