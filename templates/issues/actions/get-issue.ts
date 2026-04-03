import { parseArgs } from "@agent-native/core";
import { getAtlassianClient, jiraUrl, jiraFetch } from "./helpers.js";

function adfToText(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "mention") return `@${node.attrs?.text || ""}`;
  if (node.content) return node.content.map(adfToText).join("");
  return "";
}

export default async function (args: string[]) {
  const { key } = parseArgs(args);
  if (!key) return "Error: --key is required (e.g. --key=PROJ-123)";

  const client = await getAtlassianClient();

  const params = new URLSearchParams({
    fields:
      "summary,status,priority,assignee,reporter,issuetype,project,labels,created,updated,description,comment,subtasks,issuelinks,sprint,parent",
    expand: "changelog",
  });

  const issue = await jiraFetch(
    jiraUrl(client.cloudId, `/issue/${key}?${params}`),
    client.accessToken,
  );

  const f = issue.fields;
  let output = `## ${issue.key}: ${f.summary}\n\n`;
  output += `**Status:** ${f.status.name} (${f.status.statusCategory?.name})\n`;
  output += `**Type:** ${f.issuetype?.name}\n`;
  output += `**Priority:** ${f.priority?.name || "None"}\n`;
  output += `**Assignee:** ${f.assignee?.displayName || "Unassigned"}\n`;
  output += `**Reporter:** ${f.reporter?.displayName || "None"}\n`;
  output += `**Project:** ${f.project?.name} (${f.project?.key})\n`;
  if (f.labels?.length) output += `**Labels:** ${f.labels.join(", ")}\n`;
  if (f.sprint) output += `**Sprint:** ${f.sprint.name}\n`;
  if (f.parent)
    output += `**Parent:** ${f.parent.key} — ${f.parent.fields?.summary}\n`;
  output += `**Created:** ${f.created}\n`;
  output += `**Updated:** ${f.updated}\n`;

  if (f.description) {
    output += `\n### Description\n${adfToText(f.description)}\n`;
  }

  if (f.subtasks?.length) {
    output += `\n### Subtasks (${f.subtasks.length})\n`;
    for (const sub of f.subtasks) {
      output += `- ${sub.key} [${sub.fields.status.name}] ${sub.fields.summary}\n`;
    }
  }

  if (f.comment?.comments?.length) {
    output += `\n### Comments (${f.comment.comments.length})\n`;
    for (const c of f.comment.comments.slice(-5)) {
      output += `\n**${c.author?.displayName}** (${c.created}):\n${adfToText(c.body)}\n`;
    }
  }

  return output;
}
