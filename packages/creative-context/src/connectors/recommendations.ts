import {
  asRecord,
  connectorConnectionId,
  executeConnectorProviderRequest,
  positiveLimit,
  stringValue,
} from "./provider-response.js";
import type { ContextConnectorExecutionContext } from "./types.js";

export type ContextRootRecommendationProvider =
  | "notion"
  | "google-slides"
  | "figma";

export interface ContextRootRecommendation {
  externalId: string;
  provider: ContextRootRecommendationProvider;
  kind: "page" | "presentation" | "file";
  title: string;
  canonicalUrl?: string;
  sourceModifiedAt?: string;
  containerRef?: string;
  metadata?: Record<string, unknown>;
}

export async function recommendContextRoots(
  input: {
    provider: ContextRootRecommendationProvider;
    connectionId?: string;
    limit?: number;
    figmaProjectId?: string;
    figmaTeamId?: string;
  },
  context: ContextConnectorExecutionContext,
): Promise<{
  recommendations: ContextRootRecommendation[];
  persisted: false;
  requiresExplicitBoundary: true;
  unavailableReason?: string;
}> {
  const limit = positiveLimit(input.limit, 15, 50);
  const config = input.connectionId ? { connectionId: input.connectionId } : {};
  if (input.provider === "notion") {
    const connectionId = await connectorConnectionId(
      "notion",
      config,
      context.resolveConnection,
    );
    const payload = asRecord(
      await executeConnectorProviderRequest(context.providerApi, {
        provider: "notion",
        method: "POST",
        path: "/search",
        body: {
          filter: { property: "object", value: "page" },
          sort: { direction: "descending", timestamp: "last_edited_time" },
          page_size: limit,
        },
        connectionId,
      }),
    );
    const recommendations = (
      Array.isArray(payload?.results) ? payload.results : []
    ).flatMap((value) => {
      const page = asRecord(value);
      const id = stringValue(page?.id);
      if (!id) return [];
      return [
        {
          externalId: id,
          provider: "notion" as const,
          kind: "page" as const,
          title: page
            ? (notionRecommendationTitle(page) ?? "Notion page")
            : "Notion page",
          ...(stringValue(page?.url)
            ? { canonicalUrl: stringValue(page?.url) }
            : {}),
          ...(stringValue(page?.last_edited_time)
            ? { sourceModifiedAt: stringValue(page?.last_edited_time) }
            : {}),
          metadata: { recommendationOnly: true },
        },
      ];
    });
    return recommendationResult(recommendations.slice(0, limit));
  }

  if (input.provider === "google-slides") {
    const connectionId = await connectorConnectionId(
      "google_drive",
      config,
      context.resolveConnection,
    );
    const payload = asRecord(
      await executeConnectorProviderRequest(context.providerApi, {
        provider: "google_drive",
        method: "GET",
        path: "/files",
        query: {
          q: "mimeType = 'application/vnd.google-apps.presentation' and trashed = false",
          pageSize: limit,
          orderBy: "modifiedTime desc",
          fields:
            "files(id,name,modifiedTime,webViewLink,parents,driveId,shared,ownedByMe)",
        },
        connectionId,
      }),
    );
    const recommendations = (
      Array.isArray(payload?.files) ? payload.files : []
    ).flatMap((value) => {
      const file = asRecord(value);
      const id = stringValue(file?.id);
      if (!id) return [];
      return [
        {
          externalId: id,
          provider: "google-slides" as const,
          kind: "presentation" as const,
          title: stringValue(file?.name) ?? id,
          canonicalUrl:
            stringValue(file?.webViewLink) ??
            `https://docs.google.com/presentation/d/${encodeURIComponent(id)}/edit`,
          ...(stringValue(file?.modifiedTime)
            ? { sourceModifiedAt: stringValue(file?.modifiedTime) }
            : {}),
          ...(stringValue(file?.driveId)
            ? { containerRef: `shared-drive:${stringValue(file?.driveId)}` }
            : {}),
          metadata: {
            recommendationOnly: true,
            shared: file?.shared === true,
            ownedByMe: file?.ownedByMe === true,
            ...(Array.isArray(file?.parents) ? { parents: file.parents } : {}),
          },
        },
      ];
    });
    return recommendationResult(recommendations.slice(0, limit));
  }

  const connectionId = await connectorConnectionId(
    "figma",
    config,
    context.resolveConnection,
  );
  const projectIds = new Set<string>();
  if (input.figmaProjectId?.trim()) projectIds.add(input.figmaProjectId.trim());
  if (input.figmaTeamId?.trim()) {
    const projects = asRecord(
      await executeConnectorProviderRequest(context.providerApi, {
        provider: "figma",
        method: "GET",
        path: `/teams/${encodeURIComponent(input.figmaTeamId.trim())}/projects`,
        connectionId,
      }),
    );
    for (const value of Array.isArray(projects?.projects)
      ? projects.projects
      : []) {
      const id = stringValue(asRecord(value)?.id);
      if (id) projectIds.add(id);
    }
  }
  if (projectIds.size === 0) {
    return {
      ...recommendationResult([]),
      unavailableReason:
        "Figma has no global recent-files API. Choose a team or project before requesting file recommendations.",
    };
  }
  const recommendations: ContextRootRecommendation[] = [];
  for (const projectId of projectIds) {
    if (recommendations.length >= limit) break;
    const payload = asRecord(
      await executeConnectorProviderRequest(context.providerApi, {
        provider: "figma",
        method: "GET",
        path: `/projects/${encodeURIComponent(projectId)}/files`,
        connectionId,
      }),
    );
    for (const value of Array.isArray(payload?.files) ? payload.files : []) {
      const file = asRecord(value);
      const key = stringValue(file?.key);
      if (!key) continue;
      recommendations.push({
        externalId: key,
        provider: "figma",
        kind: "file",
        title: stringValue(file?.name) ?? key,
        canonicalUrl: `https://www.figma.com/design/${encodeURIComponent(key)}`,
        ...(stringValue(file?.last_modified)
          ? { sourceModifiedAt: stringValue(file?.last_modified) }
          : {}),
        containerRef: `project:${projectId}`,
        metadata: { recommendationOnly: true, projectId },
      });
      if (recommendations.length >= limit) break;
    }
  }
  recommendations.sort(
    (left, right) =>
      timestamp(right.sourceModifiedAt) - timestamp(left.sourceModifiedAt),
  );
  return recommendationResult(recommendations.slice(0, limit));
}

function recommendationResult(recommendations: ContextRootRecommendation[]) {
  return {
    recommendations,
    persisted: false as const,
    requiresExplicitBoundary: true as const,
  };
}

function notionRecommendationTitle(
  page: Record<string, unknown>,
): string | undefined {
  const properties = asRecord(page.properties);
  for (const value of Object.values(properties ?? {})) {
    const property = asRecord(value);
    if (!Array.isArray(property?.title)) continue;
    const title = property.title
      .map((entry) => stringValue(asRecord(entry)?.plain_text) ?? "")
      .join("")
      .trim();
    if (title) return title;
  }
  return undefined;
}

function timestamp(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
