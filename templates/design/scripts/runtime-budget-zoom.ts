type DeadlineResult<T> = { timedOut: false; value: T } | { timedOut: true };

export type ZoomSnapshot = {
  routeZoom: number | null;
  canvasScale: number | null;
  labelZoom: number | null;
};

export type StableZoomSnapshot = {
  routeZoom: number;
  canvasScale: number;
  labelZoom: number;
};

function isUsableZoomSnapshot(
  snapshot: ZoomSnapshot,
): snapshot is StableZoomSnapshot {
  return (
    snapshot.routeZoom !== null &&
    Number.isFinite(snapshot.routeZoom) &&
    snapshot.routeZoom > 0 &&
    snapshot.canvasScale !== null &&
    Number.isFinite(snapshot.canvasScale) &&
    snapshot.canvasScale > 0 &&
    snapshot.labelZoom !== null &&
    Number.isFinite(snapshot.labelZoom) &&
    snapshot.labelZoom > 0 &&
    Math.round(snapshot.routeZoom) === snapshot.labelZoom
  );
}

async function beforeDeadline<T>(
  run: () => Promise<T>,
  timeoutMs: number,
  cleanup: () => Promise<unknown>,
): Promise<DeadlineResult<T>> {
  if (timeoutMs <= 0) return { timedOut: true };

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const pending = Promise.resolve().then(run);
  // The operation may reject after the timeout wins; keep that rejection handled.
  void pending.catch(() => {});
  let result: DeadlineResult<T>;
  try {
    result = await Promise.race<DeadlineResult<T>>([
      pending.then((value) => ({ timedOut: false, value })),
      new Promise<DeadlineResult<T>>((resolve) => {
        timeout = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
  if (result.timedOut) await cleanup();
  return result;
}

export async function readZoomUntilAvailable(
  readZoom: () => Promise<number | null>,
  wait: (milliseconds: number) => Promise<unknown>,
  deadline: number,
  cleanup: () => Promise<unknown>,
  now = Date.now,
): Promise<number | null> {
  while (now() < deadline) {
    const result = await beforeDeadline(readZoom, deadline - now(), cleanup);
    if (result.timedOut) return null;
    const zoom = result.value;
    if (zoom !== null && Number.isFinite(zoom) && zoom > 0) return zoom;
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await wait(Math.min(250, remaining));
  }
  return null;
}

export async function readStableZoomUntilAvailable(
  readSnapshot: () => Promise<ZoomSnapshot>,
  wait: (milliseconds: number) => Promise<unknown>,
  deadline: number,
  cleanup: () => Promise<unknown>,
  options: {
    matches?: (snapshot: StableZoomSnapshot) => boolean;
    now?: () => number;
  } = {},
): Promise<StableZoomSnapshot | null> {
  const now = options.now ?? Date.now;
  let previous: StableZoomSnapshot | null = null;
  let stableReads = 0;
  while (now() < deadline) {
    const result = await beforeDeadline(
      readSnapshot,
      deadline - now(),
      cleanup,
    );
    if (result.timedOut) return null;
    const snapshot = result.value;
    if (
      !isUsableZoomSnapshot(snapshot) ||
      (options.matches && !options.matches(snapshot))
    ) {
      previous = null;
      stableReads = 0;
    } else if (
      previous &&
      Math.abs(snapshot.routeZoom - previous.routeZoom) <= 0.005 &&
      Math.abs(snapshot.canvasScale - previous.canvasScale) <=
        Math.max(0.005, snapshot.canvasScale * 0.001)
    ) {
      stableReads += 1;
      if (stableReads >= 2) return snapshot;
    } else {
      previous = snapshot;
      stableReads = 0;
    }
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await wait(Math.min(100, remaining));
  }
  return null;
}

export async function waitForAnimationFrame(
  waitForFrame: () => Promise<unknown>,
  timeoutMs: number,
  cleanup: () => Promise<unknown>,
): Promise<boolean> {
  // A host-side timer still runs if the browser stops producing frames.
  const result = await beforeDeadline(waitForFrame, timeoutMs, cleanup);
  return !result.timedOut;
}
