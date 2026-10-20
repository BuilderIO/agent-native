// Builds one prototype into a single self-contained page: prototypes/<name>/dist/index.html.
// Run: node prototypes/kit/build.ts <name>
//
// Placeholders in <name>/source.html:
//   __KIT_HEAD__    the font link, the template's tokens read from the code, and kit/base.css
//   __KIT_SCRIPT__  kit/ui.ts and kit/changes.ts with their types stripped, with KIT_ICONS from kit/icons.json
//                   plus <name>/icons.json, and KIT_SETTINGS from kit/settings.json plus <name>/settings.json
//                   and KIT_CHANGES from <name>/changes.json
//   __LOGO__        the Agent-Native logo (__LOGO_SMALL__ at 20 × 12)
//   __FOO__         any other placeholder is filled from <name>/foo.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LOGO =
  '<svg width="24" height="14" viewBox="0 0 24 14" aria-hidden="true"><path d="M5.1692 13.9511H0L3.17598 8.37071L7.93853 0L12.735 8.37071H8.34518L5.1692 13.9511Z" fill="currentColor"/><path d="M18.8307 0H24L16.0615 13.9513H10.8923L18.8307 0Z" fill="currentColor"/></svg>';
const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;550;600;700&display=swap">';

const kit = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2];
if (!name) throw new Error("Usage: node prototypes/kit/build.ts <name>");
const dir = join(kit, "..", name);
const read = (path: string) => readFileSync(path, "utf8");

interface Change {
  date: string;
  text: string;
}

// A malformed entry fails the build rather than vanishing from the drawer.
function loadChanges(): Change[] {
  const changes = JSON.parse(read(join(dir, "changes.json"))) as Change[];
  if (!Array.isArray(changes)) throw new Error("changes.json must be an array");
  changes.forEach((change, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(change.date))
      throw new Error(`changes.json[${i}]: date must be YYYY-MM-DD`);
    if (!change.text?.trim())
      throw new Error(`changes.json[${i}]: text is empty`);
    if (i > 0 && change.date > changes[i - 1].date)
      throw new Error(`changes.json[${i}]: entries must run newest first`);
  });
  return changes;
}

// The tokens come from the code, never from copies: the toolkit's shared tokens and its Tailwind @theme
// (the --color-* names), then the template's own theme. Only exact `:root`, `.dark`, `.light`, `@media (prefers-color-scheme: dark) { :root }`, and `@theme` rules
// (and `:root` inside `@supports`) are read, and only their custom properties. `.dark` becomes the prototype's dark selectors, since a prototype follows the
// viewer's color scheme or the review strip's Theme switch instead of a class.
const repo = join(kit, "../..");
// A prototype adds sources beyond the template's global.css with "tokens" in prototype.json (Clips desktop
// reads its renderer's own CSS).
const TOKEN_SOURCES = (template: string, extra: string[] = []) => [
  "packages/toolkit/src/app/styles/tokens/agent-kit.css",
  "packages/toolkit/src/app/styles/agent-native.css",
  "packages/toolkit/src/app/agentkit/react/styles.css",
  `templates/${template}/app/global.css`,
  ...extra,
];

function topLevelRules(css: string): { selector: string; body: string }[] {
  const rules: { selector: string; body: string }[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    const semi = css.indexOf(";", i);
    if (open < 0) break;
    // An at-rule without a block (@import, @source, @plugin) ends at its semicolon.
    if (semi >= 0 && semi < open) {
      i = semi + 1;
      continue;
    }
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    rules.push({
      selector: css.slice(i, open).trim(),
      body: css.slice(open + 1, j - 1),
    });
    i = j;
  }
  return rules;
}

const customProperties = (body: string) =>
  body
    .split(/;(?![^(]*\))/)
    .map((decl) => decl.trim().replace(/\s+/g, " "))
    .filter((decl) => decl.startsWith("--"));

