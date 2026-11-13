import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const toolkit = path.resolve(import.meta.dirname, "../../..");

// A native Node process loads the SSR bundle, so Core's externalized helper
// cannot accidentally receive the app's Vite define through Vitest.
const render = `
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";

const { mode, override } = JSON.parse(process.argv[1]);
const temp = await mkdtemp(path.join(tmpdir(), "ssr-onboarding-"));
try {
  await symlink(path.resolve("node_modules"), path.join(temp, "node_modules"), "dir");
  await build({
    configFile: false,
    logLevel: "silent",
    define: {
      __AGENT_NATIVE_APP_CONFIG__: JSON.stringify({ onboarding: { firstRun: mode } }),
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
      { queryClient: new QueryClient(), i18n: false, ...props },
      React.createElement("div", null, "content"),
    ));
    return markup.includes('<script data-agent-native-first-run-first-paint="1"');
  }
  console.log(JSON.stringify({
    private: hasScript({}),
    skipped: hasScript({ skipFirstRunOnboarding: true }),
    public: hasScript({ isPublicPath: true }),
    bypass: hasScript({ sessionBypass: true }),
    embedded: hasScript({ ownsDocument: false }),
  }));
} finally {
  await rm(temp, { recursive: true, force: true });
}
`;

describe("AppProviders with externalized Core SSR", () => {
  it.each([
    ["connect", null, true],
    ["off", null, false],
    ["connect", "false", false],
    ["off", "true", true],
  ])(
    "renders first-run script for mode %s and override %s",
    async (mode, override, enabled) => {
      const env = { ...process.env };
      delete env.VITE_AGENT_NATIVE_FIRST_RUN_ONBOARDING;
      const { stdout } = await run(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          render,
          JSON.stringify({ mode, override }),
        ],
        { cwd: toolkit, env },
      );
      expect(JSON.parse(stdout)).toEqual({
        private: enabled,
        skipped: false,
        public: false,
        bypass: false,
        embedded: false,
      });
    },
  );
});
