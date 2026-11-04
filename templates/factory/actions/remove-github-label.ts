import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { resolveFactoryRepository } from "../server/lib/factory-repository-scope.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  issueAuditTarget,
  issueWriteAuditSummary,
  removeLabelFromIssue,
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
  description:
    "Remove one label from a GitHub issue or pull request for a workflow. repo is owner/name, never a URL. It writes only in the repository the factory is set up for (repository_not_allowed otherwise, as the merge gate refuses). An item that does not carry the label is a success with alreadyAbsent true, the same end state; a missing issue or repository is github_not_found. Returns alreadyAbsent and externalRef, derived from the repository, number and label.",
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    repo: z.string().trim().min(1).max(200),
    number: z.number().int().positive(),
    label: z.string(),
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    alreadyAbsent: z.boolean(),
    externalRef: z.string(),
  }),
  http: false,
  mcpTool: false,
  audit: {
    recordInputs: false,
    target: (args: { repo: string; number: number }) => issueAuditTarget(args),
    summary: (
      args: { repo: string; number: number; label: string },
      _result: unknown,
      meta: { status: string },
    ) => issueWriteAuditSummary(args, "DELETE", meta.status),
  },
  run: async (
    { factoryId: requestedFactoryId, repo, number, label },
    context,
  ) => {
    const caller = await requireWorkflowActionCaller(context, {
      factoryId: requestedFactoryId,
    });
    return removeLabelFromIssue(
      createGitHubClient({ ownerEmail: caller.userEmail, orgId: caller.orgId }),
      {
        repo,
        number,
        label,
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
