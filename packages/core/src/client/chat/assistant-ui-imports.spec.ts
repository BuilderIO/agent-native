import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(import.meta.dirname, "../../..");
const workspaceRoot = path.resolve(packageRoot, "../..");

describe("assistant-ui imports", () => {
  it("uses the React package's store context instead of a separately bundled store", () => {
    const messageComponents = fs.readFileSync(
      path.join(packageRoot, "src/client/chat/message-components.tsx"),
      "utf8",
    );
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const workspace = fs.readFileSync(
      path.join(workspaceRoot, "pnpm-workspace.yaml"),
      "utf8",
    );

    expect(messageComponents).not.toContain('from "@assistant-ui/store"');
    expect(packageJson.dependencies?.["@assistant-ui/store"]).toBe("catalog:");
    expect(packageJson.devDependencies?.["@assistant-ui/store"]).toBe(
      "catalog:",
    );
    expect(workspace).toContain('"@assistant-ui/store": 0.2.13');
  });
});
