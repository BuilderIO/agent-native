import { z } from "zod";

export const navigationModeSchema = z.enum(["open", "reveal", "keep"]);
export type NavigationMode = z.infer<typeof navigationModeSchema>;

const name = z.string().trim().min(1);
const phrases = z.array(name);
const route = z
  .string()
  .refine(
    (path) =>
      path.startsWith("/") &&
      !path.startsWith("//") &&
      !/[^\S ]|[\\?# ]/.test(path),
    "Use an app-relative route template.",
  );
const showSchema = z.object({
  route,
  params: z.record(z.string(), z.json()).optional(),
});
export const appCapabilityManifestSchema = z
  .object({
    id: name,
    displayName: name,
    aliases: phrases,
    routing: z.object({
      domainSummary: name,
      canonicalIntents: phrases,
      entityNouns: phrases,
      negativeDisambiguators: phrases,
    }),
    screens: z.object({
      defaultLandingScreen: name,
      definitions: z.record(name, z.object({ show: showSchema })),
    }),
    entities: z.record(name, z.object({ show: name })),
    viewPolicy: z.record(name, navigationModeSchema),
    suggestableCapabilities: z.array(
      z.object({
        type: z.enum([
          "ai-split-filter",
          "saved-view",
          "automation",
          "customize-app",
          "create-app",
        ]),
        action: name.optional(),
      }),
    ),
    guide: z
      .string()
      .refine(
        (value) => new TextEncoder().encode(value).length <= 400,
        "Guide must be at most 400 UTF-8 bytes.",
      ),
  })
  .superRefine(({ screens, entities }, ctx) => {
    if (!Object.hasOwn(screens.definitions, screens.defaultLandingScreen)) {
      ctx.addIssue({
        code: "custom",
        path: ["screens", "defaultLandingScreen"],
        message: "Choose a declared screen.",
      });
    }
    for (const [id, entity] of Object.entries(entities)) {
      if (!Object.hasOwn(screens.definitions, entity.show)) {
        ctx.addIssue({
          code: "custom",
          path: ["entities", id, "show"],
          message: "Choose a declared screen.",
        });
      }
    }
  });

export type AppCapabilityManifest = z.infer<typeof appCapabilityManifestSchema>;
type ManifestInput = Omit<AppCapabilityManifest, "screens"> & {
  screens: {
    defaultLandingScreen: string;
    definitions: Record<
      string,
      {
        show: { route: string; params?: z.ZodObject | Record<string, unknown> };
      }
    >;
  };
};

/** Declare public app metadata. Zod parameters are published as JSON Schema. */
export function defineAppManifest(input: ManifestInput): AppCapabilityManifest {
  return appCapabilityManifestSchema.parse({
    ...input,
    screens: {
      ...input.screens,
      definitions: Object.fromEntries(
        Object.entries(input.screens.definitions).map(([id, { show }]) => [
          id,
          {
            show: {
              ...show,
              params:
                show.params instanceof z.ZodObject
                  ? z.toJSONSchema(show.params, { io: "input" })
                  : show.params,
            },
          },
        ]),
      ),
    },
  });
}

export function deriveAppManifest(
  app: {
    id?: string;
    name?: string;
    homePath?: string;
  },
  actionNames: readonly string[] = [],
): AppCapabilityManifest {
  const id = app.id ?? "app";
  const displayName = app.name ?? id;
  return defineAppManifest({
    id,
    displayName,
    aliases: [],
    routing: {
      domainSummary: displayName,
      canonicalIntents: [
        ...new Set(
          actionNames
            .map((name) => name.replace(/[-_]+/g, " ").trim())
            .filter(Boolean),
        ),
      ].sort(),
      entityNouns: [],
      negativeDisambiguators: [],
    },
    screens: {
      defaultLandingScreen: "home",
      definitions: { home: { show: { route: app.homePath ?? "/" } } },
    },
    entities: {},
    viewPolicy: {
      background: "keep",
      query: "reveal",
      create: "reveal",
      navigate: "open",
    },
    suggestableCapabilities: [],
    guide: "",
  });
}

/** Expand whole-segment parameters without allowing a parameter to change routes. */
export function resolveScreenPath(
  manifest: AppCapabilityManifest,
  screen: string,
  params: Record<string, unknown> = {},
): string {
  const definition = Object.hasOwn(manifest.screens.definitions, screen)
    ? manifest.screens.definitions[screen]
    : undefined;
  if (!definition) throw new Error(`Unknown screen: ${screen}`);
  return definition.show.route.replace(
    /(^|\/):([A-Za-z_][A-Za-z0-9_]*)(?=\/|$)/g,
    (_, prefix: string, key: string) => {
      const value = Object.hasOwn(params, key) ? params[key] : undefined;
      if (
        (typeof value !== "string" && typeof value !== "number") ||
        String(value) === "" ||
        String(value) === "." ||
        String(value) === ".."
      ) {
        throw new Error(`Missing or invalid screen parameter: ${key}`);
      }
      return prefix + encodeURIComponent(String(value));
    },
  );
}
