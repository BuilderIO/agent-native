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
    return true;
  },

  getComponentInfo(_element: Element): ComponentInfo | null {
    return null;
  },

  getSourceLocation(_element: Element): SourceLocation | null {
    return null;
  },
};
