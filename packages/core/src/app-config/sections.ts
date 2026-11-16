import { z } from "zod";

import { collectEnvAliases } from "./env-layer.js";
import { appConfigSchema } from "./schema.js";

/**
 * App-registered config sections, keyed by section name. An app declares the
 * types of its own sections by augmenting this interface:
 *
 * ```ts
 * declare module "@agent-native/core/server" {
 *   interface AppConfigSections {
 *     calendar: typeof calendarConfig;
 *   }
 * }
 * ```
 *
 * Core declares no sections here, so `AppConfig` is unchanged for apps that do
 * not register any.
 */
export interface AppConfigSections {}

export type AppConfigSectionSchema = z.ZodObject;

export type AppConfigSectionOutputs = {
  [K in keyof AppConfigSections]: AppConfigSections[K] extends z.ZodType
    ? z.output<AppConfigSections[K]>
    : never;
};

export type AppConfigSectionInputs = {
  [K in keyof AppConfigSections]?: AppConfigSections[K] extends z.ZodType
    ? z.input<AppConfigSections[K]>
    : never;
};

const SECTION_KEY = /^[a-z][a-zA-Z0-9]*$/;

interface SectionRegistry {
  sections: Map<string, { schema: AppConfigSectionSchema; signature: string }>;
  version: number;
  composed?: { version: number; schema: z.ZodObject } | undefined;
}

const globals = globalThis as typeof globalThis & {
  __agentNativeAppConfigSections?: SectionRegistry;
};
const registry: SectionRegistry = (globals.__agentNativeAppConfigSections ??= {
  sections: new Map(),
  version: 0,
});

function sectionSignature(schema: AppConfigSectionSchema): string {
  return JSON.stringify({
    keys: Object.keys(schema.shape).sort(),
    aliases: collectEnvAliases(schema),
    // Types, defaults and constraints: two schemas with the same keys can
    // still parse the same environment differently.
    fields: z.toJSONSchema(schema, { unrepresentable: "any", io: "input" }),
  });
}

function declaredEnvOwners(skip: string): Map<string, string> {
  const owners = new Map<string, string>();
  for (const alias of collectEnvAliases(appConfigSchema)) {
    for (const key of alias.env) owners.set(key, alias.path.join("."));
  }
  for (const [name, { schema }] of registry.sections) {
    if (name === skip) continue;
    for (const alias of collectEnvAliases(schema)) {
      for (const key of alias.env) {
        owners.set(key, [name, ...alias.path].join("."));
      }
    }
  }
  return owners;
}

/**
 * Adds `schema` to the app config under `key`. Returns true when the effective
 * schema changed, so the caller knows to drop its resolved config.
 */
export function registerAppConfigSection(
  key: string,
  schema: AppConfigSectionSchema,
): boolean {
  if (!SECTION_KEY.test(key)) {
    throw new Error(
      `App config section "${key}" must be a lower-camel-case identifier.`,
    );
  }
  if (Object.prototype.hasOwnProperty.call(appConfigSchema.shape, key)) {
    throw new Error(
      `App config section "${key}" collides with the framework's "${key}" config. Pick an app-specific name.`,
    );
  }
  if (!(schema instanceof z.ZodObject)) {
    throw new Error(`App config section "${key}" must be a z.object() schema.`);
  }

  const signature = sectionSignature(schema);
  const existing = registry.sections.get(key);
  if (existing) {
    if (existing.schema === schema) return false;
    // A module re-evaluated in the same process (tests, dev reloads) registers
    // an equal schema again; a different shape under the same key is two
    // owners fighting over one name.
    if (existing.signature !== signature) {
      throw new Error(
        `App config section "${key}" is already registered with a different shape.`,
      );
    }
  }

  const owners = declaredEnvOwners(key);
  for (const alias of collectEnvAliases(schema)) {
    for (const env of alias.env) {
      const owner = owners.get(env);
      if (owner) {
        throw new Error(
          `App config section "${key}" declares env "${env}" for "${[key, ...alias.path].join(".")}", but "${owner}" already reads it.`,
        );
      }
    }
  }

  registry.sections.set(key, { schema, signature });
  registry.version += 1;
  return true;
}

export function appConfigSectionsVersion(): number {
  return registry.version;
}

export function registeredAppConfigSectionKeys(): string[] {
  return [...registry.sections.keys()].sort();
}

/**
 * The framework schema plus every registered app section, each wrapped in
 * `.prefault({})` like the framework's own domains.
 */
export function getAppConfigSchema(): z.ZodObject {
  if (registry.sections.size === 0) return appConfigSchema;
  if (registry.composed?.version === registry.version) {
    return registry.composed.schema;
  }
  const extension = Object.fromEntries(
    [...registry.sections].map(([key, { schema }]) => [
      key,
      schema.prefault({}),
    ]),
  );
  const schema = appConfigSchema.extend(extension);
  registry.composed = { version: registry.version, schema };
  return schema;
}

export function clearAppConfigSectionsForTests(): void {
  registry.sections.clear();
  registry.version += 1;
  registry.composed = undefined;
}
