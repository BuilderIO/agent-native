import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  mutateDesignData,
  type DesignDataRecord,
} from "../server/lib/design-data-mutation.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  localhostBridgeRequestError,
  resolveLocalhostConnectionScope,
} from "../server/lib/localhost-connection.js";
import { writeInlineSourceFile } from "../server/source-workspace.js";
import { sanitizeMarkup } from "../shared/capture-sanitize.js";
import { isStandaloneHttpUrl } from "../shared/html-content.js";
import { designConnectionIdFromData } from "../shared/source-mode.js";
import { pathFromUrl, routeUrl } from "./add-localhost-screens.js";

const MAX_SNAPSHOT_CHARS = 2_000_000;

type ScreenSourceType = "static" | "url";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseDesignData(value: string | null): DesignDataRecord {
  if (!value) return {};
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) throw new Error("Design data must be an object.");
  return parsed;
}

function metadataForFile(
  data: DesignDataRecord,
  fileId: string,
): Record<string, unknown> {
  const canonical = isRecord(data.screenMetadata)
    ? data.screenMetadata[fileId]
    : undefined;
  if (isRecord(canonical)) return canonical;
  const legacy = isRecord(data.localhostScreens)
    ? data.localhostScreens[fileId]
    : undefined;
  return isRecord(legacy) ? legacy : {};
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("The localhost connection URL must use http(s).");
  }
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function sameLoopbackOrigin(left: string, right: string): boolean {
  const a = new URL(left);
  const b = new URL(right);
  return (
    a.protocol === b.protocol &&
    a.port === b.port &&
    isLoopbackHostname(a.hostname) &&
    isLoopbackHostname(b.hostname)
  );
}

function sourceMetadataForUrl(args: {
  current: Record<string, unknown>;
  url: string;
  path: string;
  connectionId: string;
  bridgeUrl: string | null;
  previewToken: string | null;
}): Record<string, unknown> {
  return {
    ...args.current,
    sourceType: "localhost",
    previewState: "live",
    url: args.url,
    previewUrl: args.url,
    path: args.path,
    connectionId: args.connectionId,
    bridgeUrl: args.bridgeUrl ?? undefined,
    previewToken: args.previewToken ?? undefined,
  };
}

export function screenSourceMetadataForStatic(
  current: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...current,
    sourceType: "inline",
    previewState: "static",
  };
  for (const key of [
    "url",
    "previewUrl",
    "path",
    "connectionId",
    "routeId",
    "bridgeUrl",
    "previewToken",
    "sourceFile",
    "sourceKind",
    "screenshotUrl",
  ]) {
    delete next[key];
  }
  return next;
}

