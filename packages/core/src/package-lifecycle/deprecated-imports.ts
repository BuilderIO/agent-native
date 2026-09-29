import fs from "node:fs";
import path from "node:path";

import {
  loadMigrationManifestsForProject,
  migrationMoveStatus,
  resolveMigrationSymbolMove,
  type MigrationManifest,
  type MigrationMove,
  type MigrationMoveStatus,
  type RemovedExportManifest,
} from "./migration-manifest.js";

const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".cjs",
  ".cts",
  ".ts",
  ".tsx",
]);
const SKIP_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".output",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);
const REGEX_PREFIX_KEYWORDS = new Set([
  "await",
  "case",
  "delete",
  "do",
  "else",
  "extends",
  "finally",
  "in",
  "instanceof",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
  "if",
  "while",
  "for",
  "with",
  "switch",
  "catch",
]);
const CONTROL_PAREN_KEYWORDS = new Set([
  "if",
  "while",
  "for",
  "with",
  "switch",
  "catch",
]);

export interface DeprecatedImportFinding {
  file: string;
  line: number;
  from: string;
  to: string[];
  symbols: string[];
  status: MigrationMoveStatus | "removed";
  migrationGuide?: string;
}

export interface ScanDeprecatedImportsOptions {
  root: string;
  manifests?: MigrationManifest[];
}

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (
        SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
        !entry.name.endsWith(".d.ts")
      ) {
        files.push(entryPath);
      }
    }
  };
  visit(root);
  return files.sort();
}

function mergeMoves(
  manifests: MigrationManifest[],
): Record<string, MigrationMove> {
  const moves: Record<string, MigrationMove> = {};
  for (const manifest of manifests) Object.assign(moves, manifest.moves);
  return moves;
}

function importedNames(clause: string): string[] | null {
  const named = clause.match(/\{([\s\S]*?)\}/);
  if (!named) return null;
  return named[1]
    .split(",")
    .map((part) => part.trim().replace(/^type\s+/, ""))
    .filter(Boolean)
    .map((part) => part.split(/\s+as\s+/)[0].trim());
}

