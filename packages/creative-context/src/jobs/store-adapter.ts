import {
  claimJobLease,
  createJob,
  getJob,
  ingestItems,
  inferBrandDnaProposalFromCorpus,
  markSourceContainerOwnerVerified,
  releaseJobLease,
  reconcileSourceInventory,
  renewJobLease,
  updateLeasedJob,
  upsertSourceInventory,
  updateContextSource,
} from "../store/index.js";
import type { ContextImportJobPersistence } from "./types.js";

export const creativeContextImportJobPersistence: ContextImportJobPersistence =
  {
    getJob,
    claimJobLease,
    async renewJobLease(input) {
      return Boolean(await renewJobLease(input));
    },
    releaseJobLease,
    updateLeasedJob,
    upsertSourceInventory,
    ingestItems,
    reconcileSourceInventory,
    markSourceContainerOwnerVerified,
    async updateSourceSyncCursor(sourceId, syncCursor) {
      await updateContextSource(sourceId, { syncCursor });
    },
    async inferBrandDnaProposal(input) {
      const result = await inferBrandDnaProposalFromCorpus(input);
      return "preview" in result
        ? { preview: result.preview }
        : { reason: result.reason };
    },
    async enqueueMediaEnrichment(input) {
      const job = await createJob({
        sourceId: input.sourceId,
        kind: "enrich-media",
        request: { operation: "enrich-media", mediaIds: input.mediaIds },
        progressTotal: input.mediaIds.length,
        budget: {
          eagerLimit: input.eagerLimit,
          remainingMode: "pending-on-demand",
        },
      });
      return { jobId: job.id };
    },
  };
