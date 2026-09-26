import {
  normalizeDatabaseToolsMode,
  type DatabaseToolsOption,
} from "./scripts/db/tool-mode.js";

export const FRAMEWORK_TOOL_GROUPS = [
  "sharing",
  "review",
  "history",
  "featureFlags",
  "launchDarkly",
  "labs",
  "localization",
  "audit",
  "contextXray",
  "userProfile",
  "automation",
  "docs",
  "resources",
  "browserSessions",
  "web",
  "workspaceApps",
  "chat",
  "email",
  "emailCatalog",
  "workspaceUserGroups",
  "orgServiceTokens",
  "orgAdministration",
] as const;

export type FrameworkToolGroup = (typeof FRAMEWORK_TOOL_GROUPS)[number];

export interface FrameworkToolsOption {
  database?: DatabaseToolsOption;
  extensions?: boolean;
  sharing?: boolean;
  review?: boolean;
  history?: boolean;
  featureFlags?: boolean;
  launchDarkly?: boolean;
  labs?: boolean;
  /** @deprecated Use `frameworkTools.labs`. */
  experiments?: boolean;
  localization?: boolean;
  audit?: boolean;
  contextXray?: boolean;
  userProfile?: boolean;
  automation?: boolean;
  docs?: boolean;
  resources?: boolean;
  browserSessions?: boolean;
  web?: boolean;
  workspaceApps?: boolean;
  chat?: boolean;
  email?: boolean;
  emailCatalog?: boolean;
  workspaceUserGroups?: boolean;
  orgServiceTokens?: boolean;
  orgAdministration?: boolean;
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

  const legacyLabs = option.experiments;
  if (legacyLabs !== undefined) {
    if (
      option.labs !== undefined &&
      (legacyLabs === true) !== (option.labs === true)
    ) {
      conflict("labs", "frameworkTools.experiments", legacyLabs, option.labs);
    }
    console.warn(
      "[agent-native] `frameworkTools.experiments` is deprecated - use `frameworkTools: { labs: … }`.",
    );
  }

  const database =
    option.database ?? legacyDatabase ?? (minimal ? "off" : undefined);
  const extensions = option.extensions ?? legacyExtensions ?? false;
  const labs = option.labs ?? legacyLabs;

  const disabledGroups = new Set<FrameworkToolGroup>();
  for (const group of FRAMEWORK_TOOL_GROUPS) {
    const explicit = group === "labs" ? labs : option[group];
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

export const CORE_ACTION_GROUPS: Record<string, FrameworkToolGroup> = {
  "list-app-member-roles": "orgAdministration",
  "set-app-member-roles": "orgAdministration",
  "list-app-permissions": "orgAdministration",
  "set-app-permission-roles": "orgAdministration",
  "list-workspace-app-access": "orgAdministration",
  "set-workspace-app-access": "orgAdministration",
  "explain-access": "orgAdministration",
  "offboard-member": "orgAdministration",
  "share-resource": "sharing",
  "unshare-resource": "sharing",
  "list-resource-shares": "sharing",
  "set-resource-visibility": "sharing",
  "create-agent-resource-link": "sharing",

  "get-feature-flags": "featureFlags",
  "list-feature-flags": "featureFlags",
  "set-feature-flag": "featureFlags",

  "get-launchdarkly-flags": "launchDarkly",

  "get-labs": "labs",
  "set-lab": "labs",
  "get-chatgpt-subscription-status": "chat",
  "disconnect-chatgpt-subscription": "chat",
  "get-experiments": "labs",
  "set-experiment": "labs",

  "list-recurring-jobs": "automation",
  "manage-recurring-job": "automation",
  "run-automation-now": "automation",
  "list-automation-runs": "automation",
  "get-scheduled-trigger-status": "automation",
  "list-automations": "automation",
  "list-automation-events": "automation",
  "manage-automation": "automation",
  "get-usage-alerts": "automation",
  "manage-usage-alert": "automation",
  "get-usage-metrics": "automation",
  "get-builder-credit-usage": "automation",
  "get-builder-referral-info": "automation",

  "context-manifest-get": "contextXray",
  "context-preview-get": "contextXray",
  "context-pin": "contextXray",
  "context-evict": "contextXray",
  "context-restore": "contextXray",
  "context-report": "contextXray",

  "get-localization-preference": "localization",
  "set-localization-preference": "localization",

  "get-user-profile": "userProfile",
  "update-user-profile": "userProfile",
  "get-auth-methods": "userProfile",
  "set-password": "userProfile",
  "change-password": "userProfile",
  "request-privacy-right": "userProfile",
  "change-appearance": "userProfile",

  "list-audit-events": "audit",
  "get-audit-event": "audit",
  "export-audit-events": "audit",

  "create-resource-version": "history",
  "list-resource-versions": "history",
  "get-resource-version": "history",
  "restore-resource-version": "history",
  "list-resource-history": "history",

  "list-transactional-emails": "emailCatalog",
  "render-transactional-email-preview": "emailCatalog",
  "list-email-log": "emailCatalog",
  "get-email-log-body": "emailCatalog",
  "list-email-activity": "emailCatalog",
  "list-email-engagement": "emailCatalog",

  "list-workspace-user-groups": "workspaceUserGroups",
  "upsert-workspace-user-group": "workspaceUserGroups",
  "bulk-update-workspace-user-groups": "workspaceUserGroups",
  "delete-workspace-user-group": "workspaceUserGroups",

  "create-org-service-token": "orgServiceTokens",
  "list-org-service-tokens": "orgServiceTokens",
  "revoke-org-service-token": "orgServiceTokens",

  "list-review-comments": "review",
  "create-review-comment": "review",
  "reply-review-comment": "review",
  "resolve-review-thread": "review",
  "update-review-comment-anchor": "review",
  "delete-review-comment": "review",
  "update-review-comment": "review",
  "consume-review-feedback": "review",
  "get-review-feedback": "review",
  "set-review-status": "review",
  "send-review-thread-to-agent": "review",
  "react-to-review-comment": "review",
  "set-review-thread-unread": "review",
  "set-review-threads-unread": "review",
  "set-review-thread-muted": "review",
  "create-resource-suggestion": "review",
  "update-resource-suggestion": "review",
  "list-resource-suggestions": "review",
  "get-resource-suggestion": "review",
  "decide-resource-suggestion": "review",
};

interface FrameworkGrouped {
  frameworkGroup?: FrameworkToolGroup;
}

export function resolveFrameworkGroup(
  name: string,
  entry: FrameworkGrouped | undefined,
): FrameworkToolGroup | undefined {
  return entry?.frameworkGroup ?? CORE_ACTION_GROUPS[name];
}

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

export function isFrameworkGroupedAction(
  name: string,
  entry: FrameworkGrouped | undefined,
): boolean {
  return resolveFrameworkGroup(name, entry) !== undefined;
}

export function frameworkGroupEnabled(
  disabledGroups: ReadonlySet<FrameworkToolGroup> | undefined,
  group: FrameworkToolGroup,
): boolean {
  return !disabledGroups?.has(group);
}
