import nodePath from "node:path";

import "../authorization/check-action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import type { ActionTool } from "../agent/types.js";
import { CORE_ACTION_GROUPS } from "../framework-tools.js";
import { captureCliOutput } from "./cli-capture.js";

let _fs: typeof import("fs") | undefined;
async function getFs(): Promise<typeof import("fs")> {
  if (!_fs) {
    _fs = await import("node:fs");
  }
  return _fs;
}
import { fileURLToPath } from "node:url";

import { importRuntimeSourceModule } from "./runtime-source-module.js";

const SKIP_FILES = new Set([
  "helpers",
  "run",
  "db-connect",
  "db-status",
  "registry",
  "migrate-production",
]);

function isRuntimeSourceFile(filename: string): boolean {
  if (!/\.(ts|js)$/.test(filename)) return false;
  if (/\.d\.ts$/.test(filename)) return false;
  if (/\.(test|spec)\.(ts|js)$/.test(filename)) return false;
  return true;
}

const PACKAGE_ACTION_REGISTRY_KEY = Symbol.for(
  "@agent-native/core.package-action-registry",
);

function getPackageActionRegistry(): Record<string, ActionEntry> {
  const sharedGlobal = globalThis as typeof globalThis & {
    [key: symbol]: unknown;
  };
  const existing = sharedGlobal[PACKAGE_ACTION_REGISTRY_KEY];
  if (existing && typeof existing === "object") {
    return existing as Record<string, ActionEntry>;
  }

  const registry: Record<string, ActionEntry> = {};
  sharedGlobal[PACKAGE_ACTION_REGISTRY_KEY] = registry;
  return registry;
}

export function registerPackageActions(
  actions: Record<string, ActionEntry>,
): void {
  const packageActionRegistry = getPackageActionRegistry();
  for (const [name, entry] of Object.entries(actions)) {
    if (packageActionRegistry[name]) continue;
    packageActionRegistry[name] = entry;
  }
}

export function mergePackageActions(
  registry: Record<string, ActionEntry>,
): void {
  for (const [name, entry] of Object.entries(getPackageActionRegistry())) {
    if (registry[name]) continue;
    registry[name] = entry;
  }
}

function splitShellArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inDouble = false;
  let inSingle = false;
  let wasQuoted = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      wasQuoted = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      wasQuoted = true;
      continue;
    }
    if ((ch === " " || ch === "\t") && !inDouble && !inSingle) {
      if (current.length > 0 || wasQuoted) {
        tokens.push(current);
      }
      current = "";
      wasQuoted = false;
      continue;
    }
    current += ch;
  }
  if (current.length > 0 || wasQuoted) {
    tokens.push(current);
  }
  return tokens;
}

function wrapDefaultExport(
  name: string,
  defaultFn: (args: string[]) => Promise<void>,
): ActionEntry {
  const tool: ActionTool = {
    description: `Run the "${name}" action. Pass arguments as key-value pairs.`,
    parameters: {
      type: "object",
      properties: {
        args: {
          type: "string",
          description:
            "Space-separated CLI arguments (e.g. '--id abc --title Hello')",
        },
      },
    },
  };

  return {
    tool,
    run: async (args: Record<string, string>): Promise<string> => {
      const cliArgs: string[] = [];
      if (args.args && Object.keys(args).length === 1) {
        cliArgs.push(...splitShellArgs(args.args));
      } else {
        for (const [k, v] of Object.entries(args)) {
          cliArgs.push(`--${k}`, v);
        }
      }
      return captureCliOutput(() => defaultFn(cliArgs));
    },
  };
}