function destructuredNames(pattern: string): string[] {
  return pattern
    .split(",")
    .map((part) =>
      part
        .trim()
        .split(/\s*:\s*|\s*=\s*/)[0]
        .trim(),
    )
    .map((name) => name.replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function appendRemovedImportFinding(
  findings: DeprecatedImportFinding[],
  file: string,
  text: string,
  from: string,
  removedExport: RemovedExportManifest | undefined,
  symbols: string[] | null,
  index: number,
): void {
  const removedSymbols = symbols?.filter((name) =>
    removedExport?.symbols.includes(name),
  );
  if (!removedExport || !removedSymbols?.length) return;
  findings.push({
    file,
    line: lineAt(text, index),
    from,
    to: [],
    symbols: removedSymbols,
    status: "removed",
    migrationGuide: removedExport.migrationGuide,
  });
}

function appendRemovedNamespaceFindings(
  findings: DeprecatedImportFinding[],
  file: string,
  text: string,
  codeMask: Uint8Array,
  from: string,
  namespace: string,
  removedExport: RemovedExportManifest | undefined,
  namespaceBindingIndex?: number,
): void {
  if (!removedExport) return;
  const shadowedRanges = namespaceShadowedRanges(
    text,
    codeMask,
    namespace,
    namespaceBindingIndex,
  );
  const namespacePattern = `(?<![\\w$.])\\b${escapeRegExp(namespace)}`;
  for (const symbol of removedExport.symbols) {
    const symbolPattern = escapeRegExp(symbol);
    const property = `${symbolPattern}\\b`;
    const quotedProperty = `\\[\\s*["']${symbolPattern}["']\\s*\\]`;
    const memberAccess = new RegExp(
      `${namespacePattern}\\s*(?:\\?\\.\\s*(?:${property}|${quotedProperty})|\\.\\s*${property}|${quotedProperty})`,
      "g",
    );
    for (const match of text.matchAll(memberAccess)) {
      const index = match.index ?? 0;
      if (
        !codeMask[index] ||
        shadowedRanges.some(({ start, end }) => index >= start && index < end)
      ) {
        continue;
      }
      findings.push({
        file,
        line: lineAt(text, index),
        from,
        to: [],
        symbols: [symbol],
        status: "removed",
        migrationGuide: removedExport.migrationGuide,
      });
    }
  }
}

type CodeRange = { start: number; end: number };

// ponytail: scope matching is syntax-limited; add a parser if real diagnostics need wider coverage.
function conciseArrowBodyEnd(
  text: string,
  codeMask: Uint8Array,
  start: number,
): number {
  const stack: string[] = [];
  const closes: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  for (let index = start; index < text.length; index += 1) {
    if (!codeMask[index]) continue;
    const character = text[index] ?? "";
    if (character in closes) {
      stack.push(character);
    } else if (")]}".includes(character)) {
      if (closes[stack.at(-1) ?? ""] === character) {
        stack.pop();
      } else if (stack.length === 0) {
        return index;
      }
    } else if ((character === "," || character === ";") && stack.length === 0) {
      return index;
    }
  }
  return text.length;
}

function matchingCodePairs(
  text: string,
  codeMask: Uint8Array,
  open: string,
  close: string,
): Map<number, number> {
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (!codeMask[index]) continue;
    if (text[index] === open) stack.push(index);
    if (text[index] !== close) continue;
    const start = stack.pop();
    if (start !== undefined) pairs.set(start, index);
  }
  return pairs;
}

function topLevelParts(value: string): string[] {
  const parts: string[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (
      character === "(" ||
      character === "[" ||
      character === "{" ||
      character === "<"
    ) {
      stack.push(character);
    } else if (
      (character === ")" && stack.at(-1) === "(") ||
      (character === "]" && stack.at(-1) === "[") ||
      (character === "}" && stack.at(-1) === "{") ||
      (character === ">" && stack.at(-1) === "<")
    ) {
      stack.pop();
    } else if (character === "," && stack.length === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function bindingPatternHasName(pattern: string, name: string): boolean {
  const value = pattern
    .trim()
    .replace(/^\.\.\./, "")
    .split(/\s*=\s*/)[0]
    .trim();
  if (/^[\w$]+[!?]?(?:\s*:|$)/.test(value)) {
    return value.match(/^[\w$]+/)?.[0] === name;
  }
  if (
    (value.startsWith("{") && value.endsWith("}")) ||
    (value.startsWith("[") && value.endsWith("]"))
  ) {
    const contents = value.slice(1, -1);
    return topLevelParts(contents).some((part) => {
      const binding = part.trim().replace(/^\.\.\./, "");
      const [key, alias] = topLevelParts(binding.replace(":", ","));
      const local = alias ?? key;
      return local?.trim().match(/^[\w$]+/)?.[0] === name;
    });
  }
  return false;
}

function namespaceShadowedRanges(
  text: string,
  codeMask: Uint8Array,
  namespace: string,
  namespaceBindingIndex?: number,
): CodeRange[] {
  const bracePairs = matchingCodePairs(text, codeMask, "{", "}");
  const parenPairs = matchingCodePairs(text, codeMask, "(", ")");
  const functionScopes: CodeRange[] = [];
  const shadowed: CodeRange[] = [];
  const forHeaders: CodeRange[] = [];
  const skipWhitespace = (index: number): number => {
    while (/\s/.test(text[index] ?? "")) index += 1;
    return index;
  };

  for (const [open, close] of parenPairs) {
    const next = skipWhitespace(close + 1);
    const arrow = text.startsWith("=>", next);
    const body = arrow ? skipWhitespace(next + 2) : next;
    const priorWord = text.slice(0, open).match(/([\w$]+)\s*$/)?.[1];
    if (!arrow && priorWord === "for") {
      forHeaders.push({ start: open, end: close });
      const header = text.slice(open + 1, close);
      const declaration =
        header.match(/^\s*(const|let|var)\s+([\s\S]+?)\s+(?:of|in)\b/) ??
        header.split(";", 1)[0]?.match(/^\s*(const|let|var)\s+([\s\S]+)$/);
      const kind = declaration?.[1];
      const binding = declaration?.[2];
      const end = text[body] === "{" ? bracePairs.get(body) : undefined;
      if (
        end !== undefined &&
        binding &&
        bindingPatternHasName(binding, namespace)
      ) {
        const range = { start: body, end };
        if (kind === "var") {
          const functionScope = functionScopes
            .filter(({ start, end }) => start < open && end > open)
            .sort(
              (left, right) =>
                left.end - left.start - (right.end - right.start),
            )[0];
          if (functionScope) shadowed.push(functionScope);
        } else {
          shadowed.push(range);
        }
      }
      continue;
    }
    if (arrow) {
      const shadowsNamespace = bindingPatternHasName(
        text.slice(open + 1, close),
        namespace,
      );
      const isNamespaceBinding =
        namespaceBindingIndex !== undefined &&
        namespaceBindingIndex > open &&
        namespaceBindingIndex < close;
      if (text[body] === "{") {
        const end = bracePairs.get(body);
        if (end !== undefined) {
          const range = { start: body, end };
          functionScopes.push(range);
          if (shadowsNamespace && !isNamespaceBinding) shadowed.push(range);
        }
      } else if (shadowsNamespace && !isNamespaceBinding) {
        shadowed.push({
          start: body,
          end: conciseArrowBodyEnd(text, codeMask, body),
        });
      }
      continue;
    }
    if (text[body] !== "{") continue;
    if (
      !arrow &&
      ["if", "for", "while", "switch", "with"].includes(priorWord ?? "")
    ) {
      continue;
    }
    const end = bracePairs.get(body);
    if (end === undefined) continue;
    const range = { start: body, end };
    functionScopes.push(range);
    if (bindingPatternHasName(text.slice(open + 1, close), namespace)) {
      shadowed.push(range);
    }
  }

  const singleParamArrow = new RegExp(
    `(?<![\\w$.])${escapeRegExp(namespace)}\\s*=>`,
    "g",
  );
  for (const match of text.matchAll(singleParamArrow)) {
    const index = match.index ?? 0;
    if (!codeMask[index]) continue;
    if (
      namespaceBindingIndex !== undefined &&
      namespaceBindingIndex >= index &&
      namespaceBindingIndex < index + match[0].length
    ) {
      continue;
    }
    const body = skipWhitespace(index + match[0].length);
    if (text[body] === "{") {
      const end = bracePairs.get(body);
      if (end === undefined) continue;
      const range = { start: body, end };
      functionScopes.push(range);
      shadowed.push(range);
    } else {
      shadowed.push({
        start: body,
        end: conciseArrowBodyEnd(text, codeMask, body),
      });
    }
  }

  const declaration =
    /\b(const|let|var)\s+([^=;\n]+?)(?=\s*=|\s+of\b|\s+in\b|;)/g;
  for (const match of text.matchAll(declaration)) {
    const index = match.index ?? 0;
    if (
      !codeMask[index] ||
      forHeaders.some(({ start, end }) => index > start && index < end) ||
      !bindingPatternHasName(match[2], namespace)
    ) {
      continue;
    }
    const containingScopes = [...bracePairs]
      .filter(([start, end]) => start < index && end > index)
      .sort((left, right) => left[1] - left[0] - (right[1] - right[0]));
    const enclosingBlock = containingScopes[0];
    if (!enclosingBlock) continue;
    if (match[1] === "var") {
      const functionScope = functionScopes
        .filter(({ start, end }) => start < index && end > index)
        .sort(
          (left, right) => left.end - left.start - (right.end - right.start),
        )[0];
      if (functionScope) shadowed.push(functionScope);
    } else {
      shadowed.push({ start: enclosingBlock[0], end: enclosingBlock[1] });
    }
  }

  return shadowed;
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function regexLiteralEnd(text: string, start: number): number | null {
  let escaped = false;
  let inCharacterClass = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (character === "\n" || character === "\r") return null;
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "[" && !inCharacterClass) {
      inCharacterClass = true;
    } else if (character === "]" && inCharacterClass) {
      inCharacterClass = false;
    } else if (character === "/" && !inCharacterClass) {
      index += 1;
      while (/[a-z]/i.test(text[index] ?? "")) index += 1;
      return index;
    }
  }
  return null;
}

function codePositionMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);
  const templateExpressionDepths: number[] = [];
  const controlParens: boolean[] = [];
  let mode: "code" | "single" | "double" | "template" | "line" | "block" =
    "code";
  let escaped = false;
  let canStartRegex = true;
  let previousWord = "";

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    const next = text[index + 1];

    if (mode === "line") {
      if (character === "\n" || character === "\r") {
        mode = "code";
        mask[index] = 1;
      }
      continue;
    }
    if (mode === "block") {
      if (character === "*" && next === "/") {
        index += 1;
        mode = "code";
      }
      continue;
    }
    if (mode === "single" || mode === "double") {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (
        (mode === "single" && character === "'") ||
        (mode === "double" && character === '"')
      ) {
        mode = "code";
        canStartRegex = false;
        previousWord = "";
      }
      continue;
    }
    if (mode === "template") {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "`") {
        templateExpressionDepths.pop();
        mode = "code";
        canStartRegex = false;
        previousWord = "";
      } else if (character === "$" && next === "{") {
        templateExpressionDepths[templateExpressionDepths.length - 1] = 1;
        index += 1;
        mode = "code";
        canStartRegex = true;
        previousWord = "";
      }
      continue;
    }

    if (character === "/" && next === "/") {
      index += 1;
      mode = "line";
      continue;
    }
    if (character === "/" && next === "*") {
      index += 1;
      mode = "block";
      continue;
    }
    if (character === "'") {
      mode = "single";
      canStartRegex = false;
      previousWord = "";
      continue;
    }
    if (character === '"') {
      mode = "double";
      canStartRegex = false;
      previousWord = "";
      continue;
    }
    if (character === "`") {
      templateExpressionDepths.push(0);
      mode = "template";
      previousWord = "";
      continue;
    }

    // ponytail: regex-vs-division uses token context; use a parser if syntax coverage grows.
    if (character === "/" && canStartRegex) {
      const end = regexLiteralEnd(text, index);
      if (end !== null) {
        index = end - 1;
        canStartRegex = false;
        previousWord = "";
        continue;
      }
    }

    if (/\s/.test(character)) {
      mask[index] = 1;
      continue;
    }

    if (/[A-Za-z_$]/.test(character)) {
      let end = index + 1;
      while (/[\w$]/.test(text[end] ?? "")) end += 1;
      const word = text.slice(index, end);
      mask.fill(1, index, end);
      canStartRegex = REGEX_PREFIX_KEYWORDS.has(word);
      previousWord = word;
      index = end - 1;
      continue;
    }

    if (/[0-9]/.test(character)) {
      let end = index + 1;
      while (/[\w.]/.test(text[end] ?? "")) end += 1;
      mask.fill(1, index, end);
      canStartRegex = false;
      previousWord = "";
      index = end - 1;
      continue;
    }

    mask[index] = 1;
    const templateDepthIndex = templateExpressionDepths.length - 1;
    const templateDepth = templateExpressionDepths[templateDepthIndex];
    if (character === "(") {
      controlParens.push(CONTROL_PAREN_KEYWORDS.has(previousWord));
      canStartRegex = true;
      previousWord = "(";
    } else if (character === ")") {
      canStartRegex = controlParens.pop() ?? false;
      previousWord = ")";
    } else if (
      character === "[" ||
      character === "{" ||
      character === "," ||
      character === ";" ||
      character === ":"
    ) {
      canStartRegex = true;
      previousWord = character;
    } else if (character === "}" || character === "]") {
      canStartRegex = character === "}";
      previousWord = character;
    } else if (character === ".") {
      canStartRegex = false;
      previousWord = ".";
    } else if (character === "+" || character === "-") {
      if (next === character) {
        mask[index + 1] = 1;
        index += 1;
        canStartRegex = false;
      } else {
        canStartRegex = true;
      }
      previousWord = character;
    } else if (character === "?") {
      canStartRegex = next !== ".";
      previousWord = "?";
    } else {
      canStartRegex = true;
      previousWord = "";
    }

    if (templateDepth === undefined || templateDepth === 0) continue;
    if (character === "{") {
      templateExpressionDepths[templateDepthIndex] = templateDepth + 1;
    } else if (character === "}") {
      if (templateDepth === 1) {
        templateExpressionDepths[templateDepthIndex] = 0;
        mode = "template";
        canStartRegex = false;
      } else {
        templateExpressionDepths[templateDepthIndex] = templateDepth - 1;
      }
    }
  }
  return mask;
}

