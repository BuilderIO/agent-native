import {
  getTemplate,
  templateToAppConfig,
  type AppConfig,
} from "@agent-native/shared-app-config";

export const CODE_AGENTS_SURFACE_ID = "code-agents";
export const MIGRATION_APP_ID = "migration";

export type CodeAgentGoalId = "task" | "migrate" | "audit";
export type CodeAgentPermissionMode =
  | "read-only"
  | "ask-before-edit"
  | "auto-edit"
  | "full-auto";

export interface CodeAgentPermissionModeDefinition {
  id: CodeAgentPermissionMode;
  label: string;
  shortLabel: string;
  description: string;
}

export interface CodeAgentGoalDefinition {
  id: CodeAgentGoalId;
  label: string;
  slashCommand: string;
  description: string;
  cliCommand: string;
  appId?: string;
  templateId?: string;
  listRunsAction?: string;
  runNoun: string;
  surfaceLabel: string;
  primaryActionLabel: string;
  surfaceKind: "app" | "native";
}

export const CODE_AGENT_GOALS: CodeAgentGoalDefinition[] = [
  {
    id: "task",
    label: "New task",
    slashCommand: "/task",
    description:
      "Start a general task from a prompt, then keep progress, outcomes, and follow-ups attached to the same run.",
    cliCommand: "task",
    runNoun: "agent task",
    surfaceLabel: "Task workspace",
    primaryActionLabel: "New Task",
    surfaceKind: "native",
  },
  {
    id: "migrate",
    label: "App migration",
    slashCommand: "/migrate",
    description:
      "Start a migration task that ports an existing path, URL, or described product into agent-native.",
    cliCommand: "migrate",
    runNoun: "migration task",
    surfaceLabel: "Migration workspace",
    primaryActionLabel: "Start /migrate",
    surfaceKind: "native",
  },
  {
    id: "audit",
    label: "Agent web audit",
    slashCommand: "/audit",
    description:
      "Start an audit task that checks a public URL for agent-readable surfaces such as llms.txt, sitemap, and Markdown mirrors.",
    cliCommand: "audit-agent-web",
    runNoun: "audit task",
    surfaceLabel: "Native audit feedback",
    primaryActionLabel: "Start /audit",
    surfaceKind: "native",
  },
];

export const CODE_AGENT_PERMISSION_MODES: CodeAgentPermissionModeDefinition[] =
  [
    {
      id: "read-only",
      label: "Plan mode",
      shortLabel: "Plan",
      description: "Inspect files and propose a plan before editing.",
    },
    {
      id: "ask-before-edit",
      label: "Ask mode",
      shortLabel: "Ask",
      description: "Ask before changing files or running write commands.",
    },
    {
      id: "auto-edit",
      label: "Edit mode",
      shortLabel: "Edit",
      description: "Make focused edits and run verification.",
    },
    {
      id: "full-auto",
      label: "Auto mode",
      shortLabel: "Auto",
      description:
        "Edit, run checks, and only pause for destructive file, git, or data operations.",
    },
  ];

export const DEFAULT_CODE_AGENT_PERMISSION_MODE: CodeAgentPermissionMode =
  "full-auto";

export function getCodeAgentPermissionMode(
  value: string | null | undefined,
): CodeAgentPermissionMode | undefined {
  return CODE_AGENT_PERMISSION_MODES.find((mode) => mode.id === value)?.id;
}

export function getCodeAgentPermissionModeDefinition(
  value: string | null | undefined,
): CodeAgentPermissionModeDefinition {
  return (
    CODE_AGENT_PERMISSION_MODES.find((mode) => mode.id === value) ??
    CODE_AGENT_PERMISSION_MODES.find(
      (mode) => mode.id === DEFAULT_CODE_AGENT_PERMISSION_MODE,
    )!
  );
}

export function getCodeAgentGoal(
  id: string | null | undefined,
): CodeAgentGoalDefinition | undefined {
  return CODE_AGENT_GOALS.find((goal) => goal.id === id);
}

export function getDefaultCodeAgentGoal(): CodeAgentGoalDefinition {
  return CODE_AGENT_GOALS[0];
}

export function getMigrationWorkbenchAppConfig(
  apps: AppConfig[] = [],
): AppConfig {
  const existing = apps.find((app) => app.id === MIGRATION_APP_ID);
  if (existing) return existing;

  const template = getTemplate(MIGRATION_APP_ID);
  if (!template) {
    throw new Error("Migration detail surface template is not registered.");
  }

  return {
    ...templateToAppConfig(template, { isBuiltIn: true, enabled: true }),
    devCommand: "pnpm --filter migration dev",
    mode: "dev",
  };
}

export function getCodeAgentAppConfig(
  goal: CodeAgentGoalDefinition,
  apps: AppConfig[] = [],
): AppConfig {
  if (goal.surfaceKind !== "app") {
    throw new Error(`${goal.label} does not use an app surface.`);
  }
  if (goal.id === "migrate") {
    return getMigrationWorkbenchAppConfig(apps);
  }
  throw new Error(`Unknown Agent-Native Code goal: ${goal.id}`);
}
