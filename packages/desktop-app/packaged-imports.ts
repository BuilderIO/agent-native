import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, relative, resolve } from "node:path";

import { parseAst } from "vite";

export interface UnpackagedImport {
  specifier: string;
  importedThrough: string[];
}

export function packagedModuleNames(builderConfig: string): Set<string> {
  const files =
    builderConfig.match(/^files:\r?\n((?:(?: .*|#.*|)(?:\r?\n|$))*)/m)?.[1] ??
    "";
  const entries = files.matchAll(
    /^ {2}- ["']?node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\/(?:\S*\/)?\*\*/gm,
  );
  return new Set(Array.from(entries).flatMap((match) => match.slice(1, 2)));
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

export function findUnpackagedImports(options: {
  specifiers: Iterable<string>;
  packaged: ReadonlySet<string>;
  readImportsOf: string;
  resolveFile: (specifier: string) => string;
}): UnpackagedImport[] {
  const missing = new Map<string, UnpackagedImport>();
  const visited = new Set<string>();
  const queue: { specifier: string; importedThrough: string[] }[] = Array.from(
    options.specifiers,
    (specifier) => ({ specifier, importedThrough: [] }),
  );

  for (let next = queue.shift(); next; next = queue.shift()) {
    const { specifier, importedThrough } = next;
    const name = packageName(specifier);
    if (isBuiltin(specifier) || name === "electron") continue;
    if (!options.packaged.has(name)) {
      if (!missing.has(name)) missing.set(name, next);
      continue;
    }
    if (name !== options.readImportsOf) continue;

    const entry = options.resolveFile(specifier);
    const files = [
      { file: entry, importedThrough: [...importedThrough, specifier] },
    ];
    for (let current = files.shift(); current; current = files.shift()) {
      if (visited.has(current.file)) continue;
      visited.add(current.file);
      const { file, importedThrough: path } = current;
      for (const imported of staticImports(file)) {
        if (imported.startsWith(".")) {
          const target = resolve(dirname(file), imported);
          files.push({
            file: target,
            importedThrough: [
              ...path,
              relative(dirname(entry), target).replaceAll("\\", "/"),
            ],
          });
        } else {
          queue.push({ specifier: imported, importedThrough: path });
        }
      }
    }
  }
  return [...missing.values()];
}
