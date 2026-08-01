import {
  WORKSPACE_OWNER,
  resourceGetByPath,
  resourcePut,
} from "@agent-native/core/resources";
import { defineNitroPlugin } from "@agent-native/core/server";

const JOB_PATH = "jobs/factory-observation-scheduler.md";

const JOB_BODY = `
# Factory observation scheduler

Call get-triage-config. If pollingEnabled is true and a Slack channel is
configured, call poll-slack-channel. Then call list-triage-items with status
received and evaluate each returned item with evaluate-triage-item. Keep the
work bounded to the returned page. This scheduled observer does not start work
or send provider messages; interactive approvals happen through the Factory agent.
If any action reports an error, preserve that error and continue to the next
item; do not report a false success.
`;

function workspaceOwnerEmail() {
  const email = process.env.WORKSPACE_OWNER_EMAIL?.trim().toLowerCase(); // guard:allow-env-credential - deployment owner identity, not a user credential
  if (!email || /[\r\n]/.test(email)) return undefined;
  return email;
}

function readFrontmatterField(content: string, key: string): string | null {
  if (!content.startsWith("---\n")) return null;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return null;
  const match = content
    .slice(4, end)
    .match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
  return match ? match[1].trim() : null;
}

function setFrontmatterField(content: string, key: string, value: string) {
  if (!content.startsWith("---\n")) return content;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return content;
  const frontmatter = content.slice(4, end);
  const pattern = new RegExp(`^${key}:.*$`, "m");
  if (pattern.test(frontmatter)) {
    return `---\n${frontmatter.replace(pattern, `${key}: ${value}`)}${content.slice(end)}`;
  }
  return `${content.slice(0, end)}\n${key}: ${value}${content.slice(end)}`;
}

function jobContent(createdBy: string) {
  return `---
schedule: "* * * * *"
enabled: true
createdBy: ${createdBy}
runAs: creator
---
${JOB_BODY}`;
}

async function ensureSchedulerJob() {
  const existing = await resourceGetByPath(WORKSPACE_OWNER, JOB_PATH);
  const ownerEmail = workspaceOwnerEmail();

  if (!existing) {
    if (!ownerEmail) {
      throw new Error(
        "WORKSPACE_OWNER_EMAIL is required to seed the Factory scheduler",
      );
    }
    await resourcePut(
      WORKSPACE_OWNER,
      JOB_PATH,
      jobContent(ownerEmail),
      "text/markdown",
    );
    return;
  }

  if (!ownerEmail) {
    const runAs = readFrontmatterField(existing.content, "runAs");
    const createdBy = readFrontmatterField(existing.content, "createdBy");
    if (runAs === "creator" && createdBy) return;
    throw new Error(
      "WORKSPACE_OWNER_EMAIL is required to repair the Factory scheduler",
    );
  }

  if (
    !existing.content.startsWith("---\n") ||
    !existing.content.includes("\n---", 4)
  ) {
    await resourcePut(
      WORKSPACE_OWNER,
      JOB_PATH,
      jobContent(ownerEmail),
      "text/markdown",
    );
    return;
  }

  const migrated = setFrontmatterField(
    setFrontmatterField(existing.content, "createdBy", ownerEmail),
    "runAs",
    "creator",
  );
  if (migrated === existing.content) return;
  await resourcePut(WORKSPACE_OWNER, JOB_PATH, migrated, "text/markdown");
}

export default defineNitroPlugin(async () => {
  try {
    await ensureSchedulerJob();
  } catch (error) {
    console.error("[factory-scheduler-job] failed to seed job:", error);
  }
});
