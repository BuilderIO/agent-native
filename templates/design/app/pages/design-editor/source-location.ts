/**
 * Pure, unit-testable helpers for turning a React `_debugStack` owner-stack
 * (React 19+, an `Error` captured at JSX-creation time — `_debugSource` was
 * removed as a structured fiber field in React 19) into a source location.
 *
 * Generalizes builder-internal's `extractJSXLocation` (see
 * builder-internal/packages/app/models/fusion-editor.model.ts) to one regex
 * instead of two branches: both webpack-internal:/// frames (webpack/Next.js/
 * CRA dev servers) and Vite dev-server frames (incl. `/@fs/` absolute-path
 * serving, which `editor-chrome.bridge.ts` also handles) are the same V8
 * "at Name (url:line:col)" shape once the URL is resolved.
 *
 * Kept framework/DOM-free so it runs in a plain Node test environment. The
 * `source-location.bridge.ts` IIFE duplicates this React parsing logic and adds
 * Vue/Svelte compiler metadata handling inline (bridge files may not import
 * anything) — keep the two in sync by hand if this file changes.
 */

export interface ParsedStackFrame {
  sourceFile: string;
  line: number;
  column: number;
  functionName?: string;
}

// Checked as whole path segments (see isNoisePath) rather than substrings so
// resolveFrameUrl's leading-slash stripping for relative paths (which turns
// "/node_modules/..." into "node_modules/...") can't slip past a "/x/" style
// substring check, and so a legitimate dir name that merely CONTAINS one of
// these words (e.g. "redistribute") never false-positives.
const NOISE_SEGMENTS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  "public",
]);

// V8 stack frame: "at Name (url:line:col)" or the anonymous "at url:line:col".
const STACK_FRAME_RE =
  /^\s*at\s+(?:([^\s(]+)\s+\()?([^()\s][^()]*?):(\d+):(\d+)\)?\s*$/;

function isNoisePath(path: string): boolean {
  const segments = path.split("/");
  if (segments.some((segment) => NOISE_SEGMENTS.has(segment))) return true;
  const nextIndex = segments.indexOf("_next");
  return nextIndex >= 0 && segments[nextIndex + 1] === "static";
}

/**
 * Resolves a stack frame's raw URL text to a project-ish path.
 * - `webpack-internal:///./src/App.tsx` → `src/App.tsx`
 * - `http://localhost:5173/@fs/Users/x/App.jsx?t=1` → `/Users/x/App.jsx` (Vite
 *   absolute-path serving strips the query string automatically via URL parsing)
 * - `http://localhost:5173/src/App.jsx` → `src/App.jsx`
 * - `file:///Users/x/App.jsx` → `/Users/x/App.jsx`
 */
function resolveFrameUrl(rawUrl: string): string | null {
  if (rawUrl.startsWith("webpack-internal:///")) {
    const path = rawUrl
      .slice("webpack-internal:///".length)
      .replace(/^\.\//, "");
    return path || null;
  }
  try {
    const url = new URL(rawUrl);
    let path = decodeURIComponent(url.pathname);
    if (path.startsWith("/@fs/")) {
      // Vite absolute-path serving — keep the leading slash, it's a real FS path.
      path = path.slice("/@fs".length);
    } else if (url.protocol !== "file:") {
      // http(s) server-relative path -> project-relative. A file: URL's
      // pathname is already an absolute FS path, same as /@fs/ above.
      path = path.replace(/^\/+/, "");
    }
    return path || null;
  } catch {
    return null;
  }
}

/**
 * Parses one stack-trace line into a source location. Returns null for lines
 * that aren't a resolvable, non-noise application frame (a React/runtime
 * internal frame, a malformed line, or anything under node_modules/build
 * output) — callers should try the next line rather than treat null as a
 * hard failure.
 */
export function parseReactStackFrame(line: string): ParsedStackFrame | null {
  const match = STACK_FRAME_RE.exec(line);
  if (!match) return null;
  const [, functionName, rawUrl, lineText, columnText] = match;
  const sourceFile = resolveFrameUrl(rawUrl!);
  if (!sourceFile || isNoisePath(sourceFile)) return null;
  const lineNumber = Number(lineText);
  const column = Number(columnText);
  if (!Number.isFinite(lineNumber) || !Number.isFinite(column)) return null;
  return {
    sourceFile,
    line: lineNumber,
    column,
    functionName: functionName || undefined,
  };
}

/**
 * Scans a full multi-line owner-stack (`fiber._debugStack.stack`) top-down
 * and returns the first non-noise application frame.
 */
export function extractSourceFromDebugStack(
  stack: string,
): ParsedStackFrame | null {
  for (const line of stack.split("\n")) {
    const parsed = parseReactStackFrame(line);
    if (parsed) return parsed;
  }
  return null;
}

/** Which tier resolved the location — see source-location.bridge.ts. */
export type SourceLocationMethod =
  | "data-attribute" // pre-existing data-source-file/data-loc (build-time transform)
  | "debug-source" // React <=18 structured _debugSource field
  | "debug-stack" // React 19 _debugStack owner-stack (this file's parser)
  | "vue-inspector" // Vue dev compiler's __v_inspector vnode prop
  | "svelte-meta"; // Svelte dev compiler's __svelte_meta.loc

/**
 * A resolved element source location.
 *
 * `sourceFile`/`line`/`column` are the element's OWN JSX authoring location
 * — for a node inside a child component this is the child's file, not the
 * parent's, regardless of how many times the parent instantiates it (e.g. a
 * button inside `Card.jsx` always resolves there, whether `<Card>` was
 * authored once directly or three times via `.map()`).
 *
 * `owner*` fields locate the nearest enclosing COMPONENT's own instantiation
 * site — where the `<Card ...>` JSX itself was written in the parent. This is
 * what differs between a directly-authored instance and one produced by
 * `.map()`: all `.map()`-produced siblings share the same owner location
 * (the call site is authored once), so `ownerKey` (the element's React `key`,
 * when the parent supplied one) is the only source-derived signal that tells
 * mapped siblings apart — this module does not invent DOM-instance identity
 * beyond that; that's `data-agent-native-node-id`'s job elsewhere.
 */
export interface ElementSourceLocation {
  status: "resolved";
  framework?: "html" | "react" | "vue" | "svelte" | "angular" | "lwc";
  method: SourceLocationMethod;
  sourceFile: string;
  line: number;
  column?: number;
  componentName?: string;
  ownerSourceFile?: string;
  ownerLine?: number;
  ownerColumn?: number;
  ownerComponentName?: string;
  /**
   * Which tier produced `ownerLine`/`ownerColumn`. Separate from `method`
   * because they routinely differ: a source plugin's attributes give the
   * element an authored position while the owner site is only reachable
   * through a React 19 owner stack (transformed).
   */
  ownerMethod?: SourceLocationMethod;
  ownerKey?: string;
}

export type SourceLocationUnavailableReason =
  | "not-framework" // no supported framework metadata found on any ancestor
  | "no-debug-info" // framework found, but its dev source metadata is absent
  | "element-not-found"; // the requested node/selector didn't resolve to a live element

export interface SourceLocationUnavailable {
  status: "unavailable";
  reason: SourceLocationUnavailableReason;
}

export type SourceLocationOutcome =
  | ElementSourceLocation
  | SourceLocationUnavailable;
