import crypto from "node:crypto";

import { defineAction, embedApp } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  DESIGN_BRIDGE_OPERATIONS,
  makeLocalhostRouteId,
  titleFromRoutePath,
} from "../shared/source-mode.js";
import addLocalhostScreensAction, {
  pathFromUrl,
  routeUrl,
} from "./add-localhost-screens.js";
import connectLocalhostAction from "./connect-localhost.js";
import createDesignAction from "./create-design.js";
import navigateAction from "./navigate.js";

const connectionRouteSchema = z.object({
  id: z.string().optional(),
  path: z.string().min(1),
  title: z.string().optional(),
  sourceFile: z.string().optional(),
  sourceKind: z.enum(["react-router", "html", "manual"]).optional(),
  screenshotUrl: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const screenRouteSchema = z.object({
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

const capabilitySchema = z.object({
  operation: z.enum(DESIGN_BRIDGE_OPERATIONS),
  status: z.enum(["available", "planned", "disabled"]),
  reason: z.string().optional(),
});

const routeManifestSchema = z.object({
  version: z.literal(1).optional().default(1),
  sourceType: z.literal("localhost").optional().default("localhost"),
  devServerUrl: z.string().optional(),
  rootPath: z.string().optional(),
  routes: z.array(connectionRouteSchema),
  generatedAt: z.string().optional(),
});

const jsonArray = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === "string" ? JSON.parse(value) : value),
    schema,
  );

function normalizeBaseUrl(value: string): string {
  const raw = value.trim();
  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("devServerUrl must be an http(s) URL");
  }
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function isLoopbackUrl(value: string): boolean {
  const hostname = new URL(value).hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "::1" || hostname === "[::1]") {
    return true;
  }
  const parts = hostname.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.every((part) => /^\d+$/.test(part) && Number(part) <= 255)
  );
}

function stableConnectionId(devServerUrl: string, rootPath?: string) {
  const hash = crypto
    .createHash("sha256")
    .update(`${devServerUrl}\n${rootPath ?? ""}`)
    .digest("base64url")
    .slice(0, 16);
  return `localhost_${hash}`;
}

function designOverviewDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId, editorView: "overview" },
    to: `/design/${encodeURIComponent(designId)}?editorView=overview`,
  });
}

function routeManifestFromScreens(args: {
  devServerUrl: string;
  routes?: Array<z.infer<typeof screenRouteSchema>>;
  paths?: string[];
}) {
  const screenInputs: Array<z.infer<typeof screenRouteSchema>> = args.routes
    ?.length
    ? args.routes
    : (args.paths?.map((path) => ({ path })) ?? []);
  if (screenInputs.length === 0) return undefined;

  return screenInputs.map((input) => {
    const url = routeUrl(args.devServerUrl, {
      path: input.path,
      url: input.url,
    });
    const path = pathFromUrl(args.devServerUrl, url, input.path ?? "/");
    return {
      id: input.routeId ?? makeLocalhostRouteId(path),
      path,
      title: input.title ?? titleFromRoutePath(path),
      sourceFile: input.sourceFile,
      sourceKind: "manual" as const,
    };
  });
}

