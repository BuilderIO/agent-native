type DeadlineResult<T> = { timedOut: false; value: T } | { timedOut: true };

export function expectedCanvasScaleAtZoomPercent(
  currentScale: number | null,
  currentZoomPercent: number,
  targetZoomPercent: number,
): number | null {
  if (
    currentScale === null ||
    !Number.isFinite(currentScale) ||
    currentScale <= 0 ||
    !Number.isFinite(currentZoomPercent) ||
    currentZoomPercent <= 0 ||
    !Number.isFinite(targetZoomPercent) ||
    targetZoomPercent <= 0
  ) {
    return null;
  }
  return (currentScale * targetZoomPercent) / currentZoomPercent;
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

export async function waitForAnimationFrame(
  waitForFrame: () => Promise<unknown>,
  timeoutMs: number,
  cleanup: () => Promise<unknown>,
): Promise<boolean> {
  // A host-side timer still runs if the browser stops producing frames.
  const result = await beforeDeadline(waitForFrame, timeoutMs, cleanup);
  return !result.timedOut;
}
