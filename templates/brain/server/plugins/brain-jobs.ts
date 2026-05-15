import registerBrainDistillationQueueJob from "../jobs/distillation-queue.js";
import registerBrainSourceSyncJob from "../jobs/sync-sources.js";

export default () => {
  registerBrainSourceSyncJob();
  registerBrainDistillationQueueJob();
};
