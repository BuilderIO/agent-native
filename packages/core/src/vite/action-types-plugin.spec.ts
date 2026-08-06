import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  actionTypesPlugin,
  generateActionRegistryForProject,
} from "./action-types-plugin.js";

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
      fs.writeFileSync(
        path.join(actionsDir, "factory-action.ts"),
        `import { createProviderApiCatalogAction } from "@agent-native/core/provider-api/actions/provider-api";\nexport default createProviderApiCatalogAction({} as any, {} as any);\n`,
      );

      generateActionRegistryForProject(root);

      const registry = fs.readFileSync(
        path.join(root, ".generated", "actions-registry.ts"),
        "utf-8",
      );
      expect(registry).toContain('"real-action": a_real_action');
      expect(registry).toContain('"factory-action": a_factory_action');
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

  it("refreshes the server registry when an action file changes it", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "an-action-watch-"));
    const watcher = new EventEmitter() as EventEmitter & {
      add: (path: string) => void;
    };
    watcher.add = vi.fn();
    const restart = vi.fn().mockResolvedValue(undefined);
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
    };

    try {
      const actionsDir = path.join(root, "actions");
      fs.mkdirSync(actionsDir);
      fs.writeFileSync(path.join(root, ".gitignore"), "");

      const plugin = actionTypesPlugin();
      plugin.configResolved?.({ root } as any);
      const registryModule = {};
      const invalidateModule = vi.fn();
      const send = vi.fn();
      await plugin.configureServer?.({
        config: { logger },
        httpServer: new EventEmitter(),
        environments: {
          nitro: {
            config: { consumer: "server" },
            hot: { send },
            moduleGraph: {
              getModuleById: (id: string) =>
                id === path.join(root, ".generated", "actions-registry.ts")
                  ? registryModule
                  : undefined,
              invalidateModule,
            },
          },
        },
        restart,
        watcher,
      } as any);

      const actionPath = path.join(actionsDir, "create-note.ts");
      fs.writeFileSync(
        actionPath,
        `import { defineAction } from "@agent-native/core";\nexport default defineAction({ tool: { description: "Create a note", parameters: { type: "object", properties: {} } }, run: async () => ({ ok: true }) });\n`,
      );
      watcher.emit("add", actionPath);

      await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
      expect(restart).not.toHaveBeenCalled();
      expect(invalidateModule).toHaveBeenCalledWith(registryModule);
      expect(send).toHaveBeenCalledWith({ type: "full-reload" });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("refreshing the server action registry"),
        { timestamp: true },
      );
      expect(
        fs.readFileSync(
          path.join(root, ".generated", "actions-registry.ts"),
          "utf-8",
        ),
      ).toContain('"create-note"');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
