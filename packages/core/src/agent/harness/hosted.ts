import type { AgentNativeHarnessRuntime } from "../../config.js";

export type HostedHarnessRuntime = AgentNativeHarnessRuntime;

export const HOSTED_HARNESS_ENV_KEY = "AGENT_NATIVE_HOSTED_HARNESS" as const;
export const HOSTED_HARNESS_ORG_SETTING_KEY = "agent-harness.enabled" as const;

export const HOSTED_HARNESS_RUNTIME_ORDER: readonly HostedHarnessRuntime[] = [
  "claude-code",
  "codex",
  "pi",
  "opencode",
];

export const HOSTED_HARNESS_AGENT_DESCRIPTIONS: Record<
  HostedHarnessRuntime,
  string
> = {
  "claude-code":
    "Production mode is tools-only: no repository, shell, or code editing. Use the Electron app for full coding workflows.",
  codex:
    "Production mode is tools-only: no repository, shell, or code editing. Use the Electron app for full coding workflows.",
  pi: "Production mode is tools-only: no repository, shell, or code editing. Use the Electron app for full coding workflows.",
  opencode:
    "Production mode is tools-only: no repository, shell, or code editing. Use the Electron app for full coding workflows.",
};

export const HOSTED_HARNESS_AGENT_LABELS: Record<HostedHarnessRuntime, string> =
  {
    "claude-code": "Claude Code Agent",
    codex: "Codex",
    pi: "Pi",
    opencode: "OpenCode",
  };

export const HOSTED_HARNESS_BLOCKED_TOOL_NAMES = new Set([
  "bash",
  "edit",
  "read",
  "write",
  "run-code",
  "tool-orchestration",
  "get-code-execution",
  "workspace-files",
  "show-workspace-file",
  "read-workspace-file",
  "write-workspace-file",
  "delete-workspace-file",
  "grep-workspace-file",
  "connect-builder",
]);

export function isHostedHarnessRuntime(
  value: unknown,
): value is HostedHarnessRuntime {
  return (
    value === "claude-code" ||
    value === "codex" ||
    value === "pi" ||
    value === "opencode"
  );
}

export function normalizeHostedHarnessRuntime(
  value: unknown,
): HostedHarnessRuntime | undefined {
  if (value === "claude") return "claude-code";
  return isHostedHarnessRuntime(value) ? value : undefined;
}

export function normalizeHostedHarnessRuntimes(
  value: unknown,
): HostedHarnessRuntime[] {
  if (!Array.isArray(value)) return [...HOSTED_HARNESS_RUNTIME_ORDER];
  const runtimes = value
    .map((runtime) => normalizeHostedHarnessRuntime(runtime))
    .filter(
      (runtime): runtime is HostedHarnessRuntime => runtime !== undefined,
    );
  return [...new Set(runtimes)];
}

export function isHostedHarnessConfigured(value: unknown): boolean {
  return (
    value === true ||
    (!!value && typeof value === "object" && !Array.isArray(value))
  );
}

export function hostedHarnessAgentOption(runtime: HostedHarnessRuntime) {
  return {
    id: runtime,
    label: HOSTED_HARNESS_AGENT_LABELS[runtime],
    description: HOSTED_HARNESS_AGENT_DESCRIPTIONS[runtime],
  };
}

export function isHostedHarnessBlockedToolName(name: string): boolean {
  return (
    HOSTED_HARNESS_BLOCKED_TOOL_NAMES.has(name) ||
    name.startsWith("workspace-file-") ||
    name.startsWith("data-program-")
  );
}

export function filterHostedHarnessToolNames(
  names: readonly string[],
): string[] {
  return names.filter((name) => !isHostedHarnessBlockedToolName(name));
}

export function hostedHarnessSystemPrompt(
  runtime: HostedHarnessRuntime,
): string {
  return `<hosted-tools-only-harness runtime="${runtime}">
You are running as a hosted ${HOSTED_HARNESS_AGENT_LABELS[runtime]} inside a production app.
This is a tools-only mode. You have no repository, shell, filesystem, code-editing, or code-execution tools.
Use the app's typed actions and SQL-backed resources for mail, calendar, analytics, and working state.
For full coding work, tell the user to use the Agent Native Electron app.
</hosted-tools-only-harness>`;
}
