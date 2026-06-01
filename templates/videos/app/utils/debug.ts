const IS_DEV = import.meta.env.DEV;

export const debug = {
  log: (...args: unknown[]) => {
    if (IS_DEV) {
      console.log("[Videos]", ...args);
    }
  },

  warn: (...args: unknown[]) => {
    if (IS_DEV) {
      console.warn("[Videos]", ...args);
    }
  },

  error: (...args: unknown[]) => {
    console.error("[Videos]", ...args);
  },

  verbose: (...args: unknown[]) => {
    if (IS_DEV && import.meta.env.VITE_DEBUG_VERBOSE === "true") {
      console.log("[Videos:Verbose]", ...args);
    }
  },

  frame: (...args: unknown[]) => {
    if (IS_DEV && import.meta.env.VITE_DEBUG_FRAMES === "true") {
      console.log("[Videos:Frame]", ...args);
    }
  },

  time: (label: string) => {
    if (IS_DEV) {
      console.time(`[Videos] ${label}`);
    }
  },

  timeEnd: (label: string) => {
    if (IS_DEV) {
      console.timeEnd(`[Videos] ${label}`);
    }
  },

  group: (label: string) => {
    if (IS_DEV) {
      console.group(`[Videos] ${label}`);
    }
  },

  groupEnd: () => {
    if (IS_DEV) {
      console.groupEnd();
    }
  },
};

export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    const error = new Error(`Assertion failed: ${message}`);
    debug.error(error);
    throw error;
  }
}
