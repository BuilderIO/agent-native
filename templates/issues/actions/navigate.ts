import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description: "Navigate the UI to a specific view or issue",
  schema: z.object({
    view: z
      .string()
      .optional()
      .describe("Target view: my-issues, projects, board, sprint, settings"),
    issueKey: z.string().optional().describe("Issue key to open"),
    projectKey: z.string().optional().describe("Project key"),
    boardId: z.string().optional().describe("Board ID"),
    sprintId: z.string().optional().describe("Sprint ID"),
  }),
  http: false,
  run: async (args) => {
    const { view, issueKey, projectKey, boardId, sprintId } = args;

    const state: Record<string, string> = {};
    if (view) state.view = view;
    if (issueKey) state.issueKey = issueKey;
    if (projectKey) state.projectKey = projectKey;
    if (boardId) state.boardId = boardId;
    if (sprintId) state.sprintId = sprintId;

    if (!view) {
      return "Error: --view is required (my-issues, projects, board, sprint, settings)";
    }

    await writeAppState("navigate", state);
    return `Navigating to ${view}${issueKey ? ` / ${issueKey}` : ""}`;
  },
});
