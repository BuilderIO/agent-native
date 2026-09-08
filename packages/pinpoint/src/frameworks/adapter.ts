// @agent-native/pinpoint — Framework adapter interface and auto-detection
// MIT License

import type {
  FrameworkAdapter,
  ComponentInfo,
  SourceLocation,
} from "../types/index.js";

/** Registry of framework adapters, tried in order */
const adapters: FrameworkAdapter[] = [];

/** The currently detected adapter (cached after first detection) */
let detectedAdapter: FrameworkAdapter | null = null;
let detected = false;

/**
 * Register a framework adapter. Adapters are tried in registration order.
 */
export function registerAdapter(adapter: FrameworkAdapter): void {
  adapters.push(adapter);
  // Reset detection cache when new adapters are registered
  detected = false;
  detectedAdapter = null;
}

/**
 * Auto-detect the current framework by trying each adapter's detect() method.
 * Returns the first matching adapter, or the generic fallback.
 */
export function detectFramework(): FrameworkAdapter {
  if (detected && detectedAdapter) return detectedAdapter;

  for (const adapter of adapters) {
    try {
      if (adapter.detect()) {
        detectedAdapter = adapter;
        detected = true;
        return adapter;
      }
    } catch {
      // Adapter detection failed, try next
    }
  }

  // Return generic adapter as fallback
  detectedAdapter = genericAdapter;
  detected = true;
  return genericAdapter;
}

/**
 * Get component info for an element using the detected framework adapter.
 */
export function getComponentInfo(element: Element): ComponentInfo | null {
  const adapter = detectFramework();
  try {
    return adapter.getComponentInfo(element);
  } catch {
    return null;
  }
}

/**
 * Get source location for an element using the detected framework adapter.
 */
export function getSourceLocation(element: Element): SourceLocation | null {
  const adapter = detectFramework();
  try {
    return adapter.getSourceLocation(element);
  } catch {
    return null;
  }
}

/**
 * Reset detection cache. Useful for testing or when the page framework changes.
 */
export function resetDetection(): void {
  detected = false;
  detectedAdapter = null;
}

/**
 * Get all registered adapters.
 */
export function getAdapters(): FrameworkAdapter[] {
  return [...adapters];
}

/** Generic fallback adapter for non-framework pages */
const genericAdapter: FrameworkAdapter = {
  name: "generic",
  detect: () => true, // Always matches as fallback
  getComponentInfo: () => null,
  getSourceLocation: () => null,
};