async function fetchFallbackSnapshot(args: {
  bridgeUrl: string;
  previewToken: string | null;
  url: string;
}): Promise<string> {
  if (!args.previewToken) {
    throw new Error(
      "This URL-backed screen has no preview token. Reload the frame or reconnect the localhost app before switching it to static HTML.",
    );
  }
  const endpoint = new URL("/snapshot", args.bridgeUrl);
  endpoint.searchParams.set("url", args.url);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: {
        accept: "application/json",
        "x-design-preview-token": args.previewToken,
      },
    });
  } catch (error) {
    throw new Error(
      `Could not reach the localhost bridge for snapshot (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw localhostBridgeRequestError("snapshot", response.status, errorText);
  }
  let payload: { html?: unknown } | null;
  try {
    payload = (await response.json()) as { html?: unknown } | null;
  } catch {
    throw new Error("The localhost bridge returned invalid snapshot JSON.");
  }
  if (!payload || typeof payload.html !== "string") {
    throw new Error("The localhost bridge returned no HTML snapshot.");
  }
  return payload.html;
}

export default defineAction({
  description:
    "Change one Design screen between static HTML and a live localhost URL. " +
    "URL mode keeps the running app and editable route metadata. Static mode " +
    "stores the current sanitized DOM snapshot in the screen file. Use the " +
    "optional snapshotHtml from the visual-edit page when switching a live " +
    "frame so current client state is preserved.",
  schema: z
    .object({
      designId: z.string().describe("Design project ID."),
      fileId: z.string().describe("Screen file ID to update."),
      sourceType: z
        .enum(["static", "url"])
        .describe("Use static for HTML or url for a live localhost route."),
      url: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Absolute localhost URL or path, such as /plans."),
      path: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe("Route path alternative to url."),
      connectionId: z
        .string()
        .optional()
        .describe("Localhost connection to use when sourceType is url."),
      snapshotHtml: z
        .string()
        .max(MAX_SNAPSHOT_CHARS)
        .optional()
        .describe(
          "Current sanitized DOM snapshot from the visual-edit iframe. " +
            "The page supplies this when switching URL mode to static.",
        ),
    })
    .superRefine((value, context) => {
      if (value.sourceType === "url" && !value.url && !value.path) {
        context.addIssue({
          code: "custom",
          path: ["url"],
          message: "URL mode requires url or path.",
        });
      }
    }),
  capabilityScopes: ["visual-edit"],
  run: async (
    {
      designId,
      fileId,
      sourceType,
      url: requestedUrl,
      path: requestedPath,
      connectionId: requestedConnectionId,
      snapshotHtml,
    },
    context,
  ) => {
    await assertAccess("design", designId, "editor");
    await snapshotDesignBeforeAgentEdit(designId, context);
    const db = getDb();
    const [file] = await db
      .select()
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.id, fileId),
          eq(schema.designFiles.designId, designId),
        ),
      )
      .limit(1);
    if (!file) throw new Error(`Screen not found: ${fileId}`);
    if (file.fileType !== "html") {
      throw new Error(
        "Only HTML screens can switch between static and URL mode.",
      );
    }

    const [design] = await db
      .select({ data: schema.designs.data })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId))
      .limit(1);
    if (!design) throw new Error(`Design not found: ${designId}`);
    const currentData = parseDesignData(design.data);
    const currentMetadata = metadataForFile(currentData, fileId);
    const currentUrl = [
      currentMetadata.url,
      currentMetadata.previewUrl,
      file.content,
    ].find(
      (value): value is string =>
        typeof value === "string" && isStandaloneHttpUrl(value),
    );

    let nextContent = file.content;
    let nextMetadata: Record<string, unknown>;
    let resultConnectionId: string | null = null;
    let fileUpdatedAt = file.updatedAt;

    if (sourceType === "url") {
      const { ownerEmail, orgId } = await resolveLocalhostConnectionScope({
        designId,
      });
      const connectionId =
        requestedConnectionId ??
        (typeof currentMetadata.connectionId === "string"
          ? currentMetadata.connectionId
          : designConnectionIdFromData(currentData));
      const connectionQuery = db
        .select()
        .from(schema.designLocalhostConnections)
        .where(
          and(
            eq(schema.designLocalhostConnections.ownerEmail, ownerEmail),
            orgId
              ? eq(schema.designLocalhostConnections.orgId, orgId)
              : isNull(schema.designLocalhostConnections.orgId),
            ...(connectionId
              ? [eq(schema.designLocalhostConnections.id, connectionId)]
              : []),
          ),
        )
        .orderBy(desc(schema.designLocalhostConnections.updatedAt))
        .limit(1);
      const [connection] = await connectionQuery;
      if (!connection) {
        throw new Error(
          "No localhost connection found. Connect the local app first, then retry.",
        );
      }
      const baseUrl = normalizeBaseUrl(connection.devServerUrl);
      const nextUrl = routeUrl(baseUrl, {
        url: requestedUrl ?? requestedPath,
      });
      if (
        new URL(nextUrl).origin !== new URL(baseUrl).origin &&
        !sameLoopbackOrigin(nextUrl, baseUrl)
      ) {
        throw new Error(
          `Screen URL must stay on localhost connection ${connection.id} (${connection.devServerUrl}).`,
        );
      }
      const nextPath = pathFromUrl(baseUrl, nextUrl, requestedPath ?? "/");
      nextContent = nextUrl;
      nextMetadata = sourceMetadataForUrl({
        current: currentMetadata,
        url: nextUrl,
        path: nextPath,
        connectionId: connection.id,
        bridgeUrl: connection.bridgeUrl,
        previewToken: connection.previewToken,
      });
      resultConnectionId = connection.id;
    } else {
      if (currentUrl) {
        const { ownerEmail, orgId } = await resolveLocalhostConnectionScope({
          designId,
        });
        const connectionId =
          typeof currentMetadata.connectionId === "string"
            ? currentMetadata.connectionId
            : designConnectionIdFromData(currentData);
        if (!connectionId) {
          throw new Error(
            "This URL-backed screen has no connection metadata. Reload the visual-edit frame before switching it to static HTML.",
          );
        }
        const [connection] = await db
          .select({
            bridgeUrl: schema.designLocalhostConnections.bridgeUrl,
            previewToken: schema.designLocalhostConnections.previewToken,
          })
          .from(schema.designLocalhostConnections)
          .where(
            and(
              eq(schema.designLocalhostConnections.id, connectionId),
              eq(schema.designLocalhostConnections.ownerEmail, ownerEmail),
              orgId
                ? eq(schema.designLocalhostConnections.orgId, orgId)
                : isNull(schema.designLocalhostConnections.orgId),
            ),
          )
          .limit(1);
        if (!connection?.bridgeUrl) {
          throw new Error(
            "The localhost bridge is not running for this screen.",
          );
        }
        const rawSnapshot =
          snapshotHtml ??
          (await fetchFallbackSnapshot({
            bridgeUrl: connection.bridgeUrl,
            previewToken: connection.previewToken,
            url: currentUrl,
          }));
        nextContent = sanitizeMarkup(rawSnapshot).trim();
        if (!nextContent) {
          throw new Error(
            "The localhost bridge returned an empty HTML snapshot.",
          );
        }
      }
      nextMetadata = screenSourceMetadataForStatic(currentMetadata);
    }

    if (nextContent.length > MAX_SNAPSHOT_CHARS) {
      throw new Error("The screen HTML snapshot is too large to save.");
    }

    if (nextContent !== file.content) {
      const writeResult = await writeInlineSourceFile({
        designId,
        file: {
          id: file.id,
          designId: file.designId,
          filename: file.filename,
          fileType: file.fileType,
          content: file.content,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
        },
        content: nextContent,
        allowUrlBackedTransition: true,
      });
      fileUpdatedAt = writeResult.updatedAt;
    }

    const persisted = await mutateDesignData({
      designId,
      mutate: (current) => {
        const screenMetadata = isRecord(current.screenMetadata)
          ? { ...current.screenMetadata }
          : {};
        const localhostScreens = isRecord(current.localhostScreens)
          ? { ...current.localhostScreens }
          : {};
        screenMetadata[fileId] = nextMetadata;
        localhostScreens[fileId] = nextMetadata;
        return { ...current, screenMetadata, localhostScreens };
      },
      isApplied: (current) => {
        const matches = (value: unknown) =>
          isRecord(value) &&
          value.sourceType === nextMetadata.sourceType &&
          value.url === nextMetadata.url &&
          value.path === nextMetadata.path &&
          value.connectionId === nextMetadata.connectionId;
        return (
          isRecord(current.screenMetadata) &&
          isRecord(current.localhostScreens) &&
          matches(current.screenMetadata[fileId]) &&
          matches(current.localhostScreens[fileId])
        );
      },
    });

    return {
      designId,
      fileId,
      sourceType: sourceType as ScreenSourceType,
      url: sourceType === "url" ? (nextMetadata.url as string) : null,
      path: sourceType === "url" ? (nextMetadata.path as string) : null,
      connectionId: resultConnectionId,
      content: nextContent,
      metadata: nextMetadata,
      updatedAt: fileUpdatedAt ?? persisted.updatedAt,
      contentChanged: nextContent !== file.content,
      dataUpdatedAt: persisted.updatedAt,
    };
  },
});
