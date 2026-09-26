// @agent-native/pinpoint — Framework adapter interface and auto-detection
// MIT License

import type {
  FrameworkAdapter,
  ComponentInfo,
  SourceLocation,
} from "../types/index.js";

const adapters: FrameworkAdapter[] = [];

let detectedAdapter: FrameworkAdapter | null = null;
let detected = false;

export function registerAdapter(adapter: FrameworkAdapter): void {
  adapters.push(adapter);
  detected = false;
  detectedAdapter = null;
}

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

  detectedAdapter = genericAdapter;
  detected = true;
  return genericAdapter;
}

export function getComponentInfo(element: Element): ComponentInfo | null {
  const adapter = detectFramework();
  try {
    return adapter.getComponentInfo(element);
  } catch {
    return null;
  }
}

export function getSourceLocation(element: Element): SourceLocation | null {
  const adapter = detectFramework();
  try {
    return adapter.getSourceLocation(element);
  } catch {
    return null;
  }
}

export function resetDetection(): void {
  detected = false;
  detectedAdapter = null;
}

export function getAdapters(): FrameworkAdapter[] {
  return [...adapters];
}

const genericAdapter: FrameworkAdapter = {
  name: "generic",
  detect: () => true, // Always matches as fallback
  getComponentInfo: () => null,
  getSourceLocation: () => null,
};
