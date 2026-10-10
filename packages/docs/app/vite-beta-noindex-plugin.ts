import fs from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";

export const BETA_NOINDEX_HEADERS_BLOCK = "/*\n  X-Robots-Tag: noindex";

/**
 * Beta docs builds (`VITE_AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT=beta`) serve the
 * same pages as www, so every static file they publish is marked noindex.
 * Rendered HTML also carries a robots meta tag from `root.tsx`; this header
 * covers the Markdown, text, and XML files that have no `<head>`.
 */
export function betaNoindexHeadersPlugin(): Plugin {
  let headersPath: string | undefined;

  return {
    name: "agent-native-docs-beta-noindex-headers",
    apply: "build",
    configResolved(config) {
      const environment = config.env.VITE_AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT;
      if (
        typeof environment === "string" &&
        environment.trim().toLowerCase() === "beta"
      ) {
        headersPath = path.resolve(config.root, "build/client/_headers");
      }
    },
    closeBundle() {
      if (!headersPath) return;
      appendBetaNoindexHeaders(headersPath);
    },
  };
}

export function appendBetaNoindexHeaders(headersPath: string): void {
  if (!fs.existsSync(headersPath)) {
    throw new Error(
      `Beta docs build has no ${headersPath} to mark noindex; public/_headers should have been copied there.`,
    );
  }
  const existing = fs.readFileSync(headersPath, "utf8");
  // closeBundle runs once per Vite environment, so the client file is seen
  // again after the server build.
  if (existing.includes(BETA_NOINDEX_HEADERS_BLOCK)) return;
  fs.writeFileSync(
    headersPath,
    `${existing.trimEnd()}\n\n${BETA_NOINDEX_HEADERS_BLOCK}\n`,
  );
}
