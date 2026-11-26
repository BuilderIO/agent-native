import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import { GUARD_EXIT_COULD_NOT_RUN } from "./lib/changed-lines.mjs";
import {
  bindSource,
  commentBody,
  isGeneratedSource,
  isHandwrittenSource,
  isTestSource,
  requireSourceChanges,
  sourceComments,
  touchesAdded,
} from "./lib/guard-source.ts";

const GUARD = "guard:new-prose-comments";
const rootDir = path.resolve(import.meta.dirname, "..");

const DIRECTIVES = [
  /^(?:eslint|oxlint)-(?:disable|enable)(?:-next-line|-line)?(?:\s+[^\n]+)?$/,
  /^@ts-(?:expect-error|ignore|nocheck|check)(?:\s+[^\n]+)?$/,
  /^(?:prettier|oxfmt)-ignore(?:-start|-end)?$/,
  /^(?:c8|v8|istanbul) ignore (?:next(?: \d+)?|start|stop|file|if|else)(?: -- [^\n]+)?$/,
  /^(?:@|#)__(?:PURE|NO_SIDE_EFFECTS|INLINE|NOINLINE)__$/,
  /^@vite-ignore$/,
  /^@vitest-environment \S+$/,
  /^webpack(?:ChunkName|Mode|Prefetch|Preload|Ignore|Include|Exclude|Exports|FetchPriority):[^\n]+$/,
  /^@jsx(?:Frag|ImportSource|Runtime)? \S+$/,
  /^\/\s*<(?:reference|amd-module|amd-dependency)\s[^\n]+\/>$/,
  /^#\s*source(?:Mapping)?URL=\S+$/,
  /^nosemgrep(?::[^\n]+)?$/,
  /^(?:source-read-ok|wall-clock-ok|fixed-sleep-ok|coercion-ok|raw-sql-ok|observed-write-ok|agent-native-brand-ok|settings-key-unused-ok|i18n-copy-ignore|oracle-change(?:\([^)\n]+\))?|oracle finding): [^\n]{10,}$/,
];

const GUARD_ALLOW_DIRECTIVES = new Set([
  "action-twin",
  "api-route",
  "bare-error",
  "bare-pnpm",
  "blob-predicate",
  "blocking-column-default",
  "boot-data-work",
  "card-description",
  "chat-send-gate",
  "copy-links",
  "deferred-count",
  "destructive-ddl",
  "duplicate-search-clear",
  "empty-copy-fallback",
  "empty-migrations",
  "env-credential",
  "env-mutation",
  "error-string",
  "extension-public",
  "eyebrow",
  "heavy-dashboard-list-read",
  "identity-column",
  "large-help-icon",
  "localhost-fallback",
  "no-output-schema",
  "part-geometry",
  "plaintext-secret-column",
  "raw-color",
  "realtime-opt-in",
  "required-description",
  "resource-action-access",
  "result-contract",
  "secret-literal",
  "serverless-function-payload",
  "ssr-shell-exception",
  "unbounded-read",
  "unreleased-schema",
  "unscoped",
  "unscoped-credential",
]);

function isDirective(body: string): boolean {
  if (/[\r\n]/.test(body)) return false;
  const guard = /^guard:allow-([a-z-]+)(?:\s|$)/.exec(body)?.[1];
  return guard
    ? GUARD_ALLOW_DIRECTIVES.has(guard)
    : DIRECTIVES.some((pattern) => pattern.test(body));
}

