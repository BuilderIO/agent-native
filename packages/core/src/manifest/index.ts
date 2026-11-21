import { z } from "zod";

export const navigationModeSchema = z.enum(["open", "reveal", "keep"]);
export type NavigationMode = z.infer<typeof navigationModeSchema>;

export const APP_CAPABILITIES_META_KEY = "agent-native/app-capabilities";

const actionName = z.string().trim().min(1);
const route = z
  .string()
  .regex(/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]*$/)
  .refine(
    (path) => !path.split("/").some((part) => part === "." || part === ".."),
  );

const suggestionTypeSchema = z.enum([
  "saved-view",
  "automation",
  "ai-split-filter",
]);

const v1AppCapabilityManifestSchema = z.object({
  version: z.literal(1),
  screens: z
    .record(z.string().min(1), z.object({ route, action: actionName }))
    .optional(),
  suggestions: z.partialRecord(suggestionTypeSchema, actionName).optional(),
});

export interface LegacyAppManifestInput {
  version?: undefined;
  id: string;
  displayName: string;
  screens?: {
    defaultLandingScreen?: string;
    definitions?: Record<string, { show?: { route?: string } }>;
  };
  suggestableCapabilities?: ReadonlyArray<{
    type?: string;
    action?: string;
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
  const screens: Record<string, { route: string; action: string }> = {};
  for (const [id, def] of Object.entries(definitions)) {
    if (!id || !def || typeof def !== "object") continue;
    const show = (def as { show?: unknown }).show;
    const rawRoute =
      show && typeof show === "object"
        ? (show as { route?: unknown }).route
        : undefined;
    if (typeof rawRoute === "string" && route.safeParse(rawRoute).success) {
      screens[id] = { route: rawRoute, action: "navigate" };
    }
  }

  const suggestions: Record<string, string> = {};
  if (Array.isArray(legacy.suggestableCapabilities)) {
    for (const cap of legacy.suggestableCapabilities) {
      if (!cap || typeof cap !== "object") continue;
      const { type, action } = cap as { type?: unknown; action?: unknown };
      if (
        suggestionTypeSchema.safeParse(type).success &&
        typeof action === "string" &&
        action.trim().length > 0
      ) {
        suggestions[type as string] = action.trim();
      }
    }
  }

  return {
    version: 1,
    ...(Object.keys(screens).length > 0 ? { screens } : {}),
    ...(Object.keys(suggestions).length > 0 ? { suggestions } : {}),
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
  if (screens.length === 0 && suggestions.length === 0) return undefined;
  return {
    version: 1,
    ...(screens.length > 0 && { screens: Object.fromEntries(screens) }),
    ...(suggestions.length > 0 && {
      suggestions: Object.fromEntries(suggestions),
    }),
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
    const url = new URL(mount.origin);
    url.pathname = base + screen.route;
    return [id, { action: screen.action, url: url.href }] as const;
  });
  return {
    version: manifest.version,
    ...(screens.length > 0 && { screens: Object.fromEntries(screens) }),
    ...(manifest.suggestions && { suggestions: manifest.suggestions }),
  };
}
