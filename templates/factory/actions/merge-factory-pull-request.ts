import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { mergeGatedPullRequest } from "../server/lib/factory-merge.js";
import { parseRepositoryInput } from "../server/lib/factory-pull-request.js";
import { resolveFactoryRepository } from "../server/lib/factory-repository-scope.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import { requireWorkflowActionCaller } from "../server/lib/workflow-action-support.js";
import { actionTripwire } from "../server/lib/workflow-run-observer.js";
import { createGitHubClient } from "../server/triage/github-client.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  description:
    "Merge one pull request for a workflow, only if the merge gate clears it, which includes an approving review of the head commit from a person who is an owner, member or collaborator other than the author (not a bot or Builder account). This action runs the same check as get-factory-merge-gate itself, immediately before merging, and refuses with merge_gate_ineligible when the pull request is not eligible, whatever the workflow checked earlier. The merge is pinned to the head commit it checked, so a push in between fails the merge. mergeMethod is a preference: the repository's settings decide, and merge_method_unavailable means none is allowed. Returns sha and url. A pull request that is already merged returns its merge commit with alreadyMerged true. When the error code ends in _outcome_unknown the merge may have happened, so read the pull request before trying again.",
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    repo: z.string().trim().min(1).max(256),
    number: z.number().int().positive(),
    mergeMethod: z.enum(["squash", "merge", "rebase"]).default("squash"),
  }),
  http: false,
  mcpTool: false,
  audit: {
    target: (args: { repo: string; number: number }) => ({
      type: "github-pull-request",
      id: `${args.repo}#${args.number}`,
      visibility: "org",
    }),
    summary: (
      args: { repo: string; number: number },
      _result: unknown,
      meta: { status: string },
    ) =>
      meta.status === "success"
        ? `Merged ${args.repo}#${args.number}`
        : `Tried to merge ${args.repo}#${args.number}`,
  },
  run: async (
    { factoryId: requestedFactoryId, repo, number, mergeMethod },
    context,
  ) => {
    const caller = await requireWorkflowActionCaller(context, {
      factoryId: requestedFactoryId,
    });
    const repository = parseRepositoryInput(repo);
    const merged = await mergeGatedPullRequest({
      github: createGitHubClient({
        ownerEmail: caller.userEmail,
        orgId: caller.orgId,
      }),
      repository,
      repositoryLabel: repo,
      number,
      mergeMethod,
      tripwire: actionTripwire({
        orgId: caller.orgId,
        factoryId: caller.factoryId,
      }),
      configuredRepository: await resolveFactoryRepository(
        getDb(),
        context,
        caller,
        caller.factoryId,
      ),
    });
    return {
      ok: true as const,
      merged: true as const,
      repo: `${repository.owner}/${repository.repo}`,
      number,
      ...merged,
    };
  },
});
