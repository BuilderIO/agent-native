/**
 * Source-location bridge — injected into a localhost dev-server iframe to
 * resolve a DOM element to authored framework source evidence (file, line,
 * column, component name), for precise agent edits instead of guesswork.
 *
 * This is the standalone request/reply extraction path. Keep its framework
 * metadata parsing aligned with `editor-chrome.bridge.ts`, which wires the same
 * provenance tiers into live selection and runtime-layer snapshots.
 *
 * Protocol (parent → iframe via postMessage):
 *   { type: 'agent-native:source-location-request', correlationId: string,
 *     nodeId?: string, selector?: string }
 *   Resolves the element by `[data-agent-native-node-id="nodeId"]` first,
 *   falling back to `selector` (a CSS selector) when nodeId is absent/unmatched.
 *
 * Reply (iframe → window.parent):
 *   { type: 'agent-native:source-location-result', correlationId: string,
 *     result: SourceLocationOutcome }
 *   See ../../../pages/design-editor/source-location.ts for the outcome shape
 *   (status: 'resolved' with sourceFile/line/column/componentName/owner* —
 *   never status: 'resolved' with any of those invented — or status:
 *   'unavailable' with a reason. This file duplicates that module's stack
 *   parser inline (bridge files may not import anything, see below); keep
 *   the two in sync by hand if either changes.
 *
 * Element vs. owner source location
 * ----------------------------------
 * `sourceFile`/`line`/`column` are the element's OWN JSX authoring line — for
 * a node inside a child component this is the child's file (e.g. a <button>
 * inside Card.jsx resolves to Card.jsx), regardless of whether that parent
 * component was instantiated once directly or many times via `.map()`.
 * `ownerSourceFile`/`ownerLine`/`ownerColumn`/`ownerComponentName` locate
 * where the nearest enclosing COMPONENT itself was instantiated — i.e. where
 * the `<Card ...>` JSX was written in the parent. All `.map()`-produced
 * siblings share that same owner location (the call site is authored once);
 * `ownerKey` (the element's React `key`, when the parent supplied one) is the
 * only source-derived signal that tells mapped siblings apart. This module
 * does not invent per-instance DOM identity beyond that — that's
 * `data-agent-native-node-id`'s job elsewhere in the bridge.
 *
 * Framework/version support
 * -------------------------
 * - React <=18: reads the structured `fiber._debugSource` field directly
 *   (`method: 'debug-source'`) — populated by the dev JSX transform
 *   (`jsxDEV`/classic pragma + `@babel/plugin-transform-react-jsx-source`),
 *   not by anything this bridge injects.
 * - React 19: `_debugSource` was removed from the fiber. Falls back to
 *   parsing `fiber._debugStack.stack` (`method: 'debug-stack'`), the owner
 *   stack React 19 captures at element-creation time in dev builds. Requires
 *   the dev server to serve React's development build with owner stacks
 *   enabled (the Vite/Next.js/CRA dev default) — a production build strips
 *   this entirely and this bridge reports `unavailable`/`no-debug-info`
 *   rather than guess.
 * - Vue: reads the dev compiler's `vnode.props.__v_inspector` location.
 * - Svelte: reads the dev compiler's `element.__svelte_meta.loc` location.
 * - Pre-existing `data-source-file`/`data-loc` attributes (a build-time
 *   transform's convention, not something this bridge writes) are read first
 *   and always win (`method: 'data-attribute'`) when present.
 *
 * Rules:
 *   • No import/require of any module (DOM globals only).
 *   • No references to outer/module scope (the code runs inside an iframe).
 *   • Wrap everything in a self-executing IIFE.
 */
