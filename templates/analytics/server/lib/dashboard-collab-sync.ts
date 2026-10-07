import {
  applyText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";

export const DASHBOARD_COLLAB_SYNC_TIMEOUT_MS = 2_000;

type DashboardSnapshot = {
  config: Record<string, unknown>;
  updatedAt: string;
};

type LoadDashboard = () => Promise<DashboardSnapshot | null>;

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
  queuedUpdatedAt: string,
  loadDashboard: LoadDashboard,
  requestSource?: string,
  retryLateFailure = true,
): Promise<void> {
  const docId = `dash-${dashboardId}`;
  const startedAt = Date.now();
  const sync = (async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const exists = await hasCollabState(docId);
      const dashboard = await loadDashboard();
      if (!dashboard) {
        throw new Error(
          `Dashboard "${dashboardId}" is unavailable for collab sync.`,
        );
      }
      if (dashboard.updatedAt < queuedUpdatedAt) {
        throw new Error(
          `Dashboard "${dashboardId}" read version ${dashboard.updatedAt} is older than queued version ${queuedUpdatedAt}.`,
        );
      }
      const configStr = JSON.stringify(dashboard.config);
      if (exists) {
        await applyText(docId, configStr, "content", requestSource);
      } else {
        await seedFromText(docId, configStr);
      }

      const latest = await loadDashboard();
      if (!latest) {
        throw new Error(
          `Dashboard "${dashboardId}" became unavailable during collab sync.`,
        );
      }
      if (JSON.stringify(latest.config) === configStr) return;
    }

    throw new Error(
      `Dashboard "${dashboardId}" kept changing during collab sync.`,
    );
  })();

  try {
    await withTimeout(sync, DASHBOARD_COLLAB_SYNC_TIMEOUT_MS);
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    const timedOut = error instanceof DashboardCollabSyncTimeoutError;
    console.warn(
      `[analytics] Dashboard collab sync ${timedOut ? "timed out" : "failed"} for ${dashboardId} after ${elapsedMs}ms: ${message}`,
    );
    if (timedOut) {
      void sync.catch((lateError) => {
        const lateMessage =
          lateError instanceof Error ? lateError.message : String(lateError);
        console.warn(
          `[analytics] Dashboard collab sync failed for ${dashboardId} after timeout: ${lateMessage}`,
        );
        if (retryLateFailure) {
          void queueDashboardCollabSyncInternal(
            dashboardId,
            queuedUpdatedAt,
            loadDashboard,
            requestSource,
            false,
          ).catch((repairError) => {
            const repairMessage =
              repairError instanceof Error
                ? repairError.message
                : String(repairError);
            console.warn(
              `[analytics] Dashboard collab sync recovery failed for ${dashboardId}: ${repairMessage}`,
            );
          });
        }
      });
    }
  }
}

const syncsByDocumentId = new Map<string, Promise<void>>();

function queueDashboardCollabSyncInternal(
  dashboardId: string,
  updatedAt: string,
  loadDashboard: LoadDashboard,
  requestSource?: string,
  retryLateFailure = true,
): Promise<void> {
  const docId = `dash-${dashboardId}`;
  const previous = syncsByDocumentId.get(docId) ?? Promise.resolve();
  const next = previous.then(
    () =>
      syncDashboardToCollab(
        dashboardId,
        updatedAt,
        loadDashboard,
        requestSource,
        retryLateFailure,
      ),
    () =>
      syncDashboardToCollab(
        dashboardId,
        updatedAt,
        loadDashboard,
        requestSource,
        retryLateFailure,
      ),
  );
  syncsByDocumentId.set(docId, next);
  void next.then(
    () => {
      if (syncsByDocumentId.get(docId) === next)
        syncsByDocumentId.delete(docId);
    },
    () => {
      if (syncsByDocumentId.get(docId) === next)
        syncsByDocumentId.delete(docId);
    },
  );
  return next;
}

export function queueDashboardCollabSync(
  dashboardId: string,
  updatedAt: string,
  loadDashboard: LoadDashboard,
  requestSource?: string,
): Promise<void> {
  return queueDashboardCollabSyncInternal(
    dashboardId,
    updatedAt,
    loadDashboard,
    requestSource,
  );
}
