import registerBrainDistillationQueueJob from "../jobs/distillation-queue.js";
import registerBrainSourceSyncJob from "../jobs/sync-sources.js";

export default () => {
  if (process.env.NETLIFY === "true") return;
  registerBrainSourceSyncJob();
  registerBrainDistillationQueueJob();
};
