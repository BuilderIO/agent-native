export type WebgpuSupport = "supported" | "unsupported" | "probe-failed";

const SESSION_KEY = "agent-native:webgpu-support";

let probe: Promise<WebgpuSupport> | null = null;

function readSessionResult(): WebgpuSupport | null {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    return stored === "supported" || stored === "unsupported" ? stored : null;
    // coercion-ok: unreadable storage only means the adapter is probed again
  } catch {
    return null;
  }
}

function writeSessionResult(support: WebgpuSupport) {
  // A failed probe can be transient, so only settled answers are kept.
  if (support === "probe-failed") return;
  try {
    sessionStorage.setItem(SESSION_KEY, support);
    // coercion-ok: a failed write only costs one extra probe next load
  } catch {}
}

async function requestWebgpuSupport(): Promise<WebgpuSupport> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu || typeof gpu.requestAdapter !== "function") return "unsupported";
  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? "supported" : "unsupported";
  } catch {
    return "probe-failed";
  }
}

/**
 * Chrome logs "No available adapters." on every null `requestAdapter()`, so
 * the probe runs at most once per page and its answer is reused for the tab
 * session.
 */
export function probeWebgpuSupport(): Promise<WebgpuSupport> {
  if (probe) return probe;
  const stored = readSessionResult();
  probe = stored
    ? Promise.resolve(stored)
    : requestWebgpuSupport().then((support) => {
        writeSessionResult(support);
        if (support === "probe-failed") probe = null;
        return support;
      });
  return probe;
}

/** Test seam: forget the cached probe. */
export function resetWebgpuSupportProbe() {
  probe = null;
}
