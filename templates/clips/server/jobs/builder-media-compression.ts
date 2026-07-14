/**
 * builder-media-compression — recurring job (every 5 min).
 *
 * Clips upload completion intentionally skips Builder's inline video
 * compression wait so recording saves do not inherit the upload API's timeout
 * risk. This job finishes that work out of band: trigger Builder's existing
 * compress-media endpoint, poll the deterministic `/compressed` object, and
 * swap the recording row once it exists. The original media URL remains usable
 * the whole time.
 */

import { runBuilderMediaCompressionSweepOnce } from "../lib/builder-media-compression.js";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let skippingLogged = false;

export { runBuilderMediaCompressionSweepOnce };

export default function registerBuilderMediaCompressionJob(): void {
  const isProd = process.env.NODE_ENV === "production";
  const flag = process.env.RUN_BACKGROUND_JOBS;
  const enabled = flag === "1" || (isProd && flag !== "0");
  if (!enabled) {
    if (process.env.DEBUG && !skippingLogged) {
      console.log(
        "[builder-media-compression] Skipping background compression sweep (set RUN_BACKGROUND_JOBS=1 to enable in dev).",
      );
      skippingLogged = true;
    }
    return;
  }

  setInterval(() => {
    runBuilderMediaCompressionSweepOnce().catch((err) =>
      console.error("[builder-media-compression] interval failed:", err),
    );
  }, SWEEP_INTERVAL_MS);
  console.log(
    `[builder-media-compression] Recurring compression sweep every ${SWEEP_INTERVAL_MS / 1000}s.`,
  );
}
