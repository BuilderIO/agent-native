import { fetchFigmaNativeContextItems } from "./figma-native.js";
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

interface FigmaReference {
  key: string;
  title: string;
  url: string;
  sourceModifiedAt?: string;
  metadata?: Record<string, unknown>;
}

export class FigmaContextConnector implements ContextImportConnector {
  readonly kind = "figma" as const;
  readonly label = "Figma";
  readonly supportsIncremental = true;

  async inventory(
    request: ContextConnectorInventoryRequest,
    context: ContextConnectorExecutionContext,
  ): Promise<ContextConnectorInventoryPage> {
    const connectionId = await connectorConnectionId(
      "figma",
      request.config,
      context.resolveConnection,
    );
    const references = await figmaReferences(
      request.config,
      connectionId,
      context,
    );
    const offset = cursorOffset(request.cursor);
    const limit = positiveLimit(request.limit, 100, 1_000);
    const slice = references.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    return {
      items: slice.map((file) => ({
        externalId: file.key,
        kind: "figma-file",
        title: file.title,
        canonicalUrl: file.url,
        mimeType: "application/vnd.figma.file",
        ...(file.sourceModifiedAt
          ? { sourceModifiedAt: file.sourceModifiedAt }
          : {}),
        ...(file.metadata ? { metadata: file.metadata } : {}),
      })),
      nextCursor: nextOffset < references.length ? String(nextOffset) : null,
      complete: nextOffset >= references.length,
      coverage: {
        inspected: slice.length,
        returned: slice.length,
        truncated: nextOffset < references.length,
      },
    };
  }

  async fetch(
    request: ContextConnectorFetchRequest,
    context: ContextConnectorExecutionContext,
  ): Promise<ContextConnectorFetchResult> {
    const connectionId = await connectorConnectionId(
      "figma",
      request.config,
      context.resolveConnection,
    );
    const sourceUrl =
      request.item.canonicalUrl ??
      `https://www.figma.com/design/${encodeURIComponent(request.item.externalId)}`;
    const result = await fetchFigmaNativeContextItems({
      fileKey: request.item.externalId,
      sourceTitle: request.item.title,
      sourceUrl,
      sourceModifiedAt: request.item.sourceModifiedAt,
      connectionId,
      context,
    });
    return {
      items: result.items,
      ...(result.warnings.length ? { warnings: result.warnings } : {}),
    };
  }
}

async function figmaReferences(
  config: Record<string, unknown>,
  connectionId: string | undefined,
  context: ContextConnectorExecutionContext,
): Promise<FigmaReference[]> {
  const urls = stringArray(config.fileUrls);
  const keys = stringArray(config.fileKeys);
  const records = Array.isArray(config.files) ? config.files : [];
  const found = new Map<string, FigmaReference>();
  for (const key of keys) {
    found.set(key, {
      key,
      title: key,
      url: `https://www.figma.com/design/${encodeURIComponent(key)}`,
    });
  }
  for (const value of urls) {
    const key = figmaKeyFromUrl(value);
    found.set(key, { key, title: key, url: value });
  }
  for (const value of records) {
    const record = asRecord(value);
    const url = stringValue(record?.url);
    const key =
      stringValue(record?.key) ?? (url ? figmaKeyFromUrl(url) : undefined);
    if (!key) continue;
    found.set(key, {
      key,
      title: stringValue(record?.title) ?? stringValue(record?.name) ?? key,
      url: url ?? `https://www.figma.com/design/${encodeURIComponent(key)}`,
    });
  }
  const projectIds = new Set([
    ...stringArray(config.projectIds),
    ...stringArray(config.projectUrls).map((url) =>
      figmaContainerIdFromUrl(url, "project"),
    ),
  ]);
  for (const id of stringArray(config.teamIds)) {
    for (const projectId of await figmaProjectIdsForTeam(
      id,
      connectionId,
      context,
    )) {
      projectIds.add(projectId);
    }
  }
  for (const url of stringArray(config.teamUrls)) {
    const id = figmaContainerIdFromUrl(url, "team");
    for (const projectId of await figmaProjectIdsForTeam(
      id,
      connectionId,
      context,
    )) {
      projectIds.add(projectId);
    }
  }
  for (const projectId of projectIds) {
    for (const file of await figmaFilesForProject(
      projectId,
      connectionId,
      context,
    )) {
      found.set(file.key, file);
    }
  }
  if (found.size === 0) {
    throw new Error(
      "Figma connector config requires explicit file, project, or team IDs/URLs. The Figma API does not provide a global file inventory.",
    );
  }
  return [...found.values()];
}

export function figmaRecommendedFileKeys(
  config: Record<string, unknown>,
): string[] {
  return stringArray(config.recommendedFileKeys);
}

async function figmaProjectIdsForTeam(
  teamId: string,
  connectionId: string | undefined,
  context: ContextConnectorExecutionContext,
): Promise<string[]> {
  const payload = asRecord(
    await executeConnectorProviderRequest(context.providerApi, {
      provider: "figma",
      method: "GET",
      path: `/teams/${encodeURIComponent(teamId)}/projects`,
      connectionId,
    }),
  );
  return (Array.isArray(payload?.projects) ? payload.projects : []).flatMap(
    (value) => {
      const id = stringValue(asRecord(value)?.id);
      return id ? [id] : [];
    },
  );
}

async function figmaFilesForProject(
  projectId: string,
  connectionId: string | undefined,
  context: ContextConnectorExecutionContext,
): Promise<FigmaReference[]> {
  const payload = asRecord(
    await executeConnectorProviderRequest(context.providerApi, {
      provider: "figma",
      method: "GET",
      path: `/projects/${encodeURIComponent(projectId)}/files`,
      connectionId,
      maxBytes: 4 * 1024 * 1024,
    }),
  );
  return (Array.isArray(payload?.files) ? payload.files : []).flatMap(
    (value) => {
      const file = asRecord(value);
      const key = stringValue(file?.key);
      if (!key) return [];
      return [
        {
          key,
          title: stringValue(file?.name) ?? key,
          url: `https://www.figma.com/design/${encodeURIComponent(key)}`,
          sourceModifiedAt: stringValue(file?.last_modified),
          metadata: { projectId },
        },
      ];
    },
  );
}

function figmaContainerIdFromUrl(
  value: string,
  kind: "team" | "project",
): string {
  const url = new URL(value);
  if (url.hostname !== "figma.com" && !url.hostname.endsWith(".figma.com")) {
    throw new Error(`Figma ${kind} URL must use figma.com.`);
  }
  const match = url.pathname.match(new RegExp(`/files/${kind}/([^/]+)`));
  if (!match?.[1]) {
    throw new Error(`Could not find a Figma ${kind} ID in ${value}.`);
  }
  return decodeURIComponent(match[1]);
}

function figmaKeyFromUrl(value: string): string {
  const url = new URL(value);
  if (url.hostname !== "figma.com" && !url.hostname.endsWith(".figma.com")) {
    throw new Error("Figma file URL must use figma.com.");
  }
  const match = url.pathname.match(/\/(?:file|design|board)\/([^/]+)/);
  if (!match?.[1])
    throw new Error(`Could not find a Figma file key in ${value}.`);
  return decodeURIComponent(match[1]);
}
