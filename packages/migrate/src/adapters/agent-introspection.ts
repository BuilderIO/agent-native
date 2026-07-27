import path from "path";

import type {
  MigrationInputKind,
  ProjectIR,
  RouteKind,
  SiteRoute,
  SourceAdapter,
} from "../types.js";

export interface MigrationInputDescriptor {
  sourceRoot: string;
  inputKind?: MigrationInputKind | string;
  inputDescription?: string;
}

export interface SkeletonProjectIROptions extends MigrationInputDescriptor {
  generatedAt?: string;
}

export function inferMigrationInputKind(input: string): MigrationInputKind {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return "url";
  if (isPathLike(trimmed)) return "path";
  if (/\s/.test(trimmed)) return "description";
  return "path";
}

export function normalizeMigrationSourceRoot(
  input: string,
  inputKind: MigrationInputKind | string = inferMigrationInputKind(input),
): string {
  const trimmed = input.trim();
  return inputKind === "path" ? path.resolve(trimmed) : trimmed;
}

export function describeMigrationInput(
  input: string,
  inputKind: MigrationInputKind | string = inferMigrationInputKind(input),
): string {
  const trimmed = input.trim();
  if (inputKind === "path")
    return normalizeMigrationSourceRoot(trimmed, inputKind);
  return trimmed;
}

export function createSkeletonProjectIR(
  options: SkeletonProjectIROptions | string,
): ProjectIR {
  const descriptor =
    typeof options === "string" ? { sourceRoot: options } : options;
  const inputKind =
    descriptor.inputKind ?? inferMigrationInputKind(descriptor.sourceRoot);
  const sourceRoot = normalizeMigrationSourceRoot(
    descriptor.sourceRoot,
    inputKind,
  );
  const inputDescription =
    descriptor.inputDescription ??
    describeMigrationInput(descriptor.sourceRoot, inputKind);
  const route = createFallbackRoute(sourceRoot, inputKind, inputDescription);

  return {
    site: {
      framework: "unknown",
      sourceRoot,
      routes: [route],
      redirects: [],
      metadata: {
        source: "agent-introspection",
        inputKind,
        inputDescription,
        generatedAt: descriptor.generatedAt ?? new Date().toISOString(),
        needsAgentIntrospection: true,
      },
    },
    components: {
      components: [],
      designTokens: {},
    },
    content: {
      models: [],
      assets: [],
    },
    behavior: {
      apiEndpoints: [],
      dataStores: [],
      llmCalls: [],
      clientState: [],
      auth: [],
      jobs: [],
    },
  };
}

export function createAgentIntrospectionSourceAdapter(
  defaults: Partial<MigrationInputDescriptor> = {},
): SourceAdapter {
  return {
    id: "agent-introspection",
    label: "Agent introspection",
    kind: "agent",
    inputKinds: defaults.inputKind ? [defaults.inputKind] : undefined,
    async detect() {
      return true;
    },
    async introspect(sourceRoot) {
      return createSkeletonProjectIR({
        sourceRoot,
        inputKind: defaults.inputKind,
        inputDescription: defaults.inputDescription,
      });
    },
  };
}

export const agentIntrospectionSourceAdapter =
  createAgentIntrospectionSourceAdapter();

function createFallbackRoute(
  sourceRoot: string,
  inputKind: MigrationInputKind | string,
  inputDescription: string,
): SiteRoute {
  const routePath = inputKind === "url" ? pathFromUrl(sourceRoot) : "/";
  const routeKind = classifyFallbackRoute(routePath, inputDescription);
  return {
    id: stableId(`fallback:${inputKind}:${sourceRoot}:${routePath}`),
    path: routePath,
    filePath: sourceRoot,
    router: "unknown",
    kind: routeKind,
    dynamic: false,
    public: routeKind !== "app" && routeKind !== "api",
    notes: [
      "Skeleton route generated for agent-led source introspection. Replace with a deterministic inventory when source files are available.",
    ],
  };
}

function classifyFallbackRoute(
  routePath: string,
  inputDescription: string,
): RouteKind {
  const haystack = `${routePath} ${inputDescription}`.toLowerCase();
  if (haystack.includes("api") || haystack.includes("webhook")) return "api";
  if (haystack.includes("docs")) return "docs";
  if (
    haystack.includes("dashboard") ||
    haystack.includes("admin") ||
    haystack.includes("authenticated") ||
    haystack.includes("workspace")
  ) {
    return "app";
  }
  if (routePath === "/") return "landing";
  if (
    haystack.includes("pricing") ||
    haystack.includes("blog") ||
    haystack.includes("marketing")
  ) {
    return "marketing";
  }
  return "unknown";
}

function pathFromUrl(value: string): string {
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return pathname || "/";
  } catch {
    return "/";
  }
}

function isPathLike(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes("/") ||
    value.includes("\\")
  );
}

function stableId(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
