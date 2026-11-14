import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import {
  mergeAgentNativeConfigs,
  normalizeAgentNativeConfig,
  resolveAgentNativeConfig,
} from "@agent-native/core/config";
import { describe, expect, it } from "vitest";

import mailConfig from "../../../../../templates/mail/agent-native.config";
import mailJson from "../../../../../templates/mail/agent-native.json";

const run = promisify(execFile);
const toolkit = path.resolve(import.meta.dirname, "../../..");
const productionContext = {
  command: "build",
  mode: "production",
  isDev: false,
  isBuild: true,
} as const;
const productionConfig = resolveAgentNativeConfig(
  mergeAgentNativeConfigs(
    normalizeAgentNativeConfig(mailJson, "Mail"),
    resolveAgentNativeConfig(mailConfig, productionContext),
  ),
  productionContext,
);

// Core stays external, as it does in the production SSR build. Node must load
// it outside Vite so its own import.meta.env and config are not transformed.
const render = `
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";

const { config, override } = JSON.parse(process.argv[1]);
const temp = await mkdtemp(path.join(tmpdir(), "ssr-first-run-"));
try {
  await symlink(path.resolve("node_modules"), path.join(temp, "node_modules"), "dir");
  await build({
    configFile: false,
    logLevel: "silent",
    define: {
      __AGENT_NATIVE_APP_CONFIG__: JSON.stringify(config),
      ...(override === null ? {} : { "import.meta.env.VITE_AGENT_NATIVE_FIRST_RUN_ONBOARDING": JSON.stringify(override) }),
    },
    build: {
      ssr: path.resolve("src/app/providers/AppProviders.tsx"),
      outDir: temp,
      emptyOutDir: false,
      rollupOptions: {
        external: [/^@agent-native\\/core(\\/|$)/],
        output: { entryFileNames: "ssr.mjs" },
      },
    },
  });
  const { AppProviders } = await import(pathToFileURL(path.join(temp, "ssr.mjs")));
  function hasScript(props) {
    const markup = renderToStaticMarkup(React.createElement(
      AppProviders,
      { queryClient: new QueryClient(), skeletonLayout: "mail", i18n: false, ...props },
      React.createElement("div", null, "content"),
    ));
    return markup.includes('<script data-agent-native-first-run-first-paint="1"');
  }
  console.log(JSON.stringify({
    mail: hasScript({}),
    skipped: hasScript({ skipFirstRunOnboarding: true }),
    public: hasScript({ isPublicPath: true }),
    bypass: hasScript({ sessionBypass: true }),
    hosted: hasScript({ ownsDocument: false }),
  }));
} finally {
  await rm(temp, { recursive: true, force: true });
}
`;

const renderMailRoot = `
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";

const mail = path.resolve("../../templates/mail");
const temp = await mkdtemp(path.join(tmpdir(), "mail-ssr-first-run-"));
try {
  await symlink(path.resolve("node_modules"), path.join(temp, "node_modules"), "dir");
  await build({
    configFile: false,
    logLevel: "silent",
    define: { __AGENT_NATIVE_APP_CONFIG__: process.argv[1] },
    resolve: { alias: [
      { find: "@agent-native/toolkit/app/providers", replacement: path.resolve("src/app/providers/AppProviders.tsx") },
      { find: "@", replacement: path.join(mail, "app") },
    ] },
    plugins: [{
      name: "css-stub",
      enforce: "pre",
      resolveId(id) { if (id.includes(".css")) return "\\0css-empty"; },
      load(id) { if (id === "\\0css-empty") return 'export default ""'; },
    }],
    build: {
      ssr: path.join(mail, "app/root.tsx"),
      outDir: temp,
      emptyOutDir: false,
      rollupOptions: {
        external: [/^@agent-native\\/core(\\/|$)/],
        output: { entryFileNames: "mail.mjs" },
      },
    },
  });
  const { default: Root } = await import(pathToFileURL(path.join(temp, "mail.mjs")));
  const html = renderToStaticMarkup(React.createElement(
    StaticRouter,
    { location: "/inbox?embedded=1&chatFirst=1" },
    React.createElement(Root),
  ));
  console.log(JSON.stringify({ firstPaint: html.includes('<script data-agent-native-first-run-first-paint="1"') }));
} finally {
  await rm(temp, { recursive: true, force: true });
}
// Some imported Mail dependencies keep a timer alive after server rendering.
process.exit(0);
`;

describe("AppProviders with externalized Core SSR", () => {
  it("renders first paint on Mail's embedded inbox with its production config", async () => {
    const env = { ...process.env };
    delete env.VITE_AGENT_NATIVE_FIRST_RUN_ONBOARDING;
    const { stdout } = await run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        renderMailRoot,
        JSON.stringify(productionConfig),
      ],
      { cwd: toolkit, env },
    );
    expect(JSON.parse(stdout)).toEqual({ firstPaint: true });
  });
  it.each([
    ["standalone connect", { onboarding: { firstRun: "connect" } }, null, true],
    ["standalone off", { onboarding: { firstRun: "off" } }, null, false],
    [
      "standalone connect with disabled override",
      { onboarding: { firstRun: "connect" } },
      "false",
      false,
    ],
    [
      "standalone off with enabled override",
      { onboarding: { firstRun: "off" } },
      "true",
      true,
    ],
    ["Mail production", productionConfig, null, true],
    [
      "disabled",
      { ...productionConfig, onboarding: { firstRun: "off" } },
      null,
      false,
    ],
    ["disabled override", productionConfig, "false", false],
    [
      "enabled override",
      { ...productionConfig, onboarding: { firstRun: "off" } },
      "true",
      true,
    ],
  ])(
    "renders the first-paint script for %s",
    async (_name, config, override, enabled) => {
      const env = { ...process.env };
      delete env.VITE_AGENT_NATIVE_FIRST_RUN_ONBOARDING;
      const { stdout } = await run(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          render,
          JSON.stringify({ config, override }),
        ],
        { cwd: toolkit, env },
      );
      expect(JSON.parse(stdout)).toEqual({
        mail: enabled,
        skipped: false,
        public: false,
        bypass: false,
        hosted: false,
      });
    },
  );
});
