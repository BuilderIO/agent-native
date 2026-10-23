import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  applyTemplateLayer,
  readTemplateLayer,
} from "../cli/template-layer.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../",
);
const ROOT_ROUTE = "app/root.tsx";
const CHAT_PLUGIN = "server/plugins/agent-chat.ts";
// Dispatch's template re-exports the chat plugin its package defines.
const CHAT_PLUGIN_SOURCE: Record<string, string> = {
  dispatch: "packages/dispatch/src/server/plugins/agent-chat.ts",
};
const STARTER_LAYER = "packages/core/src/templates/builder-code-starter";

interface AppShell {
  name: string;
  rootRoute: string;
  chatPlugin: string;
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "app-approval-page-"));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

function templateApps(): AppShell[] {
  const templates = path.join(REPO_ROOT, "templates");
  return fs
    .readdirSync(templates, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => ({
      name,
      rootRoute: path.join(templates, name, ROOT_ROUTE),
      chatPlugin: path.join(
        REPO_ROOT,
        CHAT_PLUGIN_SOURCE[name] ?? path.join("templates", name, CHAT_PLUGIN),
      ),
    }))
    .filter(
      (app) => fs.existsSync(app.rootRoute) || fs.existsSync(app.chatPlugin),
    );
}

/** The Builder Code starter as its layer writes it over its base template. */
function starterApp(): AppShell {
  const layerDir = path.join(REPO_ROOT, STARTER_LAYER);
  const layer = readTemplateLayer(layerDir);
  if (!layer) throw new Error(`${STARTER_LAYER} is not a template layer.`);
  for (const dir of ["app", "server"]) {
    fs.cpSync(
      path.join(REPO_ROOT, "templates", layer.base, dir),
      path.join(scratch, dir),
      { recursive: true },
    );
    applyTemplateLayer(layerDir, layer, scratch, { only: dir });
  }
  return {
    name: "builder-code-starter",
    rootRoute: path.join(scratch, ROOT_ROUTE),
    chatPlugin: path.join(scratch, CHAT_PLUGIN),
  };
}

function readIfPresent(file: string): string {
  // source-read-ok: whether an app's shell renders AppProviders, and whether its chat plugin opts into the app's review page, is the subject.
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

describe("the app's own MCP approval review", () => {
  const apps = [...templateApps(), starterApp()];

  it("checks every chat template and the Builder Code starter", () => {
    expect(apps.map((app) => app.name)).toEqual(
      expect.arrayContaining(["chat", "dispatch", "builder-code-starter"]),
    );
  });

  it.each(apps)(
    "$name opts in exactly when its shell renders AppProviders",
    (app) => {
      const rendersReview = /<AppProviders\b/.test(
        readIfPresent(app.rootRoute),
      );
      const optsIn = /\bappApprovalPage:\s*true\b/.test(
        readIfPresent(app.chatPlugin),
      );
      expect(
        optsIn,
        rendersReview
          ? `${app.name} renders AppProviders, so its chat plugin should pass mcp: { appApprovalPage: true }.`
          : `${app.name} doesn't render AppProviders, so its review links would open a page that shows no review.`,
      ).toBe(rendersReview);
    },
  );
});
