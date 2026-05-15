import { runAuditAgentWeb } from "./audit-agent-web.js";
import { runMigrate } from "./migrate.js";

export type CodeAgentGoalId = "migrate" | "audit";

export interface CodeAgentCliGoal {
  id: CodeAgentGoalId;
  slashCommand: string;
  aliases: string[];
  summary: string;
  backingCommand: "migrate" | "audit-agent-web";
}

export type CodeCliCommand =
  | { kind: "help" }
  | { kind: "list-goals" }
  | {
      kind: "run-goal";
      goalId: CodeAgentGoalId;
      forwardedArgs: string[];
    };

export const CODE_AGENT_CLI_GOALS: CodeAgentCliGoal[] = [
  {
    id: "migrate",
    slashCommand: "/migrate",
    aliases: ["migrate", "migration"],
    summary:
      "Move a path, URL, or described product into agent-native with verification.",
    backingCommand: "migrate",
  },
  {
    id: "audit",
    slashCommand: "/audit",
    aliases: ["audit", "audit-agent-web", "agent-web"],
    summary:
      "Audit a public URL for agent-readable surfaces such as llms.txt and markdown mirrors.",
    backingCommand: "audit-agent-web",
  },
];

const DEFAULT_GOAL_ID: CodeAgentGoalId = "migrate";
const DEFAULT_GOAL_SUBCOMMANDS = new Set(["resume", "status", "stop", "ui"]);

export function resolveCodeCommand(argv: string[]): CodeCliCommand {
  const [rawFirst, ...rest] = argv;
  if (!rawFirst || rawFirst === "--help" || rawFirst === "-h") {
    return { kind: "help" };
  }

  const first = normalizeGoalToken(rawFirst);
  if (first === "goals" || first === "list") {
    return { kind: "list-goals" };
  }

  const goal = findGoal(first);
  if (goal) {
    return {
      kind: "run-goal",
      goalId: goal.id,
      forwardedArgs: rest,
    };
  }

  if (DEFAULT_GOAL_SUBCOMMANDS.has(first)) {
    return {
      kind: "run-goal",
      goalId: DEFAULT_GOAL_ID,
      forwardedArgs: [first, ...rest],
    };
  }

  return {
    kind: "run-goal",
    goalId: DEFAULT_GOAL_ID,
    forwardedArgs: argv,
  };
}

export async function runCode(argv: string[]): Promise<void> {
  const command = resolveCodeCommand(argv);

  if (command.kind === "help") {
    console.log(codeUsage());
    return;
  }

  if (command.kind === "list-goals") {
    console.log(renderGoalList());
    return;
  }

  await runCodeGoal(command.goalId, command.forwardedArgs);
}

export function codeUsage(): string {
  return `agent-native code

Run long-running coding-agent goals with the Agent Native harness.

Usage:
  agent-native code /audit --url https://example.com
  agent-native code /migrate <source> [--out ../migrated-app]
  agent-native code /migrate --describe "what to build or migrate"
  agent-native code resume --last
  agent-native code status --last
  agent-native code ui --last
  agent-native code goals

Available goals:
${renderGoalRows()}

The existing shortcut still works:
  agent-native migrate <source> [options]`;
}

function renderGoalList(): string {
  return `Available Code Agents goals:
${renderGoalRows()}`;
}

function renderGoalRows(): string {
  return CODE_AGENT_CLI_GOALS.map(
    (goal) => `  ${goal.slashCommand.padEnd(12)} ${goal.summary}`,
  ).join("\n");
}

function normalizeGoalToken(value: string): string {
  return value.replace(/^\//, "").toLowerCase();
}

function findGoal(value: string): CodeAgentCliGoal | undefined {
  const normalized = normalizeGoalToken(value);
  return CODE_AGENT_CLI_GOALS.find(
    (goal) =>
      goal.id === normalized ||
      normalizeGoalToken(goal.slashCommand) === normalized ||
      goal.aliases.includes(normalized),
  );
}

async function runCodeGoal(
  goalId: CodeAgentGoalId,
  forwardedArgs: string[],
): Promise<void> {
  const goal = CODE_AGENT_CLI_GOALS.find(
    (candidate) => candidate.id === goalId,
  );
  if (!goal) {
    throw new Error(`Unknown Code Agents goal: ${goalId}`);
  }

  switch (goal.backingCommand) {
    case "audit-agent-web":
      await runAuditAgentWeb(forwardedArgs);
      return;
    case "migrate":
      await runMigrate(forwardedArgs);
      return;
  }
}
