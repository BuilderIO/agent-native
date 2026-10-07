#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "scripts/figma-oracle-page-bridge");
const BUILD = path.join(ROOT, ".tmp/figma-oracle-page-bridge-build");

function manifestPathFromArgs(args: string[]): string {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  const [flag, value, ...rest] = normalized;
  if (
    rest.length > 0 ||
    (flag && flag !== "--manifest") ||
    (flag === "--manifest" && !value)
  ) {
    throw new Error(
      "usage: pnpm design:oracle-page-bridge -- --manifest <Figma-development-plugin-manifest.json>",
    );
  }
  return path.resolve(
    ROOT,
    value ?? ".tmp/figma-oracle-page-bridge/manifest.json",
  );
}

function compile(source: string): string {
  execFileSync(
    "pnpm",
    [
      "exec",
      "tsc",
      "--target",
      "ES2020",
      "--lib",
      "ES2020,DOM",
      "--module",
      "ES2020",
      "--skipLibCheck",
      "--outDir",
      BUILD,
      path.join(SOURCE, source),
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  return readFileSync(path.join(BUILD, source.replace(/\.ts$/, ".js")), "utf8");
}

const manifestPath = manifestPathFromArgs(process.argv.slice(2));
if (!existsSync(manifestPath)) {
  throw new Error(
    `Figma development plugin manifest is missing at ${path.relative(ROOT, manifestPath)}; create a Custom UI development plugin in Figma Desktop first, then build the bridge into its directory`,
  );
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
  string,
  unknown
>;
if (typeof manifest.id !== "string" || !/^\d{12,}$/.test(manifest.id)) {
  throw new Error(
    "Figma development plugin manifest must contain its Figma-assigned numeric id",
  );
}
const pluginId = manifest.id;
const outputDir = path.dirname(manifestPath);
mkdirSync(BUILD, { recursive: true });
const uiScript = compile("ui.ts").replaceAll(
  "__FIGMA_ORACLE_PLUGIN_ID__",
  pluginId,
);
const htmlTemplate = readFileSync(path.join(SOURCE, "ui.html"), "utf8");
if (!htmlTemplate.includes("<!-- ORACLE_UI_SCRIPT -->")) {
  throw new Error("oracle page bridge UI script marker is missing");
}
const html = htmlTemplate.replace(
  "<!-- ORACLE_UI_SCRIPT -->",
  `<script>${uiScript}</script>`,
);
const compiledPlugin = compile("plugin.ts");
if (!compiledPlugin.includes("figma.showUI(__html__,")) {
  throw new Error("compiled oracle page bridge UI HTML placeholder is missing");
}
const plugin = compiledPlugin.replace(
  "figma.showUI(__html__,",
  `figma.showUI(${JSON.stringify(html)},`,
);
if (plugin.includes("__html__")) {
  throw new Error("compiled oracle page bridge leaves __html__ undefined");
}
writeFileSync(path.join(outputDir, "ui.html"), html);
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      ...manifest,
      name: "Agent-Native Oracle Page Bridge",
      api: "1.0.0",
      editorType: ["figma"],
      main: "plugin.js",
      ui: "ui.html",
      documentAccess: "dynamic-page",
      networkAccess: { allowedDomains: ["none"] },
    },
    null,
    2,
  )}\n`,
);
writeFileSync(path.join(outputDir, "plugin.js"), plugin);
if (!plugin.includes("figma.currentPage.name")) {
  throw new Error("compiled oracle page bridge does not read the active page");
}
console.log(path.relative(ROOT, manifestPath));
