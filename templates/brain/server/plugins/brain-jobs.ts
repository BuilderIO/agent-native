import registerBrainDistillationQueueJob from "../jobs/distillation-queue.js";
import registerBrainSourceSyncJob from "../jobs/sync-sources.js";

export default () => {
  if (
    process.env.NETLIFY === "true" ||
    process.env.SITE_ID || // guard:allow-env-credential -- Netlify's public site ID identifies its function runtime.
    process.env.AWS_LAMBDA_FUNCTION_NAME
  ) {
    return;
  }
  registerBrainSourceSyncJob();
  registerBrainDistillationQueueJob();
};
