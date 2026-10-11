import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGES = path.resolve(HERE, "..");
const SHELL = path.join(PAGES, "DesignEditor.tsx");
const SHARED = path.join(HERE, "design-editor-shared.ts");

let cached: string | undefined;

// Test-only (node:fs): the shell, its hooks in call order, then the view, as one
// text, so source-text specs see every statement of the editor component.
export function readDesignEditorSource(): string {
  if (cached !== undefined) return cached;
  const shell = readFileSync(SHELL, "utf8");
  const importPathByName = new Map<string, string>();
  for (const match of shell.matchAll(
    /import \{ (\w+) \} from "\.\/(design-editor\/[^"]+)";/g,
  )) {
    importPathByName.set(match[1], match[2]);
  }
  const body = shell.slice(shell.indexOf("function DesignEditor()"));
  const ordered = [...importPathByName.keys()].sort(
    (a, b) => indexOfUse(body, a) - indexOfUse(body, b),
  );
  const parts = [shell];
  for (const name of ordered) {
    parts.push(readModule(path.join(PAGES, importPathByName.get(name)!)));
  }
  parts.push(...readViewModules(parts[parts.length - 1]));
  if (existsSync(SHARED)) parts.push(readFileSync(SHARED, "utf8"));
  cached = parts.join("\n");
  return cached;
}

function indexOfUse(body: string, name: string): number {
  const call = body.indexOf(`${name}(`);
  if (call === -1) throw new Error(`${name} is imported but never called`);
  return call;
}

function readModule(modulePath: string): string {
  for (const ext of [".ts", ".tsx"]) {
    if (existsSync(modulePath + ext))
      return readFileSync(modulePath + ext, "utf8");
  }
  throw new Error(`No module at ${modulePath}`);
}

// The view's render modules (design-editor/view/*), in the order they are first imported.
function readViewModules(viewSource: string): string[] {
  const viewDir = path.join(HERE, "view");
  const seen = new Set<string>();
  const out: string[] = [];
  const queue = [viewSource];
  while (queue.length) {
    const source = queue.shift()!;
    for (const match of source.matchAll(
      /from "\.\/(?:view\/)?([a-z][a-z0-9-]*)";/g,
    )) {
      const file = path.join(viewDir, `${match[1]}.tsx`);
      if (seen.has(file) || !existsSync(file)) continue;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      out.push(text);
      queue.push(text);
    }
  }
  return out;
}
