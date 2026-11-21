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

export const appCapabilityManifestSchema = z.object({
  version: z.literal(1),
  screens: z
    .record(z.string().min(1), z.object({ route, action: actionName }))
    .optional(),
  suggestions: z
    .partialRecord(
      z.enum(["saved-view", "automation", "ai-split-filter"]),
      actionName,
    )
    .optional(),
});

export type AppCapabilityManifest = z.infer<typeof appCapabilityManifestSchema>;

export function defineAppManifest(
  input: AppCapabilityManifest,
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