(function () {
  var FIBER_KEY_PREFIXES = [
    "__reactFiber$",
    "__reactInternalInstance$",
    "__reactInternalFiberCurrent$",
    "__reactInternalFiber$",
  ];

  var NOISE_SEGMENTS: Record<string, true> = {
    node_modules: true,
    dist: true,
    build: true,
    ".next": true,
    public: true,
  };

  function isNoisePath(path: string): boolean {
    var segments = path.split("/");
    for (var i = 0; i < segments.length; i += 1) {
      if (NOISE_SEGMENTS[segments[i]!]) return true;
      if (segments[i] === "_next" && segments[i + 1] === "static") return true;
    }
    return false;
  }

  function resolveFrameUrl(rawUrl: string): string | null {
    if (rawUrl.indexOf("webpack-internal:///") === 0) {
      var wPath = rawUrl
        .slice("webpack-internal:///".length)
        .replace(/^\.\//, "");
      return wPath || null;
    }
    try {
      var url = new URL(rawUrl);
      var path = decodeURIComponent(url.pathname);
      if (path.indexOf("/@fs/") === 0) {
        path = path.slice("/@fs".length);
      } else if (url.protocol !== "file:") {
        path = path.replace(/^\/+/, "");
      }
      return path || null;
    } catch (_err) {
      return null;
    }
  }

  // Keep in sync with parseReactStackFrame in
  // ../../../pages/design-editor/source-location.ts.
  var STACK_FRAME_RE =
    /^\s*at\s+(?:([^\s(]+)\s+\()?([^()\s][^()]*?):(\d+):(\d+)\)?\s*$/;

  function parseStackFrame(line: string): {
    sourceFile: string;
    line: number;
    column: number;
    functionName?: string;
  } | null {
    var match = STACK_FRAME_RE.exec(line);
    if (!match) return null;
    var functionName = match[1];
    var rawUrl = match[2]!;
    var sourceFile = resolveFrameUrl(rawUrl);
    if (!sourceFile || isNoisePath(sourceFile)) return null;
    var lineNumber = Number(match[3]);
    var column = Number(match[4]);
    if (!isFinite(lineNumber) || !isFinite(column)) return null;
    return {
      sourceFile: sourceFile,
      line: lineNumber,
      column: column,
      functionName: functionName || undefined,
    };
  }

  function extractFromDebugStack(stack: string): {
    sourceFile: string;
    line: number;
    column: number;
    functionName?: string;
  } | null {
    var lines = stack.split("\n");
    for (var i = 0; i < lines.length; i += 1) {
      var parsed = parseStackFrame(lines[i]!);
      if (parsed) return parsed;
    }
    return null;
  }

  function getFiberFromDom(node: Element): any {
    var keys = Object.keys(node);
    for (var i = 0; i < keys.length; i += 1) {
      for (var j = 0; j < FIBER_KEY_PREFIXES.length; j += 1) {
        if (keys[i]!.indexOf(FIBER_KEY_PREFIXES[j]!) === 0) {
          return (node as unknown as Record<string, any>)[keys[i]!];
        }
      }
    }
    return null;
  }

  // Bounded climb to the nearest DOM ancestor React actually tracks — covers
  // the case where the exact selected node (e.g. a plain wrapper inserted by
  // non-React code) has no fiber key of its own, without pretending an
  // unrelated ancestor's source location belongs to a non-React element.
  function findNearestFiber(el: Element): any {
    var node: Element | null = el;
    var attempts = 0;
    while (node && attempts < 8) {
      var fiber = getFiberFromDom(node);
      if (fiber) return fiber;
      node = node.parentElement;
      attempts += 1;
    }
    return null;
  }

  function debugSourceOf(
    fiber: any,
  ): { sourceFile: string; line: number; column?: number } | null {
    var source =
      fiber._debugSource ||
      (fiber._debugInfo && fiber._debugInfo.source) ||
      (fiber.stateNode && fiber.stateNode._debugSource) ||
      (fiber.elementType && fiber.elementType._debugSource);
    if (source && source.fileName) {
      return {
        sourceFile: source.fileName,
        line: source.lineNumber,
        column: source.columnNumber,
      };
    }
    var stack =
      (fiber._debugStack && fiber._debugStack.stack) ||
      (fiber._debugInfo && fiber._debugInfo.stack) ||
      (fiber.stateNode &&
        fiber.stateNode._debugStack &&
        fiber.stateNode._debugStack.stack);
    if (stack) {
      var parsed = extractFromDebugStack(String(stack));
      if (parsed) {
        return {
          sourceFile: parsed.sourceFile,
          line: parsed.line,
          column: parsed.column,
        };
      }
    }
    return null;
  }

  function hasStructuredDebugSource(fiber: any): boolean {
    return !!(
      fiber._debugSource ||
      (fiber._debugInfo && fiber._debugInfo.source) ||
      (fiber.stateNode && fiber.stateNode._debugSource) ||
      (fiber.elementType && fiber.elementType._debugSource)
    );
  }

  function isComponentFiber(fiber: any): boolean {
    return typeof fiber.type === "function";
  }

  function componentNameOf(fiber: any): string | undefined {
    var type = fiber.type;
    return (type && (type.displayName || type.name)) || undefined;
  }

  type SourceLocationOutcome =
    | {
        status: "resolved";
        framework?: "html" | "react" | "vue" | "svelte";
        method:
          | "data-attribute"
          | "debug-source"
          | "debug-stack"
          | "vue-inspector"
          | "svelte-meta";
        sourceFile: string;
        line: number;
        column?: number;
        componentName?: string;
        ownerSourceFile?: string;
        ownerLine?: number;
        ownerColumn?: number;
        ownerComponentName?: string;
        // The owner site's own tier — an authored data-attribute element can
        // still owe its owner line to a transformed React 19 owner stack.
        ownerMethod?: "debug-source" | "debug-stack";
        ownerKey?: string;
      }
    | {
        status: "unavailable";
        reason: "not-framework" | "no-debug-info" | "element-not-found";
      };

  function resolveFromDataAttributes(
    el: Element,
  ): SourceLocationOutcome | null {
    var sourceFile = el.getAttribute("data-source-file");
    var lineAttr = el.getAttribute("data-source-line");
    var columnAttr = el.getAttribute("data-source-column");
    var component = el.getAttribute("data-component-name");
    var dataLoc = el.getAttribute("data-loc");
    if (!sourceFile && dataLoc) {
      var lastColon = dataLoc.lastIndexOf(":");
      var lastPart = lastColon >= 0 ? dataLoc.slice(lastColon + 1) : "";
      if (lastColon >= 0 && /^\d+$/.test(lastPart)) {
        var before = dataLoc.slice(0, lastColon);
        var prevColon = before.lastIndexOf(":");
        var prevPart = prevColon >= 0 ? before.slice(prevColon + 1) : "";
        var hasColumn = /^\d+$/.test(prevPart);
        sourceFile = hasColumn ? before.slice(0, prevColon) : before;
        lineAttr = hasColumn ? prevPart : lastPart;
        columnAttr = hasColumn ? lastPart : columnAttr;
      }
    }
    if (!sourceFile || !lineAttr) return null;
    var line = Number(lineAttr);
    if (!isFinite(line)) return null;
    var column = columnAttr ? Number(columnAttr) : undefined;
    return {
      status: "resolved",
      framework: "html",
      method: "data-attribute",
      sourceFile: sourceFile,
      line: line,
      column: isFinite(column as number) ? column : undefined,
      componentName: component || undefined,
    };
  }

  function resolveFromFiber(el: Element): SourceLocationOutcome {
    var leafFiber = findNearestFiber(el);
    if (!leafFiber) return { status: "unavailable", reason: "not-framework" };

    var elementSource: {
      sourceFile: string;
      line: number;
      column?: number;
    } | null = null;
    var elementMethod: "debug-source" | "debug-stack" | null = null;
    var componentFiber: any = null;

    var current = leafFiber;
    var depth = 0;
    while (current && depth < 12) {
      if (!elementSource) {
        var hasStructured = hasStructuredDebugSource(current);
        var found = debugSourceOf(current);
        if (found) {
          elementSource = found;
          elementMethod = hasStructured ? "debug-source" : "debug-stack";
        }
      }
      if (
        !componentFiber &&
        current !== leafFiber &&
        isComponentFiber(current)
      ) {
        componentFiber = current;
      }
      if (elementSource && componentFiber) break;
      current = current.return || current.parent || current._debugOwner;
      depth += 1;
    }

    if (!elementSource || !elementMethod) {
      return { status: "unavailable", reason: "no-debug-info" };
    }

    var result: SourceLocationOutcome = {
      status: "resolved",
      framework: "react",
      method: elementMethod,
      sourceFile: elementSource.sourceFile,
      line: elementSource.line,
      column: elementSource.column,
    };

    if (componentFiber) {
      (result as any).componentName = componentNameOf(componentFiber);
      var ownerSource = debugSourceOf(componentFiber);
      if (ownerSource) {
        (result as any).ownerSourceFile = ownerSource.sourceFile;
        (result as any).ownerLine = ownerSource.line;
        (result as any).ownerColumn = ownerSource.column;
        (result as any).ownerComponentName = (result as any).componentName;
        (result as any).ownerMethod = hasStructuredDebugSource(componentFiber)
          ? "debug-source"
          : "debug-stack";
      }
      if (typeof componentFiber.key === "string" && componentFiber.key) {
        (result as any).ownerKey = componentFiber.key;
      }
    }

    return result;
  }

  function parseFrameworkDataLoc(
    value: string,
  ): { sourceFile: string; line: number; column?: number } | null {
    var lastColon = value.lastIndexOf(":");
    if (lastColon < 0) return null;
    var lastPart = value.slice(lastColon + 1);
    if (!/^\d+$/.test(lastPart)) return null;
    var beforeLast = value.slice(0, lastColon);
    var previousColon = beforeLast.lastIndexOf(":");
    var previousPart =
      previousColon >= 0 ? beforeLast.slice(previousColon + 1) : "";
    var hasColumn = /^\d+$/.test(previousPart);
    var sourceFile = (
      hasColumn ? beforeLast.slice(0, previousColon) : beforeLast
    ).trim();
    var line = Number(hasColumn ? previousPart : lastPart);
    var column = hasColumn ? Number(lastPart) : undefined;
    if (!sourceFile || !isFinite(line)) return null;
    if (column !== undefined && !isFinite(column)) return null;
    return { sourceFile: sourceFile, line: line, column: column };
  }

  function resolveFromVue(el: Element): SourceLocationOutcome | null {
    var node: any = el;
    var sawVue = false;
    for (var depth = 0; node && depth < 8; depth += 1) {
      var vnode = node.__vnode;
      var component = node.__vueParentComponent;
      if (vnode || component) sawVue = true;
      var inspector =
        vnode && vnode.props && typeof vnode.props.__v_inspector === "string"
          ? vnode.props.__v_inspector
          : null;
      if (inspector) {
        var parsed = parseFrameworkDataLoc(inspector);
        if (parsed) {
          var type = (component && component.type) || (vnode && vnode.type);
          return {
            status: "resolved",
            framework: "vue",
            method: "vue-inspector",
            sourceFile: parsed.sourceFile,
            line: parsed.line,
            column: parsed.column,
            componentName:
              type && (type.name || type.__name || type.displayName),
          };
        }
      }
      node = node.parentElement;
    }
    return sawVue ? { status: "unavailable", reason: "no-debug-info" } : null;
  }

  function resolveFromSvelte(el: Element): SourceLocationOutcome | null {
    var node: any = el;
    var sawSvelte = false;
    for (var depth = 0; node && depth < 8; depth += 1) {
      var meta = node.__svelte_meta;
      if (meta) sawSvelte = true;
      var loc = meta && meta.loc;
      var sourceFile = loc && (loc.file || loc.filename);
      var line = loc && Number(loc.line);
      var column = loc && Number(loc.column);
      if (sourceFile && isFinite(line)) {
        return {
          status: "resolved",
          framework: "svelte",
          method: "svelte-meta",
          sourceFile: String(sourceFile),
          line: line,
          column: isFinite(column) ? column : undefined,
          componentName:
            typeof meta.component === "string"
              ? meta.component
              : typeof meta.name === "string"
                ? meta.name
                : undefined,
        };
      }
      node = node.parentElement;
    }
    return sawSvelte
      ? { status: "unavailable", reason: "no-debug-info" }
      : null;
  }

  function resolveFromFramework(el: Element): SourceLocationOutcome {
    var react = resolveFromFiber(el);
    if (react.status === "resolved" || react.reason === "no-debug-info") {
      return react;
    }
    var vue = resolveFromVue(el);
    if (vue) return vue;
    var svelte = resolveFromSvelte(el);
    if (svelte) return svelte;
    return { status: "unavailable", reason: "not-framework" };
  }

  function resolveSourceLocation(el: Element): SourceLocationOutcome {
    var fromAttributes = resolveFromDataAttributes(el);
    if (!fromAttributes) return resolveFromFramework(el);
    // A build-time source plugin stamps the element's OWN location and never
    // the owner call site, so keep walking Fiber for owner provenance instead
    // of short-circuiting — the owner site is what separates `.map()` siblings.
    var fromFiber = resolveFromFiber(el);
    if (
      fromAttributes.status === "resolved" &&
      fromFiber.status === "resolved"
    ) {
      if (fromFiber.ownerSourceFile) {
        fromAttributes.ownerSourceFile = fromFiber.ownerSourceFile;
        fromAttributes.ownerLine = fromFiber.ownerLine;
        fromAttributes.ownerColumn = fromFiber.ownerColumn;
        fromAttributes.ownerComponentName = fromFiber.ownerComponentName;
        fromAttributes.ownerMethod = fromFiber.ownerMethod;
      }
      if (fromFiber.ownerKey) fromAttributes.ownerKey = fromFiber.ownerKey;
      if (!fromAttributes.componentName) {
        fromAttributes.componentName = fromFiber.componentName;
      }
      fromAttributes.framework = fromFiber.framework;
    }
    return fromAttributes;
  }

  function findTarget(nodeId?: string, selector?: string): Element | null {
    if (nodeId) {
      var byId = document.querySelector(
        '[data-agent-native-node-id="' + nodeId.replace(/"/g, '\\"') + '"]',
      );
      if (byId) return byId;
    }
    if (selector) {
      try {
        return document.querySelector(selector);
      } catch (_err) {
        return null;
      }
    }
    return null;
  }

  window.addEventListener("message", function (e: MessageEvent) {
    if (e.source !== window.parent) return;
    if (!e.data || e.data.type !== "agent-native:source-location-request")
      return;
    var correlationId: string = e.data.correlationId || "";
    var target = findTarget(e.data.nodeId, e.data.selector);
    var result: SourceLocationOutcome = target
      ? resolveSourceLocation(target)
      : { status: "unavailable", reason: "element-not-found" };
    try {
      (window.parent as Window).postMessage(
        {
          type: "agent-native:source-location-result",
          correlationId: correlationId,
          result: result,
        },
        "*",
      );
    } catch (_err) {
      // Cross-origin errors are silently swallowed.
    }
  });
})();
