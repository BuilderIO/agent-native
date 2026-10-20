import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { evaluateMergeGate } from "../server/lib/factory-merge-gate.js";
import { parseRepositoryInput } from "../server/lib/factory-pull-request.js";
import { resolveFactoryRepository } from "../server/lib/factory-repository-scope.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import { requireWorkflowActionCaller } from "../server/lib/workflow-action-support.js";
import { createGitHubClient } from "../server/triage/github-client.js";

export default defineAction({
  description:
    "Check whether a pull request may merge without a person, for a workflow. Returns eligible and every reason it is not. Eligible means: the repository is this factory's, a Builder account (builderio-bot or builder-io-integration[bot]) opened it from a branch in the same repository (not a fork) and aims it at the default branch, every check on the head commit is green, no review thread is unresolved, no review blocks it, a person who is an owner, member or collaborator, not the author and not a bot or Builder account, has approved the current head commit (a push after approval needs a new one), it changes at most 30 files and 1500 lines, and it touches no never-automate path (auth, sessions, identity, credentials, vault, migrations, payments, security, publishable packages, owner-owned areas). approvals counts the approvals found (seen, qualifying, byAuthor, fromBots, fromNonCollaborators, stale); approval_required in reasonCodes says none counts. merge-factory-pull-request runs this same check itself before it merges.",
  schema: z.object({
    factoryId: factoryIdSchema.optional(),
    repo: z.string().trim().min(1).max(256),
    number: z.number().int().positive(),
  }),
  http: false,
  mcpTool: false,
  readOnly: true,
  audit: {
    onRead: true,
    target: (args: { repo: string; number: number }) => ({
      type: "github-pull-request",
      id: `${args.repo}#${args.number}`,
      visibility: "org",
    }),
    summary: (args: { repo: string; number: number }, result: unknown) =>
      `Checked whether ${args.repo}#${args.number} may merge: ${
        (result as { eligible?: boolean } | undefined)?.eligible
          ? "eligible"
          : "not eligible"
      }`,
  },
  run: async ({ factoryId: requestedFactoryId, repo, number }, context) => {
    const caller = await requireWorkflowActionCaller(context, {
      factoryId: requestedFactoryId,
    });
    const repository = parseRepositoryInput(repo);
    const gate = await evaluateMergeGate({
      github: createGitHubClient({
        ownerEmail: caller.userEmail,
        orgId: caller.orgId,
      }),
      repository,
      repositoryLabel: repo,
      number,
      configuredRepository: await resolveFactoryRepository(
        getDb(),
        context,
        caller,
        caller.factoryId,
      ),
    });
    return {
      ok: true as const,
      eligible: gate.eligible,
      reasons: gate.reasons.map((reason) => reason.message),
      reasonCodes: gate.reasons.map((reason) => reason.code),
      reasonText: gate.reasons.map((reason) => reason.message).join(" "),
      approvals: gate.approvals,
      repo: `${repository.owner}/${repository.repo}`,
      number,
      url: gate.pullRequest?.url ?? null,
      state: gate.pullRequest?.state ?? null,
      headSha: gate.pullRequest?.headSha ?? null,
      checkedAt: new Date().toISOString(),
    };
  },
});
