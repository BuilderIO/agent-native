import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { setupError } from "./_database-setup-mutation.js";
import {
  assertPageLifecycleTarget,
  claimDocumentLifecycleIntent,
  finishDocumentLifecycleIntent,
  lockLifecycleDocument,
  parseDocumentLifecycleInput,
  refreshAfterDocumentLifecycle,
  usesDocumentLifecycleProtocol,
} from "./_document-lifecycle.js";
import { assertDocumentMutationAccess } from "./_document-mutation-access.js";
import {
  lockDatabasesForRestore,
  restoreDocumentSubtree,
} from "./delete-document.js";

const guardedRestoreSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .describe("Trash root page ID (trashRootId) to restore"),
    expectedTrashedAt: z
      .string()
      .min(1)
      .describe(
        "The item's exact trashedAt from list-content-trash or the delete-document receipt",
      ),
    idempotencyKey: z
      .string()
      .min(1)
      .max(200)
      .describe("Unique intent key; reuse unchanged after a lost response"),
  })
  .strict();

const legacyRestoreSchema = z
  .object({
    id: z.string().describe("Trashed root document ID"),
  })
  .strict();

async function restoreDocumentWithReceipt(
  input: z.infer<typeof guardedRestoreSchema>,
) {
  const access = await assertDocumentMutationAccess(input.id, "admin");
  const ownerEmail = access.resource.ownerEmail as string;
  const result = await getDb().transaction(async (transaction) => {
    const tx = transaction as unknown as ReturnType<typeof getDb>;
    const lockedDatabaseIds = await lockDatabasesForRestore(
      tx,
      input.id,
      ownerEmail,
    );
    const before = await lockLifecycleDocument(tx, input.id, ownerEmail);
    const { claim, replay } = await claimDocumentLifecycleIntent(
      tx,
      "restore-document",
      input.id,
      input.idempotencyKey,
      input,
    );
    if (replay) return replay;
    await assertPageLifecycleTarget(tx, input.id, "restore-document");
    if (!before.trashedAt)
      return finishDocumentLifecycleIntent(tx, claim, "unchanged", before, []);
    if (before.trashRootId !== input.id)
      setupError(
        "PARENT_IN_TRASH",
        `This page moved to Trash with "${before.trashRootId}". Restore that Trash item instead.`,
        400,
      );
    if (before.trashedAt !== input.expectedTrashedAt)
      setupError(
        "TRASH_REVISION_CONFLICT",
        "The Trash item changed after you read it. List Trash again and retry with its current trashedAt.",
      );
    const restored = await restoreDocumentSubtree(
      tx,
      input.id,
      ownerEmail,
      lockedDatabaseIds,
    );
    const after = await lockLifecycleDocument(tx, input.id, ownerEmail);
    if (after.trashedAt || !restored.includes(input.id))
      setupError(
        "READBACK_UNAVAILABLE",
        "The page could not be verified as restored, so the change was rolled back.",
      );
    return finishDocumentLifecycleIntent(
      tx,
      claim,
      "restored",
      after,
      restored,
    );
  });
  await refreshAfterDocumentLifecycle(result.receipt);
  return { success: true, ...result.value, receipt: result.receipt };
}

export default defineAction({
  description:
    "Restore one page and the sub-pages trashed with it from recoverable Trash, guarded by the item's exact trashedAt and an idempotency key. Pass the Trash root; returns a receipt with the restored page ids. Collections use restore-content-database.",
  mcpTool: true,
  mcpApp: { structuredContent: true },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  agentInputSchema: guardedRestoreSchema,
  schema: z.union([guardedRestoreSchema, legacyRestoreSchema]),
  run: async (input, ctx) => {
    if (usesDocumentLifecycleProtocol(input, ctx))
      return restoreDocumentWithReceipt(
        parseDocumentLifecycleInput(
          guardedRestoreSchema,
          input,
          "Agent page restores require the Trash root id, its exact trashedAt as expectedTrashedAt, and idempotencyKey.",
        ),
      );
    const { id } = input;
    // Checked as moving it to Trash is: whoever could trash the page, or is
    // offered Restore on its access screen, must be able to restore it.
    const access = await assertDocumentMutationAccess(id, "admin");
    const restored = await getDb().transaction((tx) =>
      restoreDocumentSubtree(
        tx as unknown as ReturnType<typeof getDb>,
        id,
        access.resource.ownerEmail as string,
      ),
    );
    if (restored.length === 0) throw new Error("Document is not in Trash");

    await writeAppState("refresh-signal", { ts: Date.now() });
    return { success: true, restored: restored.length, documentId: id };
  },
});
