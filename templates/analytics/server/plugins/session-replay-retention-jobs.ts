import { runSessionReplayRetentionOnce } from "../jobs/session-replay-retention";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
let skippingLogged = false;

export default function registerSessionReplayRetentionJobs(): void {
  const isProd = process.env.NODE_ENV === "production";
  const flag =
    process.env.ANALYTICS_SESSION_REPLAY_RETENTION_JOBS ??
    process.env.RUN_BACKGROUND_JOBS;
  const enabled = flag === "1" || (isProd && flag !== "0");

  if (!enabled) {
    if (!skippingLogged) {
      console.log(
        "[session-replay] Skipping retention job (set ANALYTICS_SESSION_REPLAY_RETENTION_JOBS=1 or RUN_BACKGROUND_JOBS=1 to enable in dev; on by default in production)",
      );
      skippingLogged = true;
    }
    return;
  }

  setInterval(() => {
    runSessionReplayRetentionOnce()
      .then((result) => {
        if (
          result.finalized ||
          result.expired ||
          result.chunks ||
          result.blobDeleteFailures
        ) {
          console.log("[session-replay] Retention sweep completed", result);
        }
      })
      .catch((err) =>
        console.error("[session-replay] retention interval failed:", err),
      );
  }, ONE_DAY_MS);

  console.log("[session-replay] Retention sweep scheduled daily.");
}
