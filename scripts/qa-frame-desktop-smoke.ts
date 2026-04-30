import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

interface TemplateEntry {
  name: string;
  devPort: number;
  core: boolean;
  hidden: boolean;
  prodUrl: boolean;
}

function sharedTemplates(): TemplateEntry[] {
  const src = read("packages/shared-app-config/templates.ts");
  return [
    ...src.matchAll(
      /\{\s*name:\s*"([^"]+)"[\s\S]*?devPort:\s*(\d+)[\s\S]*?\}/g,
    ),
  ].map((m) => ({
    name: m[1],
    devPort: Number(m[2]),
    core: /core:\s*true/.test(m[0]),
    hidden: /hidden:\s*true/.test(m[0]),
    prodUrl: /prodUrl:\s*"[^"]+"/.test(m[0]),
  }));
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

const templates = sharedTemplates();

assertSameMembers(
  templates.map((template) => template.name),
  templateDirs,
  "shared template registry must match templates/* package directories",
);

assertSameMembers(
  templateNamesFromSource("packages/core/src/cli/templates-meta.ts"),
  templates.map((template) => template.name),
  "CLI and shared template registries must expose the same template names",
);

assert.equal(
  new Set(templates.map((template) => template.devPort)).size,
  templates.length,
  "template dev ports must be unique",
);

const sharedIndex = read("packages/shared-app-config/index.ts");
assert.match(
  sharedIndex,
  /DEFAULT_APPS:[\s\S]*coreTemplates\(\)\.map/,
  "desktop default apps must be derived from the core template set",
);

assertSameMembers(
  templates
    .filter((template) => template.core)
    .map((template) => template.name),
  [
    "analytics",
    "calendar",
    "clips",
    "content",
    "design",
    "dispatch",
    "forms",
    "mail",
    "slides",
    "starter",
    "videos",
  ],
  "core template set changed; update desktop/default orchestration expectations deliberately",
);

const visibleWithoutProdUrl = templates
  .filter((template) => !template.hidden)
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
  /TEMPLATES\.flatMap/,
  "frame client must allow messages from every template dev origin",
);

console.log("qa-frame-desktop-smoke: clean");
