import { createHash } from "node:crypto";

import { fail, type ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import { notebookProposalErrors } from "../../app/i18n/messages/notebook-proposal-errors.js";
import type {
  NotebookChange,
  NotebookSnapshot,
} from "../../shared/notebook-operations.js";
import {
  CONTRACT_VERSION,
  notebookCellIdSchema,
  revisionSchema,
} from "../../shared/notebook-snapshot-contract.js";
import {
  readNotebookProposalSnapshot,
  replayNotebookProposal,
  stageNotebookProposal,
} from "../model/notebook-proposals.js";
import type { WorkspaceScope } from "../model/scope.js";
import {
  ensureToolNotebookThreadBinding,
  type NotebookThreadBinding,
} from "../model/thread-projects.js";
import { requireNotebookToolIdentity } from "./notebook-tool-context.js";
import { refreshedProjectDocument } from "./project-action-access.js";
import { requireCurrentWorkspace } from "./workspace-access.js";

export const notebookToolProposalFields = {
  threadId: z.string().optional(),
  proposalIds: z.array(z.string()).optional(),
};

const notebookProposalCardResult = z.object({
  threadId: notebookToolProposalFields.threadId,
  proposalIds: z.array(z.string()).min(1),
});

export const notebookProposalChatUI = {
  renderer: "analytics2.notebook-proposal",
  when: (_args: Record<string, unknown>, result: unknown) =>
    notebookProposalCardResult.safeParse(result).success,
  projectResult: (args: Record<string, unknown>, result: unknown) => {
    const card = notebookProposalCardResult.parse(result);
    return notebookProposalCardResult.parse({
      ...card,
      threadId: card.threadId ?? args.threadId,
    });
  },
};

export function invalidNotebookProposal(): never {
  return fail(notebookProposalErrors.invalidProposal, {
    statusCode: 422,
    errorCode: "invalid_proposal",
  });
}

export async function proposeNotebookToolChange(
  context: ActionRunContext | undefined,
  projectId: string,
  action: string,
  args: unknown,
  build: (
    notebook: NotebookSnapshot,
    newCellId: z.infer<typeof notebookCellIdSchema>,
    scope: WorkspaceScope,
    binding: NotebookThreadBinding,
  ) => NotebookChange[] | Promise<NotebookChange[]>,
) {
  const { scope, threadId, ...identity } = await requireNotebookToolIdentity(
    await requireCurrentWorkspace(),
    context,
  );
  const key = { projectId, threadId };
  await ensureToolNotebookThreadBinding(scope, key);
  const intent = { action, args };
  const opId = createHash("sha256")
    .update(JSON.stringify([scope.orgId, scope.ownerEmail, threadId, identity]))
    .digest("hex");
  const newCellId = notebookCellIdSchema.parse(`cel_${opId.slice(0, 32)}`);
  const replay = await replayNotebookProposal(scope, key, identity, intent);
  const proposal = replay ?? (await stage());
  return {
    threadId,
    proposalIds: proposal.proposalIds,
    newCellId,
    project: await refreshedProjectDocument(scope, projectId),
  };

  async function stage() {
    const { binding, notebook } = await readNotebookProposalSnapshot(
      scope,
      key,
    );
    const changes = await build(notebook, newCellId, scope, binding);
    if (!changes.length) invalidNotebookProposal();
    return stageNotebookProposal(
      scope,
      {
        ...key,
        command: {
          protocol: CONTRACT_VERSION,
          projectId: notebook.snapshot.projectId,
          workingVersionId: notebook.snapshot.head.versionId,
          observedHead: notebook.snapshot.head,
          opId,
          changes,
        },
        expectedOverlayRevision: revisionSchema.parse(
          binding.overlayRevision.toString(),
        ),
      },
      identity,
      intent,
    );
  }
}
