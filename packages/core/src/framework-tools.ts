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

/**
 * Which `frameworkTools` switch owns each framework action kit.
 *
 * This map is the authority. `ActionEntry.frameworkGroup` is an optional
 * pre-resolved copy of the same answer, not a requirement: it is stamped only
 * by `mergeCoreSharingActions`, which runs against the ungated `httpActions`
 * registry, so for a year every app loading core kits through
 * `loadActionsFromStaticRegistry` or its own actions directory carried
 * untagged entries and silently ignored eight of the `frameworkTools`
 * switches. Resolve by name and the switch works no matter how the action was
 * registered.
 *
 * Membership does two jobs: one filter subtracts a whole kit from every agent
 * tool surface at once (the plugin spreads these registries at thirteen
 * composition sites), and it keeps these ~45 schemas out of the DEFAULT
 * first-request tool list. They stay reachable through `tool-search`.
 *
 * Anything absent from this map is always-on and must be listed in
 * `ALWAYS_ON_CORE_ACTIONS` instead. `action-discovery.spec.ts` fails when a new
 * core action appears in neither, so "always-on" stays a decision someone made
 * rather than the default that happens when a map goes un-updated.
 */
export const CORE_ACTION_GROUPS: Record<string, FrameworkToolGroup> = {
  "share-resource": "sharing",
  "unshare-resource": "sharing",
  "list-resource-shares": "sharing",
  "set-resource-visibility": "sharing",
  "create-agent-resource-link": "sharing",

  "get-feature-flags": "featureFlags",
  "list-feature-flags": "featureFlags",
  "set-feature-flag": "featureFlags",

  "list-recurring-jobs": "automation",
  "manage-recurring-job": "automation",
  "run-automation-now": "automation",
  "list-automation-runs": "automation",
  "list-automations": "automation",
  "manage-automation": "automation",
  "get-usage-alerts": "automation",
  "manage-usage-alert": "automation",
  "get-usage-metrics": "automation",

  "context-manifest-get": "contextXray",
  "context-preview-get": "contextXray",
  "context-pin": "contextXray",
  "context-evict": "contextXray",
  "context-restore": "contextXray",
  "context-report": "contextXray",

  "get-localization-preference": "localization",
  "set-localization-preference": "localization",

  // Profile, credentials, and appearance share one switch: an app that hides
  // its profile surface from the agent hides password management with it.
  "get-user-profile": "userProfile",
  "update-user-profile": "userProfile",
  "get-auth-methods": "userProfile",
  "set-password": "userProfile",
  "change-password": "userProfile",
  "change-appearance": "userProfile",

  "list-audit-events": "audit",
  "get-audit-event": "audit",
  "export-audit-events": "audit",

  "create-resource-version": "history",
  "list-resource-versions": "history",
  "get-resource-version": "history",
  "restore-resource-version": "history",
  "list-resource-history": "history",

  "list-review-comments": "review",
  "create-review-comment": "review",
  "reply-review-comment": "review",
  "resolve-review-thread": "review",
  "delete-review-comment": "review",
  "consume-review-feedback": "review",
  "get-review-feedback": "review",
  "set-review-status": "review",
  "send-review-thread-to-agent": "review",
};

/** Structural view of the one field these helpers read, so tagging utilities
 *  stay free of an import cycle with `ActionEntry`. */
interface FrameworkGrouped {
  frameworkGroup?: FrameworkToolGroup;
}

/**
 * Which group owns an action, by name first and tag second.
 *
 * Name first because the name is present on every registration path, while the
 * tag is stamped on exactly one — an app is not less entitled to its
 * `frameworkTools` switches because it loaded core kits from a generated
 * registry instead of `autoDiscoverActions`.
 */
export function resolveFrameworkGroup(
  name: string,
  entry: FrameworkGrouped | undefined,
): FrameworkToolGroup | undefined {
  return entry?.frameworkGroup ?? CORE_ACTION_GROUPS[name];
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
    Object.entries(actions).filter(([name, entry]) => {
      const group = resolveFrameworkGroup(name, entry);
      return group === undefined || !disabledGroups.has(group);
    }),
  );
}

/** True for actions the framework contributes rather than the app's own. */
export function isFrameworkGroupedAction(
  name: string,
  entry: FrameworkGrouped | undefined,
): boolean {
  return resolveFrameworkGroup(name, entry) !== undefined;
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
