import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
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

    const now = new Date().toISOString();
    const id = args.id ?? nanoid();
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
    const capabilities =
      args.capabilities ??
      DESIGN_BRIDGE_OPERATIONS.map((operation) => ({
        operation,
        status: "available" as const,
      }));

    const existing = await db
      .select({
        id: schema.designLocalhostConnections.id,
        bridgeToken: schema.designLocalhostConnections.bridgeToken,
      })
      .from(schema.designLocalhostConnections)
      .where(
        and(
          eq(schema.designLocalhostConnections.id, id),
          eq(schema.designLocalhostConnections.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);

    const nextBridgeToken = args.bridgeToken?.trim() || undefined;
    const values = {
      id,
      name: args.name ?? new URL(devServerUrl).host,
      sourceType: "localhost" as const,
      devServerUrl,
      bridgeUrl: bridgeUrl ?? null,
      rootPath: routeManifest.rootPath ?? null,
      routeManifest: JSON.stringify(routeManifest),
      capabilities: JSON.stringify(capabilities),
      bridgeToken: nextBridgeToken ?? existing[0]?.bridgeToken ?? null,
      status: args.status,
      lastSeenAt: now,
      ownerEmail,
      orgId: getRequestOrgId() ?? null,
      updatedAt: now,
    };

    if (existing[0]) {
      await db
        .update(schema.designLocalhostConnections)
        .set(values)
        .where(eq(schema.designLocalhostConnections.id, id));
    } else {
      await db.insert(schema.designLocalhostConnections).values({
        ...values,
        createdAt: now,
      });
    }

    return {
      id,
      sourceType: "localhost",
      name: values.name,
      devServerUrl,
      bridgeUrl: bridgeUrl ?? null,
      rootPath: routeManifest.rootPath ?? null,
      routeCount: routes.length,
      routes,
      capabilities,
      status: args.status,
      lastSeenAt: now,
    };
  },
});
