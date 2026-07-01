import { defineAction, embedApp } from "@agent-native/core";
import {
  applyText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  mergeCanvasFramePlacements,
  parseCanvasFrameGeometryById,
  type CanvasFramePlacement,
} from "../shared/canvas-frames.js";
import {
  makeLocalhostRouteId,
  titleFromRoutePath,
  type LocalhostDesignRouteManifest,
} from "../shared/source-mode.js";

const routeInputSchema = z.object({
  routeId: z.string().optional(),
  path: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  sourceFile: z.string().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  z: z.number().optional(),
});

type LocalhostScreenInput = z.infer<typeof routeInputSchema>;

function designDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId, editorView: "overview" },
    to: `/design/${encodeURIComponent(designId)}`,
  });
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function withLocalhostProtocol(value: string): string {
  const raw = value.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (
    /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|::1)(?::\d+)?(?:[/?#]|$)/i.test(
      raw,
    )
  ) {
    return `http://${raw}`;
  }
  return raw;
}

export function routeUrl(
  baseUrl: string,
  route: { path?: string; url?: string },
) {
  const raw = route.url ?? route.path ?? "/";
  let parsed: URL;
  try {
    parsed = new URL(withLocalhostProtocol(raw), `${baseUrl}/`);
  } catch {
    throw new Error(
      `Invalid localhost screen URL "${raw}". Use a path like /pricing or an http(s) localhost URL.`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Localhost screen URL must be an http(s) URL: ${raw}`);
  }
  parsed.hash = "";
  return parsed.toString();
}

export function pathFromUrl(baseUrl: string, url: string, fallback?: string) {
  try {
    const parsed = new URL(url);
    const base = new URL(baseUrl);
    if (parsed.origin === base.origin) {
      return `${parsed.pathname}${parsed.search}` || "/";
    }
  } catch {
    // Fall through to the provided fallback.
  }
  return fallback ?? "/";
}

export function slugForPath(pathOrUrl: string) {
  const parsed = (() => {
    try {
      const url = new URL(withLocalhostProtocol(pathOrUrl));
      return url.pathname + url.search;
    } catch {
      return pathOrUrl;
    }
  })();
  const slug = parsed
    .replace(/^\/+/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return (slug || "home").slice(0, 80);
}

function uniqueFilename(
  pathOrUrl: string,
  used: Set<string>,
  preferred?: string,
) {
  const base = preferred ?? `localhost-${slugForPath(pathOrUrl)}.html`;
  const [stem, extension = "html"] = base.split(/\.(?=[^.]+$)/);
  let filename = `${stem}.${extension}`;
  let suffix = 2;
  while (used.has(filename)) {
    filename = `${stem}-${suffix}.${extension}`;
    suffix += 1;
  }
  used.add(filename);
  return filename;
}

export function viewportFilename(
  pathOrUrl: string,
  width: number,
  height: number,
) {
  const viewport = `${Math.round(width)}x${Math.round(height)}`;
  return `localhost-${slugForPath(pathOrUrl)}-${viewport}.html`;
}

function metadataNumber(
  metadata: Record<string, unknown> | undefined,
  key: "width" | "height",
) {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export default defineAction({
  description:
    "Create or refresh URL-backed localhost screens in a design project. " +
    "Use after connect-localhost to place local app routes on the overview " +
    "canvas as iframe-backed artboards with editable URL metadata.",
  schema: z.object({
    designId: z.string().describe("Design project ID to add screens to."),
    connectionId: z
      .string()
      .optional()
      .describe(
        "Localhost connection ID from connect-localhost. Omit to use the latest connection.",
      ),
    routes: z
      .preprocess(
        (value) => (typeof value === "string" ? JSON.parse(value) : value),
        z.array(routeInputSchema).optional(),
      )
      .describe(
        "Routes or URL states to place. Each may include path, url, title, width, height, x/y/z.",
      ),
    paths: z
      .preprocess(
        (value) => (typeof value === "string" ? JSON.parse(value) : value),
        z.array(z.string()).optional(),
      )
      .describe("Shortcut for routes when only paths/URLs are needed."),
    defaultWidth: z
      .number()
      .positive()
      .optional()
      .describe("Default iframe viewport width. Defaults to 1280."),
    defaultHeight: z
      .number()
      .positive()
      .optional()
      .describe("Default iframe viewport height. Defaults to 900."),
    startX: z.number().optional().default(0),
    startY: z.number().optional().default(0),
    gap: z.number().optional().default(160),
  }),
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Local visual edit",
      description: "Open local URL-backed screens in Design overview mode.",
      iframeTitle: "Agent-Native Design",
      openLabel: "Open overview",
      height: 680,
    }),
  },
  run: async ({
    designId,
    connectionId,
    routes,
    paths,
    defaultWidth,
    defaultHeight,
    startX,
    startY,
    gap,
  }) => {
    await assertAccess("design", designId, "editor");
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() ?? null;
    const db = getDb();

    const connectionClauses = [
      eq(schema.designLocalhostConnections.ownerEmail, ownerEmail),
      orgId
        ? eq(schema.designLocalhostConnections.orgId, orgId)
        : isNull(schema.designLocalhostConnections.orgId),
    ];
    if (connectionId) {
      connectionClauses.push(
        eq(schema.designLocalhostConnections.id, connectionId),
      );
    }

    const [connection] = await db
      .select()
      .from(schema.designLocalhostConnections)
      .where(and(...connectionClauses))
      .orderBy(desc(schema.designLocalhostConnections.updatedAt))
      .limit(1);

    if (!connection) {
      throw new Error(
        connectionId
          ? `No localhost connection found for ${connectionId}.`
          : "No localhost connection found. Run connect-localhost first.",
      );
    }

    const devServerUrl = normalizeBaseUrl(connection.devServerUrl);
    const manifest = parseJson<LocalhostDesignRouteManifest>(
      connection.routeManifest,
      {
        version: 1,
        sourceType: "localhost",
        devServerUrl,
        rootPath: connection.rootPath ?? undefined,
        routes: [],
        generatedAt: connection.updatedAt ?? new Date(0).toISOString(),
      },
    );
    const manifestByPath = new Map(
      manifest.routes.map((route) => [route.path, route]),
    );
    const manifestById = new Map(
      manifest.routes.map((route) => [route.id, route]),
    );
    const requestedRoutes: LocalhostScreenInput[] = routes?.length
      ? routes
      : paths?.length
        ? paths.map((path) => ({ path }))
        : manifest.routes.map((route) => ({
            routeId: route.id,
            path: route.path,
            title: route.title,
            width:
              typeof route.metadata?.width === "number"
                ? route.metadata.width
                : undefined,
            height:
              typeof route.metadata?.height === "number"
                ? route.metadata.height
                : undefined,
          }));

    if (requestedRoutes.length === 0) {
      throw new Error(
        "No routes were provided and the localhost manifest has no routes.",
      );
    }

    const [design] = await db
      .select({ data: schema.designs.data })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId))
      .limit(1);
    const prevData = parseJson<Record<string, unknown>>(design?.data, {});
    const existingCanvasFrames = parseCanvasFrameGeometryById(
      prevData.canvasFrames,
    );
    const existingMetadata = isRecord(prevData.screenMetadata)
      ? (prevData.screenMetadata as Record<string, unknown>)
      : {};
    const existingFiles = await db
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.designId, designId));
    const existingByFilename = new Map(
      existingFiles.map((file) => [file.filename, file]),
    );
    const usedFilenames = new Set(existingFiles.map((file) => file.filename));
    const now = new Date().toISOString();
    const effectiveDefaultWidth = defaultWidth ?? 1280;
    const effectiveDefaultHeight = defaultHeight ?? 900;
    const savedScreens: Array<{
      id: string;
      filename: string;
      title: string;
      path: string;
      url: string;
      routeId: string;
      sourceFile?: string;
      width: number;
      height: number;
    }> = [];
    const placements: CanvasFramePlacement[] = [];

    for (let index = 0; index < requestedRoutes.length; index += 1) {
      const input = requestedRoutes[index]!;
      const manifestRoute =
        (input.routeId ? manifestById.get(input.routeId) : undefined) ??
        (input.path ? manifestByPath.get(input.path) : undefined);
      const url = routeUrl(devServerUrl, {
        path: input.path ?? manifestRoute?.path,
        url: input.url,
      });
      const path = pathFromUrl(
        devServerUrl,
        url,
        input.path ?? manifestRoute?.path ?? "/",
      );
      const routeId =
        input.routeId ?? manifestRoute?.id ?? makeLocalhostRouteId(path);
      const title =
        input.title ?? manifestRoute?.title ?? titleFromRoutePath(path);
      const sourceFile = input.sourceFile ?? manifestRoute?.sourceFile;
      const width = input.width ?? effectiveDefaultWidth;
      const height = input.height ?? effectiveDefaultHeight;
      const basePreferredFilename = `localhost-${slugForPath(path)}.html`;
      const existingBase = existingByFilename.get(basePreferredFilename);
      const requestedViewportExplicitly =
        input.width !== undefined ||
        input.height !== undefined ||
        defaultWidth !== undefined ||
        defaultHeight !== undefined;
      const existingBaseMetadata = isRecord(
        existingBase ? existingMetadata[existingBase.id] : undefined,
      )
        ? (existingMetadata[existingBase!.id] as Record<string, unknown>)
        : undefined;
      const existingBaseFrame = existingBase
        ? existingCanvasFrames[existingBase.id]
        : undefined;
      const existingBaseWidth =
        existingBaseFrame?.width ??
        metadataNumber(existingBaseMetadata, "width");
      const existingBaseHeight =
        existingBaseFrame?.height ??
        metadataNumber(existingBaseMetadata, "height");
      const viewportDiffersFromBase =
        (typeof existingBaseWidth === "number" &&
          existingBaseWidth !== width) ||
        (typeof existingBaseHeight === "number" &&
          existingBaseHeight !== height);
      const preferredFilename =
        existingBase && requestedViewportExplicitly && viewportDiffersFromBase
          ? viewportFilename(path, width, height)
          : basePreferredFilename;
      const existing = existingByFilename.get(preferredFilename);
      const filename =
        existing?.filename ??
        uniqueFilename(path, usedFilenames, preferredFilename);
      const fileId = existing?.id ?? nanoid();

      if (existing) {
        await db
          .update(schema.designFiles)
          .set({ content: url, fileType: "html", updatedAt: now })
          .where(eq(schema.designFiles.id, existing.id));
        if (await hasCollabState(existing.id)) {
          await applyText(existing.id, url, "content", "agent");
        } else {
          await seedFromText(existing.id, url);
        }
      } else {
        await db.insert(schema.designFiles).values({
          id: fileId,
          designId,
          filename,
          fileType: "html",
          content: url,
          createdAt: now,
          updatedAt: now,
        });
        await seedFromText(fileId, url);
      }

      savedScreens.push({
        id: fileId,
        filename,
        title,
        path,
        url,
        routeId,
        sourceFile,
        width,
        height,
      });
      placements.push({
        fileId,
        filename,
        x: input.x ?? startX + index * (width + gap),
        y: input.y ?? startY,
        width,
        height,
        z: input.z ?? index,
      });
    }

    const mergedFrames = mergeCanvasFramePlacements({
      existing: prevData.canvasFrames,
      placements,
      resolveFileId: (placement) => placement.fileId,
    });
    const previousMetadata = isRecord(prevData.screenMetadata)
      ? { ...prevData.screenMetadata }
      : {};
    const previousLocalhostScreens = isRecord(prevData.localhostScreens)
      ? { ...prevData.localhostScreens }
      : {};
    for (const screen of savedScreens) {
      const metadata = {
        sourceType: "localhost",
        previewState: "live",
        title: screen.title,
        width: screen.width,
        height: screen.height,
        url: screen.url,
        previewUrl: screen.url,
        connectionId: connection.id,
        routeId: screen.routeId,
        sourceFile: screen.sourceFile,
        path: screen.path,
        bridgeUrl: connection.bridgeUrl ?? undefined,
      };
      previousMetadata[screen.id] = metadata;
      previousLocalhostScreens[screen.id] = metadata;
    }

    await db
      .update(schema.designs)
      .set({
        data: JSON.stringify({
          ...prevData,
          sourceMode: "localhost",
          canvasFrames: mergedFrames.canvasFrames,
          screenMetadata: previousMetadata,
          localhostScreens: previousLocalhostScreens,
          updatedAt: now,
        }),
        updatedAt: now,
      })
      .where(eq(schema.designs.id, designId));

    return {
      designId,
      connectionId: connection.id,
      devServerUrl,
      bridgeUrl: connection.bridgeUrl ?? null,
      screenCount: savedScreens.length,
      screens: savedScreens,
      placedFrames: mergedFrames.placedFrames,
      overview: true,
      urlPath: `/design/${designId}`,
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const designId = (result as { designId?: string }).designId;
    if (!designId) return null;
    return {
      url: designDeepLink(designId),
      label: "Open overview",
      view: "editor",
    };
  },
});
