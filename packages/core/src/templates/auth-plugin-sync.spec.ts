import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function workspaceRoot(): string {
  let current = process.cwd();
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) {
      return current;
    }
    current = path.dirname(current);
  }
  throw new Error("Could not locate workspace root.");
}

const ROOT = workspaceRoot();

function authPluginPaths(): Array<[name: string, file: string]> {
  const templatesRoot = path.join(ROOT, "templates");
  const templatePlugins = fs
    .readdirSync(templatesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => {
      const templatePlugin = path.join(
        templatesRoot,
        entry.name,
        "server/plugins/auth.ts",
      );
      if (!fs.existsSync(templatePlugin)) return null;
      const implementation =
        entry.name === "dispatch"
          ? path.join(ROOT, "packages/dispatch/src/server/plugins/auth.ts")
          : templatePlugin;
      return [entry.name, implementation] as const;
    })
    .filter((entry): entry is readonly [string, string] => entry !== null)
    .sort(([a], [b]) => a.localeCompare(b));

  return [
    [
      "core default",
      path.join(
        ROOT,
        "packages/core/src/templates/default/server/plugins/auth.ts",
      ),
    ],
    ["Docs", path.join(ROOT, "packages/docs/server/plugins/auth.ts")],
    ...templatePlugins,
  ];
}

describe("first-party auth plugin sync", () => {
  it("uses the shared server-rendered Toolkit auth page across templates", () => {
    const violations: string[] = [];

    for (const [name, file] of authPluginPaths()) {
      const source = fs.readFileSync(file, "utf-8");
      if (
        !source.includes("@agent-native/toolkit/app/auth/server") ||
        !/\bcreateToolkitAuthPlugin\s*\(/.test(source) ||
        /\bcreateAuthPlugin\s*\(/.test(source)
      ) {
        violations.push(name);
      }
    }

    expect(
      violations,
      [
        "First-party sign-in pages must use Toolkit's server-rendered AuthPage",
        "so every signup surface keeps the shared wave and avoids the generic flash.",
        ...violations,
      ].join("\n"),
    ).toEqual([]);
  });
});
