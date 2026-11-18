import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import { requireAddedLines } from "./changed-lines.mjs";

export function requireSourceChanges(
  root: string,
  guard: string,
): Map<string, Set<number>> {
  const added = requireAddedLines(root, guard) as Map<string, Set<number>>;
  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  for (const file of untracked.split("\0")) {
    if (!isHandwrittenSource(file)) continue;
    const absolute = path.resolve(root, file);
    added.set(
      absolute,
      new Set(
        readFileSync(absolute, "utf8")
          .split("\n")
          .map((_, index) => index + 1),
      ),
    );
  }
  return added;
}

export function isHandwrittenSource(relativeFile: string): boolean {
  const name = relativeFile.replaceAll("\\", "/");
  return (
    /\.[cm]?[jt]sx?$/.test(name) &&
    !/(?:^|\/)(?:node_modules|vendor|vendored|dist|build|coverage|\.generated|\.output|\.next|\.react-router|prototypes)\//.test(
      name,
    ) &&
    !/\.(?:generated|gen|min)\.[cm]?[jt]sx?$/.test(name)
  );
}

export function isTestSource(file: string): boolean {
  return (
    isHandwrittenSource(file) &&
    /(?:\.(?:test|spec|fixture|test-utils)\.[cm]?[jt]sx?$|(?:^|\/)(?:__tests__|e2e|tests|test)\/|(?:^|\/)(?:vitest|jest|playwright)\.(?:setup|config)\.[cm]?[jt]s$|(?:^|\/)setup(?:Tests|[.-]tests?)\.[cm]?[jt]sx?$)/.test(
      file.replaceAll("\\", "/"),
    )
  );
}

export function bindSource(file: string, text: string) {
  const normalize = (name: string) => name.replaceAll("\\", "/");
  const filename = normalize(file);
  const source = ts.createSourceFile(
    filename,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const host: ts.CompilerHost = {
    getSourceFile: (name) =>
      normalize(name) === filename ? source : undefined,
    fileExists: (name) => normalize(name) === filename,
    readFile: () => undefined,
    writeFile: () => {},
    getDefaultLibFileName: () => "lib.d.ts",
    getCurrentDirectory: () => "",
    getCanonicalFileName: normalize,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
  const program = ts.createProgram({
    rootNames: [filename],
    options: { noLib: true, noResolve: true, allowJs: true, types: [] },
    host,
  });
  const errors = program.getSyntacticDiagnostics(source);
  if (errors.length) {
    throw new Error(
      `${file}: ${errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, " ")).join("; ")}`,
    );
  }
  return { source, checker: program.getTypeChecker() };
}

export function isGeneratedSource(text: string): boolean {
  const first = ts.getLeadingCommentRanges(text, 0)?.[0];
  return (
    first !== undefined &&
    text.slice(0, first.pos).trim() === "" &&
    /^(?:@generated(?:\s|$)|Generated (?:from|by)\b|Code generated\b)/i.test(
      commentBody(text, first),
    )
  );
}

export function sourceComments(source: ts.SourceFile): ts.CommentRange[] {
  const comments = new Map<number, ts.CommentRange>();
  const visit = (node: ts.Node) => {
    const children = node.getChildren(source);
    if (children.length === 0 && node.kind !== ts.SyntaxKind.JsxText) {
      for (const range of [
        ...(ts.getLeadingCommentRanges(source.text, node.pos) ?? []),
        ...(ts.getTrailingCommentRanges(source.text, node.pos) ?? []),
      ]) {
        comments.set(range.pos, range);
      }
    }
    children.forEach(visit);
  };
  visit(source);
  return [...comments.values()].sort((a, b) => a.pos - b.pos);
}

export function commentBody(text: string, range: ts.CommentRange): string {
  return text
    .slice(range.pos, range.end)
    .replace(/^\/\/|^\/\*+!?|\*\/$/g, "")
    .replace(/^\s*\* ?/gm, "")
    .trim();
}

export function touchesAdded(
  source: ts.SourceFile,
  node: ts.TextRange,
  added: Set<number>,
): boolean {
  const start = source.getLineAndCharacterOfPosition(node.pos).line + 1;
  const end =
    source.getLineAndCharacterOfPosition(Math.max(node.pos, node.end - 1))
      .line + 1;
  for (let line = start; line <= end; line++) {
    if (added.has(line)) return true;
  }
  return false;
}
