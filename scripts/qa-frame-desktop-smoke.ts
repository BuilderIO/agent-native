import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  [],
  "all public templates should have a production URL; starter is CLI-only",
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
assert.match(
  appWebview,
  /webview-slot--active/,
  "desktop webview slots must mark the active native guest surface explicitly",
);

const desktopShell = read("packages/desktop-app/src/renderer/shell.css");
assert.doesNotMatch(
  desktopShell,
  /\.webview-slot--hidden\s*\{[^}]*visibility:\s*hidden/s,
  "desktop hidden webview slots must not rely on visibility:hidden; Electron can leave stale native-surface pixels composited",
);
assert.match(
  desktopShell,
  /\.webview-slot--hidden\s*\{[^}]*translate3d\(-200vw/s,
  "desktop hidden webview slots must move inactive native guest surfaces offscreen",
);

const desktopApp = read("packages/desktop-app/src/renderer/App.tsx");
assert.match(
  desktopApp,
  /enabledApps\.find\(\(app\) => app\.id === activeSidebarAppId\)/,
  "desktop shell must mount only the active app's webviews to avoid stale Electron native guest surfaces",
);

const frameClient = read("packages/frame/client/App.tsx");
assert.match(
  frameClient,
  /TEMPLATES\.flatMap/,
  "frame client must allow messages from every template dev origin",
);

const devElectronHelp = execFileSync(
  "node",
  ["scripts/dev-electron.ts", "--help"],
  {
    cwd: repoRoot,
    encoding: "utf8",
  },
);
assert.match(
  devElectronHelp,
  /--dry-run/,
  "dev-electron help must document dry-run mode",
);
assert.doesNotMatch(
  devElectronHelp,
  /Starting:/,
  "dev-electron --help must not start apps or Electron",
);

const devElectronDryRun = execFileSync(
  "node",
  ["scripts/dev-electron.ts", "--apps=mail,forms", "--dry-run"],
  {
    cwd: repoRoot,
    encoding: "utf8",
  },
);
assert.match(
  devElectronDryRun,
  /Dry run: mail, forms, frame, electron/,
  "dev-electron dry-run must print the planned app set",
);
assert.match(
  devElectronDryRun,
  /mail: APP_NAME=mail PORT=8085 pnpm --dir templates\/mail exec vite/,
  "dev-electron dry-run must print the mail dev command",
);
assert.match(
  devElectronDryRun,
  /forms: APP_NAME=forms PORT=8084 pnpm --dir templates\/forms exec vite/,
  "dev-electron dry-run must print the forms dev command",
);
assert.doesNotMatch(
  devElectronDryRun,
  /Starting:/,
  "dev-electron dry-run must not start apps or Electron",
);

console.log("qa-frame-desktop-smoke: clean");
