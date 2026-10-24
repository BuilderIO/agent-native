import { createInterface } from "node:readline/promises";

import { runOutsideActionInvocation, vouchedOutcome } from "../action-frame.js";
import {
  runPreparedActionCall,
  type ActionRunContext,
  type PreparedActionCall,
} from "../action.js";
import { auditAttribution } from "../audit/attribution.js";
import { recordActionAudit } from "../audit/record.js";

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

function shellQuote(value: string): string {
  const powershell =
    process.platform === "win32" &&
    !/(?:^|[/\\])(bash|zsh|sh)(?:\.exe)?$/i.test(process.env.SHELL ?? "");
  return /^[a-zA-Z0-9_./:=@-]+$/.test(value) &&
    !(powershell && value.startsWith("@"))
    ? value
    : `'${value.replace(/'/g, powershell ? "''" : `'"'"'`)}'`;
}

export async function requestCliApproval(
  actionName: string,
  parsed: unknown,
  originalArgs: string[],
): Promise<CliApprovalSource> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const command = [
      "pnpm",
      "action",
      actionName,
      ...originalArgs,
      "--approved",
    ]
      .map(shellQuote)
      .join(" ");
    throw new Error(
      `Action "${actionName}" requires human approval. Ask the person to approve this call, then rerun:\n${command}`,
    );
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

export async function runApprovedCliAction(
  entry: { run(args: any, ctx?: ActionRunContext): unknown },
  prepared: PreparedActionCall,
  ctx: ActionRunContext,
  approval?: CliApprovalSource,
): Promise<any> {
  const record = (status: "success" | "error", error?: unknown) =>
    runOutsideActionInvocation(() =>
      recordActionAudit({
        config: {
          enabled: true,
          recordInputs: false,
          summary: () =>
            approval === "flag"
              ? "CLI approval via --approved"
              : "CLI approval via prompt",
        },
        args: undefined,
        ctx,
        attribution: auditAttribution(ctx),
        status,
        error,
      }),
    );
  let result: unknown;
  try {
    result = await runPreparedActionCall(
      entry,
      prepared,
      ctx,
      vouchedOutcome({ refused: false }, undefined),
    );
  } catch (error) {
    if (approval) await record("error", error);
    throw error;
  }
  if (approval) await record("success");
  return result;
}
