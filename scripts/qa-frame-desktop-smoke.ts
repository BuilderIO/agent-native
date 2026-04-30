import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as sharedConfig from "../packages/shared-app-config/index.ts";

const {
  DEFAULT_APPS,
  TEMPLATE_APPS,
  TEMPLATES,
  coreTemplates,
  visibleTemplates,
} = sharedConfig;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(file: string): string {
  return fs.readFileSync(path.join(repoRoot, file), "utf8");
}

function templateNamesFromSource(file: string): string[] {
  return [...read(file).matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
}

function assertSameMembers(
  actual: string[],
  expected: string[],
  message: string,
): void {
  assert.deepEqual([...actual].sort(), [...expected].sort(), message);
}

const templateDirs = fs
  .readdirSync(path.join(repoRoot, "templates"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) =>
    fs.existsSync(path.join(repoRoot, "templates", name, "package.json")),
  );

assertSameMembers(
  TEMPLATES.map((template) => template.name),
  templateDirs,
  "shared template registry must match templates/* package directories",
);

assertSameMembers(
  templateNamesFromSource("packages/core/src/cli/templates-meta.ts"),
  TEMPLATES.map((template) => template.name),
  "CLI and shared template registries must expose the same template names",
);

assert.equal(
  new Set(TEMPLATES.map((template) => template.devPort)).size,
  TEMPLATES.length,
  "template dev ports must be unique",
);

assertSameMembers(
  DEFAULT_APPS.map((app) => app.id),
  coreTemplates().map((template) => template.name),
  "desktop default apps must be exactly the core template set",
);

assertSameMembers(
  TEMPLATE_APPS.map((app) => app.id),
  TEMPLATES.map((template) => template.name),
  "template app configs must cover every template for frame/dev routing",
);

const visibleWithoutProdUrl = visibleTemplates()
  .filter((template) => !template.prodUrl)
  .map((template) => template.name);
assert.deepEqual(
  visibleWithoutProdUrl,
  ["starter"],
  "starter should be the only visible template without a production URL",
);

const appWebview = read(
  "packages/desktop-app/src/renderer/components/AppWebview.tsx",
);
assert.match(
  appWebview,
  /appConfig\.devUrl\?\.trim\(\)/,
  "desktop dev-mode URL resolution must honor custom devUrl values",
);
assert.match(
  appWebview,
  /setAttribute\("src", url\)/,
  "desktop webview must update its src when app URL/mode changes",
);

const frameClient = read("packages/frame/client/App.tsx");
assert.match(
  frameClient,
  /TEMPLATES\.map/,
  "frame client must allow messages from every template dev origin",
);

console.log("qa-frame-desktop-smoke: clean");
