import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, relative, resolve } from "node:path";

import { parseAst } from "vite";

export interface UnpackagedImport {
  specifier: string;
  /** The import, then each file from there to the one that needs the package. */
  chain: string[];
}

/** Names the packages electron-builder.yml copies out of node_modules. */
export function packagedModuleNames(builderConfig: string): Set<string> {
  const files =
    builderConfig.match(/^files:\r?\n((?: {2}- .*(?:\r?\n|$))*)/m)?.[1] ?? "";
  return new Set(
    Array.from(
      files.matchAll(/^ {2}- node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//gm),
      (match) => match[1],
    ),
  );
}

function packageName(specifier: string): string {
  return specifier.split("/", specifier.startsWith("@") ? 2 : 1).join("/");
}

function staticImports(file: string): string[] {
  return parseAst(readFileSync(file, "utf8")).body.flatMap((node) =>
    (node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration") &&
    node.source
      ? [node.source.value]
      : [],
  );
}

/**
 * Finds packages the app needs to start but doesn't ship. `walk` resolves a
 * specifier to the file to read imports from, or returns null for a package
 * whose files don't need reading.
 */
export function findUnpackagedImports(options: {
  specifiers: Iterable<string>;
  packaged: ReadonlySet<string>;
  walk: (specifier: string) => string | null;
}): UnpackagedImport[] {
  const missing = new Map<string, UnpackagedImport>();
  const visited = new Set<string>();
  const queue: { specifier: string; chain: string[] }[] = Array.from(
    options.specifiers,
    (specifier) => ({ specifier, chain: [] }),
  );

  for (let next = queue.shift(); next; next = queue.shift()) {
    const { specifier, chain } = next;
    if (isBuiltin(specifier) || packageName(specifier) === "electron") continue;
    if (!options.packaged.has(packageName(specifier))) {
      if (!missing.has(packageName(specifier))) {
        missing.set(packageName(specifier), { specifier, chain });
      }
      continue;
    }
    const entry = options.walk(specifier);
    if (!entry) continue;

    const files = [{ file: entry, chain: [...chain, specifier] }];
    for (let current = files.shift(); current; current = files.shift()) {
      if (visited.has(current.file)) continue;
      visited.add(current.file);
      const { file, chain: fileChain } = current;
      for (const imported of staticImports(file)) {
        if (imported.startsWith(".")) {
          const target = resolve(dirname(file), imported);
          files.push({
            file: target,
            chain: [
              ...fileChain,
              relative(dirname(entry), target).replaceAll("\\", "/"),
            ],
          });
        } else {
          queue.push({ specifier: imported, chain: fileChain });
        }
      }
    }
  }
  return [...missing.values()];
}
