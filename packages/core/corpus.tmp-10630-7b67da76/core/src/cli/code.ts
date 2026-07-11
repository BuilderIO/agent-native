import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { runAuditAgentWeb } from "./audit-agent-web.js";
import {
  findProjectSlashCommand,
  listProjectSlashCommands,
  renderProjectSlashCommandPrompt,
} from "./code-agent-commands.js";
import {
  executeApproveAlwaysCodeAgentApproval,
  executeCodeAgentRun,
  executeDenyCodeAgentApproval,
  executeExistingCodeAgentRun,
  executePendingCodeAgentApproval,
} from "./code-agent-executor.js";
import {
  CODE_AGENT_PERMISSION_MODES,
  appendCodeAgentTranscriptEvent,
  createCodeAgentRunRecord,
  getCodeAgentRunRecord,
  getLastCodeAgentRunRecord,
  isActiveCodeAgentRun,
  listCodeAgentRunRecords,
  listCodeAgentTranscriptEvents,
  normalizeCodeAgentPermissionMode,
  queueCodeAgentFollowUp,
  updateCodeAgentRunRecord,
  type CodeAgentFollowUpMode,
  type CodeAgentPermissionMode,
  type CodeAgentRunRecord,
  type CodeAgentTranscriptEvent,
} from "./code-agent-runs.js";
import { runMigrate } from "./migrate.js";

export type CodeAgentGoalId = "task" | "migrate" | "audit";

export interface CodeAgentCliGoal {
  id: CodeAgentGoalId;
  slashCommand: string;
  aliases: string[];
  summary: string;
  backingCommand: "task" | "migrate" | "audit-agent-web";
}

export type CodeCliCommand =
  | { kind: "shell" }
  | { kind: "help" }
  | { kind: "list-goals" }
  | { kind: "serve"; relayUrl?: string }
  | { kind: "execute-existing-run"; runId: string }
  | { kind: "control"; subcommand: CodeAgentControlSubcommand; args: string[] }
  | {
      kind: "record-follow-up";
      prompt: string;
      runId?: string;
      permissionMode?: CodeAgentPermissionMode;
      followUpMode?: CodeAgentFollowUpMode;
    }
  | {
      kind: "run-project-command";
      commandName: string;
      forwardedArgs: string[];
    }
  | {
      kind: "run-goal";
      goalId: CodeAgentGoalId;
      forwardedArgs: string[];
    };

export const CODE_AGENT_CLI_GOALS: CodeAgentCliGoal[] = [
  {
    id: "task",
    slashCommand: "/task",
    aliases: ["task", "todo"],
    summary:
      "Run a generic coding task as a resumable Agent-Native Code session.",
    backingCommand: "task",
  },
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

type CodeAgentControlSubcommand =
  | "approve"
  | "approve-always"
  | "deny"
  | "attach"
  | "list"
  | "logs"
  | "ps"
  | "resume"
  | "status"
  | "stop"
  | "ui";

const CODE_AGENT_CONTROL_SUBCOMMANDS = new Set<CodeAgentControlSubcommand>([
  "approve",
  "approve-always",
  "deny",
  "attach",
  "list",
  "logs",
  "ps",
  "resume",
  "status",
  "stop",
  "ui",
] as CodeAgentControlSubcommand[]);
const SHELL_PROMPT = "code> ";
const DEFAULT_CODE_AGENT_PERMISSION_MODE: CodeAgentPermissionMode = "full-auto";

export interface CodeShellOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  runGoal?: CodeGoalRunner;
}

type CodeGoalRunner = (
  goalId: CodeAgentGoalId,
  forwardedArgs: string[],
  output?: NodeJS.WritableStream,
) => Promise<void>;

type CodeShellLineResult = "continue" | "exit";

interface ParsedTaskArgs {
  prompt: string;
  promptArgs: string[];
  permissionMode: CodeAgentPermissionMode;
  permissionModeExplicit?: boolean;
  error?: string;
}

interface RunTaskOptions {
  subtitle?: string;
  source?: string;
  commandName?: string;
  commandPath?: string;
  permissionMode?: CodeAgentPermissionMode;
}

