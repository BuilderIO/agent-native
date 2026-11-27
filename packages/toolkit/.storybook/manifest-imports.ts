import fs from "node:fs";
import path from "node:path";

import { PARTS } from "@agent-native/design-system/catalog";
import type { Manifests } from "storybook/internal/types";

const IMPORT_TAG = /@import\s+import\s*\{([^}]*)\}\s*from\s*"([^"]+)";/g;
const IMPORT_STATEMENT = /^import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];$/gm;

/**
 * Every name the `@import` tags in `dirs` import, mapped to the module the tag
 * imports it from.
 */
export function readImportTags(dirs: string[]): Map<string, string> {
  const modules = new Map<string, string>();
  const files = dirs.flatMap((dir) =>
    fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".tsx") && !file.endsWith(".spec.tsx"))
      .map((file) => path.join(dir, file)),
  );
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const [, names = "", module = ""] of source.matchAll(IMPORT_TAG)) {
      for (const name of names.split(",")) {
        const trimmed = name.trim();
        if (trimmed && !modules.has(trimmed)) modules.set(trimmed, module);
      }
    }
  }
  return modules;
}

function printImport(names: string[], module: string): string {
  const line = `import { ${names.join(", ")} } from '${module}';`;
  if (line.length <= 80) return line;
  return `import {\n${names.map((name) => `  ${name},`).join("\n")}\n} from '${module}';`;
}

/**
 * Moves each named import that `isComponentSource` claims to the module its
 * `@import` tag names, merged into one statement per module. A name with no
 * tag stays where it was, so the manifest still shows it unresolved.
 */
export function applyImportTags(
  code: string,
  modules: Map<string, string>,
  isComponentSource: (source: string) => boolean,
): string {
  const mark = "\u0000";
  const grouped = new Map<string, string[]>();
  const state = { claimed: false };
  const replaced = code.replace(
    IMPORT_STATEMENT,
    (statement, names: string, source: string) => {
      if (!isComponentSource(source)) return statement;
      const left: string[] = [];
      for (const specifier of names.split(",")) {
        const trimmed = specifier.trim();
        if (!trimmed) continue;
        const module = modules.get(trimmed.split(/\s+as\s+/)[0] ?? trimmed);
        if (!module) {
          left.push(trimmed);
          continue;
        }
        const list = grouped.get(module) ?? [];
        if (!list.includes(trimmed)) list.push(trimmed);
        grouped.set(module, list);
      }
      const lines = state.claimed ? [] : [mark];
      state.claimed = true;
      if (left.length > 0) {
        lines.push(printImport(left, source));
      }
      return lines.join("\n");
    },
  );
  if (!state.claimed) return code;
  const statements = [...grouped]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, names]) => printImport(names, module))
    .join("\n");
  return replaced
    .replace(mark, statements)
    .split("\n")
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * Storybook reads a component's `@import` tag from its docgen description,
 * where react-docgen keeps tags; react-docgen-typescript files them apart, so
 * every entry falls back to the package root or the story's relative path.
 * This applies the tags to each entry's import statements instead.
 */
export function withImportTags(
  manifests: Manifests,
  componentDirs: string[],
  packageName: string,
  projectRoot: string,
): Manifests {
  const components = manifests.components;
  if (!components) return manifests;
  const modules = readImportTags(componentDirs);
  const inputsByModule = new Map(
    PARTS.flatMap((part) =>
      part.cssInputs && part.toolkit
        ? [[part.toolkit, part.cssInputs] as const]
        : [],
    ),
  );
  const isComponentSource = (source: string) =>
    source === packageName ||
    (source.startsWith(".") && source.includes("/src/"));
  function storyModules(storyPath: string) {
    const resolved = new Map(modules);
    const file = path.resolve(projectRoot, storyPath);
    const parts = path.resolve(projectRoot, "src/ui/base-ui");
    for (const [, names, source] of fs
      .readFileSync(file, "utf8")
      .matchAll(IMPORT_STATEMENT)) {
      if (!source.startsWith(".")) continue;
      const target = path.resolve(path.dirname(file), source);
      const isPart = path.dirname(target) === parts;
      if (!isPart && !source.startsWith("./")) continue;
      const module = isPart
        ? packageName +
          "/ui/base-ui/" +
          path.basename(target, path.extname(target))
        : source;
      for (const name of names.split(",")) {
        const original = name.trim().split(/\s+as\s+/)[0];
        if (original) resolved.set(original, module);
      }
    }
    return resolved;
  }
  function guideFor(storyPath: string) {
    if (!storyPath.endsWith(".stories.tsx")) return undefined;
    const guide = path.resolve(
      projectRoot,
      storyPath.replace(/\.stories\.tsx$/, ".docs.md"),
    );
    return fs.existsSync(guide)
      ? fs.readFileSync(guide, "utf8").trim()
      : undefined;
  }
  return {
    ...manifests,
    components: {
      ...components,
      components: Object.fromEntries(
        Object.entries(components.components).map(([id, entry]) => {
          const sources = storyModules(entry.path);
          const module = sources.get(entry.name);
          const cssInputs = module && inputsByModule.get(module);
          const rewrite = (code: string | undefined) =>
            code === undefined
              ? undefined
              : applyImportTags(code, sources, isComponentSource);
          return [
            id,
            {
              ...entry,
              ...(cssInputs ? { cssInputs } : {}),
              description: guideFor(entry.path) ?? entry.description,
              import: rewrite(entry.import),
              ...(entry.subcomponents
                ? {
                    subcomponents: Object.fromEntries(
                      Object.entries(entry.subcomponents).map(([name, sub]) => [
                        name,
                        { ...sub, import: rewrite(sub.import) },
                      ]),
                    ),
                  }
                : {}),
            },
          ];
        }),
      ),
    },
  };
}
