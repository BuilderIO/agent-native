/**
 * Request a code change via the Builder.io background agent.
 *
 * In production, when a user asks for UI or code modifications, this tool
 * spins up a Builder.io background agent to handle the change on a new branch.
 * Returns a link the user can visit to track and accept the proposed changes.
 *
 * This is a placeholder — the real Builder.io integration is coming soon.
 *
 * Usage (agent):
 *   request-code-change --description="Add a dark mode toggle to the sidebar"
 *
 * Usage (CLI):
 *   pnpm action request-code-change --description="..."
 */

import { parseArgs, output, fatal } from "./helpers.js";
import type { ActionTool } from "@agent-native/core";

export const tool: ActionTool = {
  description:
    "Request a code change via the Builder.io background agent. Use this in production whenever the user asks to modify the UI, add features, change styles, or update any source code. Spins up a background agent on a new branch and returns a Builder.io link to track and accept the changes.",
  parameters: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description:
          "A clear description of the code change requested by the user (e.g. 'Add a snooze button to the email list item')",
      },
      files: {
        type: "string",
        description:
          "Optional comma-separated list of files likely involved in the change (e.g. 'app/components/email/EmailListItem.tsx')",
      },
    },
    required: ["description"],
  },
};

/** Generate a deterministic-looking but unique project branch ID */
function generateBranchId(description: string): string {
  const seed = description.length + Date.now();
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  let n = seed;
  for (let i = 0; i < 8; i++) {
    n = (n * 1664525 + 1013904223) & 0xffffffff;
    id += chars[Math.abs(n) % chars.length];
  }
  return id;
}

export async function run(args: Record<string, string>): Promise<string> {
  const { description, files } = args;

  if (!description?.trim()) {
    return "Error: --description is required.";
  }

  const isProduction = process.env.NODE_ENV === "production";
  if (!isProduction) {
    return [
      "⚠️  request-code-change is only active in production.",
      "In development, you can edit files directly via the dev agent tools.",
      `Requested change: "${description}"`,
    ].join("\n");
  }

  const branchId = generateBranchId(description);
  const projectId = `proj_${branchId}`;
  const url = `https://builder.io/app/projects/${projectId}`;

  const result = {
    status: "queued",
    projectId,
    url,
    description,
    ...(files ? { files: files.split(",").map((f) => f.trim()) } : {}),
    message: `Builder.io background agent queued. Track the change at: ${url}`,
  };

  return JSON.stringify(result, null, 2);
}

export default async function main(): Promise<void> {
  const args = parseArgs() as Record<string, string>;
  if (!args.description) {
    fatal(
      "--description is required. Usage: pnpm action request-code-change --description='...'",
    );
  }
  const result = await run(args);
  console.log(result);
  output({ result });
}
