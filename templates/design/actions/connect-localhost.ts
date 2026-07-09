import crypto from "node:crypto";

import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  DESIGN_BRIDGE_OPERATIONS,
  makeLocalhostRouteId,
  titleFromRoutePath,
} from "../shared/source-mode.js";

const routeSchema = z.object({
  id: z.string().optional(),
  path: z.string().min(1),
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

function normalizeBridgeUrl(value: string): string {
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
    status: z
      .enum(["connected", "detected", "manual", "error"])
      .optional()
      .default("connected"),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId() ?? null;

    const now = new Date().toISOString();
    const db = getDb();
    const devServerUrl = normalizeUrl(args.devServerUrl, "devServerUrl");
    const bridgeUrl = args.bridgeUrl
      ? normalizeBridgeUrl(args.bridgeUrl)
      : undefined;
    const rawRoutes = args.routeManifest?.routes ?? args.routes ?? [];
    const routes = rawRoutes.map((route) => ({
      id: route.id ?? makeLocalhostRouteId(route.path),
      path: route.path,
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
      rootPath: args.routeManifest?.rootPath ?? args.rootPath,
      routes,
      generatedAt: args.routeManifest?.generatedAt ?? now,
    };
    const id =
      args.id ??
      stableConnectionId(
        devServerUrl,
        routeManifest.rootPath,
        ownerEmail,
        orgId,
      );
    const capabilities =
      args.capabilities ??
      DESIGN_BRIDGE_OPERATIONS.map((operation) => ({
        operation,
        status: "available" as const,
      }));

    // The id may already be taken by a DIFFERENT user (legacy ids were derived
    // from devServerUrl + rootPath without user scoping, so two users on the
    // same devcontainer image collide). Detect that up front and fail with a
    // clear error instead of crashing on the primary-key insert below.
    const existing = await db
      .select({
        ownerEmail: schema.designLocalhostConnections.ownerEmail,
        bridgeToken: schema.designLocalhostConnections.bridgeToken,
      })
      .from(schema.designLocalhostConnections)
      .where(eq(schema.designLocalhostConnections.id, id))
      .limit(1);

    if (existing[0] && existing[0].ownerEmail !== ownerEmail) {
      throw new Error(
        `Connection id "${id}" already belongs to another user. ` +
          "Omit id so a per-user connection id is derived instead.",
      );
    }

    // Token for a new row: explicit, else existing, else mint. The authenticated
    // action owning the mint is what lets the CLI skip its own auth (the 401 gap).
    const explicitToken = args.bridgeToken?.trim() || undefined;
    const nextBridgeToken =
      explicitToken ||
      existing[0]?.bridgeToken ||
      crypto.randomBytes(32).toString("hex");
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

    // On conflict, an explicit token overwrites; a server-minted one uses
    // coalesce(existing, minted) evaluated at write time — it fills a null token
    // but never clobbers one, so concurrent first-time callers converge on the
    // first writer (read->mint->write isn't atomic). setWhere keeps a cross-user
    // conflict a no-op.
    await db
      .insert(schema.designLocalhostConnections)
      .values({ ...baseValues, bridgeToken: nextBridgeToken, createdAt: now })
      .onConflictDoUpdate({
        target: schema.designLocalhostConnections.id,
        set: {
          ...baseValues,
          bridgeToken: explicitToken
            ? nextBridgeToken
            : sql`coalesce(${schema.designLocalhostConnections.bridgeToken}, excluded.bridge_token)`,
        },
        setWhere: eq(schema.designLocalhostConnections.ownerEmail, ownerEmail),
      });

    // Return the token the row actually holds (owner-scoped, so a cross-user
    // no-op never leaks another user's token), not the one we minted — so
    // concurrent callers converge on the winner (no 401 on a lost race).
    const [stored] = await db
      .select({ bridgeToken: schema.designLocalhostConnections.bridgeToken })
      .from(schema.designLocalhostConnections)
      .where(
        and(
          eq(schema.designLocalhostConnections.id, id),
          eq(schema.designLocalhostConnections.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);
    const effectiveBridgeToken = stored?.bridgeToken ?? nextBridgeToken;

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
      // Returned so the caller can start the bridge with
      // `design connect --bridge-token <this>`, matching this row.
      bridgeToken: effectiveBridgeToken,
    };
  },
});
