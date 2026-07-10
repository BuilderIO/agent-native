import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { generateActionRegistryForProject } from "./action-types-plugin.js";

describe("generateActionRegistryForProject", () => {
  it("does not import test files from actions/ into the runtime registry", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-action-registry-"));
    try {
      const actionsDir = path.join(root, "actions");
      fs.mkdirSync(actionsDir);
      fs.writeFileSync(path.join(root, ".gitignore"), "");
      fs.writeFileSync(
        path.join(actionsDir, "real-action.ts"),
        `import { defineAction } from "@agent-native/core";\nexport default defineAction({ tool: { description: "ok", parameters: {} }, run: async () => ({ ok: true }) });\n`,
      );
      fs.writeFileSync(
        path.join(actionsDir, "real-action.spec.ts"),
        `// Regression guard: mentioning defineAction here must not import this file.\nexport default {};\n`,
      );
      fs.writeFileSync(
        path.join(actionsDir, "other.test.ts"),
        `const text = "defineAction";\nexport default {};\n`,
      );

      generateActionRegistryForProject(root);

      const registry = fs.readFileSync(
        path.join(root, ".generated", "actions-registry.ts"),
        "utf-8",
      );
      expect(registry).toContain('"real-action": a_real_action');
      expect(registry).toContain('"get-localization-preference"');
      expect(registry).toContain('"set-localization-preference"');
      expect(registry).toContain('"list-resource-history"');
      expect(registry).toContain('"list-review-comments"');
      expect(registry).not.toContain("real-action.spec");
      expect(registry).not.toContain("other.test");

      const types = fs.readFileSync(
        path.join(root, ".generated", "action-types.d.ts"),
        "utf-8",
      );
      expect(types).toContain('"get-localization-preference"');
      expect(types).toContain('"set-localization-preference"');
      expect(types).toContain('"list-resource-history"');
      expect(types).toContain('"list-review-comments"');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