function matchingMoveTargets(
  move: MigrationMove,
  names: string[] | null,
): Array<{
  status: MigrationMoveStatus;
  targets: string[];
  symbols: string[];
}> {
  if (!move.symbols) {
    return [
      {
        status: migrationMoveStatus(move),
        targets: [move.to],
        symbols: names ?? [],
      },
    ];
  }
  if (!names) {
    const groups = new Map<MigrationMoveStatus, Set<string>>();
    for (const importedName of Object.keys(move.symbols)) {
      const resolved = resolveMigrationSymbolMove(move, importedName);
      if (!resolved) continue;
      const targets = groups.get(resolved.status) ?? new Set<string>();
      targets.add(resolved.to);
      groups.set(resolved.status, targets);
    }
    return [...groups].map(([status, targets]) => ({
      status,
      targets: [...targets].sort(),
      symbols: [],
    }));
  }
  const groups = new Map<
    MigrationMoveStatus,
    { targets: Set<string>; symbols: string[] }
  >();
  for (const name of names) {
    const resolved = resolveMigrationSymbolMove(move, name);
    if (!resolved) continue;
    const group = groups.get(resolved.status) ?? {
      targets: new Set<string>(),
      symbols: [],
    };
    group.targets.add(resolved.to);
    group.symbols.push(name);
    groups.set(resolved.status, group);
  }
  return [...groups].map(([status, group]) => ({
    status,
    targets: [...group.targets].sort(),
    symbols: group.symbols,
  }));
}

