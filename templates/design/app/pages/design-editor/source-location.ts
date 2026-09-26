
export interface ParsedStackFrame {
  sourceFile: string;
  line: number;
  column: number;
  functionName?: string;
}

const NOISE_SEGMENTS = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  "public",
  ".vite",
]);

const STACK_FRAME_RE =
  /^\s*at\s+(?:([^\s(]+)\s+\()?([^()\s][^()]*?):(\d+):(\d+)\)?\s*$/;

const REACT_RUNTIME_MODULE_RE =
  /^(?:react|(?:react[-_])?jsx(?:-dev)?-runtime)(?:\.development|\.production(?:\.min)?)?\.(?:m?js|cjs)$/;
const VITE_DEPS_SEGMENT_RE = /^deps(?:_|$)/;

function isNoisePath(path: string): boolean {
  const segments = path.split("/");
  const runtimeInsideDepsDir = segments.some(
    (segment, index) =>
      VITE_DEPS_SEGMENT_RE.test(segment) &&
      REACT_RUNTIME_MODULE_RE.test(segments[index + 1] ?? ""),
  );
  if (runtimeInsideDepsDir) return true;
  if (segments.some((segment) => NOISE_SEGMENTS.has(segment))) return true;
  const nextIndex = segments.indexOf("_next");
  return nextIndex >= 0 && segments[nextIndex + 1] === "static";
}

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
      path = path.slice("/@fs".length);
    } else if (url.protocol !== "file:") {
      path = path.replace(/^\/+/, "");
    }
    return path || null;
  } catch {
    return null;
  }
}

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

export function extractSourceFromDebugStack(
  stack: string,
): ParsedStackFrame | null {
  for (const line of stack.split("\n")) {
    const parsed = parseReactStackFrame(line);
    if (parsed) return parsed;
  }
  return null;
}

export type SourceLocationMethod =
  | "data-attribute"
  | "debug-source"
  | "debug-stack"
  | "debug-stack-remapped"
  | "vue-inspector"
  | "svelte-meta";

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
  ownerMethod?: SourceLocationMethod;
  ownerKey?: string;
}

export type SourceLocationUnavailableReason =
  | "not-framework"
  | "no-debug-info"
  | "element-not-found";

export interface SourceLocationUnavailable {
  status: "unavailable";
  reason: SourceLocationUnavailableReason;
}

export type SourceLocationOutcome =
  | ElementSourceLocation
  | SourceLocationUnavailable;
