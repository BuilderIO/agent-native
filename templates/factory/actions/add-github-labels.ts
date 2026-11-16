import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { resolveFactoryRepository } from "../server/lib/factory-repository-scope.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  GITHUB_LABELS_MAX,
  GITHUB_LABEL_MAX_CHARS,
  addLabelsToIssue,
  issueAuditTarget,
  issueWriteAuditSummary,
} from "../server/lib/github-issue-write.js";
import { requireWorkflowActionCaller } from "../server/lib/workflow-action-support.js";
import { createGitHubClient } from "../server/triage/github-client.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: `Add 1 to ${GITHUB_LABELS_MAX} labels to a GitHub issue or pull request for a workflow. repo is owner/name, never a URL. Each label is text of up to ${GITHUB_LABEL_MAX_CHARS} characters with no comma or control character; a name the repository lacks is created. It writes only in the repository the factory is set up for (repository_not_allowed otherwise, as the merge gate refuses). Adding a label the item already has changes nothing, so a repeat is safe. Returns every label the item carries now, and externalRef, derived from the repository, number and labels.`,
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    repo: z.string().trim().min(1).max(200),
    number: z.number().int().positive(),
    labels: z.array(z.string()),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    labels: z.array(z.string()),
    externalRef: z.string(),
  }),
  http: false,
  mcpTool: false,
  audit: {
    recordInputs: false,
    target: (args: { repo: string; number: number }) => issueAuditTarget(args),
    summary: (
      args: { repo: string; number: number },
      _result: unknown,
      meta: { status: string },
    ) => issueWriteAuditSummary(args, "POST", meta.status),
  },
  run: async (
    { factoryId: requestedFactoryId, repo, number, labels },
    context,
  ) => {
    const caller = await requireWorkflowActionCaller(context, {
      factoryId: requestedFactoryId,
    });
    return addLabelsToIssue(
      createGitHubClient({ ownerEmail: caller.userEmail, orgId: caller.orgId }),
      {
        repo,
        number,
        labels,
        configuredRepository: await resolveFactoryRepository(
          getDb(),
          context,
          caller,
          caller.factoryId,
        ),
      },
    );
  },
});
