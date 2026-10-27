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
const PLUGINS = "server/plugins";
const CHAT_PLUGIN = "agent-chat.ts";
// Dispatch's template re-exports the chat plugin its package defines.
const CHAT_PLUGIN_SOURCE: Record<string, string> = {
  dispatch: "packages/dispatch/src/server/plugins/agent-chat.ts",
};
const STARTER_LAYER = "packages/core/src/templates/builder-code-starter";
// An app can mount MCP itself, as Plan does, with its chat plugin's MCP off.
const MOUNTS_MCP = /\bmountMCP\(/;
const CHAT_MCP_OFF = /\bmcp:\s*\{[^}]*\benabled:\s*false\b/;
const OPTS_IN = /\bappApprovalPage:\s*true\b/;

interface AppShell {
  name: string;
  rootRoute: string;
  pluginDir: string;
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
      pluginDir: path.join(templates, name, PLUGINS),
      chatPlugin: path.join(
        REPO_ROOT,
        CHAT_PLUGIN_SOURCE[name] ??
          path.join("templates", name, PLUGINS, CHAT_PLUGIN),
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
    pluginDir: path.join(scratch, PLUGINS),
    chatPlugin: path.join(scratch, PLUGINS, CHAT_PLUGIN),
  };
}

function readIfPresent(file: string): string {
  // source-read-ok: whether an app's shell renders AppProviders, and whether the plugins that mount its MCP server opt into the app's review page, is the subject.
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

/** Each server plugin, and whether it mounts MCP and opts into the review. */
function serverPlugins(app: AppShell) {
  const files = fs.existsSync(app.pluginDir)
    ? fs
        .readdirSync(app.pluginDir)
        .filter((file) => file.endsWith(".ts") && !file.includes(".spec."))
    : [];
  return files.map((file) => {
    const source = readIfPresent(
      file === CHAT_PLUGIN ? app.chatPlugin : path.join(app.pluginDir, file),
    );
    return {
      file,
      mountsMcp:
        MOUNTS_MCP.test(source) ||
        (file === CHAT_PLUGIN && !CHAT_MCP_OFF.test(source)),
      optsIn: OPTS_IN.test(source),
    };
  });
}

describe("the app's own MCP approval review", () => {
  const apps = [...templateApps(), starterApp()];

  it("checks every chat template, the Builder Code starter, and Plan's own MCP mount", () => {
    expect(apps.map((app) => app.name)).toEqual(
      expect.arrayContaining(["chat", "dispatch", "builder-code-starter"]),
    );
    const plan = apps.find((app) => app.name === "plan");
    expect(serverPlugins(plan!).filter((plugin) => plugin.mountsMcp)).toEqual([
      { file: "00-mcp.ts", mountsMcp: true, optsIn: true },
    ]);
  });

  it.each(apps)(
    "$name opts in where it mounts MCP, exactly when its shell renders AppProviders",
    (app) => {
      const rendersReview = /<AppProviders\b/.test(
        readIfPresent(app.rootRoute),
      );
      const wrong = serverPlugins(app)
        .filter(
          (plugin) => plugin.optsIn !== (rendersReview && plugin.mountsMcp),
        )
        .map((plugin) => plugin.file);
      expect(
        wrong,
        rendersReview
          ? `${app.name} renders AppProviders, so each plugin that mounts MCP should pass appApprovalPage: true, and no other plugin should.`
          : `${app.name} doesn't render AppProviders, so its review links would open a page that shows no review.`,
      ).toEqual([]);
    },
  );
});
