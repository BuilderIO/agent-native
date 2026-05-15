import {
  getTemplate,
  templateToAppConfig,
  type AppConfig,
} from "@agent-native/shared-app-config";

export const CODE_AGENTS_SURFACE_ID = "code-agents";
export const MIGRATION_APP_ID = "migration";

export type CodeAgentGoalId = "migrate" | "audit";

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
    id: "migrate",
    label: "App migration",
    slashCommand: "/migrate",
    description:
      "Start a slash-command session that ports an existing path, URL, or described product into agent-native.",
    cliCommand: "migrate",
    appId: MIGRATION_APP_ID,
    templateId: MIGRATION_APP_ID,
    listRunsAction: "list-migration-runs",
    runNoun: "slash-command session",
    surfaceLabel: "Migration detail surface",
    primaryActionLabel: "Start /migrate",
    surfaceKind: "app",
  },
  {
    id: "audit",
    label: "Agent web audit",
    slashCommand: "/audit",
    description:
      "Start a slash-command session that checks a public URL for agent-readable surfaces such as llms.txt, sitemap, and Markdown mirrors.",
    cliCommand: "audit-agent-web",
    runNoun: "slash-command session",
    surfaceLabel: "Native audit feedback",
    primaryActionLabel: "Start /audit",
    surfaceKind: "native",
  },
];

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
  throw new Error(`Unknown Code Agents goal: ${goal.id}`);
}
