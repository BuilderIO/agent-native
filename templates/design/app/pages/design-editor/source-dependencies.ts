import type { SourceHydrationState } from "./source-hydration";

export interface SourceDependencyFile {
  id: string;
  filename: string;
}

export function createSourceDependencyIndex(
  files: readonly SourceDependencyFile[],
) {
  return {
    byId: new Map(files.map((file) => [file.id, file])),
    byPath: new Map(
      files.map((file) => [file.filename.replace(/^\/+/, ""), file.id]),
    ),
    // Every loader change rescans every scheduled root, so each loaded body is
    // scanned once. Keyed weakly by the loader's state, which is replaced
    // whenever the body is: a strong key would keep evicted sources alive past
    // the loader's byte budget.
    references: new WeakMap<SourceHydrationState, string[]>(),
  };
}

function sourceReferences(content: string): string[] {
  const references: string[] = [];
  const html =
    /<(?:link|script|img|source|use)\b[^>]*?\b(?:href|src)\s*=\s*(["'])(.*?)\1/gi;
  const imports =
    /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|@import\s*(?:url\(\s*)?)(["'])(.*?)\1/g;
  for (const pattern of [html, imports]) {
    for (const match of content.matchAll(pattern)) {
      const value = match.slice(2, 3).shift();
      if (value !== undefined) references.push(value);
    }
  }
  return references;
}

/** Resolve references to existing project files without treating navigation links as dependencies. */
export function sourceDependencyIds(
  files: readonly SourceDependencyFile[],
  roots: readonly string[],
  get: (id: string) => SourceHydrationState,
  index = createSourceDependencyIndex(files),
): { ids: string[]; overflow: boolean; failed: boolean } {
  const { byId, byPath, references: referenceCache } = index;
  const found = new Set(roots);
  let failed = false;
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift();
    if (id === undefined) break;
    const file = byId.get(id);
    const state = get(id);
    if (
      state.status === "error" ||
      (state.status === "ready" && state.refreshError)
    )
      failed = true;
    if (!file || state.status !== "ready") continue;
    const base = file.filename.replace(/^\/+/, "").split("/").slice(0, -1);
    let references = referenceCache.get(state);
    if (!references) {
      references = sourceReferences(state.content);
      referenceCache.set(state, references);
    }
    for (const reference of references) {
      if (/^(?:[a-z][\w+.-]*:|\/\/|#|data:)/i.test(reference)) continue;
      const raw = reference.split(/[?#]/, 1).shift();
      if (raw === undefined) continue;
      const parts = raw.startsWith("/") ? [] : [...base];
      for (const part of raw.split("/")) {
        if (!part || part === ".") continue;
        if (part === "..") parts.pop();
        else parts.push(part);
      }
      const path = parts.join("/");
      const target = [
        path,
        ...[
          ".js",
          ".jsx",
          ".ts",
          ".tsx",
          ".css",
          "/index.js",
          "/index.tsx",
        ].map((suffix) => path + suffix),
      ]
        .map((candidate) => byPath.get(candidate))
        .find(Boolean);
      if (target && !found.has(target)) {
        if (found.size >= 128)
          return { ids: [...found], overflow: true, failed };
        found.add(target);
        queue.push(target);
      }
    }
  }
  return { ids: [...found], overflow: false, failed };
}

export function scheduleSourceDependencies(
  files: readonly SourceDependencyFile[],
  roots: readonly string[],
  get: (id: string) => SourceHydrationState,
  budget = 128,
  index = createSourceDependencyIndex(files),
  {
    // A demanded root always loads; only its dependencies wait for budget.
    // A preview root cannot render without them, so it waits too.
    readRootsPastBudget = true,
  }: { readRootsPastBudget?: boolean } = {},
) {
  const ids = new Set<string>();
  const statusByRoot = new Map<
    string,
    "ready" | "loading" | "deferred" | "error"
  >();
  const idsByRoot = new Map<string, string[]>();
  for (const root of roots) {
    const graph = sourceDependencyIds(files, [root], get, index);
    const additional = graph.ids.filter((id) => !ids.has(id));
    const admitted = !graph.overflow && ids.size + additional.length <= budget;
    const isLoading = (id: string) => {
      const state = get(id);
      return state.status === "unloaded" || state.status === "loading";
    };
    // A loaded or loading root stays scheduled either way: dropping it only
    // reads it again.
    const readRoot = readRootsPastBudget || get(root).status !== "unloaded";
    if (admitted) additional.forEach((id) => ids.add(id));
    else if (readRoot) ids.add(root);
    idsByRoot.set(root, graph.ids);
    statusByRoot.set(
      root,
      graph.overflow || graph.failed
        ? "error"
        : !graph.ids.some(isLoading)
          ? "ready"
          : admitted || (readRoot && isLoading(root))
            ? "loading"
            : "deferred",
    );
  }
  return { ids: [...ids], statusByRoot, idsByRoot };
}
