import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import ts from "typescript";

import { pnpmCommand } from "./lib/pnpm-command.ts";

function usesVitest(file: string): boolean {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
  );
  return source.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "vitest"
    )
      return false;

    const clause = statement.importClause;
    if (!clause) return true;
    if (clause.isTypeOnly) return false;
    const bindings = clause.namedBindings;
    if (!clause.name && bindings && ts.isNamedImports(bindings)) {
      return (
        bindings.elements.length === 0 ||
        bindings.elements.some((binding) => !binding.isTypeOnly)
      );
    }
    return true;
  });
}

const selection = process.env.SCRIPT_TESTS;
if (selection === undefined) {
  throw new Error("SCRIPT_TESTS must be set.");
}
const selected: unknown = JSON.parse(selection);
if (
  !Array.isArray(selected) ||
  !selected.every((file: unknown) => typeof file === "string")
) {
  throw new Error("SCRIPT_TESTS must be a JSON array of file paths.");
}

const nodeTests: string[] = [];
const vitestTests: string[] = [];
for (const file of selected) {
  (usesVitest(file) ? vitestTests : nodeTests).push(file);
}

for (const { files, runner } of [
  { files: nodeTests, runner: ["tsx", "--test"] },
  { files: vitestTests, runner: ["vitest", "run"] },
]) {
  if (files.length === 0) continue;
  const command = pnpmCommand(["exec", ...runner, ...files]);
  const result = spawnSync(command.command, command.args, {
    shell: command.shell,
    stdio: "inherit",
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exitCode = 1;
}