function publicDocs(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
): Set<number> {
  const documented = new Set<number>();
  const roots = new Set<ts.Node>();
  const module = checker.getSymbolAtLocation(source);
  if (module) {
    for (let symbol of checker.getExportsOfModule(module)) {
      if (symbol.flags & ts.SymbolFlags.Alias)
        symbol = checker.getAliasedSymbol(symbol);
      for (const declaration of symbol.declarations ?? []) {
        if (declaration.getSourceFile() !== source) continue;
        roots.add(
          ts.isVariableDeclaration(declaration)
            ? declaration.parent.parent
            : declaration,
        );
      }
    }
  } else if (source.isDeclarationFile) {
    source.statements.forEach((statement) => roots.add(statement));
  }
  const hidden = (node: ts.Node): boolean => {
    const flags = ts.canHaveModifiers(node)
      ? ts.getCombinedModifierFlags(node as ts.Declaration)
      : 0;
    return (
      Boolean(
        flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected),
      ) ||
      ("name" in node &&
        node.name !== undefined &&
        ts.isPrivateIdentifier(node.name as ts.Node)) ||
      ts
        .getJSDocTags(node)
        .some(
          (tag) =>
            tag.tagName.text === "internal" || tag.tagName.text === "private",
        )
    );
  };
  const references = (node: ts.Node) => {
    if (hidden(node) || ts.isBlock(node)) return;
    if (ts.isTypeReferenceNode(node)) {
      const symbol = checker.getSymbolAtLocation(node.typeName);
      for (const declaration of symbol?.declarations ?? []) {
        if (
          declaration.getSourceFile() === source &&
          (ts.isTypeAliasDeclaration(declaration) ||
            ts.isInterfaceDeclaration(declaration))
        )
          roots.add(declaration);
      }
    }
    ts.forEachChild(node, references);
  };
  for (const root of roots) references(root);
  const visit = (node: ts.Node, exposed: boolean) => {
    const visible = !hidden(node) && (roots.has(node) || exposed);
    if (visible) {
      for (const doc of ts.getJSDocCommentsAndTags(node)) {
        if (
          ts.isJSDoc(doc) &&
          !/@(?:internal|private)\b/.test(doc.getText(source))
        )
          documented.add(doc.pos);
      }
    }
    const container =
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isTypeLiteralNode(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node) ||
      ts.isModuleBlock(node) ||
      ts.isTypeNode(node) ||
      ts.isPropertySignature(node);
    ts.forEachChild(node, (child) => visit(child, visible && container));
  };
  visit(source, false);
  return documented;
}

export function findNewProseComments(
  file: string,
  text: string,
  added: Set<number>,
  publicApi = false,
) {
  if (!isHandwrittenSource(file) || isGeneratedSource(text)) return [];
  const { source, checker } = bindSource(file, text);
  const comments = sourceComments(source);
  const docs = publicApi ? publicDocs(source, checker) : new Set<number>();
  return comments.flatMap((comment) => {
    if (!touchesAdded(source, comment, added)) return [];
    const body = commentBody(text, comment);
    const legal =
      /^(?:SPDX-(?:License-Identifier|FileCopyrightText):|@license\b|@preserve\b|Copyright\b)/i.test(
        body,
      );
    if (!body || legal || isDirective(body) || docs.has(comment.pos)) return [];
    return [
      {
        file,
        line: source.getLineAndCharacterOfPosition(comment.pos).line + 1,
      },
    ];
  });
}

function isPublicPackage(file: string): boolean {
  const packageName = /^packages\/([^/]+)\//.exec(file)?.[1];
  if (!packageName || isTestSource(file) || /(?:^|\/)scripts\//.test(file))
    return false;
  const manifest = JSON.parse(
    readFileSync(
      path.join(rootDir, "packages", packageName, "package.json"),
      "utf8",
    ),
  ) as { private?: boolean };
  return manifest.private !== true;
}

function main() {
  try {
    const added = requireSourceChanges(rootDir, GUARD);
    const findings = [...added].flatMap(([absolute, lines]) => {
      const file = path.relative(rootDir, absolute).replaceAll("\\", "/");
      if (!isHandwrittenSource(file)) return [];
      return findNewProseComments(
        file,
        readFileSync(absolute, "utf8"),
        lines,
        isPublicPackage(file),
      );
    });
    if (findings.length) {
      console.error(
        `${GUARD}: remove new prose comments; express behavior in code and rationale in the PR.\nKeep public API TSDoc, legal notices, and tool directives.`,
      );
      findings.forEach((finding) =>
        console.error(`  ${finding.file}:${finding.line}`),
      );
      process.exitCode = 1;
    } else console.log(`${GUARD}: OK (no new prose comments)`);
  } catch (error) {
    console.error(
      `${GUARD}: could not run - ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = GUARD_EXIT_COULD_NOT_RUN;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