function preserveActionFlags(entry: Record<string, any>): Partial<ActionEntry> {
  const out: Partial<ActionEntry> = {};
  if (
    entry.access &&
    typeof entry.access === "object" &&
    !Array.isArray(entry.access)
  ) {
    out.access = entry.access;
  }
  if (typeof entry.agentTool === "boolean") out.agentTool = entry.agentTool;
  if (typeof entry.mcpTool === "boolean") out.mcpTool = entry.mcpTool;
  if (typeof entry.deferLoading === "boolean") {
    out.deferLoading = entry.deferLoading;
  }
  if (typeof entry.requiresAuth === "boolean") {
    out.requiresAuth = entry.requiresAuth;
  }
  if (typeof entry.uiOnly === "boolean") out.uiOnly = entry.uiOnly;
  if (typeof entry.readOnly === "boolean") out.readOnly = entry.readOnly;
  if (typeof entry.grounding === "boolean") out.grounding = entry.grounding;
  if (typeof entry.allowInPlanMode === "boolean") {
    out.allowInPlanMode = entry.allowInPlanMode;
  }
  if (
    entry.planMode &&
    typeof entry.planMode === "object" &&
    !Array.isArray(entry.planMode)
  ) {
    out.planMode = entry.planMode;
  }
  if (typeof entry.parallelSafe === "boolean") {
    out.parallelSafe = entry.parallelSafe;
  }
  if (typeof entry.endsTurn === "boolean") {
    out.endsTurn = entry.endsTurn;
  }
  if (typeof entry.dedupe === "boolean") {
    out.dedupe = entry.dedupe;
  }
  if (typeof entry.toolCallable === "boolean") {
    out.toolCallable = entry.toolCallable;
  }
  if (
    Array.isArray(entry.capabilityScopes) &&
    entry.capabilityScopes.length > 0 &&
    entry.capabilityScopes.every((scope: unknown) => typeof scope === "string")
  ) {
    out.capabilityScopes = entry.capabilityScopes;
  }
  if (
    entry.publicAgent &&
    typeof entry.publicAgent === "object" &&
    !Array.isArray(entry.publicAgent)
  ) {
    out.publicAgent = entry.publicAgent;
  }
  if (typeof entry.link === "function") {
    out.link = entry.link;
  }
  if (
    entry.mcpApp &&
    typeof entry.mcpApp === "object" &&
    !Array.isArray(entry.mcpApp)
  ) {
    out.mcpApp = entry.mcpApp;
  }
  if (
    entry.chatUI &&
    typeof entry.chatUI === "object" &&
    !Array.isArray(entry.chatUI)
  ) {
    out.chatUI = entry.chatUI;
  }
  if (typeof entry.timeoutMs === "number") out.timeoutMs = entry.timeoutMs;
  if (typeof entry.maxResultChars === "number") {
    out.maxResultChars = entry.maxResultChars;
  }
  if (
    typeof entry.needsApproval === "boolean" ||
    typeof entry.needsApproval === "function"
  ) {
    out.needsApproval = entry.needsApproval;
  }
  if (typeof entry.allowPersistentApproval === "boolean") {
    out.allowPersistentApproval = entry.allowPersistentApproval;
  }
  return out;
}

async function resolveActionsDir(from: string): Promise<string> {
  const fs = await getFs();
  const exists = (p: string) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  };
  if (!from) {
    const cwdActions = nodePath.join(process.cwd(), "actions");
    if (exists(cwdActions)) return cwdActions;
    return nodePath.join(process.cwd(), "scripts");
  }
  if (from.startsWith("file://") || from.startsWith("file:///")) {
    const callerPath = fileURLToPath(from);
    const callerDir = nodePath.dirname(callerPath);
    const actionsResolved = nodePath.resolve(callerDir, "../../actions");
    if (exists(actionsResolved)) return actionsResolved;
    const scriptsResolved = nodePath.resolve(callerDir, "../../scripts");
    if (exists(scriptsResolved)) return scriptsResolved;
    const cwdActions = nodePath.join(process.cwd(), "actions");
    if (exists(cwdActions)) return cwdActions;
    return nodePath.join(process.cwd(), "scripts");
  }
  if (from === "auto") {
    const cwdActions = nodePath.join(process.cwd(), "actions");
    if (exists(cwdActions)) return cwdActions;
    return nodePath.join(process.cwd(), "scripts");
  }
  return nodePath.resolve(from);
}

