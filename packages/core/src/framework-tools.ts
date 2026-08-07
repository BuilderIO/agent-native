import {
  normalizeDatabaseToolsMode,
  type DatabaseToolsOption,
} from "./scripts/db/tool-mode.js";

/**
 * Optional framework tool groups an app can turn off through `frameworkTools`.
 *
 * Each name is also stamped onto the group's actions as
 * `ActionEntry.frameworkGroup`. That tag is what lets a single filter subtract a
 * group from every agent tool surface at once: `agent-chat-plugin.ts` spreads
 * these registries at thirteen separate composition sites (interactive chat,
 * dev, MCP-full, A2A, background jobs, triggers), and a per-site condition would
 * be the same omission waiting to happen thirteen times.
 *
 * The tag has a second job: framework-tagged actions are excluded from the
 * DEFAULT first-request tool list, so an app pays for the ~40 kit schemas only
 * when it names them in `initialToolNames`. They stay in the searchable registry
 * either way.
 */
export const FRAMEWORK_TOOL_GROUPS = [
  "sharing",
  "review",
  "history",
  "featureFlags",
  "localization",
  "audit",
  "contextXray",
  "userProfile",
  "automation",
  "docs",
  "resources",
  "web",
  "workspaceApps",
  "chat",
  "email",
] as const;

export type FrameworkToolGroup = (typeof FRAMEWORK_TOOL_GROUPS)[number];

/**
 * Per-group switches for the framework's own agent tools. Every group defaults
 * to today's behavior, so omitting this option leaves the tool surface
 * byte-identical.
 *
 * Turning a group off removes it from the agent surfaces only — interactive
 * chat, MCP, A2A, and background runs. The matching HTTP action routes stay
 * mounted (see `httpActions` in `agent-chat-plugin.ts`) because the UI reaches
 * them through client hooks; a flag meant to trim the model's tool list must not
 * 404 the share dialog.
 *
 * Note the parity cost before disabling one: the framework's contract is that
 * anything the UI can do, the agent can do. `sharing: false` on an app that
 * still renders `ShareButton` breaks that on purpose, and only makes sense when
 * the app has no such surface at all.
 */
export interface FrameworkToolsOption {
  /** Raw SQL tools. `"read"` (default) exposes `db-schema`/`db-query`;
   *  `"write"` adds `db-exec`/`db-patch`; `"off"` exposes neither. */
  database?: DatabaseToolsOption;
  /** Extension management (`create-extension`, `update-extension`, …).
   *  Defaults to false — only apps that intentionally let the agent build
   *  sandboxed mini-apps should enable it. */
  extensions?: boolean;
  /** `share-resource`, `unshare-resource`, `list-resource-shares`,
   *  `set-resource-visibility`, `create-agent-resource-link`. */
  sharing?: boolean;
  /** The inline review/comment kit (`list-review-comments`,
   *  `create-review-comment`, `resolve-review-thread`, …). */
  review?: boolean;
  /** Version snapshots and restore (`create-resource-version`,
   *  `list-resource-versions`, `restore-resource-version`, …). */
  history?: boolean;
  /** `get-feature-flags`, `list-feature-flags`, `set-feature-flag`. */
  featureFlags?: boolean;
  /** `get-localization-preference`, `set-localization-preference`. */
  localization?: boolean;
  /** `list-audit-events`, `get-audit-event`, `export-audit-events`. */
  audit?: boolean;
  /** Context X-Ray (`context-manifest-get`, `context-pin`, `context-evict`, …). */
  contextXray?: boolean;
  /** `get-user-profile`, `update-user-profile`, `change-appearance`. */
  userProfile?: boolean;
  /** Recurring jobs, automations, notifications, and progress runs. */
  automation?: boolean;
  /** `docs-search` over the bundled framework documentation. */
  docs?: boolean;
  /** The `resources` tool — workspace notes, memory, and context files. */
  resources?: boolean;
  /** `web-request` and `web-search`. */
  web?: boolean;
  /** `describe-workspace-apps` and `call-agent` for cross-app delegation. */
  workspaceApps?: boolean;
  /** `chat-history`, `manage-agent-engine`, `manage-agent-loop-settings`. */
  chat?: boolean;
  /** `core-send-email`. */
  email?: boolean;
  /** `"minimal"` turns every group above off, for voice-first and
   *  single-purpose apps that want the template's own actions and nothing else.
   *  Any explicit group key wins over the preset, so
   *  `{ preset: "minimal", resources: true }` keeps exactly one group. */
  preset?: "minimal";
}

export type FrameworkToolsConfig = FrameworkToolsOption | "minimal";

export interface FrameworkToolsInput {
  frameworkTools?: FrameworkToolsConfig;
  /** @deprecated Use `frameworkTools.database`. */
  databaseTools?: DatabaseToolsOption;
  /** @deprecated Use `frameworkTools.extensions`. */
  extensionTools?: boolean;
}

