import crypto from "node:crypto";
import path from "node:path";

import { defineAction, embedApp } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import {
  buildDeepLink,
  buildEmbedStartPath,
  createEmbedSessionTicket,
} from "@agent-native/core/server";
import {
  getRequestContext,
  getRequestOrgId,
  getRequestUserEmail,
  runWithRequestContext,
} from "@agent-native/core/server/request-context";
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
  sourceKind: z.enum(["react-router", "html", "manual"]).optional(),
  screenshotUrl: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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

const VIEWPORT_PRESETS = {
  // `desktop` deliberately matches add-localhost-screens' 1280x900 fallback so
  // asking for it never resizes frames placed by an earlier default call.
  desktop: { label: "Desktop", width: 1280, height: 900 },
  laptop: { label: "Laptop", width: 1440, height: 900 },
  tablet: { label: "Tablet", width: 834, height: 1112 },
  mobile: { label: "Mobile", width: 390, height: 844 },
} as const;

const viewportSchema = z.union([
  z.enum(["desktop", "laptop", "tablet", "mobile"]),
  z.object({
    label: z.string().optional(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
]);

type ViewportInput = z.infer<typeof viewportSchema>;
interface ResolvedViewport {
  label: string;
  width: number;
  height: number;
}

function resolveViewports(
  inputs: ViewportInput[] | undefined,
): ResolvedViewport[] | undefined {
  if (!inputs?.length) return undefined;
  return inputs.map((input) =>
    typeof input === "string"
      ? { ...VIEWPORT_PRESETS[input] }
      : {
          label: input.label ?? `${Math.round(input.width)}w`,
          width: input.width,
          height: input.height,
        },
  );
}

/**
 * Expand one screen request per (route x viewport) and lay them out as a grid:
 * one row per route, one column per viewport. Explicit x/y/width/height are
 * what make add-localhost-screens treat each pair as its own frame instead of
 * refreshing a single shared one, so they are always set here.
 */
function expandRoutesAcrossViewports(args: {
  routes: Array<z.infer<typeof screenRouteSchema>>;
  viewports: ResolvedViewport[];
  startX: number;
  startY: number;
  gap: number;
}): Array<z.infer<typeof screenRouteSchema>> {
  const labelViewports = args.viewports.length > 1;
  const expanded: Array<z.infer<typeof screenRouteSchema>> = [];
  let rowY = args.startY;
  for (const route of args.routes) {
    let columnX = args.startX;
    for (const viewport of args.viewports) {
      expanded.push({
        ...route,
        title: labelViewports
          ? `${route.title ?? titleFromRoutePath(route.path ?? "/")} — ${viewport.label}`
          : route.title,
        width: viewport.width,
        height: viewport.height,
        x: columnX,
        y: rowY,
      });
      columnX += viewport.width + args.gap;
    }
    rowY +=
      Math.max(...args.viewports.map((viewport) => viewport.height)) + args.gap;
  }
  return expanded;
}

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

const LOCAL_VISUAL_EDIT_TICKET_TTL_SECONDS = 5 * 60;
const LOCAL_VISUAL_EDIT_PRINCIPAL_DOMAIN =
  "local.visual-edit.agent-native.invalid";

/**
 * Stable owner partition for Design rows created by the local CLI skill when
 * no account session exists. This value is never installed as a browser
 * session; it only lets one trusted in-process `pnpm action` invocation compose
 * the existing owner-scoped actions before minting a narrow embed capability.
 */
export function localVisualEditWorkspacePrincipal(
  workspacePath = process.cwd(),
): string {
  const workspaceId = crypto
    .createHash("sha256")
    .update(path.resolve(workspacePath))
    .digest("hex")
    .slice(0, 24);
  return `workspace+${workspaceId}@${LOCAL_VISUAL_EDIT_PRINCIPAL_DOMAIN}`;
}

function localVisualEditPath(designId: string): string {
  return `/visual-edit/${encodeURIComponent(designId)}?editorView=overview`;
}

function localVisualEditDeepLink(designId: string): string {
  return buildDeepLink({
    app: "design",
    view: "editor",
    params: { designId, editorView: "overview" },
    to: localVisualEditPath(designId),
  });
}

async function createCallerHandoff(
  targetPath: string,
  ownerEmail: string,
  designId: string,
): Promise<string> {
  const ticket = await createEmbedSessionTicket({
    ownerEmail,
    orgId: getRequestOrgId(),
    targetPath,
    scope: `capability:visual-edit:design:${encodeURIComponent(designId)}`,
    ttlSeconds: LOCAL_VISUAL_EDIT_TICKET_TTL_SECONDS,
  });
  return buildEmbedStartPath(ticket.ticket);
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
    if (!input.path && !input.url) {
      throw new Error(
        `Route "${input.routeId ?? "(unknown)"}" needs path or url when no routeManifest is provided.`,
      );
    }
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
      sourceKind: input.sourceKind ?? ("manual" as const),
      screenshotUrl: input.screenshotUrl,
      metadata: input.metadata,
    };
  });
}

