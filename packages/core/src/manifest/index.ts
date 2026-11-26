import { z } from "zod";

export const navigationModeSchema = z.enum(["open", "reveal", "keep"]);
export type NavigationMode = z.infer<typeof navigationModeSchema>;

export const APP_CAPABILITIES_META_KEY = "agent-native/app-capabilities";

const actionName = z.string().trim().min(1);
const ROUTE_PARAM_SEGMENT_RE = /^:[A-Za-z][A-Za-z0-9_-]*$/;
const route = z
  .string()
  .regex(
    /^\/(?:(?:[A-Za-z0-9._~-]+|:[A-Za-z][A-Za-z0-9_-]*)\/)*(?:[A-Za-z0-9._~-]+|:[A-Za-z][A-Za-z0-9_-]*)?$/,
  )
  .refine((path) => {
    const parts = path.split("/");
    if (parts.some((part) => part === "." || part === "..")) return false;
    const seenParams = new Set<string>();
    for (const part of parts) {
      if (!part.startsWith(":")) continue;
      if (!ROUTE_PARAM_SEGMENT_RE.test(part)) return false;
      const paramName = part.slice(1);
      if (seenParams.has(paramName)) return false;
      seenParams.add(paramName);
    }
    return true;
  });

const suggestionTypeSchema = z.enum([
  "saved-view",
  "automation",
  "ai-split-filter",
]);

const manifestScreenSchema = z.object({
  route,
  action: actionName,
  params: z.record(z.string().min(1), z.string().min(1)).optional(),
  supportsViewOverlay: z.boolean().optional(),
});

const manifestEntitySchema = z.object({
  screen: z.string().trim().min(1).optional(),
  route: route.optional(),
  idParam: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1).optional(),
});

const manifestViewPolicySchema = z.object({
  defaultMode: navigationModeSchema.optional(),
  allowBackgroundNavigation: z.boolean().optional(),
  fallbackScreen: z.string().trim().min(1).optional(),
});

const suggestableCapabilitySchema = z.object({
  type: z.string().trim().min(1),
  action: actionName,
  description: z.string().trim().min(1).optional(),
});

const v1AppCapabilityManifestSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  screens: z.record(z.string().min(1), manifestScreenSchema).optional(),
  suggestions: z.partialRecord(suggestionTypeSchema, actionName).optional(),
  entities: z.record(z.string().min(1), manifestEntitySchema).optional(),
  viewPolicy: manifestViewPolicySchema.optional(),
  suggestableCapabilities: z.array(suggestableCapabilitySchema).optional(),
  supportsViewOverlay: z.boolean().optional(),
});

export type AppCapabilityManifestScreen = z.infer<typeof manifestScreenSchema>;
export type AppCapabilityManifestEntity = z.infer<typeof manifestEntitySchema>;
export type AppCapabilityManifestViewPolicy = z.infer<
  typeof manifestViewPolicySchema
>;
export type AppCapabilitySuggestableCapability = z.infer<
  typeof suggestableCapabilitySchema
>;

export interface LegacyAppManifestInput {
  version?: undefined;
  id: string;
  displayName: string;
  screens?: {
    defaultLandingScreen?: string;
    definitions?: Record<
      string,
      {
        show?: {
          route?: string;
          action?: string;
          supportsViewOverlay?: boolean;
        };
      }
    >;
  };
  entities?: Record<string, AppCapabilityManifestEntity>;
  viewPolicy?: AppCapabilityManifestViewPolicy;
  supportsViewOverlay?: boolean;
  suggestableCapabilities?: ReadonlyArray<{
    type?: string;
    action?: string;
    description?: string;
  }>;
  [key: string]: unknown;
}

