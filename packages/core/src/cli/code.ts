import { createInterface } from "node:readline";

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
  | { kind: "shell" }
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
const SHELL_PROMPT = "code> ";

export interface CodeShellOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  runGoal?: CodeGoalRunner;
}

type CodeGoalRunner = (
  goalId: CodeAgentGoalId,
  forwardedArgs: string[],
) => Promise<void>;

type CodeShellLineResult = "continue" | "exit";

export function resolveCodeCommand(argv: string[]): CodeCliCommand {
  const [rawFirst, ...rest] = argv;
  if (!rawFirst) {
    return { kind: "shell" };
  }

  if (rawFirst === "--help" || rawFirst === "-h") {
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

export async function runCode(
  argv: string[],
  options: CodeShellOptions = {},
): Promise<void> {
  const command = resolveCodeCommand(argv);
  const output = options.output ?? process.stdout;
  const runGoal = options.runGoal ?? runCodeGoal;

  if (command.kind === "shell") {
    await runCodeShell({ ...options, output, runGoal });
    return;
  }

  if (command.kind === "help") {
    writeLine(output, codeUsage());
    return;
  }

  if (command.kind === "list-goals") {
    writeLine(output, renderGoalList());
    return;
  }

  await runGoal(command.goalId, command.forwardedArgs);
}

export async function runCodeShell(
  options: CodeShellOptions = {},
): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const runGoal = options.runGoal ?? runCodeGoal;
  const rl = createInterface({
    input,
    output,
    terminal: isInteractiveTerminal(input, output),
  });

  writeLine(output, codeShellIntro());
  writePrompt(output);

  try {
    for await (const line of rl) {
      const result = await handleCodeShellLine(line, { output, runGoal });
      if (result === "exit") {
        break;
      }
      writePrompt(output);
    }
  } finally {
    rl.close();
  }
}

export async function handleCodeShellLine(
  line: string,
  options: Required<Pick<CodeShellOptions, "output" | "runGoal">>,
): Promise<CodeShellLineResult> {
  const trimmed = line.trim();
  if (!trimmed) {
    return "continue";
  }

  const parsed = parseCodeShellArgs(trimmed);
  if ("error" in parsed) {
    writeLine(options.output, parsed.error);
    return "continue";
  }

  const [rawFirst, ...rest] = parsed.args;
  if (!rawFirst) {
    return "continue";
  }

  if (rawFirst.startsWith("/")) {
    const first = normalizeGoalToken(rawFirst);
    if (first === "help") {
      writeLine(options.output, codeShellHelp());
      return "continue";
    }

    if (first === "goals" || first === "list") {
      writeLine(options.output, renderGoalList());
      return "continue";
    }

    if (first === "exit" || first === "quit") {
      writeLine(options.output, "Leaving Agent-Native Code Agents.");
      return "exit";
    }

    const goal = findGoal(first);
    if (goal) {
      await options.runGoal(goal.id, rest);
      return "continue";
    }

    writeLine(
      options.output,
      `Unknown slash command: ${rawFirst}\nTry /help to see available commands.`,
    );
    return "continue";
  }

  const first = normalizeGoalToken(rawFirst);
  if (DEFAULT_GOAL_SUBCOMMANDS.has(first)) {
    await options.runGoal(DEFAULT_GOAL_ID, parsed.args);
    return "continue";
  }

  writeLine(options.output, codeShellFreeTextMessage());
  return "continue";
}

export function codeUsage(): string {
  return `agent-native code

Open the Agent-Native Code Agents shell or run a coding-agent goal directly.

Usage:
  agent-native code
  agent-native code /audit --url https://example.com
  agent-native code /migrate <source> [--out ../migrated-app]
  agent-native code /migrate --describe "what to build or migrate"
  agent-native code resume --last
  agent-native code status --last
  agent-native code ui --last
  agent-native code goals

Interactive shell:
  /help        Show shell commands
  /goals       List available coding-agent goals
  /migrate ... Run the migration goal
  /audit ...   Run the web audit goal
  /exit        Leave the shell

Available goals:
${renderGoalRows()}

The existing shortcut still works:
  agent-native migrate <source> [options]`;
}

export function codeShellIntro(): string {
  return `Agent-Native Code Agents
Type /help for commands, /goals for available goals, or /exit to leave.`;
}

export function codeShellHelp(): string {
  return `Code Agents shell commands:
  /help        Show this help
  /goals       List available coding-agent goals
  /migrate ... Move a source into agent-native
  /audit ...   Audit a public URL for agent-readable surfaces
  /exit        Leave the shell
  /quit        Leave the shell

Compatibility shortcuts:
  resume --last
  status --last
  ui --last
  stop --last`;
}

export function codeShellFreeTextMessage(): string {
  return `Arbitrary coding chat is not wired into this shell yet.
Try /migrate, /audit, or use --emit with a migration command to produce a Code Agent dossier.`;
}

export function parseCodeShellArgs(
  line: string,
): { ok: true; args: string[] } | { ok: false; error: string } {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;
  let hasValue = false;

  const pushCurrent = () => {
    if (hasValue) {
      args.push(current);
      current = "";
      hasValue = false;
    }
  };

  for (const char of line) {
    if (escaping) {
      current += char;
      hasValue = true;
      escaping = false;
      continue;
    }

    if (char === "\\" && quote !== "'") {
      escaping = true;
      hasValue = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
        hasValue = true;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      hasValue = true;
      continue;
    }

    if (/\s/.test(char)) {
      pushCurrent();
      continue;
    }

    current += char;
    hasValue = true;
  }

  if (escaping) {
    current += "\\";
  }

  if (quote) {
    return { ok: false, error: `Unclosed ${quote} quote.` };
  }

  pushCurrent();
  return { ok: true, args };
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

function isInteractiveTerminal(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): boolean {
  return Boolean(
    (input as NodeJS.ReadStream).isTTY && (output as NodeJS.WriteStream).isTTY,
  );
}

function writeLine(output: NodeJS.WritableStream, text = ""): void {
  output.write(`${text}\n`);
}

function writePrompt(output: NodeJS.WritableStream): void {
  output.write(SHELL_PROMPT);
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
