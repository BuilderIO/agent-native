import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description: "Navigate the UI to a specific view or issue",
  parameters: {
    view: {
      type: "string",
      description: "Target view: my-issues, projects, board, sprint, settings",
    },
    issueKey: { type: "string", description: "Issue key to open" },
    projectKey: { type: "string", description: "Project key" },
    boardId: { type: "string", description: "Board ID" },
    sprintId: { type: "string", description: "Sprint ID" },
  },
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