export function scanDeprecatedImports(
  options: ScanDeprecatedImportsOptions,
): DeprecatedImportFinding[] {
  const root = path.resolve(options.root);
  const manifests = options.manifests ?? loadMigrationManifestsForProject(root);
  const moves = mergeMoves(manifests);
  const removedExports = Object.assign(
    {},
    ...manifests.map((manifest) => manifest.removedExports ?? {}),
  );
  const findings: DeprecatedImportFinding[] = [];
  const fromDeclaration =
    /\b(import|export)\s+([^;]*?)\s+from\s+["']([^"']+)["']\s*;?/g;
  const sideEffectImport = /\bimport\s+["']([^"']+)["']\s*;?/g;
  const commonJsDestructure =
    /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:await\s+)?require\(\s*["']([^"']+)["']\s*\)/g;
  const dynamicImportDestructure =
    /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*["']([^"']+)["']\s*\)/g;
  const dynamicImportThenDestructure =
    /\bimport\(\s*["']([^"']+)["']\s*\)\s*\.then\(\s*(?:async\s*)?\(\s*\{([^}]*)\}\s*\)\s*=>/g;
  const commonJsNamespace =
    /\b(?:const|let|var)\s+([\w$]+)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g;
  const dynamicImportNamespace =
    /\b(?:const|let|var)\s+([\w$]+)\s*=\s*await\s+import\(\s*["']([^"']+)["']\s*\)/g;
  const dynamicImportThenNamespace =
    /\bimport\(\s*["']([^"']+)["']\s*\)\s*\.then\(\s*(?:async\s*)?(?:\(\s*([\w$]+)\s*\)|([\w$]+))\s*=>/g;
  const importEquals =
    /\bimport\s+([\w$]+)\s*=\s*require\(\s*["']([^"']+)["']\s*\)/g;
  const commonJsMember =
    /\brequire\(\s*["']([^"']+)["']\s*\)\s*(?:\?\.\s*([\w$]+)|\.\s*([\w$]+)|\?\.\s*\[\s*["']([^"']+)["']\s*\]|\[\s*["']([^"']+)["']\s*\])/g;
  const dynamicImportMember =
    /\(\s*await\s+import\(\s*["']([^"']+)["']\s*\)\s*\)\s*(?:\?\.\s*([\w$]+)|\.\s*([\w$]+)|\?\.\s*\[\s*["']([^"']+)["']\s*\]|\[\s*["']([^"']+)["']\s*\])/g;

  for (const file of sourceFiles(root)) {
    const text = fs.readFileSync(file, "utf-8");
    const codeMask = codePositionMask(text);
    for (const match of text.matchAll(fromDeclaration)) {
      if (!codeMask[match.index ?? 0]) continue;
      const from = match[3];
      const move = moves[from];
      const removedExport = removedExports[from];
      if (!move && !removedExport) continue;
      const names = importedNames(match[2]);
      if (move) {
        const matches = matchingMoveTargets(move, names);
        for (const matched of matches) {
          findings.push({
            file,
            line: lineAt(text, match.index ?? 0),
            from,
            to: matched.targets,
            symbols: matched.symbols,
            status: matched.status,
          });
        }
      }
      appendRemovedImportFinding(
        findings,
        file,
        text,
        from,
        removedExport,
        names,
        match.index ?? 0,
      );
      const namespace = match[2].match(/\*\s+as\s+([\w$]+)/)?.[1];
      if (namespace) {
        appendRemovedNamespaceFindings(
          findings,
          file,
          text,
          codeMask,
          from,
          namespace,
          removedExport,
        );
      }
    }
    for (const match of text.matchAll(sideEffectImport)) {
      if (!codeMask[match.index ?? 0]) continue;
      const from = match[1];
      const move = moves[from];
      if (!move || move.symbols) continue;
      findings.push({
        file,
        line: lineAt(text, match.index ?? 0),
        from,
        to: [move.to],
        symbols: [],
        status: migrationMoveStatus(move),
      });
    }
    for (const match of text.matchAll(commonJsDestructure)) {
      if (!codeMask[match.index ?? 0]) continue;
      const from = match[2];
      appendRemovedImportFinding(
        findings,
        file,
        text,
        from,
        removedExports[from],
        destructuredNames(match[1]),
        match.index ?? 0,
      );
    }
    for (const match of text.matchAll(dynamicImportDestructure)) {
      if (!codeMask[match.index ?? 0]) continue;
      const from = match[2];
      appendRemovedImportFinding(
        findings,
        file,
        text,
        from,
        removedExports[from],
        destructuredNames(match[1]),
        match.index ?? 0,
      );
    }
    for (const match of text.matchAll(dynamicImportThenDestructure)) {
      if (!codeMask[match.index ?? 0]) continue;
      const from = match[1];
      appendRemovedImportFinding(
        findings,
        file,
        text,
        from,
        removedExports[from],
        destructuredNames(match[2]),
        match.index ?? 0,
      );
    }
    for (const match of text.matchAll(commonJsNamespace)) {
      if (!codeMask[match.index ?? 0]) continue;
      appendRemovedNamespaceFindings(
        findings,
        file,
        text,
        codeMask,
        match[2],
        match[1],
        removedExports[match[2]],
      );
    }
    for (const match of text.matchAll(dynamicImportNamespace)) {
      if (!codeMask[match.index ?? 0]) continue;
      appendRemovedNamespaceFindings(
        findings,
        file,
        text,
        codeMask,
        match[2],
        match[1],
        removedExports[match[2]],
      );
    }
    for (const match of text.matchAll(dynamicImportThenNamespace)) {
      if (!codeMask[match.index ?? 0]) continue;
      const from = match[1];
      const namespace = match[2] ?? match[3];
      const namespaceBindingIndex = namespace
        ? (match.index ?? 0) + match[0].lastIndexOf(namespace)
        : undefined;
      appendRemovedNamespaceFindings(
        findings,
        file,
        text,
        codeMask,
        from,
        namespace,
        removedExports[from],
        namespaceBindingIndex,
      );
    }
    for (const match of text.matchAll(importEquals)) {
      if (!codeMask[match.index ?? 0]) continue;
      appendRemovedNamespaceFindings(
        findings,
        file,
        text,
        codeMask,
        match[2],
        match[1],
        removedExports[match[2]],
      );
    }
    for (const match of text.matchAll(commonJsMember)) {
      if (!codeMask[match.index ?? 0]) continue;
      const from = match[1];
      const symbol = match[2] ?? match[3] ?? match[4] ?? match[5];
      appendRemovedImportFinding(
        findings,
        file,
        text,
        from,
        removedExports[from],
        symbol ? [symbol] : [],
        match.index ?? 0,
      );
    }
    for (const match of text.matchAll(dynamicImportMember)) {
      if (!codeMask[match.index ?? 0]) continue;
      const from = match[1];
      const symbol = match[2] ?? match[3] ?? match[4] ?? match[5];
      appendRemovedImportFinding(
        findings,
        file,
        text,
        from,
        removedExports[from],
        symbol ? [symbol] : [],
        match.index ?? 0,
      );
    }
  }
  return findings;
}