export default defineAction({
  description:
    "Open or refresh a running localhost app in Design overview mode in one authenticated step. Registers the local bridge, creates or reuses a design, places URL-backed screens, stores the active visual-edit context, and navigates the current Design session to the canvas. Use this for /visual-edit launches and follow-up requests like adding a mobile-size screen.",
  schema: z.object({
    designId: z
      .string()
      .optional()
      .describe(
        "Existing Design project to update. Omit to create a new visual-edit design.",
      ),
    connectionId: z
      .string()
      .optional()
      .describe(
        "Existing localhost connection. Omit to reuse a stable connection for devServerUrl + rootPath.",
      ),
    title: z
      .string()
      .optional()
      .describe("Title for a newly created design project."),
    description: z.string().optional(),
    devServerUrl: z
      .string()
      .describe("Running local app URL, for example http://localhost:5173"),
    bridgeUrl: z
      .string()
      .optional()
      .describe("Local bridge URL printed by agent-native design connect."),
    rootPath: z.string().optional().describe("Repository root for the app."),
    name: z.string().optional().describe("Human-readable connection name."),
    routeManifest: jsonArray(routeManifestSchema)
      .optional()
      .describe("Route manifest from the local Design bridge."),
    capabilities: jsonArray(z.array(capabilitySchema))
      .optional()
      .describe("Bridge operation capabilities."),
    bridgeToken: z
      .string()
      .optional()
      .describe(
        "Real bridge token from the running bridge. Stored server-side only; never returned.",
      ),
    routes: jsonArray(z.array(screenRouteSchema))
      .optional()
      .describe(
        "Screens to place. Each route may include path, url, title, viewport width/height, and x/y/z.",
      ),
    paths: jsonArray(z.array(z.string()))
      .optional()
      .describe("Shortcut for routes when only paths/URLs are needed."),
    defaultWidth: z
      .number()
      .positive()
      .optional()
      .describe("Default screen width. Defaults to 1280 when omitted."),
    defaultHeight: z
      .number()
      .positive()
      .optional()
      .describe("Default screen height. Defaults to 900 when omitted."),
    startX: z.number().optional().default(0),
    startY: z.number().optional().default(0),
    gap: z.number().optional().default(160),
    navigate: z
      .boolean()
      .optional()
      .default(true)
      .describe("Write a navigate app-state command to open overview mode."),
    publicReadOnly: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "For newly created loopback localhost designs, make the design public viewer-access so existing browser sessions do not see a false 404. Writes still require editor access.",
      ),
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
  run: async (args) => {
    const devServerUrl = normalizeBaseUrl(args.devServerUrl);
    const routeManifest = args.routeManifest
      ? {
          ...args.routeManifest,
          devServerUrl: args.routeManifest.devServerUrl ?? devServerUrl,
          rootPath: args.routeManifest.rootPath ?? args.rootPath,
        }
      : {
          version: 1 as const,
          sourceType: "localhost" as const,
          devServerUrl,
          rootPath: args.rootPath,
          routes:
            routeManifestFromScreens({
              devServerUrl,
              routes: args.routes,
              paths: args.paths,
            }) ?? [],
          generatedAt: new Date().toISOString(),
        };
    const connectionId =
      args.connectionId ?? stableConnectionId(devServerUrl, args.rootPath);

    const connection = await connectLocalhostAction.run({
      id: connectionId,
      name: args.name,
      devServerUrl,
      bridgeUrl: args.bridgeUrl,
      rootPath: routeManifest.rootPath ?? args.rootPath,
      routeManifest,
      capabilities: args.capabilities,
      bridgeToken: args.bridgeToken,
      status: "connected",
    });

    let designId = args.designId;
    let createdDesign = false;
    let publicReadOnly = false;
    if (!designId) {
      const design = await createDesignAction.run({
        title: args.title ?? `${new URL(devServerUrl).host} visual edit`,
        description:
          args.description ??
          "URL-backed localhost screens prepared by visual-edit.",
        projectType: "prototype",
      });
      designId = design.id;
      createdDesign = true;
      if (args.publicReadOnly && isLoopbackUrl(devServerUrl)) {
        publicReadOnly = true;
        await getDb()
          .update(schema.designs)
          .set({ visibility: "public" })
          .where(eq(schema.designs.id, designId));
      }
    }

    const screens = await addLocalhostScreensAction.run({
      designId,
      connectionId: connection.id,
      routes: args.routes,
      paths: args.paths,
      defaultWidth: args.defaultWidth,
      defaultHeight: args.defaultHeight,
      startX: args.startX,
      startY: args.startY,
      gap: args.gap,
    });

    const urlPath = `/design/${encodeURIComponent(
      designId,
    )}?editorView=overview`;
    await writeAppState("visual-edit", {
      designId,
      connectionId: connection.id,
      devServerUrl,
      bridgeUrl: connection.bridgeUrl,
      rootPath: connection.rootPath,
      urlPath,
      screens: screens.screens,
      updatedAt: new Date().toISOString(),
    });

    if (args.navigate) {
      await navigateAction.run({
        view: "editor",
        designId,
        editorView: "overview",
        path: urlPath,
      });
    }

    return {
      designId,
      connectionId: connection.id,
      createdDesign,
      publicReadOnly,
      devServerUrl,
      bridgeUrl: connection.bridgeUrl,
      rootPath: connection.rootPath,
      screenCount: screens.screenCount,
      screens: screens.screens,
      placedFrames: screens.placedFrames,
      overview: true,
      urlPath,
      openUrl: designOverviewDeepLink(designId),
    };
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const designId = (result as { designId?: string }).designId;
    if (!designId) return null;
    return {
      url: designOverviewDeepLink(designId),
      label: "Open overview",
      view: "editor",
    };
  },
});