export interface ResolvedFrameworkTools {
  /** Pass-through for `normalizeDatabaseToolsMode`; `undefined` means default. */
  database: DatabaseToolsOption | undefined;
  extensions: boolean;
  disabledGroups: ReadonlySet<FrameworkToolGroup>;
  isEnabled(group: FrameworkToolGroup): boolean;
}

function normalizeFrameworkToolsConfig(
  config: FrameworkToolsConfig | undefined,
): { option: FrameworkToolsOption; minimal: boolean } {
  if (config === "minimal") return { option: {}, minimal: true };
  if (!config || typeof config !== "object") {
    return { option: {}, minimal: false };
  }
  const { preset, ...option } = config;
  return { option, minimal: preset === "minimal" };
}

function conflict(
  key: string,
  legacyKey: string,
  legacyValue: unknown,
  nestedValue: unknown,
): never {
  throw new Error(
    `[agent-native] Conflicting agent-chat options: \`${legacyKey}: ${JSON.stringify(legacyValue)}\` ` +
      `and \`frameworkTools.${key}: ${JSON.stringify(nestedValue)}\` disagree. ` +
      `Remove the deprecated \`${legacyKey}\` and keep \`frameworkTools.${key}\`.`,
  );
}

/**
 * Resolve the public option surface into one shape the plugin threads inward.
 *
 * Legacy `databaseTools` / `extensionTools` remain accepted for one minor. When
 * both forms are present and disagree we throw at plugin init rather than
 * picking a winner: an app that boots with a tool surface nobody chose is how a
 * "why can't the agent see db-query" report ends up unexplainable.
 */
export function resolveFrameworkTools(
  input: FrameworkToolsInput | undefined,
): ResolvedFrameworkTools {
  const { option, minimal } = normalizeFrameworkToolsConfig(
    input?.frameworkTools,
  );

  const legacyDatabase = input?.databaseTools;
  if (legacyDatabase !== undefined) {
    if (
      option.database !== undefined &&
      normalizeDatabaseToolsMode(legacyDatabase) !==
        normalizeDatabaseToolsMode(option.database)
    ) {
      conflict("database", "databaseTools", legacyDatabase, option.database);
    }
    console.warn(
      "[agent-native] `databaseTools` is deprecated — use `frameworkTools: { database: … }`.",
    );
  }
  const legacyExtensions = input?.extensionTools;
  if (legacyExtensions !== undefined) {
    if (
      option.extensions !== undefined &&
      (legacyExtensions === true) !== (option.extensions === true)
    ) {
      conflict(
        "extensions",
        "extensionTools",
        legacyExtensions,
        option.extensions,
      );
    }
    console.warn(
      "[agent-native] `extensionTools` is deprecated — use `frameworkTools: { extensions: … }`.",
    );
  }

  const database =
    option.database ?? legacyDatabase ?? (minimal ? "off" : undefined);
  const extensions = option.extensions ?? legacyExtensions ?? false;

  const disabledGroups = new Set<FrameworkToolGroup>();
  for (const group of FRAMEWORK_TOOL_GROUPS) {
    const explicit = option[group];
    if (explicit === false || (explicit === undefined && minimal)) {
      disabledGroups.add(group);
    }
  }

  return {
    database,
    extensions,
    disabledGroups,
    isEnabled: (group) => !disabledGroups.has(group),
  };
}

/** Structural view of the one field these helpers read, so tagging utilities
 *  stay free of an import cycle with `ActionEntry`. */
interface FrameworkGrouped {
  frameworkGroup?: FrameworkToolGroup;
}

/**
 * Drop every action belonging to a disabled group. Returns the input untouched
 * when nothing is disabled so the default path allocates nothing.
 */
export function filterFrameworkToolGroups<T extends FrameworkGrouped>(
  actions: Record<string, T>,
  disabledGroups: ReadonlySet<FrameworkToolGroup>,
): Record<string, T> {
  if (disabledGroups.size === 0) return actions;
  return Object.fromEntries(
    Object.entries(actions).filter(
      ([, entry]) =>
        entry.frameworkGroup === undefined ||
        !disabledGroups.has(entry.frameworkGroup),
    ),
  );
}

/** True for actions the framework contributes rather than the app's own. */
export function isFrameworkGroupedAction(entry: FrameworkGrouped): boolean {
  return entry.frameworkGroup !== undefined;
}

/**
 * Whether a group is live, for prompt builders that only receive the disabled
 * set. Prompt text and tool schemas must agree: a prompt that names a tool the
 * request does not carry makes the model try it, fail, and often report the
 * capability as nonexistent — so every block naming a group's tool by name has
 * to be gated on the same set that gates the registry.
 */
export function frameworkGroupEnabled(
  disabledGroups: ReadonlySet<FrameworkToolGroup> | undefined,
  group: FrameworkToolGroup,
): boolean {
  return !disabledGroups?.has(group);
}