function adaptLegacyAppManifest(input: unknown): unknown {
  if (!input || typeof input !== "object" || "version" in input) {
    return input;
  }
  const legacy = input as Record<string, unknown>;
  const hasLegacyShape =
    typeof legacy.id === "string" ||
    typeof legacy.displayName === "string" ||
    (legacy.screens &&
      typeof legacy.screens === "object" &&
      "definitions" in legacy.screens);
  if (!hasLegacyShape) return input;

  const definitions =
    legacy.screens &&
    typeof legacy.screens === "object" &&
    "definitions" in legacy.screens &&
    legacy.screens.definitions &&
    typeof legacy.screens.definitions === "object"
      ? (legacy.screens.definitions as Record<string, unknown>)
      : {};
  const screens: Record<string, AppCapabilityManifestScreen> = {};
  for (const [id, def] of Object.entries(definitions)) {
    if (!id || !def || typeof def !== "object") continue;
    const show = (def as { show?: unknown }).show;
    const showRecord =
      show && typeof show === "object"
        ? (show as {
            route?: unknown;
            action?: unknown;
            supportsViewOverlay?: unknown;
          })
        : undefined;
    const rawRoute = showRecord?.route;
    const rawAction =
      typeof showRecord?.action === "string" && showRecord.action.trim()
        ? showRecord.action.trim()
        : "navigate";
    if (typeof rawRoute === "string" && route.safeParse(rawRoute).success) {
      screens[id] = {
        route: rawRoute,
        action: rawAction,
        ...(typeof showRecord?.supportsViewOverlay === "boolean"
          ? { supportsViewOverlay: showRecord.supportsViewOverlay }
          : {}),
      };
    }
  }

  const suggestions: Record<string, string> = {};
  const suggestableCapabilities: AppCapabilitySuggestableCapability[] = [];
  if (Array.isArray(legacy.suggestableCapabilities)) {
    for (const cap of legacy.suggestableCapabilities) {
      if (!cap || typeof cap !== "object") continue;
      const { type, action, description } = cap as {
        type?: unknown;
        action?: unknown;
        description?: unknown;
      };
      if (typeof type === "string" && typeof action === "string") {
        const trimmedType = type.trim();
        const trimmedAction = action.trim();
        if (trimmedType && trimmedAction) {
          suggestableCapabilities.push({
            type: trimmedType,
            action: trimmedAction,
            ...(typeof description === "string" && description.trim()
              ? { description: description.trim() }
              : {}),
          });
          if (suggestionTypeSchema.safeParse(trimmedType).success) {
            suggestions[trimmedType] = trimmedAction;
          }
        }
      }
    }
  }

  const parsedEntities = z
    .record(z.string().min(1), manifestEntitySchema)
    .safeParse(legacy.entities);
  const parsedViewPolicy = manifestViewPolicySchema.safeParse(
    legacy.viewPolicy,
  );
  const supportsViewOverlay =
    typeof legacy.supportsViewOverlay === "boolean"
      ? legacy.supportsViewOverlay
      : undefined;

  return {
    version: 1,
    ...(Object.keys(screens).length > 0 ? { screens } : {}),
    ...(Object.keys(suggestions).length > 0 ? { suggestions } : {}),
    ...(parsedEntities.success && Object.keys(parsedEntities.data).length > 0
      ? { entities: parsedEntities.data }
      : {}),
    ...(parsedViewPolicy.success ? { viewPolicy: parsedViewPolicy.data } : {}),
    ...(suggestableCapabilities.length > 0 &&
    suggestableCapabilities.length !== Object.keys(suggestions).length
      ? { suggestableCapabilities }
      : {}),
    ...(supportsViewOverlay !== undefined ? { supportsViewOverlay } : {}),
  };
}

export const appCapabilityManifestSchema = z.preprocess(
  adaptLegacyAppManifest,
  v1AppCapabilityManifestSchema,
);

export type AppCapabilityManifest = z.infer<
  typeof v1AppCapabilityManifestSchema
>;

export function defineAppManifest(
  input: AppCapabilityManifest | LegacyAppManifestInput,
): AppCapabilityManifest {
  return appCapabilityManifestSchema.parse(input);
}

