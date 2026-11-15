import { fileURLToPath } from "node:url";

import {
  normalizeAgentNativeConfig,
  resolveAgentNativeConfig,
} from "@agent-native/core/config";
import { QueryClient } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, describe, expect, it } from "vitest";

import dispatchManifest from "../../../../../templates/dispatch/agent-native.json";

const toolkitRoot = fileURLToPath(new URL("../../..", import.meta.url));
const providersFile = fileURLToPath(
  new URL("./AppProviders.tsx", import.meta.url),
);
const servers: ViteDevServer[] = [];

async function loadProviders(
  mode: "production" | "development",
  override?: string,
) {
  const config = resolveAgentNativeConfig(
    normalizeAgentNativeConfig(dispatchManifest),
    {
      command: "build",
      mode,
      isDev: false,
      isBuild: true,
    },
  );
  const server = await createServer({
    root: toolkitRoot,
    configFile: false,
    envPrefix: "SSR_REGRESSION_TEST_",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, watch: { ignored: ["**"] } },
    optimizeDeps: { noDiscovery: true, include: [] },
    ssr: { external: ["@agent-native/core"] },
    define: {
      __AGENT_NATIVE_APP_CONFIG__: JSON.stringify(config),
      ...(override === undefined
        ? {}
        : {
            "import.meta.env.VITE_AGENT_NATIVE_FIRST_RUN_ONBOARDING":
              JSON.stringify(override),
          }),
    },
  });
  servers.push(server);
  return (await server.ssrLoadModule(
    providersFile,
  )) as typeof import("./AppProviders.js");
}

afterAll(async () => {
  await Promise.all(servers.map((server) => server.close()));
});

describe("externalized Core first-run SSR", () => {
  it("renders Dispatch's production first-paint script before the shell, except on bypassed surfaces", async () => {
    const { AppProviders } = await loadProviders("production");
    const render = (
      props: Partial<React.ComponentProps<typeof AppProviders>> = {},
    ) =>
      renderToStaticMarkup(
        <AppProviders
          queryClient={new QueryClient()}
          i18n={false}
          toaster={null}
          {...props}
        >
          <div>content</div>
        </AppProviders>,
      );
    const html = render();
    const script = html.indexOf('data-agent-native-first-run-first-paint="1"');
    expect(script).toBeGreaterThan(-1);
    expect(script).toBeLessThan(
      html.indexOf('data-agent-native-app-skeleton="true"'),
    );
    for (const props of [
      { isPublicPath: true },
      { sessionBypass: true },
      { ownsDocument: false },
      { skipFirstRunOnboarding: true },
    ]) {
      expect(render(props)).not.toContain(
        'data-agent-native-first-run-first-paint="1"',
      );
    }
  });

  it.each([
    ["development", undefined, false],
    ["production", "false", false],
    ["development", "true", true],
  ] as const)(
    "respects %s mode and legacy override %s",
    async (mode, override, expected) => {
      const { AppProviders } = await loadProviders(mode, override);
      const html = renderToStaticMarkup(
        <AppProviders
          queryClient={new QueryClient()}
          i18n={false}
          toaster={null}
        >
          <div>content</div>
        </AppProviders>,
      );
      expect(html.includes('data-agent-native-first-run-first-paint="1"')).toBe(
        expected,
      );
    },
  );
});
