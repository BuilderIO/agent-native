import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function findWorkspaceRoot(startDirectory: string): string {
  let directory = path.resolve(startDirectory);
  while (!existsSync(path.join(directory, "pnpm-workspace.yaml"))) {
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error("Could not find pnpm-workspace.yaml");
    }
    directory = parent;
  }
  return directory;
}

export const workspaceRoot = findWorkspaceRoot(
  path.dirname(fileURLToPath(import.meta.url)),
);
