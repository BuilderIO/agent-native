import fs from "node:fs";
import path from "node:path";
import type { ActionTool } from "../../agent/types.js";
import { parseArgs } from "../utils.js";

const MAX_OUTPUT = 50_000;

export const tool: ActionTool = {
  description:
    "Read the contents of a file. Returns the file with line numbers. Use offset and limit to read specific sections of large files.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to the project root",
      },
      offset: {
        type: "string",
        description: "Line number to start reading from (1-based)",
      },
      limit: {
        type: "string",
        description: "Maximum number of lines to read",
      },
    },
    required: ["path"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const filePath = args.path;
  if (!filePath) return "Error: path is required";

  const resolved = path.resolve(process.cwd(), filePath);

  try {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      return `Error: ${filePath} is a directory, not a file. Use list-files instead.`;
    }

    const content = fs.readFileSync(resolved, "utf-8");
    const lines = content.split("\n");
    const offset = args.offset ? Math.max(1, parseInt(args.offset, 10)) : 1;
    const limit = args.limit
      ? parseInt(args.limit, 10)
      : lines.length - offset + 1;
    const selected = lines.slice(offset - 1, offset - 1 + limit);

    let output = selected
      .map((line, i) => `${String(offset + i).padStart(5)} │ ${line}`)
      .join("\n");

    if (output.length > MAX_OUTPUT) {
      output =
        output.slice(0, MAX_OUTPUT) +
        "\n... (truncated — use offset/limit to read specific sections)";
    }

    const header = `${filePath} (${lines.length} lines)`;
    return `${header}\n${output}`;
  } catch (err: any) {
    if (err?.code === "ENOENT") return `Error: File not found: ${filePath}`;
    return `Error: ${err?.message ?? String(err)}`;
  }
}

export default async function main(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  if (!parsed.path) {
    console.error("Usage: read-file --path <file>");
    throw new Error("Script failed");
  }
  console.log(await run(parsed));
}
