import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ACTION_ROOTS = [
  new URL("../../../templates/content/actions/", import.meta.url),
  new URL("../../dispatch/src/actions/", import.meta.url),
] as const;

function productionTypeScriptFiles(directoryUrl: URL): string[] {
  const directory = fileURLToPath(directoryUrl);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const childUrl = new URL(
      `${entry.name}${entry.isDirectory() ? "/" : ""}`,
      directoryUrl,
    );
    if (entry.isDirectory()) return productionTypeScriptFiles(childUrl);
    if (
      !entry.name.endsWith(".ts") ||
      entry.name.endsWith(".d.ts") ||
      /\.(?:spec|test)\.ts$/.test(entry.name)
    ) {
      return [];
    }
    return [fileURLToPath(childUrl)];
  });
}

describe("nested action dispatch callsites", () => {
  it("do not call ActionEntry.run directly in Content or Dispatch actions", () => {
    const bypasses = ACTION_ROOTS.flatMap(productionTypeScriptFiles).flatMap(
      (file) => {
        const source = readFileSync(file, "utf8");
        const directRun =
          /\b[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\.\s*run\s*\(/g;
        return Array.from(source.matchAll(directRun)).flatMap((match) => {
          const lineNumber = source.slice(0, match.index).split("\n").length;
          const line = source.split("\n")[lineNumber - 1] ?? "";
          return line.includes("nested-action-dispatch-guard: allow")
            ? []
            : [`${file}:${lineNumber}: ${match[0].replace(/\s+/g, " ")}`];
        });
      },
    );

    expect(
      bypasses,
      "Nested actions must use runActionEntry with inherited invocation/resolver context",
    ).toEqual([]);
  });
});