/** Only the actions in the caller's current discovery result can bind capabilities. */
export function projectAppManifest(
  manifest: AppCapabilityManifest | undefined,
  tools: readonly { name: string }[],
): AppCapabilityManifest | undefined {
  if (!manifest) return undefined;
  const allowed = new Set(tools.map(({ name }) => name));
  const screens = Object.entries(manifest.screens ?? {}).filter(([, screen]) =>
    allowed.has(screen.action),
  );
  const suggestions = Object.entries(manifest.suggestions ?? {}).filter(
    ([, action]) => allowed.has(action),
  );
  const suggestableCapabilities = (
    manifest.suggestableCapabilities ?? []
  ).filter((cap) => allowed.has(cap.action));
  if (
    screens.length === 0 &&
    suggestions.length === 0 &&
    suggestableCapabilities.length === 0
  ) {
    return undefined;
  }
  return {
    version: manifest.version,
    ...(screens.length > 0 && { screens: Object.fromEntries(screens) }),
    ...(suggestions.length > 0 && {
      suggestions: Object.fromEntries(suggestions),
    }),
    ...(manifest.entities ? { entities: manifest.entities } : {}),
    ...(manifest.viewPolicy ? { viewPolicy: manifest.viewPolicy } : {}),
    ...(suggestableCapabilities.length > 0 ? { suggestableCapabilities } : {}),
    ...(manifest.supportsViewOverlay !== undefined
      ? { supportsViewOverlay: manifest.supportsViewOverlay }
      : {}),
  };
}

/** Use discovery from the selected registration and its trusted runtime mount. */
export function resolveAppCapabilities(
  discovery: {
    tools: readonly { name: string }[];
    _meta?: Record<string, unknown>;
  },
  mount: URL,
) {
  const parsed = appCapabilityManifestSchema.safeParse(
    discovery._meta?.[APP_CAPABILITIES_META_KEY],
  );
  if (!parsed.success) return undefined;
  const manifest = projectAppManifest(parsed.data, discovery.tools);
  if (!manifest) return undefined;
  const base = mount.pathname.replace(/\/+$/, "");
  const screens = Object.entries(manifest.screens ?? {}).map(([id, screen]) => {
    const href = `${mount.origin}${base}${screen.route}`;
    return [
      id,
      {
        action: screen.action,
        url: href,
        ...(manifest.version >= 2 ? { route: screen.route } : {}),
        ...(screen.params ? { params: screen.params } : {}),
        ...(screen.supportsViewOverlay !== undefined
          ? { supportsViewOverlay: screen.supportsViewOverlay }
          : {}),
      },
    ] as const;
  });
  return {
    version: manifest.version,
    ...(screens.length > 0 && { screens: Object.fromEntries(screens) }),
    ...(manifest.suggestions && { suggestions: manifest.suggestions }),
    ...(manifest.entities && { entities: manifest.entities }),
    ...(manifest.viewPolicy && { viewPolicy: manifest.viewPolicy }),
    ...(manifest.suggestableCapabilities && {
      suggestableCapabilities: manifest.suggestableCapabilities,
    }),
    ...(manifest.supportsViewOverlay !== undefined && {
      supportsViewOverlay: manifest.supportsViewOverlay,
    }),
  };
}

function normalizePathSegments(rawPath: string): string[] {
  const withoutHash = rawPath.split("#", 1)[0] ?? rawPath;
  const pathname = withoutHash.split("?", 1)[0] ?? withoutHash;
  return pathname.split("/").filter(Boolean);
}

/** Matches a concrete path against a manifest route template containing optional `:param` segments. */
export function matchManifestRoute(
  template: string,
  candidatePath: string,
): { matched: true; params: Record<string, string> } | { matched: false } {
  const templateSegments = normalizePathSegments(template);
  const candidateSegments = normalizePathSegments(candidatePath);
  if (templateSegments.length !== candidateSegments.length) {
    return { matched: false };
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < templateSegments.length; i += 1) {
    const tSeg = templateSegments[i];
    const cSeg = candidateSegments[i];
    if (!tSeg || !cSeg) return { matched: false };
    if (ROUTE_PARAM_SEGMENT_RE.test(tSeg)) {
      try {
        params[tSeg.slice(1)] = decodeURIComponent(cSeg);
      } catch {
        // coercion-ok: malformed percent sequence falls back to raw segment.
        params[tSeg.slice(1)] = cSeg;
      }
      continue;
    }
    if (tSeg !== cSeg) return { matched: false };
  }
  return { matched: true, params };
}

