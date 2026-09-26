import crypto from "node:crypto";

import { defineAction } from "@agent-native/core/action";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { resolveLocalhostConnectionScope } from "../server/lib/localhost-connection.js";
import {
  DESIGN_BRIDGE_OPERATIONS,
  makeLocalhostRouteId,
  titleFromRoutePath,
} from "../shared/source-mode.js";

const routeSchema = z.object({
  id: z.string().optional(),
  connectionId: z.string().optional(),
  path: z.string().min(1),
  url: z.string().optional(),
  title: z.string().optional(),
  sourceFile: z.string().optional(),
  sourceKind: z.enum(["react-router", "html", "manual"]).optional(),
  screenshotUrl: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const capabilitySchema = z.object({
  operation: z.enum(DESIGN_BRIDGE_OPERATIONS),
  status: z.enum(["available", "planned", "disabled"]),
  reason: z.string().optional(),
});

function normalizeUrl(value: string, label: string): string {
  const raw = value.trim();
  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must be an http(s) URL`);
  }
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  ) {
    return true;
  }
  const parts = normalized.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d+$/.test(part) && Number(part) <= 255)
  );
}

export function normalizeBridgeUrl(value: string): string {
  const normalized = normalizeUrl(value, "bridgeUrl");
  const parsed = new URL(normalized);
  if (parsed.username || parsed.password) {
    throw new Error("bridgeUrl must not include credentials");
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error("bridgeUrl must not include a path");
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error("bridgeUrl must use localhost or a loopback IP address");
  }
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = "";
  return parsed.toString().replace(/\/$/, "");
}

function stableConnectionId(
  devServerUrl: string,
  rootPath: string | undefined,
  ownerEmail: string,
  orgId: string | null,
) {
  const hash = crypto
    .createHash("sha256")
    .update(`${ownerEmail}\n${orgId ?? ""}\n${devServerUrl}\n${rootPath ?? ""}`)
    .digest("base64url")
    .slice(0, 16);
  return `localhost_${hash}`;
}

const PREVIEW_TOKEN_DOMAIN = "agent-native-design-preview-v1\0";
const LIVE_EDIT_CAPABILITY_DOMAIN = "agent-native-live-edit-design-v1\0";
const LIVE_EDIT_REGISTRATION_CAPABILITY_DOMAIN =
  "agent-native-live-edit-registration-v1\0";
export const DEFAULT_BRIDGE_URL = "http://127.0.0.1:7331";

export function derivePreviewToken(bridgeToken: string): string {
  return crypto
    .createHash("sha256")
    .update(PREVIEW_TOKEN_DOMAIN)
    .update(bridgeToken)
    .digest("hex");
}

export function deriveLiveEditCapability(
  bridgeToken: string,
  designId: string,
): string {
  return crypto
    .createHmac("sha256", bridgeToken)
    .update(LIVE_EDIT_CAPABILITY_DOMAIN)
    .update(designId)
    .digest("hex");
}

export function deriveLiveEditRegistrationCapability(
  bridgeToken: string,
  designId: string,
): string {
  return crypto
    .createHmac("sha256", bridgeToken)
    .update(LIVE_EDIT_REGISTRATION_CAPABILITY_DOMAIN)
    .update(designId)
    .digest("hex");
}

function fallbackRouteIdentity(
  route: { connectionId?: string; path: string; url?: string },
  devServerUrl: string,
  connectionId: string,
): string {
  if (route.connectionId && route.connectionId !== connectionId) {
    return `${route.connectionId}:${route.path}`;
  }
  if (route.url) {
    try {
      const routeUrl = new URL(route.url, devServerUrl);
      if (routeUrl.origin !== new URL(devServerUrl).origin) {
        routeUrl.hash = "";
        return routeUrl.toString();
      }
    } catch {
      // coercion-ok: add-localhost-screens validates malformed route URLs later.
    }
  }
  return route.path;
}

export default defineAction({
  description:
    "Register or refresh a localhost Design source connection produced by `agent-native design connect`. Stores the dev server URL, bridge URL, route manifest, and operation capabilities so the UI can later list local-code artboards.",
  schema: z.object({
    id: z
      .string()
      .optional()
      .describe("Optional existing connection ID. Omit to create one."),
    name: z.string().optional().describe("Human-readable connection name."),
    devServerUrl: z
      .string()
      .describe("Local app dev server URL, for example http://localhost:5173"),
    bridgeUrl: z
      .string()
      .optional()
      .describe("Local Design bridge URL printed by the CLI."),
    rootPath: z.string().optional().describe("Repository root for the app."),
    routes: z
      .array(routeSchema)
      .optional()
      .describe("Discovered app routes/screens to become localhost artboards."),
    routeManifest: z
      .object({
        version: z.literal(1).default(1),
        sourceType: z.literal("localhost").default("localhost"),
        devServerUrl: z.string().optional(),
        rootPath: z.string().optional(),
        routes: z.array(routeSchema),
        generatedAt: z.string().optional(),
      })
      .optional()
      .describe("Full route manifest emitted by the CLI."),
    capabilities: z
      .array(capabilitySchema)
      .optional()
      .describe("Bridge operation capabilities."),
    bridgeToken: z
      .string()
      .optional()
      .describe(
        "The bridge's real auth token minted at bridge start. Stored on the connection so grant-localhost-write-consent can read it without minting its own.",
      ),
    previewToken: z
      .string()
      .optional()
      .describe(
        "Distinct read-only token for browser preview, snapshots, and live-edit bridge registration. Omit when passing bridgeToken to derive the compatible token automatically.",
      ),
    status: z
      .enum(["connected", "detected", "manual", "error"])
      .optional()
      .default("connected"),
  }),
  run: async (args) => {
    const { ownerEmail, orgId } = await resolveLocalhostConnectionScope();

    const now = new Date().toISOString();
    const db = getDb();
    const devServerUrl = normalizeUrl(args.devServerUrl, "devServerUrl");
    const requestedBridgeUrl = args.bridgeUrl
      ? normalizeBridgeUrl(args.bridgeUrl)
      : undefined;
    const rootPath = args.routeManifest?.rootPath ?? args.rootPath;
    let id =
      args.id ?? stableConnectionId(devServerUrl, rootPath, ownerEmail, orgId);
    const rawRoutes = args.routeManifest?.routes ?? args.routes ?? [];
    const routes = rawRoutes.map((route) => ({
      id:
        route.id ??
        makeLocalhostRouteId(fallbackRouteIdentity(route, devServerUrl, id)),
      connectionId: route.connectionId,
      path: route.path,
      url: route.url,
      title: route.title ?? titleFromRoutePath(route.path),
      sourceFile: route.sourceFile,
      sourceKind: route.sourceKind ?? "manual",
      screenshotUrl: route.screenshotUrl,
      metadata: route.metadata,
    }));
    const routeManifest = {
      version: 1 as const,
      sourceType: "localhost" as const,
      devServerUrl,
      rootPath,
      routes,
      generatedAt: args.routeManifest?.generatedAt ?? now,
    };
    const capabilities =
      args.capabilities ??
      DESIGN_BRIDGE_OPERATIONS.map((operation) => ({
        operation,
        status: "available" as const,
      }));
    const ownerOrgScope = and(
      eq(schema.designLocalhostConnections.ownerEmail, ownerEmail),
      orgId
        ? eq(schema.designLocalhostConnections.orgId, orgId)
        : isNull(schema.designLocalhostConnections.orgId),
    );

    let existing = await db
      .select({
        id: schema.designLocalhostConnections.id,
        ownerEmail: schema.designLocalhostConnections.ownerEmail,
        orgId: schema.designLocalhostConnections.orgId,
        devServerUrl: schema.designLocalhostConnections.devServerUrl,
        rootPath: schema.designLocalhostConnections.rootPath,
        bridgeUrl: schema.designLocalhostConnections.bridgeUrl,
        previewToken: schema.designLocalhostConnections.previewToken,
        bridgeToken: schema.designLocalhostConnections.bridgeToken,
      })
      .from(schema.designLocalhostConnections)
      .where(eq(schema.designLocalhostConnections.id, id))
      .limit(1);

    // credential only when this owner/org has one unambiguous row for the
    // exact app URL and root; otherwise a new row could mint a token that an
    if (!args.id && !existing[0] && rootPath) {
      const priorConnections = await db
        .select({
          id: schema.designLocalhostConnections.id,
          ownerEmail: schema.designLocalhostConnections.ownerEmail,
          orgId: schema.designLocalhostConnections.orgId,
          devServerUrl: schema.designLocalhostConnections.devServerUrl,
          rootPath: schema.designLocalhostConnections.rootPath,
          bridgeUrl: schema.designLocalhostConnections.bridgeUrl,
          previewToken: schema.designLocalhostConnections.previewToken,
          bridgeToken: schema.designLocalhostConnections.bridgeToken,
        })
        .from(schema.designLocalhostConnections)
        .where(
          and(
            ownerOrgScope,
            eq(schema.designLocalhostConnections.devServerUrl, devServerUrl),
            eq(schema.designLocalhostConnections.rootPath, rootPath),
            ...(requestedBridgeUrl
              ? [
                  eq(
                    schema.designLocalhostConnections.bridgeUrl,
                    requestedBridgeUrl,
                  ),
                ]
              : []),
          ),
        )
        .limit(2);
      if (priorConnections.length > 1) {
        throw new Error(
          "Multiple existing localhost connections match this app. Pass the connection ID to choose which bridge to reuse.",
        );
      }
      const prior = priorConnections[0];
      if (
        prior &&
        prior.ownerEmail === ownerEmail &&
        (prior.orgId ?? null) === orgId
      ) {
        id = prior.id;
        existing = [prior];
      }
    }

    if (
      existing[0] &&
      (existing[0].ownerEmail !== ownerEmail ||
        (existing[0].orgId ?? null) !== orgId)
    ) {
      throw new Error(
        `Connection id "${id}" already belongs to another user or organization. ` +
          "Omit id so a per-user connection id is derived instead.",
      );
    }

    const bridgeUrl =
      requestedBridgeUrl ??
      (existing[0]?.bridgeUrl
        ? normalizeBridgeUrl(existing[0].bridgeUrl)
        : DEFAULT_BRIDGE_URL);

    const explicitToken = args.bridgeToken?.trim() || undefined;
    const nextBridgeToken =
      explicitToken ||
      existing[0]?.bridgeToken ||
      crypto.randomBytes(32).toString("hex");
    const derivedPreviewToken = derivePreviewToken(nextBridgeToken);
    const explicitPreviewToken = args.previewToken?.trim();
    if (explicitPreviewToken && explicitPreviewToken !== derivedPreviewToken) {
      throw new Error(
        "previewToken must match the deterministic token derived from bridgeToken",
      );
    }
    const nextPreviewToken = derivedPreviewToken;
    const baseValues = {
      id,
      name: args.name ?? new URL(devServerUrl).host,
      sourceType: "localhost" as const,
      devServerUrl,
      bridgeUrl: bridgeUrl ?? null,
      rootPath: routeManifest.rootPath ?? null,
      routeManifest: JSON.stringify(routeManifest),
      capabilities: JSON.stringify(capabilities),
      status: args.status,
      lastSeenAt: now,
      ownerEmail,
      orgId,
      updatedAt: now,
    };

    const {
      bridgeToken: effectiveBridgeToken,
      previewToken: effectivePreviewToken,
    } = await db.transaction(async (tx) => {
      const [stored] = await tx
        .insert(schema.designLocalhostConnections)
        .values({
          ...baseValues,
          previewToken: nextPreviewToken,
          bridgeToken: nextBridgeToken,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: schema.designLocalhostConnections.id,
          set: {
            ...baseValues,
            bridgeToken: explicitToken
              ? nextBridgeToken
              : sql`coalesce(${schema.designLocalhostConnections.bridgeToken}, excluded.bridge_token)`,
            previewToken: nextPreviewToken,
          },
          setWhere: ownerOrgScope,
        })
        .returning({
          bridgeToken: schema.designLocalhostConnections.bridgeToken,
        });
      if (!stored?.bridgeToken) {
        throw Object.assign(
          new Error(
            "The localhost connection could not be confirmed for this account. Refresh the connection and retry.",
          ),
          { errorCode: "localhost_connection_conflict" },
        );
      }

      const previewToken = derivePreviewToken(stored.bridgeToken);
      await tx
        .update(schema.designLocalhostConnections)
        .set({ previewToken })
        .where(
          and(eq(schema.designLocalhostConnections.id, id), ownerOrgScope),
        );
      return { bridgeToken: stored.bridgeToken, previewToken };
    });

    return {
      id,
      sourceType: "localhost",
      name: baseValues.name,
      devServerUrl,
      bridgeUrl: bridgeUrl ?? null,
      rootPath: routeManifest.rootPath ?? null,
      routeCount: routes.length,
      routes,
      capabilities,
      status: args.status,
      lastSeenAt: now,
      previewToken: effectivePreviewToken,
      bridgeToken: effectiveBridgeToken,
    };
  },
});
