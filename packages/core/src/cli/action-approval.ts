import { createInterface } from "node:readline/promises";

import { vouchedOutcome } from "../action-frame.js";
import {
  runPreparedActionCall,
  type ActionRunContext,
  type PreparedActionCall,
} from "../action.js";

export type CliApprovalSource = "flag" | "prompt";

export function takeCliApprovalFlag(args: string[]): {
  args: string[];
  approved: boolean;
} {
  return {
    args: args.filter((arg) => arg !== "--approved"),
    approved: args.includes("--approved"),
  };
}

const PLAIN_TOKEN = /^[a-zA-Z0-9_./:=@-]+$/;

function windowsShellUnknown(): boolean {
  return (
    process.platform === "win32" &&
    !/(?:^|[/\\])(bash|zsh|sh)(?:\.exe)?$/i.test(process.env.SHELL ?? "")
  );
}

function shellQuote(value: string): string {
  const powershell = windowsShellUnknown();
  return PLAIN_TOKEN.test(value) && !(powershell && value.startsWith("@"))
    ? value
    : `'${value.replace(/'/g, powershell ? "''" : `'"'"'`)}'`;
}

// cmd.exe reads single quotes literally. Inside double quotes it passes
// spaces and `&|<>^` through, and node reads `\"` as a quote.
function cmdQuote(value: string): string {
  return PLAIN_TOKEN.test(value)
    ? value
    : `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

export function cliRerunCommand(
  actionName: string,
  originalArgs: string[],
  approved = true,
): string {
  const tokens = [
    "pnpm",
    "action",
    actionName,
    ...originalArgs,
    ...(approved ? ["--approved"] : []),
  ];
  const command = tokens.map(shellQuote).join(" ");
  if (!windowsShellUnknown()) return command;
  // Windows without a POSIX SHELL could be PowerShell or cmd.exe, and they
  // quote differently, so name both when the quoting differs.
  const cmd = tokens.map(cmdQuote).join(" ");
  return cmd === command ? command : `${command}\nIn cmd.exe: ${cmd}`;
}

// On Windows, pnpm runs the action script through cmd.exe from any shell,
// and cmd.exe expands %NAME% even inside quotes. A rerun with --approved
// could then run other values than the ones refused, so none is offered.
const CMD_VARIABLE = /%[^%]+%/;

export function cliApprovalRefusal(
  actionName: string,
  originalArgs: string[],
): string {
  const heading = `Action "${actionName}" requires human approval.`;
  if (
    process.platform === "win32" &&
    originalArgs.some((arg) => CMD_VARIABLE.test(arg))
  ) {
    return `${heading} An argument contains %NAME%, which Windows expands when pnpm runs the action, so a rerun with --approved might not use these values. Ask the person to run this in a terminal and check the values at the prompt:\n${cliRerunCommand(actionName, originalArgs, false)}`;
  }
  return `${heading} Ask the person to approve this call, then rerun:\n${cliRerunCommand(actionName, originalArgs)}`;
}

export async function requestCliApproval(
  actionName: string,
  parsed: unknown,
  originalArgs: string[],
): Promise<CliApprovalSource> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(cliApprovalRefusal(actionName, originalArgs));
  }
  console.log(`Action "${actionName}" requires human approval.`);
  console.log(JSON.stringify(parsed, null, 2));
  const prompt = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await prompt.question("Run this action? [y/N] ");
    if (!/^(y|yes)$/i.test(answer.trim())) {
      throw new Error(`Action "${actionName}" was not approved.`);
    }
  } finally {
    prompt.close();
  }
  return "prompt";
}

/**
 * Runs a prepared CLI call. An approved one records how it was approved on
 * the action's own audit row, as agent chat and A2A approvals do.
 */
export async function runApprovedCliAction(
  entry: Parameters<typeof runPreparedActionCall>[0],
  prepared: PreparedActionCall,
  ctx: ActionRunContext,
  approval?: CliApprovalSource,
): Promise<unknown> {
  return runPreparedActionCall(
    entry,
    prepared,
    ctx,
    vouchedOutcome(
      { refused: false },
      approval
        ? {
            auditOverride: {
              approval: approval === "flag" ? "cli-flag" : "cli-prompt",
            },
          }
        : undefined,
    ),
  );
}
