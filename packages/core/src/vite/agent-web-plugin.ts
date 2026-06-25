import fs from "fs";
import path from "path";

import type { Plugin } from "vite";

import {
  buildAgentWebStaticFiles,
  normalizeAgentWebConfig,
  type AgentWebInputConfig,
  type AgentWebPage,
} from "../agent-web/index.js";

export interface AgentWebVitePluginOptions {
  siteName: string;
  siteUrl: string;
  description?: string;
  pages: AgentWebPage[] | (() => AgentWebPage[]);
  agentWeb?: AgentWebInputConfig | boolean;
  outputDirs?: string[];
  organization?: {
    name: string;
    url?: string;
    sameAs?: string[];
  };
}

export function createAgentWebVitePlugin(
  options: AgentWebVitePluginOptions,
): Plugin {
  let rootDir = process.cwd();

  return {
    name: "agent-web-surfaces",
    apply: "build",
    configResolved(config) {
      rootDir = config.root;
    },
    closeBundle() {
      const pages =
        typeof options.pages === "function" ? options.pages() : options.pages;
      const config = normalizeAgentWebConfig(options.agentWeb ?? {}, {
        hasPublicRoutes: pages.length > 0,
      });
      if (!config.discoverable) return;

      const files = buildAgentWebStaticFiles({
        siteName: options.siteName,
        siteUrl: options.siteUrl,
        description: options.description,
        pages,
        config,
        organization: options.organization,
      });

      const outputDirs = options.outputDirs ?? [
        "public",
        "dist",
        "dist/client",
        "dist/server/public",
        "build/client",
      ];

      for (const dir of outputDirs) {
        const outDir = path.resolve(rootDir, dir);
        if (!fs.existsSync(outDir)) continue;
        for (const file of files) {
          const outPath = path.resolve(outDir, file.path);
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, file.content);
        }
      }

      this.info(
        `[agent-web] Generated ${files.length} files for ${pages.length} public routes`,
      );
    },
  };
}
