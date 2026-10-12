import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ResolvedConfig } from "vite";
import { afterEach, describe, expect, it } from "vitest";

import {
  appendBetaNoindexHeaders,
  BETA_NOINDEX_HEADERS_BLOCK,
  betaNoindexHeadersPlugin,
} from "./vite-beta-noindex-plugin";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function buildRoot(headers: string | undefined): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-beta-noindex-"));
  roots.push(root);
  if (headers !== undefined) {
    fs.mkdirSync(path.join(root, "build/client"), { recursive: true });
    fs.writeFileSync(path.join(root, "build/client/_headers"), headers);
  }
  return root;
}

function runPlugin(root: string, environment: string | undefined) {
  const plugin = betaNoindexHeadersPlugin();
  (plugin.configResolved as (config: ResolvedConfig) => void)({
    root,
    env: { VITE_AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT: environment },
  } as unknown as ResolvedConfig);
  (plugin.closeBundle as () => void)();
  (plugin.closeBundle as () => void)();
}

function readHeaders(root: string): string {
  return fs.readFileSync(path.join(root, "build/client/_headers"), "utf8");
}

describe("beta noindex headers", () => {
  it("marks every beta file noindex once, after the existing rules", () => {
    const root = buildRoot("/sitemap.xml\n  Content-Type: application/xml\n");

    runPlugin(root, " Beta ");

    const headers = readHeaders(root);
    expect(headers).toBe(
      `/sitemap.xml\n  Content-Type: application/xml\n\n${BETA_NOINDEX_HEADERS_BLOCK}\n`,
    );
  });

  it("leaves production builds untouched", () => {
    const root = buildRoot("/sitemap.xml\n  Content-Type: application/xml\n");

    runPlugin(root, "production");
    runPlugin(root, undefined);

    expect(readHeaders(root)).not.toContain("X-Robots-Tag");
  });

  it("fails a beta build that has no headers file to mark", () => {
    const root = buildRoot(undefined);

    expect(() =>
      appendBetaNoindexHeaders(path.join(root, "build/client/_headers")),
    ).toThrow(/Beta docs build has no/);
  });
});
