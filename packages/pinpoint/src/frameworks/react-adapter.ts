// MIT License

import type {
  FrameworkAdapter,
  ComponentInfo,
  SourceLocation,
} from "../types/index.js";

let bippy: typeof import("bippy") | null = null;
let elementSource: typeof import("element-source") | null = null;

async function loadBippy() {
  if (!bippy) {
    try {
      bippy = await import("bippy");
    } catch {
      bippy = null;
    }
  }
  return bippy;
}

async function loadElementSource() {
  if (!elementSource) {
    try {
      elementSource = await import("element-source");
    } catch {
      elementSource = null;
    }
  }
  return elementSource;
}

const FRAMEWORK_INTERNALS = new Set([
  "Fragment",
  "Suspense",
  "StrictMode",
  "Profiler",
  "Provider",
  "Consumer",
  "ForwardRef",
  "Memo",
  "InnerLayoutRouter",
  "OuterLayoutRouter",
  "RenderFromTemplateContext",
  "ScrollAndFocusHandler",
  "RedirectBoundary",
  "NotFoundBoundary",
  "LoadingBoundary",
  "ErrorBoundary",
  "HotReload",
  "Router",
  "ServerRoot",
  "AppRouter",
  "ServerInsertedHTMLProvider",
  "Routes",
  "RenderedRoute",
  "Navigate",
  "Outlet",
]);

function getRDTHook(): any {
  return typeof window !== "undefined"
    ? (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__
    : null;
}

export const reactAdapter: FrameworkAdapter = {
  name: "react",

  detect(): boolean {
    return !!getRDTHook();
  },

  getComponentInfo(element: Element): ComponentInfo | null {
    const b = bippy;
    if (!b) return null;

    try {
      const fiber = b.getFiberFromHostInstance(element);
      if (!fiber) return null;

      const components: string[] = [];
      let current: any = fiber;

      while (current) {
        const name = b.getDisplayName(current);
        if (name && !FRAMEWORK_INTERNALS.has(name)) {
          components.unshift(name);
        }
        current = current.return ?? null;
        if (components.length > 20) break;
      }

      let componentFiber: any = fiber;
      while (componentFiber && typeof componentFiber.type === "string") {
        componentFiber = componentFiber.return ?? null;
      }

      const displayName = componentFiber
        ? b.getDisplayName(componentFiber)
        : null;

      const sourceInfo = getSourceFromFiber(componentFiber);

      return {
        name: displayName || components[components.length - 1] || "Unknown",
        displayName: displayName || undefined,
        filePath: sourceInfo?.file,
        lineNumber: sourceInfo?.line,
      };
    } catch {
      return null;
    }
  },

  getSourceLocation(element: Element): SourceLocation | null {
    const b = bippy;
    if (!b) return null;

    try {
      const fiber = b.getFiberFromHostInstance(element);
      if (!fiber) return null;

      let componentFiber: any = fiber;
      while (componentFiber && typeof componentFiber.type === "string") {
        componentFiber = componentFiber.return ?? null;
      }

      return getSourceFromFiber(componentFiber);
    } catch {
      return null;
    }
  },

  freeze(): void {
  },

  unfreeze(): void {
  },
};

function getSourceFromFiber(fiber: any): SourceLocation | null {
  if (!fiber) return null;

  if (fiber._debugSource) {
    return {
      file: fiber._debugSource.fileName,
      line: fiber._debugSource.lineNumber,
      column: fiber._debugSource.columnNumber,
    };
  }


  return null;
}

export function buildComponentPath(element: Element): string {
  const b = bippy;
  if (!b) return "";

  try {
    const fiber = b.getFiberFromHostInstance(element);
    if (!fiber) return "";

    const components: string[] = [];
    let current: any = fiber;

    while (current) {
      const name = b.getDisplayName(current);
      if (name && !FRAMEWORK_INTERNALS.has(name)) {
        components.unshift(`<${name}>`);
      }
      current = current.return ?? null;
      if (components.length > 10) break;
    }

    return components.join(" ");
  } catch {
    return "";
  }
}

if (typeof window !== "undefined") {
  const init = () => {
    void loadBippy();
    void loadElementSource();
  };
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(init);
  } else {
    setTimeout(init, 100);
  }
}
