import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

import { includeReferenceSkin } from "./reference-skin";
import { ANALYTICS_MCP_INTEGRATIONS } from "./shared/connected-apps";

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];

const referenceDesignSystem = fileURLToPath(
  new URL("./app/skins/reference/design-system.ts", import.meta.url),
);

function appSource(): string {
  const source = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(source))
    throw new Error("A full app source revision is required.");
  return source;
}

// The agent-native preset runs the dev optimizer with discovery off, so any
// client dependency missing here is found only when its lazy chunk first loads.
// That late discovery re-optimizes mid-session and the in-flight asset requests
// of a cold load fail with 504 "Outdated Optimize Dep".
export const lateDiscoveredOptimizeDeps = [
  "@codemirror/autocomplete",
  "@codemirror/lang-sql",
  "@replit/codemirror-vim",
  "@uiw/react-codemirror",
  "apache-arrow",
  "vega-embed",
];

export default defineConfig(({ command }) => ({
  worker: { format: "es" },
  define: {
    __ANALYTICS_APP_SOURCE__: JSON.stringify(appSource()),
  },
  optimizeDeps: { include: lateDiscoveredOptimizeDeps },
  plugins: [
    ...reactRouterPlugins(),
    ...agentNativePlugins({
      // shiki only runs in the AgentKit chat's useEffect — keep it out of the
      // CF Pages Functions bundle (25 MiB limit).
      ssrStubs: ["shiki", "canvas"],
      mcpIntegrations: ANALYTICS_MCP_INTEGRATIONS,
      ...(includeReferenceSkin(
        command,
        process.env.AGENT_NATIVE_INCLUDE_REFERENCE_SKIN,
        existsSync(referenceDesignSystem),
      )
        ? {
            aliases: {
              "../../design-system": referenceDesignSystem,
            },
          }
        : {}),
    }),
  ],
}));
