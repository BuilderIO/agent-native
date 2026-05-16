import { processBrainIngestQueueOnce } from "../../jobs/process-ingest-queue.js";

const DISTILL_QUEUE_INTERVAL_MS = 60 * 1000;
let skippingLogged = false;
let running = false;

function isEnabled() {
  const isProd = process.env.NODE_ENV === "production";
  const flag = process.env.RUN_BACKGROUND_JOBS;
  return flag === "1" || (isProd && flag !== "0");
}

function sweepLimit() {
  const raw = Number(process.env.BRAIN_DISTILLATION_SWEEP_LIMIT);
  if (!Number.isFinite(raw)) return 1;
  return Math.max(1, Math.min(5, Math.floor(raw)));
}

export default function registerBrainDistillationQueueJob(): void {
  if (!isEnabled()) {
    if (process.env.DEBUG && !skippingLogged) {
      console.log(
        "[brain-distillation] Skipping background distillation (set RUN_BACKGROUND_JOBS=1 to enable in dev).",
      );
      skippingLogged = true;
    }
    return;
  }

  setInterval(() => {
    if (running) return;
    running = true;
    processBrainIngestQueueOnce({
      limit: sweepLimit(),
      runDistillation: true,
    })
      .then((result) => {
        const count =
          result.processed.length +
          result.deferred.length +
          result.failed.length;
        if (count) {
          console.log(
            `[brain-distillation] processed=${result.processed.length} deferred=${result.deferred.length} failed=${result.failed.length}`,
          );
        }
      })
      .catch((err) =>
        console.error("[brain-distillation] interval failed:", err),
      )
      .finally(() => {
        running = false;
      });
  }, DISTILL_QUEUE_INTERVAL_MS);
}