export default defineAction({
  description:
    "Open or refresh a running localhost app in Design overview mode without requiring a Design account login. Registers the local bridge, creates or reuses a design, places URL-backed screens, stores the active visual-edit context, and navigates the current Design session to the canvas. Use this from the local /visual-edit skill and for follow-up requests like adding a mobile-size screen.",
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
        "Existing localhost connection. Omit to reuse a stable per-user connection for devServerUrl + rootPath.",
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
        "Optional bridge token to store on the connection (e.g. one a CLI " +
          "self-registered). Omit it and the server mints one, stores it, and " +
          "returns it as `bridgeToken` so the caller can start the local bridge " +
          "with `design connect --bridge-token <token>`.",
      ),
    previewToken: z
      .string()
      .optional()
      .describe(
        "Optional paired read-only preview token from a self-registering CLI. Omit it with bridgeToken to derive the compatible token automatically.",
      ),
    routes: jsonArray(z.array(screenRouteSchema))
      .optional()
      .describe(
        "Screens to place. Each route may include path, url, title, viewport width/height, and x/y/z.",
      ),
    paths: jsonArray(z.array(z.string()))
      .optional()
      .describe("Shortcut for routes when only paths/URLs are needed."),
    viewports: jsonArray(z.array(viewportSchema))
      .optional()
      .describe(
        'Place every requested route once per viewport, laid out one row per route and one column per viewport. Use preset names ("desktop", "laptop", "tablet", "mobile") or explicit {label?, width, height}. Example for responsive editing: ["desktop", "mobile"]. Overrides defaultWidth/defaultHeight.',
      ),
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
      description:
        "Review local URL-backed screens and hand pending source edits back to the host coding agent.",
      iframeTitle: "Agent-Native Design",
      openLabel: "Open overview",
      height: 680,
    }),
  },
  run: async (args, ctx) => {
    const devServerUrl = normalizeBaseUrl(args.devServerUrl);
    const runForPrincipal = async () => {
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
      const connection = await connectLocalhostAction.run({
        // Let connect-localhost be the single source of truth for stable
        // per-user/per-org id derivation. Duplicating it here can create a second
        // tokenless row after the CLI self-registers the bridge token.
        id: args.connectionId,
        name: args.name,
        devServerUrl,
        bridgeUrl: args.bridgeUrl,
        rootPath: routeManifest.rootPath ?? args.rootPath,
        routeManifest,
        capabilities: args.capabilities,
        bridgeToken: args.bridgeToken,
        previewToken: args.previewToken,
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

      const viewports = resolveViewports(args.viewports);
      const requestedRoutes = args.routes?.length
        ? args.routes
        : args.paths?.length
          ? args.paths.map((path) => ({ path }))
          : viewports
            ? routeManifest.routes.map((route) => ({
                routeId: route.id,
                path: route.path,
                title: route.title,
              }))
            : undefined;
      if (viewports && !requestedRoutes?.length) {
        throw new Error(
          "viewports needs at least one route: pass routes/paths, or connect a bridge whose manifest lists routes.",
        );
      }

      const screens = await addLocalhostScreensAction.run({
        designId,
        connectionId: connection.id,
        routes:
          viewports && requestedRoutes
            ? expandRoutesAcrossViewports({
                routes: requestedRoutes,
                viewports,
                startX: args.startX ?? 0,
                startY: args.startY ?? 0,
                gap: args.gap ?? 160,
              })
            : args.routes,
        paths: viewports ? undefined : args.paths,
        defaultWidth: args.defaultWidth,
        defaultHeight: args.defaultHeight,
        startX: args.startX,
        startY: args.startY,
        gap: args.gap,
      });

      const urlPath = localVisualEditPath(designId);
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

      const ownerEmail = getRequestUserEmail();
      if (!ownerEmail) {
        throw new Error("visual-edit principal was not established");
      }
      const deepLink = localVisualEditDeepLink(designId);
      const embedStartUrl = isLoopbackUrl(devServerUrl)
        ? await createCallerHandoff(urlPath, ownerEmail, designId)
        : undefined;

      const result = {
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
        // Safe for model-visible action text and retained links. The MCP App
        // receives the one-time launcher separately through hidden metadata.
        openUrl: deepLink,
        // Minted/stored by connect-localhost; the skill starts the bridge with
        // `design connect --bridge-token <this>` so bridge and row agree.
        bridgeToken: connection.bridgeToken,
        previewToken: connection.previewToken,
      };
      if (embedStartUrl) {
        // Trusted hosts and the CLI runner read this property directly. Keeping
        // it non-enumerable prevents generic object/string serialization from
        // copying the single-use bearer into model-visible action output.
        Object.defineProperty(result, "embedStartUrl", {
          value: embedStartUrl,
          enumerable: false,
        });
      }
      return result as typeof result & { embedStartUrl?: string };
    };

    if (getRequestUserEmail()) return runForPrincipal();
    if (ctx?.caller !== "cli" || !isLoopbackUrl(devServerUrl)) {
      throw new Error(
        "Signed-out visual-edit is available only through the local CLI for a loopback app.",
      );
    }
    if (args.publicReadOnly === false) {
      throw new Error(
        "Signed-out local visual-edit requires publicReadOnly so the resource can be opened through its narrow editor capability. Sign in to create a private Design resource.",
      );
    }

    return runWithRequestContext(
      {
        ...(getRequestContext() ?? {}),
        userEmail: localVisualEditWorkspacePrincipal(),
        orgId: undefined,
      },
      runForPrincipal,
    );
  },
  link: ({ result }) => {
    if (!result || typeof result !== "object") return null;
    const { designId } = result as {
      designId?: string;
    };
    if (!designId) return null;
    return {
      // The single-use embed ticket stays in MCP result metadata. Keep the
      // model-visible link credential-free.
      url: localVisualEditDeepLink(designId),
      label: "Open overview",
      view: "editor",
    };
  },
});