/** Expands a manifest route template's `:param` placeholders from `params`, returning leftover query params. */
export function expandManifestRoute(
  template: string,
  params?: Record<string, string | number | boolean>,
):
  | { path: string; remainingParams: Record<string, string | number | boolean> }
  | { error: string } {
  const remainingParams: Record<string, string | number | boolean> = {
    ...(params ?? {}),
  };
  const segments = normalizePathSegments(template);
  if (segments.length === 0) {
    return { path: "/", remainingParams };
  }
  const missing: string[] = [];
  const resolved = segments.map((seg) => {
    if (!ROUTE_PARAM_SEGMENT_RE.test(seg)) return seg;
    const paramName = seg.slice(1);
    const hasParam = Object.prototype.hasOwnProperty.call(
      remainingParams,
      paramName,
    );
    const raw = hasParam ? remainingParams[paramName] : undefined;
    if (raw === undefined || String(raw).trim() === "") {
      missing.push(paramName);
      return seg;
    }
    delete remainingParams[paramName];
    return encodeURIComponent(String(raw).trim());
  });
  if (missing.length > 0) {
    return {
      error: `Missing required route parameter(s) ${missing.map((m) => `:${m}`).join(", ")} for template "${template}".`,
    };
  }
  return { path: `/${resolved.join("/")}`, remainingParams };
}

/** Validates a requested app-relative path against declared screen and entity route templates. */
export function validateAppManifestPath(
  manifest: AppCapabilityManifest,
  candidatePath: string,
):
  | { valid: true; screenId?: string; params?: Record<string, string> }
  | {
      valid: false;
      validTemplates: Array<{ screenId: string; route: string }>;
    } {
  const entries: Array<{ screenId: string; route: string }> = [];
  for (const [screenId, screen] of Object.entries(manifest.screens ?? {})) {
    entries.push({ screenId, route: screen.route });
  }
  for (const [entityId, entity] of Object.entries(manifest.entities ?? {})) {
    if (entity.route) {
      entries.push({
        screenId: entity.screen ?? entityId,
        route: entity.route,
      });
    }
  }
  if (entries.length === 0) {
    return { valid: true };
  }
  const normalizedSegments = normalizePathSegments(candidatePath);
  if (normalizedSegments.length === 0) {
    const homeEntry = entries.find(
      (entry) => normalizePathSegments(entry.route).length === 0,
    );
    return {
      valid: true,
      ...(homeEntry ? { screenId: homeEntry.screenId, params: {} } : {}),
    };
  }
  for (const entry of entries) {
    const matched = matchManifestRoute(entry.route, candidatePath);
    if (matched.matched) {
      return { valid: true, screenId: entry.screenId, params: matched.params };
    }
  }
  return { valid: false, validTemplates: entries };
}

/** Resolves `{ screen, params }` against a manifest's declared screen templates. */
export function resolveManifestScreenPath(
  manifest: AppCapabilityManifest,
  screenId: string,
  params?: Record<string, string | number | boolean>,
):
  | { path: string; remainingParams: Record<string, string | number | boolean> }
  | {
      error: string;
      validScreens: Array<{ screenId: string; route: string }>;
    } {
  const screens = manifest.screens ?? {};
  const validScreens = Object.entries(screens).map(([id, s]) => ({
    screenId: id,
    route: s.route,
  }));
  const screen = Object.prototype.hasOwnProperty.call(screens, screenId)
    ? screens[screenId]
    : undefined;
  if (!screen) {
    const list = validScreens
      .map((entry) => `${entry.screenId} (${entry.route})`)
      .join(", ");
    return {
      error: list
        ? `Unknown screen "${screenId}". Valid screens: ${list}.`
        : `Unknown screen "${screenId}".`,
      validScreens,
    };
  }
  const expanded = expandManifestRoute(screen.route, params);
  if ("error" in expanded) {
    return { error: expanded.error, validScreens };
  }
  return expanded;
}
