import { parseArgs } from "@agent-native/core";
import { readAppState } from "@agent-native/core/application-state";

export default async function (args: string[]) {
  const { full } = parseArgs(args);

  const navigation = await readAppState("navigation");
  if (!navigation) {
    return "No navigation state found. The UI may not be open.";
  }

  const nav = navigation as Record<string, string>;
  let output = `## Current View\n`;
  output += `- View: ${nav.view || "unknown"}\n`;
  if (nav.issueKey) output += `- Issue: ${nav.issueKey}\n`;
  if (nav.projectKey) output += `- Project: ${nav.projectKey}\n`;
  if (nav.boardId) output += `- Board: ${nav.boardId}\n`;
  if (nav.sprintId) output += `- Sprint: ${nav.sprintId}\n`;
  if (nav.search) output += `- Search: ${nav.search}\n`;
  if (nav.focusedIssueKey) output += `- Focused: ${nav.focusedIssueKey}\n`;

  return output;
}