async function loadActionsIntoRegistry(
  actionsDir: string,
  registry: Record<string, ActionEntry>,
  skipExisting: boolean,
): Promise<void> {
  let files: string[];
  try {
    const fs = await getFs();
    if (!fs.existsSync(actionsDir)) return;
    files = fs.readdirSync(actionsDir);
  } catch {
    return;
  }

  const actionFiles = files.filter((f) => {
    if (!isRuntimeSourceFile(f)) return false;
    const name = f.replace(/\.(ts|js)$/, "");
    if (name.startsWith("_")) return false;
    if (SKIP_FILES.has(name)) return false;
    return true;
  });

  for (const file of actionFiles) {
    const name = file.replace(/\.(ts|js)$/, "");
    if (skipExisting && registry[name]) continue;

    const filePath = nodePath.join(actionsDir, file);
    try {
      const mod = await importRuntimeSourceModule(filePath);

      if (mod.tool && typeof mod.run === "function") {
        registry[name] = {
          tool: mod.tool,
          run: mod.run,
          ...(mod.http !== undefined ? { http: mod.http } : {}),
          ...preserveActionFlags(mod),
        };
      } else if (
        mod.default &&
        typeof mod.default === "object" &&
        mod.default.tool &&
        typeof mod.default.run === "function"
      ) {
        registry[name] = {
          tool: mod.default.tool,
          run: mod.default.run,
          ...(mod.default.http !== undefined ? { http: mod.default.http } : {}),
          ...preserveActionFlags(mod.default),
        };
      } else if (typeof mod.default === "function") {
        registry[name] = wrapDefaultExport(name, mod.default);
      }
    } catch (err) {
      const msg =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      console.warn(
        `[action-discovery] Skipped "${file}" — failed to import. If this is an ` +
          `agent action (not a CLI script), it will be missing from the agent's tools:\n${msg}`,
      );
    }
  }
}

export function loadActionsFromStaticRegistry(
  modules: Record<string, unknown>,
): Record<string, ActionEntry> {
  const registry: Record<string, ActionEntry> = {};
  for (const [name, raw] of Object.entries(modules)) {
    const mod = raw as Record<string, any> | null | undefined;
    if (!mod) continue;

    if (mod.tool && typeof mod.run === "function") {
      registry[name] = {
        tool: mod.tool,
        run: mod.run,
        ...(mod.http !== undefined ? { http: mod.http } : {}),
        ...preserveActionFlags(mod),
      };
      continue;
    }

    const def = mod.default;
    if (
      def &&
      typeof def === "object" &&
      def.tool &&
      typeof def.run === "function"
    ) {
      registry[name] = {
        tool: def.tool,
        run: def.run,
        ...(def.http !== undefined ? { http: def.http } : {}),
        ...preserveActionFlags(def),
      };
      continue;
    }

    if (typeof def === "function") {
      registry[name] = wrapDefaultExport(name, def);
    }
  }
  return registry;
}

export async function autoDiscoverActions(
  from: string,
): Promise<Record<string, ActionEntry>> {
  const actionsDir = await resolveActionsDir(from);
  const registry: Record<string, ActionEntry> = {};

  try {
    await loadActionsIntoRegistry(actionsDir, registry, false);
  } catch (err: any) {
    console.warn(
      `[autoDiscoverActions] Could not read actions directory: ${actionsDir} — ${err?.message}`,
    );
  }

  if (Object.keys(registry).length === 0 && from) {
    try {
      let registryPath: string;
      if (from.startsWith("file://") || from.startsWith("file:///")) {
        const callerDir = nodePath.dirname(fileURLToPath(from));
        registryPath = nodePath.resolve(
          callerDir,
          "../../.generated/actions-registry.js",
        );
      } else {
        registryPath = nodePath.resolve(
          from,
          "../.generated/actions-registry.js",
        );
      }
      const mod = await import(/* @vite-ignore */ registryPath);
      const staticEntries = loadActionsFromStaticRegistry(mod.default || mod);
      Object.assign(registry, staticEntries);
      if (Object.keys(staticEntries).length > 0) {
        console.log(
          `[autoDiscoverActions] Filesystem scan found 0 actions — loaded ${Object.keys(staticEntries).length} from .generated/actions-registry.ts instead. ` +
            `Consider switching to loadActionsFromStaticRegistry(actionsRegistry) for production reliability.`,
        );
      }
    } catch {
      // No generated registry available — registry stays empty.
    }
  }

  if (Object.keys(registry).length === 0) {
    console.warn(
      `[autoDiscoverActions] WARNING: No template actions found! ` +
        `The agent will have no template-specific tools. ` +
        `If in production, switch from autoDiscoverActions to loadActionsFromStaticRegistry. ` +
        `See: https://docs.agent-native.com/actions#static-registry`,
    );
  }

  mergePackageActions(registry);

  try {
    const { getWorkspaceCoreExports } =
      await import("../deploy/workspace-core.js");
    const ws = await getWorkspaceCoreExports(process.cwd());
    if (ws && ws.actionsDir) {
      await loadActionsIntoRegistry(ws.actionsDir, registry, true);
    }
  } catch {
    // workspace-core discovery unavailable (e.g. edge runtime) — skip.
  }

  try {
    await mergeCoreSharingActions(registry);
  } catch {
    // Ignore — templates without sharing still work.
  }

  return registry;
}

