// MIT License

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