function tokensCss(template: string, extra: string[] = []): string {
  const light: string[] = [];
  const dark: string[] = [];
  const supports: string[] = [];
  for (const source of TOKEN_SOURCES(template, extra)) {
    const css = read(join(repo, source)).replace(/\/\*[\s\S]*?\*\//g, "");
    const root: string[] = [];
    const lightOnly: string[] = [];
    const darkOnly: string[] = [];
    for (const rule of topLevelRules(css)) {
      // AgentKit scopes its chat tokens to `:where(.agentkit-chat)`; they're var() chains, so :root is safe.
      if (
        rule.selector === ":root" ||
        rule.selector === ":where(.agentkit-chat)" ||
        rule.selector.startsWith("@theme")
      )
        root.push(...customProperties(rule.body));
      else if (rule.selector === ".dark")
        darkOnly.push(...customProperties(rule.body));
      else if (rule.selector === ".light")
        lightOnly.push(...customProperties(rule.body));
      else if (
        /^@media\s*\(prefers-color-scheme:\s*dark\)$/.test(rule.selector)
      ) {
        // A dark palette written as a media query (Clips desktop's renderer CSS).
        for (const r of topLevelRules(rule.body).filter(
          (x) => x.selector === ":root",
        ))
          darkOnly.push(...customProperties(r.body));
      } else if (rule.selector.startsWith("@supports")) {
        const inner = topLevelRules(rule.body).filter(
          (r) => r.selector === ":root",
        );
        for (const r of inner)
          supports.push(
            `${rule.selector} { :root { ${customProperties(r.body).join("; ")}; } }`,
          );
      }
    }
    // A theme that ships dark puts its dark palette on :root and the light one on `.light` (Slides does):
    // there, :root is the dark theme and light is :root with `.light` on top.
    if (lightOnly.length) {
      light.push(...root, ...lightOnly);
      dark.push(...root, ...darkOnly);
    } else {
      light.push(...root);
      dark.push(...darkOnly);
    }
  }
  if (!light.length)
    throw new Error(`No :root tokens found for template "${template}"`);
  const block = (decls: string[]) => decls.map((d) => `  ${d};`).join("\n");
  return [
    `/* Generated from ${TOKEN_SOURCES(template, extra).join(", ")} by kit/build.ts. */`,
    `:root {\n${block(light)}\n}`,
    ...supports,
    `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {\n${block(dark)}\n  color-scheme: dark;\n  }\n}`,
    `:root[data-theme="dark"] {\n${block(dark)}\n  color-scheme: dark;\n}`,
  ].join("\n");
}

const config = JSON.parse(read(join(dir, "prototype.json"))) as {
  template?: string;
};
if (!config.template)
  throw new Error(
    `${name}/prototype.json needs "template", the folder under templates/ whose theme it uses`,
  );

const changes = loadChanges();

// Settings: the kit's shared pages plus the prototype's own App pages, which replace a kit page with the same id.
function loadSettings() {
  const own = join(dir, "settings.json");
  if (!existsSync(own)) return null;
  const base = JSON.parse(read(join(kit, "settings.json")));
  const app = JSON.parse(read(own)) as {
    app: string;
    icon?: string;
    pages: { id: string; g?: string }[];
  };
  if (!app.app)
    throw new Error(
      `${name}/settings.json needs "app", the name Settings shows for the app group`,
    );
  const appPages = new Map(
    base.pages
      .filter((p: { g: string }) => p.g === "app")
      .map((p: { id: string }) => [p.id, p]),
  );
  for (const page of app.pages) appPages.set(page.id, { ...page, g: "app" });
  const order = (id: string) => base.appOrder.indexOf(id) + 1 || 99;
  return {
    groups: base.groups.map(
      ([g, label, icon]: [string, string, string | null]) =>
        g === "app" ? [g, app.app, app.icon ?? null] : [g, label, icon],
    ),
    pages: [
      ...base.pages.filter((p: { g: string }) => p.g !== "app"),
      ...[...appPages.values()].sort(
        (a: any, b: any) => order(a.id) - order(b.id),
      ),
    ],
  };
}
const settings = loadSettings();
const script = (file: string) => stripTypeScriptTypes(read(join(kit, file)));
// A prototype's own icons.json (written by kit/add-icons.ts) adds to the kit's set.
const icons = {
  ...JSON.parse(read(join(kit, "icons.json"))),
  ...(existsSync(join(dir, "icons.json"))
    ? JSON.parse(read(join(dir, "icons.json")))
    : {}),
};
// Function replacements, so `$&`, `$'`, and `$$` in the inlined code stay literal.
const fills: [string, string][] = [
  [
    "__KIT_HEAD__",
    `${FONTS}\n<style>\n${tokensCss(config.template, config.tokens)}\n${read(join(kit, "base.css"))}\n${read(join(kit, "ui.css"))}\n${read(join(kit, "settings.css"))}</style>`,
  ],
  [
    "__KIT_SCRIPT__",
    `<script>\nconst KIT_ICONS = ${JSON.stringify(icons)};\nconst KIT_CHANGES = ${JSON.stringify(changes)};\nconst KIT_SETTINGS = ${JSON.stringify(settings)};\n${script("ui.ts")}\n${script("changes.ts")}\n${script("settings.ts")}</script>`,
  ],
  [
    "__LOGO_SMALL__",
    LOGO.replace('width="24" height="14"', 'width="20" height="12"'),
  ],
  ["__LOGO__", LOGO],
];
let html = read(join(dir, "source.html"));
for (const [placeholder, value] of fills)
  html = html.replaceAll(placeholder, () => value);

html = html.replace(/__([A-Z]+)__/g, (placeholder, key: string) => {
  const file = join(dir, `${key.toLowerCase()}.json`);
  if (!existsSync(file))
    throw new Error(`${placeholder} has no ${name}/${key.toLowerCase()}.json`);
  return read(file);
});

mkdirSync(join(dir, "dist"), { recursive: true });
writeFileSync(join(dir, "dist/index.html"), html);
console.log(`Built ${name}/dist/index.html with ${changes.length} changes.`);
