const IDLE_SLICE_MAX_MS = 12;
const IDLE_SLICE_TIMEOUT_MS = 500;

export function runInIdleSlices(step: (deadline: number) => boolean) {
  let cancelled = false;
  let cancelScheduled = () => {};
  const run = (deadline?: IdleDeadline) => {
    if (cancelled) return;
    const budget =
      deadline && !deadline.didTimeout
        ? Math.min(deadline.timeRemaining(), IDLE_SLICE_MAX_MS)
        : IDLE_SLICE_MAX_MS;
    if (!step(performance.now() + budget)) schedule();
  };
  const schedule = () => {
    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback(run, {
        timeout: IDLE_SLICE_TIMEOUT_MS,
      });
      cancelScheduled = () => cancelIdleCallback(handle);
    } else {
      const handle = setTimeout(run, 16);
      cancelScheduled = () => clearTimeout(handle);
    }
  };
  schedule();
  return () => {
    cancelled = true;
    cancelScheduled();
  };
}
