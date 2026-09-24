import {
  applyText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";

export const DASHBOARD_COLLAB_SYNC_TIMEOUT_MS = 2_000;

class DashboardCollabSyncTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`timed out after ${timeoutMs}ms`);
    this.name = "DashboardCollabSyncTimeoutError";
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new DashboardCollabSyncTimeoutError(timeoutMs)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function syncDashboardToCollab(
  dashboardId: string,
  config: Record<string, unknown>,
  requestSource?: string,
): Promise<void> {
  const docId = `dash-${dashboardId}`;
  const startedAt = Date.now();
  try {
    const configStr = JSON.stringify(config);
    await withTimeout(
      (async () => {
        const exists = await hasCollabState(docId);
        if (exists) {
          await applyText(docId, configStr, "content", requestSource);
        } else {
          await seedFromText(docId, configStr);
        }
      })(),
      DASHBOARD_COLLAB_SYNC_TIMEOUT_MS,
    );
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    const outcome =
      error instanceof DashboardCollabSyncTimeoutError ? "timed out" : "failed";
    console.warn(
      `[analytics] Dashboard collab sync ${outcome} for ${dashboardId} after ${elapsedMs}ms: ${message}`,
    );
  }
}

/**
 * Queue the live-editor sync after SQL has committed. SQL remains the source
 * of truth, so a collab lock or unavailable database must not hold a mutation.
 */
export function queueDashboardCollabSync(
  dashboardId: string,
  config: Record<string, unknown>,
  requestSource?: string,
): void {
  void syncDashboardToCollab(dashboardId, config, requestSource);
}
