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
  mutateDesignData,
  type DesignDataRecord,
} from "../server/lib/design-data-mutation.js";
import {
  mergeCanvasFramePlacements,
  parseCanvasFrameGeometryById,
  type CanvasFrameGeometry,
  type CanvasFramePlacement,
} from "../shared/canvas-frames.js";
import { isUniqueConstraintViolation } from "../shared/db-conflict.js";
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
  sourceKind: z.enum(["react-router", "html", "manual"]).optional(),
  screenshotUrl: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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

function parseDesignDataSnapshot(
  designId: string,
  value: string | null,
): DesignDataRecord {
  if (value === null) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (isRecord(parsed)) return parsed;
  } catch {
    // The error below deliberately refuses to discard malformed legacy data.
  }
  throw new Error(
    `Design "${designId}" has invalid data JSON. Refusing to overwrite it; repair or restore the design data before retrying.`,
  );
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

interface PlacementIntent {
  fileId: string;
  filename: string;
  fallback: CanvasFramePlacement;
  existedAtStart: boolean;
  owns: {
    x: boolean;
    y: boolean;
    width: boolean;
    height: boolean;
    z: boolean;
  };
}

function placementAgainstLatest(
  intent: PlacementIntent,
  latest: CanvasFrameGeometry | undefined,
): CanvasFramePlacement {
  const choose = (key: keyof PlacementIntent["owns"]): number | undefined =>
    intent.owns[key]
      ? intent.fallback[key]
      : (latest?.[key] ?? intent.fallback[key]);

  return {
    fileId: intent.fileId,
    filename: intent.filename,
    x: choose("x"),
    y: choose("y"),
    width: choose("width"),
    height: choose("height"),
    z: choose("z"),
    // add-localhost-screens never owns rotation. A concurrent/local canvas
    // rotation therefore survives even when this action refreshes the route.
    rotation: latest?.rotation,
  };
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("devServerUrl must be an http(s) URL");
  }
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0.0.0.0"
  ) {
    return true;
  }
  return /^127(?:\.\d{1,3}){3}$/.test(normalized);
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
  const base = new URL(baseUrl);
  if (parsed.origin !== base.origin) {
    const equivalentLoopbackOrigin =
      parsed.protocol === base.protocol &&
      parsed.port === base.port &&
      isLoopbackHostname(parsed.hostname) &&
      isLoopbackHostname(base.hostname);
    if (!equivalentLoopbackOrigin) {
      throw new Error(
        `Localhost screen URL must stay on the connected dev server origin (${base.origin}): ${raw}`,
      );
    }
    // localhost / 127.0.0.1 / ::1 aliases can point at the same loopback
    // server, but the bridge enforces exact same-origin fetches. Canonicalize
    // the alias to the registered dev-server origin so live edit does not fail
    // later with an opaque bridge 400.
    parsed.protocol = base.protocol;
    parsed.host = base.host;
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

function metadataForFile(
  fileId: string,
  screenMetadata: Record<string, unknown>,
  localhostScreens: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const primary = screenMetadata[fileId];
  if (isRecord(primary)) return primary;
  const legacy = localhostScreens[fileId];
  return isRecord(legacy) ? legacy : undefined;
}

function metadataMatchesRoute(
  metadata: Record<string, unknown> | undefined,
  args: { connectionId: string; routeId: string; path: string; url: string },
): boolean {
  if (!metadata || metadata.sourceType !== "localhost") return false;
  if (
    typeof metadata.connectionId === "string" &&
    metadata.connectionId !== args.connectionId
  ) {
    return false;
  }
  return (
    metadata.routeId === args.routeId ||
    metadata.url === args.url ||
    metadata.previewUrl === args.url ||
    metadata.path === args.path
  );
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
            sourceFile: route.sourceFile,
            sourceKind: route.sourceKind,
            screenshotUrl: route.screenshotUrl,
            metadata: route.metadata,
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
    if (!design) throw new Error(`Design "${designId}" not found.`);
    // Fail before touching files/collab when a legacy row contains malformed
    // data. SQL NULL is the one supported legacy empty-data sentinel.
    const prevData = parseDesignDataSnapshot(designId, design.data);
    const existingCanvasFrames = parseCanvasFrameGeometryById(
      prevData.canvasFrames,
    );
    const existingMetadata = isRecord(prevData.screenMetadata)
      ? (prevData.screenMetadata as Record<string, unknown>)
      : {};
    const existingLocalhostScreens = isRecord(prevData.localhostScreens)
      ? (prevData.localhostScreens as Record<string, unknown>)
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
    const layoutStartX = startX ?? 0;
    const layoutStartY = startY ?? 0;
    const layoutGap = gap ?? 160;
    const savedScreens: Array<{
      id: string;
      filename: string;
      title: string;
      path: string;
      url: string;
      routeId: string;
      sourceFile?: string;
      sourceKind?: "react-router" | "html" | "manual";
      screenshotUrl?: string;
      routeMetadata?: Record<string, unknown>;
      width: number;
      height: number;
    }> = [];
    const placementIntents: PlacementIntent[] = [];
    // Duplicate-route guard: `existingFiles`/`existingByFilename`/the
    // route-candidate lookups below are all snapshotted ONCE above the loop
    // and never refreshed as new files are inserted mid-loop, so two entries
    // in the SAME `requestedRoutes` call that resolve to the same route
    // (repeated `paths`, or a `routeId` and a `path` naming the same route)
    // each independently see "no existing match" and each insert a fresh
    // `design_files` row — two overlapping screens for one route. Track
    // routeIds already processed THIS call (keyed with width/height so an
    // intentional multi-viewport request for the same route still creates
    // its distinct variants) and skip later duplicates outright.
    const seenRouteRequestKeys = new Set<string>();
    let placementIndex = 0;

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
      const routeRequestKey = `${routeId}::${input.width ?? ""}x${input.height ?? ""}`;
      if (seenRouteRequestKeys.has(routeRequestKey)) continue;
      seenRouteRequestKeys.add(routeRequestKey);
      const title =
        input.title ?? manifestRoute?.title ?? titleFromRoutePath(path);
      const sourceFile = input.sourceFile ?? manifestRoute?.sourceFile;
      const sourceKind = input.sourceKind ?? manifestRoute?.sourceKind;
      const screenshotUrl = input.screenshotUrl ?? manifestRoute?.screenshotUrl;
      const routeMetadata = {
        ...(manifestRoute?.metadata ?? {}),
        ...(input.metadata ?? {}),
      };
      const basePreferredFilename = `localhost-${slugForPath(path)}.html`;
      const routeMatchArgs = {
        connectionId: connection.id,
        routeId,
        path,
        url,
      };
      const routeCandidates = existingFiles.filter((file) =>
        metadataMatchesRoute(
          metadataForFile(file.id, existingMetadata, existingLocalhostScreens),
          routeMatchArgs,
        ),
      );
      const filenameBase = existingByFilename.get(basePreferredFilename);
      const existingBase =
        filenameBase &&
        metadataMatchesRoute(
          metadataForFile(
            filenameBase.id,
            existingMetadata,
            existingLocalhostScreens,
          ),
          routeMatchArgs,
        )
          ? filenameBase
          : routeCandidates.find(
              (candidate) => candidate.filename === basePreferredFilename,
            );
      const requestedViewportExplicitly =
        input.width !== undefined ||
        input.height !== undefined ||
        defaultWidth !== undefined ||
        defaultHeight !== undefined;
      const existingBaseMetadata = existingBase
        ? metadataForFile(
            existingBase.id,
            existingMetadata,
            existingLocalhostScreens,
          )
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
      const requestedWidth =
        input.width ??
        defaultWidth ??
        existingBaseWidth ??
        metadataNumber(routeMetadata, "width") ??
        1280;
      const requestedHeight =
        input.height ??
        defaultHeight ??
        existingBaseHeight ??
        metadataNumber(routeMetadata, "height") ??
        900;
      const viewportDiffersFromBase =
        (typeof existingBaseWidth === "number" &&
          existingBaseWidth !== requestedWidth) ||
        (typeof existingBaseHeight === "number" &&
          existingBaseHeight !== requestedHeight);
      const preferredFilename =
        existingBase && requestedViewportExplicitly && viewportDiffersFromBase
          ? viewportFilename(path, requestedWidth, requestedHeight)
          : basePreferredFilename;
      const preferredExisting = existingByFilename.get(preferredFilename);
      const matchingPreferredExisting =
        preferredExisting &&
        metadataMatchesRoute(
          metadataForFile(
            preferredExisting.id,
            existingMetadata,
            existingLocalhostScreens,
          ),
          routeMatchArgs,
        )
          ? preferredExisting
          : undefined;
      const existing =
        matchingPreferredExisting ??
        routeCandidates.find((candidate) => {
          const frame = existingCanvasFrames[candidate.id];
          const metadata = metadataForFile(
            candidate.id,
            existingMetadata,
            existingLocalhostScreens,
          );
          const candidateWidth =
            frame?.width ?? metadataNumber(metadata, "width");
          const candidateHeight =
            frame?.height ?? metadataNumber(metadata, "height");
          return requestedViewportExplicitly
            ? candidateWidth === requestedWidth &&
                candidateHeight === requestedHeight
            : candidate === existingBase;
        }) ??
        (!requestedViewportExplicitly ? routeCandidates[0] : undefined);
      const filename =
        existing?.filename ??
        uniqueFilename(path, usedFilenames, preferredFilename);
      // Reassigned below if a concurrent request wins the insert race for
      // this exact (designId, filename) pair — see the `else` branch.
      let fileId = existing?.id ?? nanoid();
      const existingScreenMetadata = existing
        ? metadataForFile(
            existing.id,
            existingMetadata,
            existingLocalhostScreens,
          )
        : undefined;
      const existingFrame = existing
        ? existingCanvasFrames[existing.id]
        : undefined;
      const width =
        input.width ??
        defaultWidth ??
        existingFrame?.width ??
        metadataNumber(existingScreenMetadata, "width") ??
        metadataNumber(routeMetadata, "width") ??
        1280;
      const height =
        input.height ??
        defaultHeight ??
        existingFrame?.height ??
        metadataNumber(existingScreenMetadata, "height") ??
        metadataNumber(routeMetadata, "height") ??
        900;

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
        try {
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
        } catch (err) {
          if (!isUniqueConstraintViolation(err)) throw err;
          // Cross-request race: this snapshot's `existingFiles` query ran
          // before a concurrent add-localhost-screens call (for the same
          // route) committed its own insert, so both requests independently
          // computed the same deterministic filename and both tried to
          // create it. The `design_files_design_filename_unique_idx` unique
          // index (see server/plugins/db.ts) turns the loser's insert into
          // this error instead of a silent duplicate screen. Recover by
          // adopting whichever row actually won the race and updating its
          // content, the same way the `existing` branch above does.
          const [winner] = await db
            .select()
            .from(schema.designFiles)
            .where(
              and(
                eq(schema.designFiles.designId, designId),
                eq(schema.designFiles.filename, filename),
              ),
            )
            .limit(1);
          if (!winner) throw err;
          fileId = winner.id;
          await db
            .update(schema.designFiles)
            .set({ content: url, fileType: "html", updatedAt: now })
            .where(eq(schema.designFiles.id, winner.id));
          if (await hasCollabState(winner.id)) {
            await applyText(winner.id, url, "content", "agent");
          } else {
            await seedFromText(winner.id, url);
          }
        }
      }

      savedScreens.push({
        id: fileId,
        filename,
        title,
        path,
        url,
        routeId,
        sourceFile,
        sourceKind,
        screenshotUrl,
        routeMetadata,
        width,
        height,
      });
      const fallbackPlacement: CanvasFramePlacement = {
        fileId,
        filename,
        x:
          input.x ??
          existingFrame?.x ??
          layoutStartX + placementIndex * (width + layoutGap),
        y: input.y ?? existingFrame?.y ?? layoutStartY,
        width,
        height,
        z: input.z ?? existingFrame?.z ?? placementIndex,
      };
      placementIndex += 1;
      placementIntents.push({
        fileId,
        filename,
        fallback: fallbackPlacement,
        existedAtStart: Boolean(existingFrame),
        owns: {
          x: input.x !== undefined,
          y: input.y !== undefined,
          width: input.width !== undefined || defaultWidth !== undefined,
          height: input.height !== undefined || defaultHeight !== undefined,
          z: input.z !== undefined,
        },
      });
    }

    let lastOwnedMetadata = new Map<string, Record<string, unknown>>();
    let lastOwnedFrameFields = new Map<string, Partial<CanvasFrameGeometry>>();

    const { data: persistedData } = await mutateDesignData({
      designId,
      mutate: (currentData, { updatedAt }) => {
        const latestFrames = parseCanvasFrameGeometryById(
          currentData.canvasFrames,
        );
        const placements = placementIntents.map((intent) =>
          placementAgainstLatest(intent, latestFrames[intent.fileId]),
        );
        const mergedFrames = mergeCanvasFramePlacements({
          existing: currentData.canvasFrames,
          placements,
          resolveFileId: (placement) => placement.fileId,
        });
        const previousMetadata = isRecord(currentData.screenMetadata)
          ? { ...currentData.screenMetadata }
          : {};
        const previousLocalhostScreens = isRecord(currentData.localhostScreens)
          ? { ...currentData.localhostScreens }
          : {};
        const nextOwnedMetadata = new Map<string, Record<string, unknown>>();
        const nextOwnedFrameFields = new Map<
          string,
          Partial<CanvasFrameGeometry>
        >();

        for (const screen of savedScreens) {
          const currentMetadata = isRecord(previousMetadata[screen.id])
            ? (previousMetadata[screen.id] as Record<string, unknown>)
            : {};
          const currentLocalhostMetadata = isRecord(
            previousLocalhostScreens[screen.id],
          )
            ? (previousLocalhostScreens[screen.id] as Record<string, unknown>)
            : {};
          const frame = mergedFrames.canvasFrames[screen.id] ?? {};
          const ownedMetadata: Record<string, unknown> = {
            sourceType: "localhost",
            previewState: "live",
            title: screen.title,
            width: frame.width ?? screen.width,
            height: frame.height ?? screen.height,
            url: screen.url,
            previewUrl: screen.url,
            connectionId: connection.id,
            routeId: screen.routeId,
            path: screen.path,
            bridgeUrl: connection.bridgeUrl ?? undefined,
            previewToken: connection.previewToken ?? undefined,
          };
          if (screen.sourceFile !== undefined) {
            ownedMetadata.sourceFile = screen.sourceFile;
          }
          if (screen.sourceKind !== undefined) {
            ownedMetadata.sourceKind = screen.sourceKind;
          }
          if (screen.screenshotUrl !== undefined) {
            ownedMetadata.screenshotUrl = screen.screenshotUrl;
          }

          const mergedRouteMetadata = (
            primary: Record<string, unknown>,
            counterpart: Record<string, unknown>,
          ) => ({
            ...(isRecord(counterpart.routeMetadata)
              ? counterpart.routeMetadata
              : {}),
            ...(isRecord(primary.routeMetadata) ? primary.routeMetadata : {}),
            ...(screen.routeMetadata ?? {}),
          });

          // Preserve independently written legacy and canonical metadata keys.
          // Each map keeps its own value on an unrelated same-key conflict,
          // while localhost-owned fields above intentionally converge.
          previousMetadata[screen.id] = {
            ...currentLocalhostMetadata,
            ...currentMetadata,
            ...ownedMetadata,
            routeMetadata: mergedRouteMetadata(
              currentMetadata,
              currentLocalhostMetadata,
            ),
          };
          previousLocalhostScreens[screen.id] = {
            ...currentMetadata,
            ...currentLocalhostMetadata,
            ...ownedMetadata,
            routeMetadata: mergedRouteMetadata(
              currentLocalhostMetadata,
              currentMetadata,
            ),
          };
          nextOwnedMetadata.set(screen.id, {
            ...ownedMetadata,
            routeMetadata: screen.routeMetadata ?? {},
          });

          const placementIntent = placementIntents.find(
            (intent) => intent.fileId === screen.id,
          );
          const ownedFrameFields: Partial<CanvasFrameGeometry> = {};
          if (placementIntent) {
            for (const key of ["x", "y", "width", "height", "z"] as const) {
              // A newly created screen owns its initial geometry. A refresh of
              // an existing screen only owns fields explicitly supplied by the
              // caller; current canvas movement/resizing wins for the rest.
              if (
                !placementIntent.existedAtStart ||
                placementIntent.owns[key]
              ) {
                ownedFrameFields[key] = frame[key];
              }
            }
          }
          nextOwnedFrameFields.set(screen.id, ownedFrameFields);
        }

        lastOwnedMetadata = nextOwnedMetadata;
        lastOwnedFrameFields = nextOwnedFrameFields;
        return {
          ...currentData,
          sourceType: "localhost",
          sourceMode: "localhost",
          connectionId: connection.id,
          canvasFrames: mergedFrames.canvasFrames,
          screenMetadata: previousMetadata,
          localhostScreens: previousLocalhostScreens,
          updatedAt,
        };
      },
      isApplied: (data) => {
        if (
          data.sourceType !== "localhost" ||
          data.sourceMode !== "localhost" ||
          data.connectionId !== connection.id
        ) {
          return false;
        }
        const frames = parseCanvasFrameGeometryById(data.canvasFrames);
        const metadataById = isRecord(data.screenMetadata)
          ? data.screenMetadata
          : {};
        const localhostById = isRecord(data.localhostScreens)
          ? data.localhostScreens
          : {};

        for (const screen of savedScreens) {
          const frame = frames[screen.id];
          if (!frame) return false;
          for (const [key, expected] of Object.entries(
            lastOwnedFrameFields.get(screen.id) ?? {},
          )) {
            if (
              !jsonValuesEqual(
                frame[key as keyof CanvasFrameGeometry],
                expected,
              )
            ) {
              return false;
            }
          }

          const expectedMetadata = lastOwnedMetadata.get(screen.id) ?? {};
          for (const rawMetadata of [
            metadataById[screen.id],
            localhostById[screen.id],
          ]) {
            if (!isRecord(rawMetadata)) return false;
            for (const [key, expected] of Object.entries(expectedMetadata)) {
              if (key === "routeMetadata") {
                if (!isRecord(rawMetadata.routeMetadata)) return false;
                for (const [routeKey, routeValue] of Object.entries(
                  expected as Record<string, unknown>,
                )) {
                  if (
                    !jsonValuesEqual(
                      rawMetadata.routeMetadata[routeKey],
                      routeValue,
                    )
                  ) {
                    return false;
                  }
                }
              } else if (!jsonValuesEqual(rawMetadata[key], expected)) {
                return false;
              }
            }
          }
        }
        return true;
      },
    });

    const persistedFrames = parseCanvasFrameGeometryById(
      persistedData.canvasFrames,
    );
    const resultScreens = savedScreens.map((screen) => ({
      ...screen,
      width: persistedFrames[screen.id]?.width ?? screen.width,
      height: persistedFrames[screen.id]?.height ?? screen.height,
    }));
    const placedFrames = placementIntents.map((intent) => ({
      fileId: intent.fileId,
      filename: intent.filename,
      frame:
        persistedFrames[intent.fileId] ??
        parseCanvasFrameGeometryById({
          [intent.fileId]: intent.fallback,
        })[intent.fileId] ??
        {},
    }));

    return {
      designId,
      connectionId: connection.id,
      devServerUrl,
      bridgeUrl: connection.bridgeUrl ?? null,
      screenCount: savedScreens.length,
      screens: resultScreens,
      placedFrames,
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
