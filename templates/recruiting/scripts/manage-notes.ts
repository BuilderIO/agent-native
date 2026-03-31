import { parseArgs, output, localFetch } from "./helpers.js";
import type { ScriptTool } from "@agent-native/core";

export const tool: ScriptTool = {
  description:
    "Create, list, or delete AI notes on candidates. Use this to save analysis results.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "Action to perform",
        enum: ["create", "list", "delete"],
      },
      candidateId: { type: "string", description: "Candidate ID" },
      content: {
        type: "string",
        description: "Note content (for create)",
      },
      type: {
        type: "string",
        description: "Note type (for create)",
        enum: ["resume_analysis", "comparison", "interview_prep", "general"],
      },
      id: { type: "string", description: "Note ID (for delete)" },
    },
    required: ["action"],
  },
};

export async function run(args: Record<string, string>): Promise<string> {
  switch (args.action) {
    case "create": {
      if (!args.candidateId || !args.content || !args.type) {
        return "Error: --candidateId, --content, and --type are required for create";
      }
      const note = await localFetch<any>("/api/notes", {
        method: "POST",
        body: JSON.stringify({
          candidateId: Number(args.candidateId),
          content: args.content,
          type: args.type,
        }),
      });
      return `Created ${args.type} note for candidate ${args.candidateId} (ID: ${note.id})`;
    }
    case "list": {
      if (!args.candidateId) {
        return "Error: --candidateId is required for list";
      }
      const notes = await localFetch<any[]>(
        `/api/notes?candidate_id=${args.candidateId}`,
      );
      return JSON.stringify(notes, null, 2);
    }
    case "delete": {
      if (!args.id) {
        return "Error: --id is required for delete";
      }
      await localFetch(`/api/notes/${args.id}`, { method: "DELETE" });
      return `Deleted note ${args.id}`;
    }
    default:
      return "Error: --action must be create, list, or delete";
  }
}

export default async function main(): Promise<void> {
  const args = parseArgs();
  const result = await run(args);
  console.log(result);
}
