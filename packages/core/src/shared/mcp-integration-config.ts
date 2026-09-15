export interface McpIntegrationDefaultsFilterConfig {
  include?: string[];
  exclude?: string[];
}

export type McpIntegrationDefaultsConfig =
  | boolean
  | McpIntegrationDefaultsFilterConfig;

export type McpIntegrationsConfigInput =
  | boolean
  | {
      /**
       * Built-in remote MCP presets shown in the integration catalog.
       *
       * Set to `false` to hide all defaults while keeping custom server setup.
       * Use `include` or `exclude` to allow/block individual preset ids.
       */
      defaults?: McpIntegrationDefaultsConfig;
      /** Whether users can add an arbitrary remote MCP endpoint. Defaults to true. */
      custom?: boolean;
    };

export interface NormalizedMcpIntegrationsConfig {
  enabled: boolean;
  custom: boolean;
  defaults: {
    enabled: boolean;
    include?: string[];
    exclude: string[];
  };
}

function cleanIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const id = item.trim().toLowerCase();
    if (id) ids.add(id);
  }
  return [...ids];
}

export function normalizeMcpIntegrationsConfig(
  input:
    | McpIntegrationsConfigInput
    | NormalizedMcpIntegrationsConfig
    | undefined = true,
): NormalizedMcpIntegrationsConfig {
  if (
    input === false ||
    (input &&
      typeof input === "object" &&
      (input as { enabled?: unknown }).enabled === false)
  ) {
    return {
      enabled: false,
      custom: false,
      defaults: { enabled: false, exclude: [] },
    };
  }

  if (input === true || input === undefined) {
    return {
      enabled: true,
      custom: true,
      defaults: { enabled: true, exclude: [] },
    };
  }

  const defaults = input.defaults;
  const custom = input.custom !== false;
  const defaultsEnabled =
    defaults && typeof defaults === "object"
      ? (defaults as { enabled?: unknown }).enabled !== false
      : defaults !== false;

  if (!defaultsEnabled) {
    return {
      enabled: custom,
      custom,
      defaults: { enabled: false, exclude: [] },
    };
  }

  const include =
    defaults && typeof defaults === "object" ? cleanIds(defaults.include) : [];
  const exclude =
    defaults && typeof defaults === "object" ? cleanIds(defaults.exclude) : [];

  return {
    enabled: true,
    custom,
    defaults: {
      enabled: defaultsEnabled,
      ...(include.length > 0 ? { include } : {}),
      exclude,
    },
  };
}
