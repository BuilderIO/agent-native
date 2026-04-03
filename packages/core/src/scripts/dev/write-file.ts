import fs from "node:fs";
import path from "node:path";
import type { ActionTool } from "../../agent/types.js";
import { parseArgs } from "../utils.js";

export const tool: ActionTool = {
  description:
    "Write content to a file. Creates the file if it doesn't exist, or overwrites it. Creates parent directories automatically.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to the project root",
      },
      content: {
        type: "string",
        description: "The content to write to the file",
      },
    },
    required: ["path", "content"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  const filePath = args.path;
  const content = args.content;
  if (!filePath) return "Error: path is required";
  if (content === undefined) return "Error: content is required";

  const resolved = path.resolve(process.cwd(), filePath);

  try {
    const dir = path.dirname(resolved);
    fs.mkdirSync(dir, { recursive: true });

    const existed = fs.existsSync(resolved);
    fs.writeFileSync(resolved, content, "utf-8");

    const bytes = Buffer.byteLength(content, "utf-8");
    const lines = content.split("\n").length;
    return `${existed ? "Updated" : "Created"} ${filePath} (${lines} lines, ${bytes} bytes)`;
  } catch (err: any) {
    return `Error: ${err?.message ?? String(err)}`;
  }
}

export default async function main(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  if (!parsed.path || parsed.content === undefined) {
    console.error("Usage: write-file --path <file> --content <text>");
    throw new Error("Script failed");
  }
  console.log(await run(parsed));
}
