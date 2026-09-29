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
  valueBindings: string[];
  sideEffectOnly: boolean;
}

const SSE_MODULE = /(?:^|\/)sse-event-processor(?:\.js)?$/;
const SSE_STREAM_READERS = new Set(["readSSEStream", "readSSEStreamRaw"]);

const AGENTKIT_STREAM_OWNING_MODULE =
  /^@agent-native\/agentkit(?!\/protocol$)(?:\/.*)?$/;
const LEGACY_ASSISTANT_UI_BINDINGS = new Set([
  "ActionBarPrimitive",
  "AssistantRuntimeProvider",
  "BranchPickerPrimitive",
  "ChatModelAdapter",
  "ChatModelRunResult",
  "MessagePrimitive",
  "ThreadPrimitive",
  "useLocalRuntime",
  "useMessageRuntime",
  "useThreadRuntime",
]);
const SHARED_COMPOSER_ROOT = "packages/toolkit/src/composer/";
const LEGACY_CHAT_COMPONENT_EXPORT =
  /\bexport\s+(?:const|function)\s+AssistantChat\b/;
const LEGACY_CHAT_ADAPTER =
  /\b(?:createAgentChatAdapter|createCodeAgentChatAdapter|createAgentChatRuntimeAdapter|codeAgentTranscriptEventsToContent|codeAgentTranscriptHasPendingApproval)\b/;

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

/** The old transcript controller cannot remain behind a compatibility shell. */
export function findLegacyChatOwnerViolations(
  file: string,
  content: string,
): StreamOwnershipViolation[] {
  const imports = parseImports(content);
  const lineAt = (index: number) => content.slice(0, index).split("\n").length;
  const legacyImport = imports.find(
    (entry) =>
      entry.valueBindings.includes("AssistantChat") ||
      (/(?:^|\/)AssistantChat(?:\.js)?$/.test(entry.specifier) &&
        (entry.valueBindings.length > 0 || entry.sideEffectOnly)),
  );
  const legacyAssistantUi = imports.find(
    (entry) =>
      entry.specifier === "@assistant-ui/react" &&
      entry.valueBindings.some((binding) =>
        LEGACY_ASSISTANT_UI_BINDINGS.has(binding),
      ) &&
      !file.replaceAll("\\", "/").startsWith(SHARED_COMPOSER_ROOT),
  );
  const legacyAdapter = LEGACY_CHAT_ADAPTER.exec(content);
  const legacyMount = /<AssistantChat(?:\s|\/?>)/.exec(content);
  const legacyDefinition = LEGACY_CHAT_COMPONENT_EXPORT.exec(content);
  const hit =
    legacyImport ??
    legacyAssistantUi ??
    (legacyAdapter ? { index: legacyAdapter.index } : undefined) ??
    (legacyMount
      ? { index: legacyMount.index }
      : legacyDefinition
        ? { index: legacyDefinition.index }
        : undefined);

  if (!hit) return [];
  return [
    {
      file,
      line: lineAt(hit.index),
      reason:
        "still owns legacy AssistantChat/controller UI or an assistant-ui chat adapter; keep AgentPanel, AgentSidebar, and MultiTabAssistantChat as shells, and use AgentKit as the only conversation owner",
    },
  ];
}

const STREAM_SCAN_ROOTS = ["packages", "templates"];

function walkSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".cache", "build"].includes(entry.name))
        return [];
      return walkSources(child);
    }
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
    if (/\.(?:spec|test)\.tsx?$/.test(entry.name)) return [];
    return [child];
  });
}

function main(): void {
  const root = path.resolve(import.meta.dirname, "..");
  const violations = STREAM_SCAN_ROOTS.flatMap((directory) =>
    walkSources(path.join(root, directory)).flatMap((file) => {
      const rel = path.relative(root, file);
      const content = readFileSync(file, "utf8");
      return [
        ...findStreamOwnershipViolations(rel, content),
        ...findLegacyChatOwnerViolations(rel, content),
      ];
    }),
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
