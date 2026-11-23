import { and, eq, isNull } from "@agent-native/core/db/schema";

import type { NotebookThreadInput } from "../../shared/notebook-proposals.js";
import { getDb, schema } from "../db/index.js";
import { notebookThreadProjects } from "./notebook-proposal-schema.js";
import type { Queryable } from "./scope.js";
import type { NotebookThreadScope } from "./thread-projects.js";

export async function readOwnedAskNotebook(
  scope: NotebookThreadScope,
  { projectId, threadId }: NotebookThreadInput,
  db: Queryable = getDb(),
) {
  const binding = notebookThreadProjects;
  const project = schema.projects;
  const [row] = await db
    .select({ bindingId: binding.id, listed: project.listed })
    .from(binding)
    .innerJoin(
      project,
      and(
        eq(project.id, binding.projectId),
        eq(project.orgId, binding.orgId),
        eq(project.workingVersionId, binding.workingVersionId),
      ),
    )
    .where(
      and(
        eq(binding.projectId, projectId),
        eq(binding.threadId, threadId),
        eq(binding.orgId, scope.orgId),
        eq(binding.appId, scope.appId),
        eq(binding.kind, "ask"),
        eq(binding.createdBy, scope.ownerEmail),
        eq(project.ownerEmail, scope.ownerEmail),
        isNull(binding.endedAt),
        isNull(project.trashedAt),
      ),
    )
    .limit(1);
  return row;
}
