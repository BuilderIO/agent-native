// Preflight for the configured findings tracker: its own checks plus the
// branch-run link put on tickets.
import { main } from "../lib/cli.ts";
import { runDoctor } from "../lib/doctor.ts";
import { loadTracker, runLinkCheck, trackerName } from "../lib/findings.ts";

main(async () => {
  const tracker = await loadTracker();
  console.log(`tracker: ${trackerName()}`);
  await runDoctor([...tracker.doctorChecks(), runLinkCheck]);
});
