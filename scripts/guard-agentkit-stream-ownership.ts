import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface StreamOwnershipViolation {
  file: string;
  line: number;
  reason: string;
}

interface ParsedImport {
  index: number;
  specifier: string;
  /** Bindings that survive to runtime. `import type` and `{ type X }` do not. */
  valueBindings: string[];
  /** A bare `import "x"` still evaluates the module. */
  sideEffectOnly: boolean;
}

const SSE_MODULE = /(?:^|\/)sse-event-processor(?:\.js)?$/;
const SSE_STREAM_READERS = new Set(["readSSEStream", "readSSEStreamRaw"]);

/**
 * `/protocol` is types plus pure helpers and owns no stream, so importing it
 * beside the SSE reader is fine. Every other AgentKit entry can build a client
 * or a transport.
 */
const AGENTKIT_STREAM_OWNING_MODULE =
  /^@agent-native\/agentkit(?!\/protocol$)(?:\/.*)?$/;

export function parseImports(source: string): ParsedImport[] {
  const imports: ParsedImport[] = [];

  const withClause =
    /\bimport\s+(type\s+)?([^;'"]*?)\s+from\s*["']([^"']+)["']/g;
  for (
    let match = withClause.exec(source);
    match;
    match = withClause.exec(source)
  ) {
    const [, typeOnly, clause, specifier] = match;
    if (typeOnly) {
      imports.push({
        index: match.index,
        specifier: specifier!,
        valueBindings: [],
        sideEffectOnly: false,
      });
      continue;
    }
    imports.push({
      index: match.index,
      specifier: specifier!,
      valueBindings: valueBindingsOf(clause ?? ""),
      sideEffectOnly: false,
    });
  }

  const bareImport = /\bimport\s*["']([^"']+)["']/g;
  for (
    let match = bareImport.exec(source);
    match;
    match = bareImport.exec(source)
  ) {
    imports.push({
      index: match.index,
      specifier: match[1]!,
      valueBindings: [],
      sideEffectOnly: true,
    });
  }

  return imports;
}

function valueBindingsOf(clause: string): string[] {
  const named = /\{([\s\S]*)\}/.exec(clause);
  const bindings: string[] = [];

  const outsideBraces = clause.replace(/\{[\s\S]*\}/, "").trim();
  for (const part of outsideBraces.split(",")) {
    const name = part.replace(/^\*\s*as\s+/, "").trim();
    if (name) bindings.push(name);
  }

  for (const entry of named?.[1]?.split(",") ?? []) {
    const trimmed = entry.trim();
    if (!trimmed || /^type\s/.test(trimmed)) continue;
    bindings.push(trimmed.split(/\s+as\s+/)[0]!.trim());
  }

  return bindings.filter(Boolean);
}

/**
 * Two readers on one stream is silent until a reconnect, when both try to
 * resume and the transcript forks. Only runtime ownership counts: a type-only
 * import erases, so a file that merely shares AgentKit's types with the SSE
 * reader is not a second owner.
 */
export function findStreamOwnershipViolations(
  file: string,
  content: string,
): StreamOwnershipViolation[] {
  const imports = parseImports(content);
  const lineAt = (index: number) => content.slice(0, index).split("\n").length;

  const sseReader = imports.find(
    (entry) =>
      SSE_MODULE.test(entry.specifier) &&
      entry.valueBindings.some((binding) => SSE_STREAM_READERS.has(binding)),
  );
  const agentKitOwner = imports.find(
    (entry) =>
      AGENTKIT_STREAM_OWNING_MODULE.test(entry.specifier) &&
      (entry.valueBindings.length > 0 || entry.sideEffectOnly),
  );

  if (!sseReader || !agentKitOwner) return [];

  return [
    {
      file,
      line: lineAt(Math.min(sseReader.index, agentKitOwner.index)),
      reason: `owns two readers for one stream: ${sseReader.specifier} and ${agentKitOwner.specifier}. Migrate the surface to AgentKit or leave it on the SSE processor, not both.`,
    },
  ];
}

function walkSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") return [];
      return walkSources(child);
    }
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
    if (/\.(?:spec|test)\.tsx?$/.test(entry.name)) return [];
    return [child];
  });
}

function main(): void {
  const root = path.resolve(import.meta.dirname, "..");
  const violations = ["packages/core/src", "templates/chat"].flatMap(
    (directory) =>
      walkSources(path.join(root, directory)).flatMap((file) =>
        findStreamOwnershipViolations(
          path.relative(root, file),
          readFileSync(file, "utf8"),
        ),
      ),
  );

  if (violations.length > 0) {
    console.error(
      `[guard:agentkit-stream-ownership] ${violations.length} violation(s):\n${violations
        .map(({ file, line, reason }) => `- ${file}:${line} ${reason}`)
        .join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log("[guard:agentkit-stream-ownership] clean");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
