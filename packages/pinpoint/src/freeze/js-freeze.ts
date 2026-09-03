// @agent-native/pinpoint — JS timer monkey-patching (opt-in)
// MIT License
//
// Opt-in: disabled by default, activated via options.freezeJSTimers: true
// Bounded queue (max 1000), staggered replay, Symbol-based exclusion.

const PINPOINT_SYMBOL = Symbol.for("pinpoint-internal");
const MAX_QUEUE = 1000;

interface QueuedTimer {
  type: "timeout" | "interval" | "raf";
  callback: Function;
  delay?: number;
  args?: any[];
}

let frozen = false;
let queue: QueuedTimer[] = [];
let originals: {
  setTimeout: typeof setTimeout;
  setInterval: typeof setInterval;
  clearTimeout: typeof clearTimeout;
  clearInterval: typeof clearInterval;
  requestAnimationFrame: typeof requestAnimationFrame;
} | null = null;

/**
 * Freeze JS timers by monkey-patching setTimeout, setInterval, rAF.
 * Queued callbacks are replayed on unfreeze.
 *
 * **Opt-in only** — call this explicitly when config.freezeJSTimers is true.
 */
export function freezeJSTimers(): () => void {
  if (frozen) return () => {};

  frozen = true;
  queue = [];

  originals = {
    setTimeout: window.setTimeout.bind(window),
    setInterval: window.setInterval.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
    clearInterval: window.clearInterval.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
  };

  // Patch setTimeout
  (window as any).setTimeout = (
    callback: Function | string,
    delay?: number,
    ...args: any[]
  ) => {
    if (typeof callback !== "function") return 0;
    // Skip our own callbacks (Symbol-based filter)
    if ((callback as any)[PINPOINT_SYMBOL]) {
      return originals!.setTimeout(callback, delay, ...args);
    }
    if (queue.length < MAX_QUEUE) {
      queue.push({ type: "timeout", callback, delay, args });
    }
    return 0; // Return fake timer ID
  };

  // Patch setInterval
  (window as any).setInterval = (
    callback: Function | string,
    delay?: number,
    ...args: any[]
  ) => {
    if (typeof callback !== "function") return 0;
    if ((callback as any)[PINPOINT_SYMBOL]) {
      return originals!.setInterval(callback, delay, ...args);
    }
    if (queue.length < MAX_QUEUE) {
      queue.push({ type: "interval", callback, delay, args });
    }
    return 0;
  };

  // Patch requestAnimationFrame
  (window as any).requestAnimationFrame = (callback: FrameRequestCallback) => {
    if ((callback as any)[PINPOINT_SYMBOL]) {
      return originals!.requestAnimationFrame(callback);
    }
    if (queue.length < MAX_QUEUE) {
      queue.push({ type: "raf", callback });
    }
    return 0;
  };

  return () => {
    if (!frozen || !originals) return;
    frozen = false;

    // Restore originals
    window.setTimeout = originals.setTimeout as any;
    window.setInterval = originals.setInterval as any;
    window.clearTimeout = originals.clearTimeout;
    window.clearInterval = originals.clearInterval;
    window.requestAnimationFrame = originals.requestAnimationFrame;

    // Staggered replay via requestIdleCallback
    const replayBatch = () => {
      const batch = queue.splice(0, 50);
      for (const item of batch) {
        try {
          if (item.type === "raf") {
            originals!.requestAnimationFrame(
              item.callback as FrameRequestCallback,
            );
          } else {
            originals!.setTimeout(
              item.callback as any,
              0,
              ...(item.args || []),
            );
          }
        } catch {
          // Callback may no longer be valid
        }
      }
      if (queue.length > 0) {
        (window.requestIdleCallback || originals!.setTimeout)(replayBatch);
      }
    };

    if (queue.length > 0) {
      (window.requestIdleCallback || originals.setTimeout)(replayBatch);
    }

    originals = null;
  };
}

/**
 * Mark a callback as internal to Pinpoint, so it's not frozen.
 */
export function markInternal<T extends Function>(fn: T): T {
  (fn as any)[PINPOINT_SYMBOL] = true;
  return fn;
}
