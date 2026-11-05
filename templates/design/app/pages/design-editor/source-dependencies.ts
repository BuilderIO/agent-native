import type { SourceHydrationState } from "./source-hydration";

export interface SourceDependencyFile {
  id: string;
  filename: string;
}

/** Resolve references to existing project files without treating navigation links as dependencies. */
export function sourceDependencyIds(
  files: readonly SourceDependencyFile[],
  roots: readonly string[],
  get: (id: string) => SourceHydrationState,
): { ids: string[]; overflow: boolean; failed: boolean } {
  const byId = new Map(files.map((file) => [file.id, file]));
  const byPath = new Map(
    files.map((file) => [file.filename.replace(/^\/+/, ""), file.id]),
  );
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
    const references: string[] = [];
    const html =
      /<(?:link|script|img|source|use)\b[^>]*?\b(?:href|src)\s*=\s*(["'])(.*?)\1/gi;
    const imports =
      /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|@import\s*(?:url\(\s*)?)(["'])(.*?)\1/g;
    for (const pattern of [html, imports]) {
      for (const match of state.content.matchAll(pattern)) {
        const value = match.slice(2, 3).shift();
        if (value !== undefined) references.push(value);
      }
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