export { CORE_ACTION_GROUPS };

export const ALWAYS_ON_CORE_ACTIONS: ReadonlySet<string> = new Set([
  "upload-image",
  "list-mcp-tools",
  "call-mcp-tool",
  "get-hosted-harness-config",
  "set-hosted-harness-enabled",
  "set-tool-approval-policy",
]);

export async function mergeCoreSharingActions(
  registry: Record<string, ActionEntry>,
): Promise<void> {
  const entries: Array<[string, () => Promise<any>]> = [
    ["share-resource", () => import("../sharing/actions/share-resource.js")],
    [
      "unshare-resource",
      () => import("../sharing/actions/unshare-resource.js"),
    ],
    [
      "list-resource-shares",
      () => import("../sharing/actions/list-resource-shares.js"),
    ],
    [
      "set-resource-visibility",
      () => import("../sharing/actions/set-resource-visibility.js"),
    ],
    [
      "create-agent-resource-link",
      () => import("../sharing/actions/create-agent-resource-link.js"),
    ],
    [
      "list-app-member-roles",
      () => import("../org/actions/list-app-member-roles.js"),
    ],
    [
      "set-app-member-roles",
      () => import("../org/actions/set-app-member-roles.js"),
    ],
    [
      "list-app-permissions",
      () => import("../org/actions/list-app-permissions.js"),
    ],
    [
      "set-app-permission-roles",
      () => import("../org/actions/set-app-permission-roles.js"),
    ],
    [
      "list-workspace-app-access",
      () => import("../org/actions/list-workspace-app-access.js"),
    ],
    [
      "set-workspace-app-access",
      () => import("../org/actions/set-workspace-app-access.js"),
    ],
    ["explain-access", () => import("../org/actions/explain-access.js")],
    ["offboard-member", () => import("../org/actions/offboard-member.js")],
    ["upload-image", () => import("../file-upload/actions/upload-image.js")],
    [
      "list-workspace-user-groups",
      () =>
        import("../workspace-connections/actions/list-workspace-user-groups.js"),
    ],
    [
      "upsert-workspace-user-group",
      () =>
        import("../workspace-connections/actions/upsert-workspace-user-group.js"),
    ],
    [
      "bulk-update-workspace-user-groups",
      () =>
        import("../workspace-connections/actions/bulk-update-workspace-user-groups.js"),
    ],
    [
      "delete-workspace-user-group",
      () =>
        import("../workspace-connections/actions/delete-workspace-user-group.js"),
    ],
    [
      "list-transactional-emails",
      () => import("../email-catalog/actions/list-transactional-emails.js"),
    ],
    [
      "render-transactional-email-preview",
      () =>
        import("../email-catalog/actions/render-transactional-email-preview.js"),
    ],
    [
      "list-email-log",
      () => import("../email-catalog/actions/list-email-log.js"),
    ],
    [
      "get-email-log-body",
      () => import("../email-catalog/actions/get-email-log-body.js"),
    ],
    [
      "list-email-activity",
      () => import("../email-catalog/actions/list-email-activity.js"),
    ],
    [
      "list-email-engagement",
      () => import("../email-catalog/actions/list-email-engagement.js"),
    ],
    [
      "get-feature-flags",
      () => import("../feature-flags/actions/get-feature-flags.js"),
    ],
    [
      "get-launchdarkly-flags",
      () => import("../launchdarkly/actions/get-launchdarkly-flags.js"),
    ],
    [
      "get-hosted-harness-config",
      () => import("../hosted-harness/actions/get-hosted-harness-config.js"),
    ],
    [
      "set-hosted-harness-enabled",
      () => import("../hosted-harness/actions/set-hosted-harness-enabled.js"),
    ],
    [
      "set-tool-approval-policy",
      () => import("../agent/actions/set-tool-approval-policy.js"),
    ],
    [
      "list-feature-flags",
      () => import("../feature-flags/actions/list-feature-flags.js"),
    ],
    [
      "set-feature-flag",
      () => import("../feature-flags/actions/set-feature-flag.js"),
    ],
    ["get-labs", () => import("../labs/actions/get-labs.js")],
    ["set-lab", () => import("../labs/actions/set-lab.js")],
    [
      "get-chatgpt-subscription-status",
      () => import("../agent/actions/get-chatgpt-subscription-status.js"),
    ],
    [
      "disconnect-chatgpt-subscription",
      () => import("../agent/actions/disconnect-chatgpt-subscription.js"),
    ],
    [
      "get-experiments",
      () => import("../experiments/actions/get-experiments.js"),
    ],
    [
      "set-experiment",
      () => import("../experiments/actions/set-experiment.js"),
    ],
    [
      "list-recurring-jobs",
      () => import("../jobs/actions/list-recurring-jobs.js"),
    ],
    [
      "manage-recurring-job",
      () => import("../jobs/actions/manage-recurring-job.js"),
    ],
    [
      "run-automation-now",
      () => import("../jobs/actions/run-automation-now.js"),
    ],
    [
      "list-automation-runs",
      () => import("../jobs/actions/list-automation-runs.js"),
    ],
    [
      "get-scheduled-trigger-status",
      () => import("../jobs/actions/get-scheduled-trigger-status.js"),
    ],
    [
      "list-automations",
      () => import("../triggers/actions/list-automations.js"),
    ],
    [
      "list-automation-events",
      () => import("../triggers/actions/list-automation-events.js"),
    ],
    [
      "manage-automation",
      () => import("../triggers/actions/manage-automation.js"),
    ],
    ["get-usage-alerts", () => import("../usage/actions/get-usage-alerts.js")],
    [
      "manage-usage-alert",
      () => import("../usage/actions/manage-usage-alert.js"),
    ],
    [
      "get-usage-metrics",
      () => import("../usage/actions/get-usage-metrics.js"),
    ],
    [
      "get-builder-credit-usage",
      () => import("../usage/actions/get-builder-credit-usage.js"),
    ],
    [
      "get-builder-referral-info",
      () => import("../usage/actions/get-builder-referral-info.js"),
    ],
    [
      "context-manifest-get",
      () => import("../agent/context-xray/actions/context-manifest-get.js"),
    ],
    [
      "context-preview-get",
      () => import("../agent/context-xray/actions/context-preview-get.js"),
    ],
    [
      "context-pin",
      () => import("../agent/context-xray/actions/context-pin.js"),
    ],
    [
      "context-evict",
      () => import("../agent/context-xray/actions/context-evict.js"),
    ],
    [
      "context-restore",
      () => import("../agent/context-xray/actions/context-restore.js"),
    ],
    [
      "context-report",
      () => import("../agent/context-xray/actions/context-report.js"),
    ],
    [
      "get-localization-preference",
      () => import("../localization/actions/get-localization-preference.js"),
    ],
    [
      "set-localization-preference",
      () => import("../localization/actions/set-localization-preference.js"),
    ],
    [
      "get-user-profile",
      () => import("../user-profile/actions/get-user-profile.js"),
    ],
    [
      "update-user-profile",
      () => import("../user-profile/actions/update-user-profile.js"),
    ],
    [
      "get-auth-methods",
      () => import("../user-profile/actions/get-auth-methods.js"),
    ],
    ["set-password", () => import("../user-profile/actions/set-password.js")],
    [
      "change-password",
      () => import("../user-profile/actions/change-password.js"),
    ],
    [
      "request-privacy-right",
      () => import("../user-profile/actions/request-privacy-right.js"),
    ],
    [
      "change-appearance",
      () => import("../appearance/actions/change-appearance.js"),
    ],
    [
      "list-audit-events",
      () => import("../audit/actions/list-audit-events.js"),
    ],
    ["get-audit-event", () => import("../audit/actions/get-audit-event.js")],
    [
      "export-audit-events",
      () => import("../audit/actions/export-audit-events.js"),
    ],
    [
      "create-resource-version",
      () => import("../history/actions/create-resource-version.js"),
    ],
    [
      "list-resource-versions",
      () => import("../history/actions/list-resource-versions.js"),
    ],
    [
      "get-resource-version",
      () => import("../history/actions/get-resource-version.js"),
    ],
    [
      "restore-resource-version",
      () => import("../history/actions/restore-resource-version.js"),
    ],
    [
      "list-resource-history",
      () => import("../history/actions/list-resource-history.js"),
    ],
    [
      "list-review-comments",
      () => import("../review/actions/list-review-comments.js"),
    ],
    [
      "create-review-comment",
      () => import("../review/actions/create-review-comment.js"),
    ],
    [
      "reply-review-comment",
      () => import("../review/actions/reply-review-comment.js"),
    ],
    [
      "resolve-review-thread",
      () => import("../review/actions/resolve-review-thread.js"),
    ],
    [
      "update-review-comment-anchor",
      () => import("../review/actions/update-review-comment-anchor.js"),
    ],
    [
      "delete-review-comment",
      () => import("../review/actions/delete-review-comment.js"),
    ],
    [
      "update-review-comment",
      () => import("../review/actions/update-review-comment.js"),
    ],
    [
      "consume-review-feedback",
      () => import("../review/actions/consume-review-feedback.js"),
    ],
    [
      "get-review-feedback",
      () => import("../review/actions/get-review-feedback.js"),
    ],
    [
      "set-review-status",
      () => import("../review/actions/set-review-status.js"),
    ],
    [
      "send-review-thread-to-agent",
      () => import("../review/actions/send-review-thread-to-agent.js"),
    ],
    [
      "react-to-review-comment",
      () => import("../review/actions/react-to-review-comment.js"),
    ],
    [
      "set-review-thread-unread",
      () => import("../review/actions/set-review-thread-unread.js"),
    ],
    [
      "set-review-threads-unread",
      () => import("../review/actions/set-review-threads-unread.js"),
    ],
    [
      "set-review-thread-muted",
      () => import("../review/actions/set-review-thread-muted.js"),
    ],
    [
      "create-resource-suggestion",
      () =>
        import("../review/suggestions/actions/create-resource-suggestion.js"),
    ],
    [
      "list-resource-suggestions",
      () =>
        import("../review/suggestions/actions/list-resource-suggestions.js"),
    ],
    [
      "update-resource-suggestion",
      () =>
        import("../review/suggestions/actions/update-resource-suggestion.js"),
    ],
    [
      "get-resource-suggestion",
      () => import("../review/suggestions/actions/get-resource-suggestion.js"),
    ],
    [
      "decide-resource-suggestion",
      () =>
        import("../review/suggestions/actions/decide-resource-suggestion.js"),
    ],
    [
      "create-org-service-token",
      () => import("../mcp/actions/create-org-service-token.js"),
    ],
    [
      "list-org-service-tokens",
      () => import("../mcp/actions/list-org-service-tokens.js"),
    ],
    [
      "revoke-org-service-token",
      () => import("../mcp/actions/revoke-org-service-token.js"),
    ],
    ["list-mcp-tools", () => import("../mcp/actions/list-mcp-tools.js")],
    ["call-mcp-tool", () => import("../mcp/actions/call-mcp-tool.js")],
  ];
  for (const [name, loader] of entries) {
    if (registry[name]) continue;
    try {
      const mod = await loader();
      const def = mod.default;
      if (def && def.tool && typeof def.run === "function") {
        registry[name] = {
          tool: def.tool,
          run: def.run,
          ...(def.http !== undefined ? { http: def.http } : {}),
          ...preserveActionFlags(def),
          ...(CORE_ACTION_GROUPS[name]
            ? { frameworkGroup: CORE_ACTION_GROUPS[name] }
            : {}),
        };
      }
    } catch {
      // Skip any sharing action that fails to import.
    }
  }
}

/** @deprecated Use `autoDiscoverActions` instead */
export const autoDiscoverScripts = autoDiscoverActions;
