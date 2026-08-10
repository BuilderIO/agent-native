import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function repositoryRoot(): string {
  let current = process.cwd();
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml")))
      return current;
    current = path.dirname(current);
  }
  throw new Error("Could not locate the repository root.");
}

describe("custom design system example links", () => {
  it("keeps the documented MUI and Ant Design examples present", () => {
    const root = repositoryRoot();
    const docs = fs.readFileSync(
      path.join(root, "packages/core/docs/content/custom-design-system.mdx"),
      "utf8",
    );
    for (const example of ["chat-mui", "chat-antd"]) {
      expect(docs).toContain(
        `https://github.com/BuilderIO/agent-native/tree/main/examples/${example}`,
      );
      expect(
        fs.existsSync(path.join(root, "examples", example, "README.md")),
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(root, "examples", example, "app", "design-system.tsx"),
        ),
      ).toBe(true);
    }
  });
});
