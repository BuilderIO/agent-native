import {
  claimMonitorRun,
  evaluateAndNotifyMonitor,
  listDueMonitors,
  monitorAllowPrivateHosts,
  pruneOldCheckResults,
  recordMonitorResult,
  runMonitorCheck,
  type Monitor,
} from "../lib/uptime-monitors";

let running = false;
let listFailureLogged = false;
const DEFAULT_MAX_MONITORS_PER_SWEEP = 100;

function maxMonitorsPerSweep(input?: number): number {
  if (input) return Math.max(1, Math.min(500, Math.floor(input)));
  const raw = process.env.UPTIME_MONITOR_SWEEP_LIMIT?.trim();
  if (!raw) return DEFAULT_MAX_MONITORS_PER_SWEEP;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_MONITORS_PER_SWEEP;
}

export interface UptimeSweepResult {
  processed: number;
  up: number;
  failing: number;
  failed: number;
  remaining: number;
}

export async function runDueMonitorsOnce(
  options: {
    ownerEmail?: string;
    orgId?: string | null;
    limit?: number;
    source?: "netlify-scheduled" | "in-process";
  } = {},
): Promise<UptimeSweepResult> {
  if (running) {
    return { processed: 0, up: 0, failing: 0, failed: 0, remaining: 0 };
  }
  running = true;
  let processed = 0;
  let up = 0;
  let failing = 0;
  let failed = 0;
  let remaining = 0;

  try {
    const sweepLimit = maxMonitorsPerSweep(options.limit);
    const allowPrivateHosts = monitorAllowPrivateHosts();

    let monitors: Monitor[];
    try {
      monitors = await listDueMonitors({
        limit: sweepLimit,
        ownerEmail: options.ownerEmail,
        orgId: options.orgId,
      });
    } catch (err) {
      if (!listFailureLogged) {
        console.error(
          "[uptime-monitors] Failed to list due monitors; skipping this sweep:",
          err,
        );
        listFailureLogged = true;
      }
      return { processed: 0, up: 0, failing: 0, failed: 0, remaining: 0 };
    }
    listFailureLogged = false;
    remaining = monitors.length >= sweepLimit ? 1 : 0;

    for (const monitor of monitors) {
      try {
        const claimed = await claimMonitorRun(monitor);
        if (!claimed) continue;
        processed++;
        const outcome = await runMonitorCheck(monitor, {
          allowPrivateHosts,
          source: options.source,
        });
        await recordMonitorResult(monitor, outcome);
        await evaluateAndNotifyMonitor(monitor, outcome, {
          email: monitor.ownerEmail,
          orgId: monitor.orgId,
        });
        if (outcome.ok) up++;
        else failing++;
      } catch (err) {
        failed++;
        console.error(
          `[uptime-monitors] Monitor ${monitor.id} (${monitor.name}) failed:`,
          err,
        );
      }
    }

    await pruneOldCheckResults().catch((err) =>
      console.error("[uptime-monitors] result prune failed:", err),
    );
  } finally {
    running = false;
  }

  return { processed, up, failing, failed, remaining };
}
