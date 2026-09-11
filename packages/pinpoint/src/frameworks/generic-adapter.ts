// @agent-native/pinpoint — Generic fallback adapter
// MIT License
//
// For non-framework pages. DOM-only info, no component tree, no source files.

import type {
  FrameworkAdapter,
  ComponentInfo,
  SourceLocation,
} from "../types/index.js";

export const genericAdapter: FrameworkAdapter = {
  name: "generic",

  detect(): boolean {
    // Always matches as the last resort
    return true;
  },

  getComponentInfo(_element: Element): ComponentInfo | null {
    // No framework = no component info
    return null;
  },

  getSourceLocation(_element: Element): SourceLocation | null {
    // No framework = no source location
    return null;
  },
};
