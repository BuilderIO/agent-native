/**
 * Debug Utility
 * 
 * Provides controlled logging for development.
 * All logs are stripped in production builds via Vite's define.
 */

const IS_DEV = import.meta.env.DEV;

export const debug = {
  /**
   * Log general information
   */
  log: (...args: any[]) => {
    if (IS_DEV) {
      console.log('[Videos]', ...args);
    }
  },

  /**
   * Log warnings
   */
  warn: (...args: any[]) => {
    if (IS_DEV) {
      console.warn('[Videos]', ...args);
    }
  },

  /**
   * Log errors (always shown, even in production)
   */
  error: (...args: any[]) => {
    console.error('[Videos]', ...args);
  },

  /**
   * Log only in verbose debug mode (for noisy logs)
   */
  verbose: (...args: any[]) => {
    if (IS_DEV && import.meta.env.VITE_DEBUG_VERBOSE === 'true') {
      console.log('[Videos:Verbose]', ...args);
    }
  },

  /**
   * Log animation frame data (very noisy)
   */
  frame: (...args: any[]) => {
    if (IS_DEV && import.meta.env.VITE_DEBUG_FRAMES === 'true') {
      console.log('[Videos:Frame]', ...args);
    }
  },

  /**
   * Performance timing
   */
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

  /**
   * Group related logs
   */
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

/**
 * Assert utility for development
 */
export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    const error = new Error(`Assertion failed: ${message}`);
    debug.error(error);
    throw error;
  }
}

/**
 * Deprecated utility - marks code for removal
 */
export function deprecated(message: string) {
  if (IS_DEV) {
    console.warn(`[Videos:Deprecated] ${message}`);
  }
}
