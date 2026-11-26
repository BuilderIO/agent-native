import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const rootDir = path.resolve(import.meta.dirname, "..");
const GUARD = "guard:no-duplicate-vi-mock";

export interface DuplicateMock {
  file: string;
  specifier: string;
  lines: number[];
}

function mockedSpecifier(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (
    !ts.isPropertyAccessExpression(callee) ||
    !ts.isIdentifier(callee.expression) ||
    callee.expression.text !== "vi" ||
    callee.name.text !== "mock"
  ) {
    return undefined;
  }
  const [target] = call.arguments;
  if (target && ts.isStringLiteralLike(target)) return target.text;
  if (
    target &&
    ts.isCallExpression(target) &&
    target.expression.kind === ts.SyntaxKind.ImportKeyword
  ) {
    const [specifier] = target.arguments;
    if (specifier && ts.isStringLiteralLike(specifier)) return specifier.text;
  }
  return undefined;
}

export function findDuplicateMocks(
  file: string,
  source: string,
): DuplicateMock[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    false,
  );
  const linesBySpecifier = new Map<string, number[]>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const specifier = mockedSpecifier(node);
      if (specifier !== undefined) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        );
        linesBySpecifier.set(specifier, [
          ...(linesBySpecifier.get(specifier) ?? []),
          line + 1,
        ]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...linesBySpecifier]
    .filter(([, lines]) => lines.length > 1)
    .map(([specifier, lines]) => ({ file, specifier, lines }));
}

function filesCallingViMock(root: string): string[] {
  try {
    return execFileSync(
      "git",
      [
        "grep",
        "-l",
        "-z",
        "-F",
        "vi.mock(",
        "--",
        "*.ts",
        "*.tsx",
        "*.mts",
        "*.cts",
        "*.js",
        "*.jsx",
        "*.mjs",
        "*.cjs",
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    )
      .split("\0")
      .filter(Boolean);
  } catch (error) {
    // git grep exits 1 when nothing matches; that still inspected nothing.
    if ((error as { status?: number }).status === 1) return [];
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let files: string[];
  try {
    files = filesCallingViMock(rootDir);
  } catch (error) {
    console.error(
      `[${GUARD}] could not list files: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(2);
  }
  if (files.length === 0) {
    console.error(
      `[${GUARD}] found no file that calls vi.mock, so nothing was checked.`,
    );
    process.exit(2);
  }

  const duplicates = files.flatMap((file) =>
    findDuplicateMocks(file, readFileSync(path.join(rootDir, file), "utf8")),
  );
  if (duplicates.length > 0) {
    console.error(
      `[${GUARD}] ${duplicates.length} module(s) mocked more than once in the same file:`,
    );
    for (const { file, specifier, lines } of duplicates) {
      console.error(`- ${file}: "${specifier}" at lines ${lines.join(", ")}`);
    }
    console.error(
      "Vitest hoists every vi.mock and registers them in parallel, so when a file mocks one path twice, whichever registers last wins, and that can change from run to run. Keep one vi.mock per path. To vary a mock between tests, change its vi.fn() in beforeEach or use vi.doMock.",
    );
    process.exit(1);
  }

  console.log(
    `[${GUARD}] each of ${files.length} files mocks a module at most once`,
  );
}
