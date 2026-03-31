import { parseArgs } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";

export default async function (args: string[]) {
  const { view, issueKey, projectKey, boardId, sprintId } = parseArgs(args);

  const state: Record<string, string> = {};
  if (view) state.view = view as string;
  if (issueKey) state.issueKey = issueKey as string;
  if (projectKey) state.projectKey = projectKey as string;
  if (boardId) state.boardId = boardId as string;
  if (sprintId) state.sprintId = sprintId as string;

  if (!view) {
    return "Error: --view is required (my-issues, projects, board, sprint, settings)";
  }

  await writeAppState("navigate", state);
  return `Navigating to ${view}${issueKey ? ` / ${issueKey}` : ""}`;
}