export function resolveCodeCommand(argv: string[]): CodeCliCommand {
  const [rawFirst, ...rest] = argv;
  if (!rawFirst) {
    return { kind: "shell" };
  }

  if (rawFirst === "--help" || rawFirst === "-h") {
    return { kind: "help" };
  }

  const first = normalizeGoalToken(rawFirst);
  if (first === "goals") {
    return { kind: "list-goals" };
  }

  if (first === "serve") {
    return { kind: "serve", relayUrl: parseRelayUrlOption(rest) };
  }

  if (first === "exec" || first === "e") {
    return {
      kind: "run-goal",
      goalId: "task",
      forwardedArgs: rest,
    };
  }

  if (first === "--print" || first === "-p") {
    return {
      kind: "run-goal",
      goalId: "task",
      forwardedArgs: rest,
    };
  }

  if (first === "--continue" || first === "-c") {
    const parsed = parseFollowUpArgs(rest);
    return parsed.prompt
      ? {
          kind: "record-follow-up",
          prompt: parsed.prompt,
          ...(parsed.followUpMode === "queued"
            ? { followUpMode: parsed.followUpMode }
            : {}),
          ...(parsed.permissionModeExplicit
            ? { permissionMode: parsed.permissionMode }
            : {}),
        }
      : {
          kind: "control",
          subcommand: "resume",
          args: ["resume", "--last"],
        };
  }

  if (first === "--resume" || first === "-r") {
    return {
      kind: "control",
      subcommand: "resume",
      args: ["resume", ...rest],
    };
  }

  if ((first === "run" || first === "start") && rest[0]) {
    return { kind: "execute-existing-run", runId: rest[0] };
  }

  const followUp = parseResumeFollowUpPrompt([rawFirst, ...rest]);
  if (followUp) {
    return {
      kind: "record-follow-up",
      prompt: followUp.prompt,
      runId: followUp.runId,
      ...(followUp.followUpMode ? { followUpMode: followUp.followUpMode } : {}),
      ...(followUp.permissionMode
        ? { permissionMode: followUp.permissionMode }
        : {}),
    };
  }

  const goal = findGoal(first);
  if (goal) {
    return {
      kind: "run-goal",
      goalId: goal.id,
      forwardedArgs: rest,
    };
  }

  if (rawFirst.startsWith("/")) {
    const projectCommand = findProjectSlashCommand(first);
    if (projectCommand) {
      return {
        kind: "run-project-command",
        commandName: projectCommand.name,
        forwardedArgs: rest,
      };
    }
  }

  if (isCodeAgentControlSubcommand(first)) {
    return {
      kind: "control",
      subcommand: first,
      args: [first, ...rest],
    };
  }

  return {
    kind: "run-goal",
    goalId: "task",
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

  if (command.kind === "serve") {
    const { runCodeAgentConnector } = await import("./code-agent-connector.js");
    const exitCode = await runCodeAgentConnector({
      relayUrl: command.relayUrl,
      output,
    });
    if (exitCode !== 0) process.exitCode = exitCode;
    return;
  }

  if (command.kind === "execute-existing-run") {
    await executeExistingCodeAgentRun(command.runId, { stdout: output });
    return;
  }

  if (command.kind === "control") {
    await runCodeAgentControl(command.subcommand, command.args, output);
    return;
  }

  if (command.kind === "record-follow-up") {
    await recordCodeAgentFollowUpPrompt(
      command.prompt,
      output,
      command.permissionMode,
      command.runId,
      command.followUpMode,
    );
    return;
  }

  if (command.kind === "run-project-command") {
    await runProjectSlashCommand(
      command.commandName,
      command.forwardedArgs,
      output,
    );
    return;
  }

  await runGoal(command.goalId, command.forwardedArgs, output);
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

  const followUp = parseResumeFollowUpPrompt(parsed.args);
  if (followUp) {
    await recordCodeAgentFollowUpPrompt(
      followUp.prompt,
      options.output,
      followUp.permissionMode,
      followUp.runId,
      followUp.followUpMode,
    );
    return "continue";
  }

  if (rawFirst.startsWith("/")) {
    const first = normalizeGoalToken(rawFirst);
    if (first === "help") {
      writeLine(options.output, codeShellHelp());
      return "continue";
    }

    if (first === "goals") {
      writeLine(options.output, renderGoalList());
      return "continue";
    }

    if (first === "exit" || first === "quit") {
      writeLine(options.output, "Leaving Agent-Native Code.");
      return "exit";
    }

    const goal = findGoal(first);
    if (goal) {
      await options.runGoal(goal.id, rest, options.output);
      return "continue";
    }

    const projectCommand = findProjectSlashCommand(first);
    if (projectCommand) {
      await runProjectSlashCommand(projectCommand.name, rest, options.output);
      return "continue";
    }

    writeLine(
      options.output,
      `Unknown slash command: ${rawFirst}\nTry /help to see available commands.`,
    );
    return "continue";
  }

  const first = normalizeGoalToken(rawFirst);
  if (first === "exec" || first === "e") {
    await options.runGoal("task", rest, options.output);
    return "continue";
  }

  if (first === "--print" || first === "-p") {
    await options.runGoal("task", rest, options.output);
    return "continue";
  }

  if (first === "--continue" || first === "-c") {
    const parsedTask = parseFollowUpArgs(rest);
    if (parsedTask.prompt) {
      await recordCodeAgentFollowUpPrompt(
        parsedTask.prompt,
        options.output,
        parsedTask.permissionModeExplicit
          ? parsedTask.permissionMode
          : undefined,
        undefined,
        parsedTask.followUpMode,
      );
    } else {
      await runCodeAgentControl("resume", ["resume", "--last"], options.output);
    }
    return "continue";
  }

  if (first === "--resume" || first === "-r") {
    await runCodeAgentControl("resume", ["resume", ...rest], options.output);
    return "continue";
  }

  if ((first === "run" || first === "start") && rest[0]) {
    await executeExistingCodeAgentRun(rest[0], { stdout: options.output });
    return "continue";
  }

  if (isCodeAgentControlSubcommand(first)) {
    await runCodeAgentControl(first, parsed.args, options.output);
    return "continue";
  }

  await options.runGoal("task", parsed.args, options.output);
  return "continue";
}

export function codeUsage(): string {
  return `agent-native code

Open the Agent-Native Code shell or run a coding-agent goal directly.

Usage:
  agent-native code
  agent-native code "fix the failing auth tests"
  agent-native code exec "fix the failing auth tests"
  agent-native code -p "fix the failing auth tests"
  agent-native code --plan "explain this repo"
  agent-native code --auto "fix the failing auth tests"
  agent-native code /review-diff
  agent-native code /audit --url https://example.com
  agent-native code /migrate <source> [--out ../migrated-app]
  agent-native code /migrate --describe "what to build or migrate"
  agent-native code attach --last
  agent-native code logs --last
  agent-native code approve --last
  agent-native code list
  agent-native code resume --last "follow-up prompt"
  agent-native code --continue "follow-up prompt"
  agent-native code resume --last
  agent-native code status --last
  agent-native code serve --relay-url <url>
  agent-native code ui --last
  agent-native code run <runId>
  agent-native code goals

Interactive shell:
  /help        Show shell commands
  /goals       List available coding-agent goals
  /migrate ... Run the migration goal
  /audit ...   Run the web audit goal
  /<project>   Run .agents/commands/<project>.md
  /exit        Leave the shell

Session commands:
  list         List recent sessions
  attach ...   Attach to a run transcript, following active work
  logs ...     Print a run transcript once
  approve ...  Run one pending approved command, then resume the session
  resume ...   Continue the latest or selected run
  status ...   Show run status
  stop ...     Stop a tracked Desktop/CLI runner
  serve ...    Run the remote relay connector

Modes:
  --plan, --auto
  --permission-mode read-only|ask-before-edit|auto-edit|full-auto
  --read-only, --ask-before-edit, --auto-edit, --full-auto

Available goals:
${renderGoalRows()}
${renderProjectCommandRows()}

The existing shortcut still works:
  agent-native migrate <source> [options]`;
}

export function codeShellIntro(): string {
  return [
    `Agent-Native Code v${getCorePackageVersion()}`,
    `cwd: ${process.cwd()}`,
    `default: ${formatCodeAgentRunMode(DEFAULT_CODE_AGENT_PERMISSION_MODE)} (${DEFAULT_CODE_AGENT_PERMISSION_MODE})`,
    "",
    "Type a coding task to start a session. Use /help, /goals, or /exit.",
  ].join("\n");
}

export function codeShellHelp(): string {
  return `Agent-Native Code shell commands:
  /help        Show this help
  /goals       List available coding-agent goals
  /migrate ... Move a source into agent-native
  /audit ...   Audit a public URL for agent-readable surfaces
  /<project>   Run a project command from .agents/commands/*.md
  /exit        Leave the shell
  /quit        Leave the shell

Compatibility shortcuts:
  exec "prompt"
  -p "prompt"
  list
  ps
  attach --last
  logs --last
  approve --last
  resume --last "follow-up prompt"
  --continue "follow-up prompt"
  resume --last
  status --last
  ui --last
  stop --last

Shell context:
  cwd: ${process.cwd()}
  default mode: ${formatCodeAgentRunMode(DEFAULT_CODE_AGENT_PERMISSION_MODE)} (${DEFAULT_CODE_AGENT_PERMISSION_MODE})`;
}

export function codeShellFreeTextMessage(): string {
  return `Bare prompts run as generic Agent-Native Code sessions.
Use /migrate and /audit for specialized goals.`;
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
  return `Available Agent-Native Code goals:
${renderGoalRows()}
${renderProjectCommandRows()}`;
}

function renderGoalRows(): string {
  return CODE_AGENT_CLI_GOALS.map(
    (goal) => `  ${goal.slashCommand.padEnd(12)} ${goal.summary}`,
  ).join("\n");
}

function renderProjectCommandRows(): string {
  const commands = listVisibleProjectSlashCommands();
  if (commands.length === 0) return "";
  return [
    "",
    "Project commands:",
    ...commands.map((command) => {
      const args = command.argumentHint ? ` ${command.argumentHint}` : "";
      const description = command.description ?? "Project slash command.";
      return `  /${command.name}${args}`.padEnd(24) + description;
    }),
  ].join("\n");
}

function listVisibleProjectSlashCommands() {
  return listProjectSlashCommands().filter(
    (command) => !isReservedSlashName(command.name),
  );
}

function isReservedSlashName(name: string): boolean {
  const normalized = normalizeGoalToken(name);
  return (
    Boolean(findGoal(normalized)) ||
    isCodeAgentControlSubcommand(normalized) ||
    normalized === "help" ||
    normalized === "exit" ||
    normalized === "quit" ||
    normalized === "goals"
  );
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

function isCodeAgentControlSubcommand(
  value: string,
): value is CodeAgentControlSubcommand {
  return CODE_AGENT_CONTROL_SUBCOMMANDS.has(
    value as CodeAgentControlSubcommand,
  );
}

function parseResumeFollowUpPrompt(args: string[]): {
  prompt: string;
  runId?: string;
  permissionMode?: CodeAgentPermissionMode;
  followUpMode?: CodeAgentFollowUpMode;
} | null {
  const [rawFirst, ...rest] = args;
  if (normalizeGoalToken(rawFirst ?? "") !== "resume") return null;
  const selector = parseResumeSelectorAndPrompt(rest);
  if (!selector) return null;
  if (
    !selector.hasSeparator &&
    !selector.promptArgs.some((arg) => !arg.startsWith("-"))
  ) {
    return null;
  }

  const parsed = parseFollowUpArgs(selector.promptArgs);
  return parsed.prompt
    ? {
        prompt: parsed.prompt,
        runId: selector.runId,
        ...(parsed.followUpMode === "queued"
          ? { followUpMode: parsed.followUpMode }
          : {}),
        permissionMode: parsed.permissionModeExplicit
          ? parsed.permissionMode
          : undefined,
      }
    : null;
}

function parseResumeSelectorAndPrompt(
  args: string[],
): { runId?: string; promptArgs: string[]; hasSeparator: boolean } | null {
  const lastIndex = args.indexOf("--last");
  if (lastIndex !== -1) {
    const promptArgs = args.filter((_, index) => index !== lastIndex);
    const separatorIndex = promptArgs.indexOf("--");
    return {
      promptArgs:
        separatorIndex === -1
          ? promptArgs
          : promptArgs.slice(separatorIndex + 1),
      hasSeparator: separatorIndex !== -1,
    };
  }

  const [maybeRunId, ...rest] = args;
  if (
    !maybeRunId ||
    maybeRunId.startsWith("-") ||
    !looksLikeRunId(maybeRunId)
  ) {
    return null;
  }
  const separatorIndex = rest.indexOf("--");
  return {
    runId: maybeRunId,
    promptArgs: separatorIndex === -1 ? rest : rest.slice(separatorIndex + 1),
    hasSeparator: separatorIndex !== -1,
  };
}

function looksLikeRunId(value: string): boolean {
  return /^[a-z][a-z0-9-]*-(?:\d{14}|\d{8}t\d{6}z)-[a-f0-9]{8}$/i.test(value);
}

function parseRelayUrlOption(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--relay-url" && args[i + 1]) return args[i + 1];
    if (arg.startsWith("--relay-url=")) {
      const value = arg.slice("--relay-url=".length).trim();
      if (value) return value;
    }
  }
  return undefined;
}

async function runCodeAgentControl(
  subcommand: CodeAgentControlSubcommand,
  args: string[],
  output: NodeJS.WritableStream,
  allowPicker = true,
): Promise<void> {
  const runs = listCodeAgentRunRecords();
  const effectiveArgs = await maybePickRunArgs(
    subcommand,
    runs,
    args,
    output,
    allowPicker,
  );
  if (!effectiveArgs) {
    writeLine(output, "No Agent-Native Code session selected.");
    return;
  }
  switch (subcommand) {
    case "approve":
      await approveCodeAgentRun(runs, effectiveArgs, output);
      return;
    case "approve-always":
      await approveAlwaysCodeAgentRun(runs, effectiveArgs, output);
      return;
    case "deny":
      await denyCodeAgentRun(runs, effectiveArgs, output);
      return;
    case "attach":
      await attachCodeAgentRun(runs, effectiveArgs, output);
      return;
    case "logs":
      writeLine(output, renderCodeAgentLogs(runs, effectiveArgs));
      return;
    case "list":
    case "ps":
      writeLine(output, renderCodeAgentSessionList(runs));
      return;
    case "status":
      writeLine(output, renderCodeAgentStatus(runs, effectiveArgs));
      return;
    case "resume":
      writeLine(output, renderCodeAgentResume(runs, effectiveArgs));
      return;
    case "ui":
      writeLine(output, renderCodeAgentUi(runs, effectiveArgs));
      return;
    case "stop":
      writeLine(output, stopCodeAgentRun(runs, effectiveArgs));
      return;
  }
}

async function maybePickRunArgs(
  subcommand: CodeAgentControlSubcommand,
  runs: CodeAgentRunRecord[],
  args: string[],
  output: NodeJS.WritableStream,
  allowPicker: boolean,
): Promise<string[] | null> {
  if (
    !allowPicker ||
    !["approve", "approve-always", "deny", "attach", "logs", "resume"].includes(
      subcommand,
    ) ||
    args.includes("--last") ||
    hasExplicitRunId(args) ||
    runs.length === 0 ||
    !isInteractiveTerminal(process.stdin, output)
  ) {
    return args;
  }

  const selected = await promptForRunSelection(runs, output);
  return selected ? [subcommand, selected.id] : null;
}

async function promptForRunSelection(
  runs: CodeAgentRunRecord[],
  output: NodeJS.WritableStream,
): Promise<CodeAgentRunRecord | null> {
  const choices = runs.slice(0, 10);
  writeLine(output, "");
  writeLine(output, "Select an Agent-Native Code session:");
  choices.forEach((run, index) => {
    writeLine(output, `  ${index + 1}. ${run.id}`);
    writeLine(
      output,
      `     /${run.goalId} ${run.status}${run.phase ? ` (${run.phase})` : ""}  updated ${run.updatedAt}`,
    );
    writeLine(output, `     ${truncateForDisplay(run.title, 90)}`);
  });
  writeLine(output, "");

  const rl = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  const answer = await new Promise<string>((resolve) => {
    rl.question("Run number or id (blank cancels): ", resolve);
  });
  rl.close();

  const trimmed = answer.trim();
  if (!trimmed) {
    writeLine(output, "No run selected.");
    return null;
  }
  const index = Number(trimmed);
  if (Number.isInteger(index) && index >= 1 && index <= choices.length) {
    return choices[index - 1] ?? null;
  }
  const matchingRun =
    choices.find((run) => run.id === trimmed) ??
    choices.find((run) => run.id.startsWith(trimmed));
  if (matchingRun) return matchingRun;

  writeLine(output, "No matching run selected.");
  return null;
}

function renderCodeAgentSessionList(runs: CodeAgentRunRecord[]): string {
  return [
    "",
    "Agent-Native Code sessions",
    "",
    runs.length === 0
      ? "  No Agent-Native Code sessions found."
      : `  ${runs.length} session${runs.length === 1 ? "" : "s"} found. Most recent first.`,
    ...runs.slice(0, 10).map(renderCodeAgentRunListItem),
    runs.length > 10 ? `  - ${runs.length - 10} more...` : "",
    "",
    runs.length > 0 ? "Inspect a session:" : "",
    runs.length > 0 ? "  agent-native code status <runId>" : "",
    runs.length > 0 ? "  agent-native code logs <runId>" : "",
    runs.length > 0 ? "  agent-native code resume <runId>" : "",
    runs.length > 0
      ? '  agent-native code resume <runId> "follow-up prompt"'
      : 'Start one with: agent-native code "what to change"',
  ]
    .filter(Boolean)
    .join("\n");
}

function renderCodeAgentStatus(
  runs: CodeAgentRunRecord[],
  args: string[],
): string {
  const selected = selectCodeAgentRun(runs, args, {
    defaultToLast: args.includes("--last") || hasExplicitRunId(args),
  });
  if (selected) {
    return renderCodeAgentRunDetail("Agent-Native Code status", selected);
  }

  return [
    "",
    "Agent-Native Code status",
    "",
    runs.length === 0
      ? "  No Agent-Native Code sessions found."
      : `  ${runs.length} session${runs.length === 1 ? "" : "s"} found.`,
    ...runs.slice(0, 10).map(renderCodeAgentRunListItem),
    runs.length > 10 ? `  - ${runs.length - 10} more...` : "",
    "",
    'Start one with: agent-native code "what to change"',
    'Add a follow-up with: agent-native code resume --last "what next"',
  ]
    .filter(Boolean)
    .join("\n");
}

function renderCodeAgentResume(
  runs: CodeAgentRunRecord[],
  args: string[],
): string {
  const run = selectCodeAgentRun(runs, args, { defaultToLast: true });
  if (!run) {
    return [
      "",
      "Agent-Native Code resume",
      "",
      "  No Agent-Native Code sessions found.",
      "",
      'Start one with: agent-native code "what to change"',
    ].join("\n");
  }

  const transcriptEvents = listCodeAgentTranscriptEvents(run.id);
  const latestEvent = transcriptEvents.at(-1);
  const followUpTarget = args.includes("--last") ? "--last" : run.id;
  return [
    "",
    "Agent-Native Code resume",
    "",
    `  Run:     ${run.id}`,
    `  Goal:    /${run.goalId}`,
    `  Title:   ${run.title}`,
    `  Status:  ${run.status}${run.phase ? ` (${run.phase})` : ""}`,
    run.permissionMode
      ? `  Mode:    ${formatCodeAgentRunMode(run.permissionMode)}`
      : "",
    `  Updated: ${run.updatedAt}`,
    latestEvent
      ? `  Last:    ${truncateForDisplay(latestEvent.message, 140)}`
      : "",
    "",
    "Resume execution:",
    `  agent-native code run ${run.id}`,
    "",
    "Attach to the live transcript:",
    `  agent-native code attach ${run.id}`,
    "",
    "Append and run a follow-up:",
    `  agent-native code resume ${followUpTarget} "next instruction"`,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderCodeAgentUi(runs: CodeAgentRunRecord[], args: string[]): string {
  const run = selectCodeAgentRun(runs, args, { defaultToLast: true });
  return [
    "",
    "Agent-Native Code UI",
    "",
    "Open Agent-Native Desktop and choose Agent-Native Code from the left sidebar.",
    run ? `Run: ${run.id}` : "No run selected yet.",
    run ? `Deep link: agentnative://open?app=code-agents&run=${run.id}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function stopCodeAgentRun(runs: CodeAgentRunRecord[], args: string[]): string {
  const run = selectCodeAgentRun(runs, args, { defaultToLast: true });
  if (
    run &&
    (run.status === "completed" ||
      run.status === "errored" ||
      run.phase === "complete" ||
      run.phase === "error")
  ) {
    return [
      "",
      "Agent-Native Code stop",
      "",
      `  Run: ${run.id}`,
      `  Status: ${run.status}${run.phase ? ` (${run.phase})` : ""}`,
      "",
      "  This run is already finished; no stop signal was sent.",
    ].join("\n");
  }
  if (run) {
    const pid = Number(run.metadata?.runnerPid);
    let killed = false;
    let killError = "";
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, "SIGTERM");
        killed = true;
      } catch (err) {
        killError = err instanceof Error ? err.message : String(err);
      }
    }
    appendCodeAgentTranscriptEvent({
      runId: run.id,
      kind: "status",
      message: killed
        ? "Stop requested for Agent-Native Code runner."
        : "Stop requested; no active runner process was found from the CLI.",
      metadata: {
        source: "cli-stop",
        pid: Number.isFinite(pid) ? pid : undefined,
        killed,
        killError: killError || undefined,
      },
    });
    updateCodeAgentRunRecord(run.id, {
      status: "paused",
      phase: "stopped",
      progress: {
        label: "Stopped",
        completed: 0,
        total: 1,
        percent: 0,
      },
      metadata: {
        stoppedAt: new Date().toISOString(),
        stoppedBy: "cli",
        stopSignalSent: killed,
        stopError: killError || undefined,
      },
    });
  }
  return [
    "",
    "Agent-Native Code stop",
    "",
    run ? `  Run: ${run.id}` : "  No Agent-Native Code session selected.",
    "",
    run
      ? "  Stop requested. If a tracked runner process is active, it received SIGTERM."
      : '  Start one with: agent-native code "what to change"',
  ].join("\n");
}

async function approveCodeAgentRun(
  runs: CodeAgentRunRecord[],
  args: string[],
  output: NodeJS.WritableStream,
): Promise<void> {
  const run = selectCodeAgentRun(runs, args, {
    defaultToLast: args.includes("--last"),
  });
  if (!run) {
    writeLine(
      output,
      [
        "",
        "Agent-Native Code approve",
        "",
        "  No Agent-Native Code session selected.",
        "",
        "Try: agent-native code approve --last",
      ].join("\n"),
    );
    return;
  }

  writeLine(
    output,
    [
      "",
      "Agent-Native Code approve",
      "",
      `  Run: ${run.id}`,
      "",
      "Running the pending approved command.",
    ].join("\n"),
  );
  await executePendingCodeAgentApproval(run.id, { stdout: output });
  writeLine(output, ["", "Approval step finished — run resumed."].join("\n"));
}

async function approveAlwaysCodeAgentRun(
  runs: CodeAgentRunRecord[],
  args: string[],
  output: NodeJS.WritableStream,
): Promise<void> {
  const run = selectCodeAgentRun(runs, args, {
    defaultToLast: args.includes("--last"),
  });
  if (!run) {
    writeLine(
      output,
      [
        "",
        "Agent-Native Code approve-always",
        "",
        "  No Agent-Native Code session selected.",
        "",
        "Try: agent-native code approve-always --last",
      ].join("\n"),
    );
    return;
  }

  writeLine(
    output,
    [
      "",
      "Agent-Native Code approve-always",
      "",
      `  Run: ${run.id}`,
      "",
      "Adding command to allowlist and running.",
    ].join("\n"),
  );
  await executeApproveAlwaysCodeAgentApproval(run.id, { stdout: output });
  writeLine(output, ["", "Allowlist updated and run resumed."].join("\n"));
}

async function denyCodeAgentRun(
  runs: CodeAgentRunRecord[],
  args: string[],
  output: NodeJS.WritableStream,
): Promise<void> {
  const run = selectCodeAgentRun(runs, args, {
    defaultToLast: args.includes("--last"),
  });
  if (!run) {
    writeLine(
      output,
      [
        "",
        "Agent-Native Code deny",
        "",
        "  No Agent-Native Code session selected.",
        "",
        "Try: agent-native code deny --last",
      ].join("\n"),
    );
    return;
  }

  writeLine(
    output,
    [
      "",
      "Agent-Native Code deny",
      "",
      `  Run: ${run.id}`,
      "",
      "Denying approval and resuming run so model can adapt.",
    ].join("\n"),
  );
  await executeDenyCodeAgentApproval(run.id, { stdout: output });
  writeLine(output, ["", "Denial recorded — run resumed."].join("\n"));
}

function renderCodeAgentLogs(
  runs: CodeAgentRunRecord[],
  args: string[],
): string {
  const run = selectCodeAgentRun(runs, args, { defaultToLast: true });
  if (!run) {
    return [
      "",
      "Agent-Native Code logs",
      "",
      "  No Agent-Native Code session selected.",
      "",
      "Try: agent-native code logs --last",
    ].join("\n");
  }
  const events = listCodeAgentTranscriptEvents(run.id);
  return [
    "",
    `Agent-Native Code logs: ${run.id}`,
    `/${run.goalId} ${run.status}${run.phase ? ` (${run.phase})` : ""}`,
    run.title,
    `Updated: ${run.updatedAt}`,
    `Events: ${events.length}`,
    "",
    events.length === 0
      ? "  No transcript events recorded yet."
      : events.map(renderTranscriptEventForCli).join("\n"),
  ].join("\n");
}

async function attachCodeAgentRun(
  runs: CodeAgentRunRecord[],
  args: string[],
  output: NodeJS.WritableStream,
): Promise<void> {
  const run = selectCodeAgentRun(runs, args, { defaultToLast: true });
  if (!run) {
    writeLine(
      output,
      [
        "",
        "Agent-Native Code attach",
        "",
        "  No Agent-Native Code session selected.",
        "",
        "Try: agent-native code attach --last",
      ].join("\n"),
    );
    return;
  }

  const follow = !args.includes("--no-follow");
  const printed = new Set<string>();
  writeLine(output, "");
  writeLine(output, `Attaching to Agent-Native Code run ${run.id}`);
  writeLine(
    output,
    "Press Ctrl+C to detach. The session keeps its transcript.",
  );
  writeLine(output, "");

  const printNewEvents = () => {
    const events = listCodeAgentTranscriptEvents(run.id);
    for (const event of events) {
      const key = `${event.id}:${event.createdAt}`;
      if (printed.has(key)) continue;
      printed.add(key);
      writeLine(output, renderTranscriptEventForCli(event));
    }
  };

  printNewEvents();
  if (!follow) return;

  while (true) {
    const latest = getCodeAgentRunRecord(run.id);
    if (!latest || isTerminalRun(latest)) {
      printNewEvents();
      if (latest) {
        writeLine(
          output,
          `\nRun ${latest.status}${latest.phase ? ` (${latest.phase})` : ""}.`,
        );
      }
      return;
    }
    await delay(1_000);
    printNewEvents();
  }
}

function renderTranscriptEventForCli(event: CodeAgentTranscriptEvent): string {
  const timestamp = event.createdAt.replace("T", " ").replace(/\.\d+Z$/, "Z");
  const label =
    event.kind === "user"
      ? "user"
      : event.metadata?.role === "assistant"
        ? "assistant"
        : event.kind;
  const tool =
    typeof event.metadata?.tool === "string" ? ` ${event.metadata.tool}` : "";
  return `[${timestamp}] ${label}${tool}: ${event.message}`;
}

function isTerminalRun(run: CodeAgentRunRecord): boolean {
  return (
    run.status === "completed" ||
    run.status === "errored" ||
    run.status === "paused" ||
    run.phase === "complete" ||
    run.phase === "error" ||
    run.phase === "paused" ||
    run.phase === "missing-credentials" ||
    run.phase === "stopped"
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function selectCodeAgentRun(
  runs: CodeAgentRunRecord[],
  args: string[],
  options: { defaultToLast: boolean },
): CodeAgentRunRecord | null {
  const explicitRunId = getExplicitRunId(args);
  if (explicitRunId) {
    return runs.find((run) => run.id === explicitRunId) ?? null;
  }
  return options.defaultToLast ? (runs[0] ?? null) : null;
}

function hasExplicitRunId(args: string[]): boolean {
  return Boolean(getExplicitRunId(args));
}

function getExplicitRunId(args: string[]): string | null {
  const subcommand = args[0];
  for (const arg of args.slice(1)) {
    if (arg === "--last" || arg === "--") continue;
    if (arg.startsWith("-")) continue;
    if (arg === subcommand) continue;
    return arg;
  }
  return null;
}

function renderCodeAgentRunDetail(
  heading: string,
  run: CodeAgentRunRecord,
): string {
  const transcriptEvents = listCodeAgentTranscriptEvents(run.id);
  return [
    "",
    heading,
    "",
    `  Run:        ${run.id}`,
    `  Goal:       /${run.goalId}`,
    `  Title:      ${run.title}`,
    run.subtitle ? `  Subtitle:   ${run.subtitle}` : "",
    run.permissionMode
      ? `  Mode:       ${formatCodeAgentRunMode(run.permissionMode)}`
      : "",
    run.cwd ? `  Cwd:        ${run.cwd}` : "",
    `  Status:     ${run.status}${run.phase ? ` (${run.phase})` : ""}`,
    run.progress
      ? `  Progress:   ${run.progress.completed}/${run.progress.total} (${run.progress.percent}%)`
      : "",
    run.artifactRoot ? `  Artifacts:  ${run.artifactRoot}` : "",
    `  Transcript: ${transcriptEvents.length} event${transcriptEvents.length === 1 ? "" : "s"}`,
    `  Updated:    ${run.updatedAt}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderCodeAgentRunListItem(run: CodeAgentRunRecord): string {
  const progress = run.progress
    ? `, ${run.progress.completed}/${run.progress.total}`
    : "";
  const permission = run.permissionMode
    ? `, ${formatCodeAgentRunMode(run.permissionMode)}`
    : "";
  return [
    `  - ${run.id}`,
    `    /${run.goalId} ${run.status}${run.phase ? ` (${run.phase})` : ""}${progress}${permission}`,
    `    ${truncateForDisplay(run.title, 100)}`,
    `    updated ${run.updatedAt}`,
  ].join("\n");
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

function getCorePackageVersion(): string {
  try {
    const cliDir = path.dirname(fileURLToPath(import.meta.url));
    const packagePath = path.resolve(cliDir, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

async function runCodeGoal(
  goalId: CodeAgentGoalId,
  forwardedArgs: string[],
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  const goal = CODE_AGENT_CLI_GOALS.find(
    (candidate) => candidate.id === goalId,
  );
  if (!goal) {
    throw new Error(`Unknown Agent-Native Code goal: ${goalId}`);
  }

  switch (goal.backingCommand) {
    case "task":
      await runTask(forwardedArgs, output);
      return;
    case "audit-agent-web":
      await runAuditAgentWeb(forwardedArgs);
      return;
    case "migrate":
      await runMigrate(forwardedArgs);
      return;
  }
}

async function runTask(
  forwardedArgs: string[],
  output: NodeJS.WritableStream,
  options: RunTaskOptions = {},
): Promise<void> {
  const parsed = parseTaskArgs(forwardedArgs, options.permissionMode);
  if (parsed.error) {
    writeLine(output, parsed.error);
    writeLine(output, taskUsage());
    return;
  }
  if (!parsed.prompt) {
    writeLine(output, taskUsage());
    return;
  }

  const prompt = parsed.prompt;
  const run = createCodeAgentRunRecord({
    goalId: "task",
    title: titleFromPrompt(prompt),
    subtitle: options.subtitle ?? "Generic coding task",
    status: "running",
    phase: "starting",
    permissionMode: parsed.permissionMode,
    progress: {
      label: "Starting",
      completed: 0,
      total: 1,
      percent: 5,
    },
    details: [
      { label: "Prompt", value: truncateForDisplay(prompt, 160) },
      { label: "Agent", value: "Running locally" },
      { label: "Mode", value: formatCodeAgentRunMode(parsed.permissionMode) },
    ],
    cwd: process.cwd(),
    metadata: {
      prompt,
      source: options.source ?? "agent-native code",
      commandName: options.commandName,
      commandPath: options.commandPath,
      permissionMode: parsed.permissionMode,
    },
  });

  appendCodeAgentTranscriptEvent({
    runId: run.id,
    kind: "user",
    message: prompt,
    metadata: { source: "initial-prompt" },
  });
  appendCodeAgentTranscriptEvent({
    runId: run.id,
    kind: "status",
    message: "Starting local Agent-Native Code execution.",
    metadata: {
      status: "running",
      phase: "starting",
    },
  });

  writeLine(output, renderTaskStarted(run, prompt));
  await executeCodeAgentRun({
    runId: run.id,
    prompt,
    appendUserEvent: false,
    stdout: output,
  });
}

async function runProjectSlashCommand(
  commandName: string,
  forwardedArgs: string[],
  output: NodeJS.WritableStream,
): Promise<void> {
  const command = findProjectSlashCommand(commandName);
  if (!command) {
    writeLine(
      output,
      `Project slash command not found: /${normalizeGoalToken(commandName)}`,
    );
    return;
  }
  const parsed = parseTaskArgs(forwardedArgs);
  if (parsed.error) {
    writeLine(output, parsed.error);
    return;
  }
  const prompt = renderProjectSlashCommandPrompt(command, parsed.promptArgs);
  await runTask([prompt], output, {
    subtitle: `Project command /${command.name}`,
    source: "agent-native code project-command",
    commandName: command.name,
    commandPath: command.path,
    permissionMode: parsed.permissionMode,
  });
}

async function recordCodeAgentFollowUpPrompt(
  prompt: string,
  output: NodeJS.WritableStream,
  permissionMode?: CodeAgentPermissionMode,
  runId?: string,
  followUpMode: CodeAgentFollowUpMode = "immediate",
): Promise<void> {
  const run = runId
    ? getCodeAgentRunRecord(runId)
    : getLastCodeAgentRunRecord();
  if (!run) {
    writeLine(
      output,
      [
        "",
        runId
          ? `Agent-Native Code run not found: ${runId}`
          : "No Agent-Native Code runs found.",
        "",
        'Start one with: agent-native code "what to change"',
      ].join("\n"),
    );
    return;
  }

  const activeRun = permissionMode
    ? (updateCodeAgentRunRecord(run.id, { permissionMode }) ?? run)
    : run;
  const shouldQueue = isActiveCodeAgentRun(activeRun);
  const event = appendCodeAgentTranscriptEvent({
    runId: activeRun.id,
    kind: "user",
    message: prompt,
    metadata: {
      source: "resume-follow-up",
      permissionMode,
      followUpMode,
      delivery: shouldQueue ? followUpMode : "run-now",
    },
  });
  if (shouldQueue) {
    queueCodeAgentFollowUp({
      runId: activeRun.id,
      prompt,
      mode: followUpMode,
      eventId: event.id,
      permissionMode,
      source: "resume-follow-up",
      createdAt: event.createdAt,
    });
    writeLine(output, renderFollowUpRecorded(activeRun, event, followUpMode));
    return;
  }

  writeLine(output, renderFollowUpRecorded(activeRun, event, "immediate"));
  await executeCodeAgentRun({
    runId: activeRun.id,
    prompt,
    appendUserEvent: false,
    stdout: output,
  });
}

function parseTaskArgs(
  forwardedArgs: string[],
  defaultPermissionMode: CodeAgentPermissionMode = DEFAULT_CODE_AGENT_PERMISSION_MODE,
): ParsedTaskArgs {
  const promptArgs: string[] = [];
  let permissionMode: CodeAgentPermissionMode = defaultPermissionMode;
  let permissionModeExplicit = false;
  for (let index = 0; index < forwardedArgs.length; index += 1) {
    const arg = forwardedArgs[index];
    if (arg === "--") {
      promptArgs.push(...forwardedArgs.slice(index + 1));
      break;
    }
    if (arg === "--permission-mode") {
      const value = forwardedArgs[index + 1];
      const normalized = normalizeCodeAgentPermissionMode(value);
      if (!normalized) {
        return {
          prompt: "",
          promptArgs,
          permissionMode,
          error: `Invalid run mode: ${value ?? "(missing)"}`,
        };
      }
      permissionMode = normalized;
      permissionModeExplicit = true;
      index += 1;
      continue;
    }
    if (arg.startsWith("--permission-mode=")) {
      const normalized = normalizeCodeAgentPermissionMode(
        arg.slice("--permission-mode=".length),
      );
      if (!normalized) {
        return {
          prompt: "",
          promptArgs,
          permissionMode,
          error: `Invalid run mode: ${arg.slice("--permission-mode=".length)}`,
        };
      }
      permissionMode = normalized;
      permissionModeExplicit = true;
      continue;
    }
    const shorthand = parsePermissionModeFlag(arg);
    if (shorthand) {
      permissionMode = shorthand;
      permissionModeExplicit = true;
      continue;
    }
    promptArgs.push(arg);
  }
  return {
    prompt: promptArgs.join(" ").trim(),
    promptArgs,
    permissionMode,
    permissionModeExplicit,
  };
}

function parseFollowUpArgs(forwardedArgs: string[]): ParsedTaskArgs & {
  followUpMode: CodeAgentFollowUpMode;
} {
  const promptArgs: string[] = [];
  let followUpMode: CodeAgentFollowUpMode = "immediate";
  for (let index = 0; index < forwardedArgs.length; index += 1) {
    const arg = forwardedArgs[index];
    if (arg === "--") {
      promptArgs.push(...forwardedArgs.slice(index));
      break;
    }
    if (arg === "--queue" || arg === "--after-completion") {
      followUpMode = "queued";
      continue;
    }
    if (arg === "--immediate" || arg === "--steer") {
      followUpMode = "immediate";
      continue;
    }
    promptArgs.push(arg);
  }
  return {
    ...parseTaskArgs(promptArgs),
    followUpMode,
  };
}

function parsePermissionModeFlag(arg: string): CodeAgentPermissionMode | null {
  switch (arg) {
    case "--plan":
    case "--read-only":
      return "read-only";
    case "--auto":
      return "full-auto";
    case "--ask-before-edit":
      return "ask-before-edit";
    case "--auto-edit":
      return "auto-edit";
    case "--full-auto":
      return "full-auto";
    default:
      return null;
  }
}

function titleFromPrompt(prompt: string): string {
  return truncateForDisplay(prompt.replace(/\s+/g, " "), 80);
}

function truncateForDisplay(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function renderTaskStarted(run: CodeAgentRunRecord, prompt: string): string {
  return [
    "",
    "Agent-Native Code session started.",
    "",
    `  Run:    ${run.id}`,
    `  Prompt: ${truncateForDisplay(prompt, 160)}`,
    `  Mode:   ${formatCodeAgentRunMode(run.permissionMode)}`,
    "",
    "Streaming output below. The transcript is saved with this run.",
  ].join("\n");
}

function renderFollowUpRecorded(
  run: CodeAgentRunRecord,
  event: ReturnType<typeof appendCodeAgentTranscriptEvent>,
  mode: CodeAgentFollowUpMode,
): string {
  const active = isActiveCodeAgentRun(run);
  const heading = active
    ? mode === "queued"
      ? "Queued follow-up prompt for Agent-Native Code run."
      : "Recorded steering prompt for active Agent-Native Code run."
    : "Running follow-up prompt for Agent-Native Code run.";
  return [
    "",
    heading,
    "",
    `  Run:   ${run.id}`,
    `  Goal:  /${run.goalId}`,
    `  Event: ${event.id}`,
    "",
    active
      ? mode === "queued"
        ? "It will run after the current execution finishes."
        : "It will be applied by the active runner as soon as it can steer."
      : "Streaming output below. The transcript is saved with this run.",
  ].join("\n");
}

function taskUsage(): string {
  return [
    "",
    "Usage:",
    '  agent-native code "what to change"',
    '  agent-native code --plan "explain this repo"',
    '  agent-native code --auto "fix this and verify it"',
    `  agent-native code --permission-mode ${CODE_AGENT_PERMISSION_MODES.join("|")} "what to change"`,
    "",
    "The task goal starts a local Agent-Native Code session, saves transcript events, and can be resumed with follow-up prompts.",
  ].join("\n");
}

function formatCodeAgentRunMode(
  permissionMode: CodeAgentPermissionMode | undefined,
): string {
  return permissionMode === "read-only" ? "Plan mode" : "Auto mode";
}
