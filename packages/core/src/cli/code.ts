import { createInterface } from "node:readline";

import {
  appendCodeAgentTranscriptEvent,
  createCodeAgentRunRecord,
  getCodeAgentRunRecord,
  getLastCodeAgentRunRecord,
  listCodeAgentRunRecords,
  listCodeAgentTranscriptEvents,
  updateCodeAgentRunRecord,
  type CodeAgentRunRecord,
  type CodeAgentTranscriptEvent,
} from "./code-agent-runs.js";
import {
  executeCodeAgentRun,
  executeExistingCodeAgentRun,
} from "./code-agent-executor.js";
import { runAuditAgentWeb } from "./audit-agent-web.js";
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
  | { kind: "execute-existing-run"; runId: string }
  | { kind: "control"; subcommand: CodeAgentControlSubcommand; args: string[] }
  | { kind: "record-follow-up"; prompt: string }
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
    summary: "Run a generic coding task as a resumable Code Agent session.",
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
  | "attach"
  | "list"
  | "logs"
  | "ps"
  | "resume"
  | "status"
  | "stop"
  | "ui";

const CODE_AGENT_CONTROL_SUBCOMMANDS = new Set<CodeAgentControlSubcommand>([
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
    const prompt = rest.join(" ").trim();
    return prompt
      ? { kind: "record-follow-up", prompt }
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

  const followUpPrompt = parseResumeFollowUpPrompt([rawFirst, ...rest]);
  if (followUpPrompt) {
    return { kind: "record-follow-up", prompt: followUpPrompt };
  }

  const goal = findGoal(first);
  if (goal) {
    return {
      kind: "run-goal",
      goalId: goal.id,
      forwardedArgs: rest,
    };
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

  if (command.kind === "execute-existing-run") {
    await executeExistingCodeAgentRun(command.runId, { stdout: output });
    return;
  }

  if (command.kind === "control") {
    await runCodeAgentControl(command.subcommand, command.args, output);
    return;
  }

  if (command.kind === "record-follow-up") {
    await recordCodeAgentFollowUpPrompt(command.prompt, output);
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

  const followUpPrompt = parseResumeFollowUpPrompt(parsed.args);
  if (followUpPrompt) {
    await recordCodeAgentFollowUpPrompt(followUpPrompt, options.output);
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
      writeLine(options.output, "Leaving Agent-Native Code Agents.");
      return "exit";
    }

    const goal = findGoal(first);
    if (goal) {
      await options.runGoal(goal.id, rest, options.output);
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
    const prompt = rest.join(" ").trim();
    if (prompt) {
      await recordCodeAgentFollowUpPrompt(prompt, options.output);
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

Open the Agent-Native Code Agents shell or run a coding-agent goal directly.

Usage:
  agent-native code
  agent-native code "fix the failing auth tests"
  agent-native code exec "fix the failing auth tests"
  agent-native code -p "fix the failing auth tests"
  agent-native code /task "fix the failing auth tests"
  agent-native code /audit --url https://example.com
  agent-native code /migrate <source> [--out ../migrated-app]
  agent-native code /migrate --describe "what to build or migrate"
  agent-native code attach --last
  agent-native code logs --last
  agent-native code list
  agent-native code resume --last "follow-up prompt"
  agent-native code --continue "follow-up prompt"
  agent-native code resume --last
  agent-native code status --last
  agent-native code ui --last
  agent-native code run <runId>
  agent-native code goals

Interactive shell:
  /help        Show shell commands
  /goals       List available coding-agent goals
  /task ...    Run a generic coding task
  /migrate ... Run the migration goal
  /audit ...   Run the web audit goal
  /exit        Leave the shell

Session commands:
  list         List recent sessions
  attach ...   Attach to a run transcript, following active work
  logs ...     Print a run transcript once
  resume ...   Continue the latest or selected run
  status ...   Show run status
  stop ...     Stop a tracked Desktop/CLI runner

Available goals:
${renderGoalRows()}

The existing shortcut still works:
  agent-native migrate <source> [options]`;
}

export function codeShellIntro(): string {
  return `Agent-Native Code Agents
Type a coding task to start a session, /help for commands, /goals for goals, or /exit to leave.`;
}

export function codeShellHelp(): string {
  return `Code Agents shell commands:
  /help        Show this help
  /goals       List available coding-agent goals
  /task ...    Run a generic coding task
  /migrate ... Move a source into agent-native
  /audit ...   Audit a public URL for agent-readable surfaces
  /exit        Leave the shell
  /quit        Leave the shell

Compatibility shortcuts:
  exec "prompt"
  -p "prompt"
  list
  ps
  attach --last
  logs --last
  resume --last "follow-up prompt"
  --continue "follow-up prompt"
  resume --last
  status --last
  ui --last
  stop --last`;
}

export function codeShellFreeTextMessage(): string {
  return `Bare prompts run as generic Code Agent sessions.
Use /task explicitly if you prefer, or /migrate and /audit for specialized goals.`;
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

function isCodeAgentControlSubcommand(
  value: string,
): value is CodeAgentControlSubcommand {
  return CODE_AGENT_CONTROL_SUBCOMMANDS.has(
    value as CodeAgentControlSubcommand,
  );
}

function parseResumeFollowUpPrompt(args: string[]): string | null {
  const [rawFirst, ...rest] = args;
  if (normalizeGoalToken(rawFirst ?? "") !== "resume") return null;
  if (!rest.includes("--last")) return null;

  const promptArgs = rest.filter((arg) => arg !== "--last");
  const hasSeparator = promptArgs[0] === "--";
  const normalizedPromptArgs = hasSeparator ? promptArgs.slice(1) : promptArgs;
  if (
    !hasSeparator &&
    !normalizedPromptArgs.some((arg) => !arg.startsWith("-"))
  ) {
    return null;
  }

  const prompt = normalizedPromptArgs.join(" ").trim();
  return prompt || null;
}

async function runCodeAgentControl(
  subcommand: CodeAgentControlSubcommand,
  args: string[],
  output: NodeJS.WritableStream,
): Promise<void> {
  const runs = listCodeAgentRunRecords();
  switch (subcommand) {
    case "attach":
      await attachCodeAgentRun(runs, args, output);
      return;
    case "logs":
      writeLine(output, renderCodeAgentLogs(runs, args));
      return;
    case "list":
    case "ps":
      writeLine(output, renderCodeAgentStatus(runs, ["status"]));
      return;
    case "status":
      writeLine(output, renderCodeAgentStatus(runs, args));
      return;
    case "resume":
      writeLine(output, renderCodeAgentResume(runs, args));
      return;
    case "ui":
      writeLine(output, renderCodeAgentUi(runs, args));
      return;
    case "stop":
      writeLine(output, stopCodeAgentRun(runs, args));
      return;
  }
}

function renderCodeAgentStatus(
  runs: CodeAgentRunRecord[],
  args: string[],
): string {
  const selected = selectCodeAgentRun(runs, args, {
    defaultToLast: args.includes("--last") || hasExplicitRunId(args),
  });
  if (selected) {
    return renderCodeAgentRunDetail("Code Agents status", selected);
  }

  return [
    "",
    "Code Agents status",
    "",
    runs.length === 0
      ? "  No Code Agents sessions found."
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
      "Code Agents resume",
      "",
      "  No Code Agents sessions found.",
      "",
      'Start one with: agent-native code "what to change"',
    ].join("\n");
  }

  const transcriptEvents = listCodeAgentTranscriptEvents(run.id);
  const latestEvent = transcriptEvents.at(-1);
  return [
    "",
    "Code Agents resume",
    "",
    `  Run:     ${run.id}`,
    `  Goal:    /${run.goalId}`,
    `  Status:  ${run.status}${run.phase ? ` (${run.phase})` : ""}`,
    `  Updated: ${run.updatedAt}`,
    latestEvent
      ? `  Last:    ${truncateForDisplay(latestEvent.message, 140)}`
      : "",
    "",
    "Continue in the shell:",
    "  agent-native code",
    "",
    "Attach to the live transcript:",
    `  agent-native code attach ${run.id}`,
    "",
    "Or append a follow-up directly:",
    '  agent-native code resume --last "next instruction"',
  ]
    .filter(Boolean)
    .join("\n");
}

function renderCodeAgentUi(runs: CodeAgentRunRecord[], args: string[]): string {
  const run = selectCodeAgentRun(runs, args, { defaultToLast: true });
  return [
    "",
    "Code Agents UI",
    "",
    "Open Agent-Native Desktop and choose Code Agents from the left sidebar.",
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
      "Code Agents stop",
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
        ? "Stop requested for Code Agent runner."
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
    "Code Agents stop",
    "",
    run ? `  Run: ${run.id}` : "  No Code Agents session selected.",
    "",
    run
      ? "  Stop requested. If a tracked runner process is active, it received SIGTERM."
      : '  Start one with: agent-native code "what to change"',
  ].join("\n");
}

function renderCodeAgentLogs(
  runs: CodeAgentRunRecord[],
  args: string[],
): string {
  const run = selectCodeAgentRun(runs, args, { defaultToLast: true });
  if (!run) {
    return [
      "",
      "Code Agents logs",
      "",
      "  No Code Agents session selected.",
      "",
      "Try: agent-native code logs --last",
    ].join("\n");
  }
  const events = listCodeAgentTranscriptEvents(run.id);
  return [
    "",
    `Code Agents logs: ${run.id}`,
    `/${run.goalId} ${run.status}${run.phase ? ` (${run.phase})` : ""}`,
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
        "Code Agents attach",
        "",
        "  No Code Agents session selected.",
        "",
        "Try: agent-native code attach --last",
      ].join("\n"),
    );
    return;
  }

  const follow = !args.includes("--no-follow");
  const printed = new Set<string>();
  writeLine(output, "");
  writeLine(output, `Attaching to Code Agent run ${run.id}`);
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
  return [
    `  - ${run.id}`,
    `    /${run.goalId} ${run.status}${run.phase ? ` (${run.phase})` : ""}${progress}`,
    `    ${truncateForDisplay(run.title, 100)}`,
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

async function runCodeGoal(
  goalId: CodeAgentGoalId,
  forwardedArgs: string[],
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  const goal = CODE_AGENT_CLI_GOALS.find(
    (candidate) => candidate.id === goalId,
  );
  if (!goal) {
    throw new Error(`Unknown Code Agents goal: ${goalId}`);
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
): Promise<void> {
  const prompt = parseTaskPrompt(forwardedArgs);
  if (!prompt) {
    console.log(taskUsage());
    return;
  }

  const run = createCodeAgentRunRecord({
    goalId: "task",
    title: titleFromPrompt(prompt),
    subtitle: "Generic coding task",
    status: "running",
    phase: "starting",
    progress: {
      label: "Starting",
      completed: 0,
      total: 1,
      percent: 5,
    },
    details: [
      { label: "Prompt", value: truncateForDisplay(prompt, 160) },
      { label: "Agent", value: "Running locally" },
    ],
    cwd: process.cwd(),
    metadata: {
      prompt,
      source: "agent-native code /task",
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
    message: "Starting local Code Agent execution.",
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

async function recordCodeAgentFollowUpPrompt(
  prompt: string,
  output: NodeJS.WritableStream,
): Promise<void> {
  const run = getLastCodeAgentRunRecord();
  if (!run) {
    writeLine(
      output,
      [
        "",
        "No Code Agents runs found.",
        "",
        'Start one with: agent-native code /task "what to change"',
      ].join("\n"),
    );
    return;
  }

  const event = appendCodeAgentTranscriptEvent({
    runId: run.id,
    kind: "user",
    message: prompt,
    metadata: { source: "resume-follow-up" },
  });
  writeLine(output, renderFollowUpRecorded(run, event));
  await executeCodeAgentRun({
    runId: run.id,
    prompt,
    appendUserEvent: false,
    stdout: output,
  });
}

function parseTaskPrompt(forwardedArgs: string[]): string {
  const promptArgs =
    forwardedArgs[0] === "--" ? forwardedArgs.slice(1) : forwardedArgs;
  return promptArgs.join(" ").trim();
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
    "Code Agents /task session started.",
    "",
    `  Run:    ${run.id}`,
    `  Prompt: ${truncateForDisplay(prompt, 160)}`,
    "",
    "Streaming output below. The transcript is saved with this run.",
  ].join("\n");
}

function renderFollowUpRecorded(
  run: CodeAgentRunRecord,
  event: ReturnType<typeof appendCodeAgentTranscriptEvent>,
): string {
  return [
    "",
    "Running follow-up prompt for Code Agent run.",
    "",
    `  Run:   ${run.id}`,
    `  Goal:  /${run.goalId}`,
    `  Event: ${event.id}`,
    "",
    "Streaming output below. The transcript is saved with this run.",
  ].join("\n");
}

function taskUsage(): string {
  return [
    "",
    "Usage:",
    '  agent-native code /task "what to change"',
    "",
    "The task goal starts a local Code Agent session, saves transcript events, and can be resumed with follow-up prompts.",
  ].join("\n");
}
