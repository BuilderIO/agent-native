import { execSync } from "node:child_process";
import path from "node:path";
import type { ActionTool } from "../../agent/types.js";
import { parseArgs } from "../utils.js";

const MAX_OUTPUT = 50_000;
const TIMEOUT_MS = 30_000;

export const tool: ActionTool = {
  description:
    "Run a shell command and return the output. Use for build commands, git operations, package management, or any CLI task. Has a 30-second timeout.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute",
      },
      cwd: {
        type: "string",
        description:
          "Working directory for the command (default: project root)",
      },
    },
    required: ["command"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const command = args.command;
  if (!command) return "Error: command is required";

  const cwd = args.cwd ? path.resolve(process.cwd(), args.cwd) : process.cwd();

  try {
    const output = execSync(command, {
      cwd,
      timeout: TIMEOUT_MS,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    let result = output;
    if (result.length > MAX_OUTPUT) {
      result = result.slice(0, MAX_OUTPUT) + "\n... (output truncated at 50KB)";
    }
    return result || "(no output)";
  } catch (err: any) {
    let output = "";
    if (err?.stdout) output += err.stdout;
    if (err?.stderr) output += (output ? "\n" : "") + err.stderr;
    if (!output) output = err?.message ?? String(err);

    if (output.length > MAX_OUTPUT) {
      output = output.slice(0, MAX_OUTPUT) + "\n... (output truncated)";
    }

    // Throw so the agent framework marks this as isError:true, preventing the
    // agent from synthesizing a success narrative when the command failed.
    throw new Error(`Command failed (exit ${err?.status ?? "?"})\n${output}`);
  }
}

export default async function main(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  if (!parsed.command) {
    console.error("Usage: shell --command <cmd> [--cwd <dir>]");
    throw new Error("Script failed");
  }
  console.log(await run(parsed));
}
