import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_MCP_INTEGRATIONS } from "../client/resources/mcp-integration-catalog.js";
import { BUILT_IN_SETUP_READINESS_UI_IDS } from "../client/setup-connections/catalog.js";
import { WORKSPACE_CONNECTION_PROVIDERS } from "../connections/catalog.js";
import { BUILT_IN_INTEGRATION_ADAPTER_IDS } from "../integrations/plugin.js";
import { PROVIDER_API_IDS } from "../provider-api/index.js";
import {
  assertAgentNativeEjectManifest,
  type AgentNativeEjectCatalog,
  type AgentNativeEjectManifest,
} from "./eject-manifest.js";

const repoRoot = path.resolve(import.meta.dirname, "../../../..");

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, relativePath), "utf8"),
  ) as T;
}

function readManifest(relativePath: string): AgentNativeEjectManifest {
  const manifest = readJson<unknown>(relativePath);
  assertAgentNativeEjectManifest(manifest);
  return manifest;
}

function items(
  manifests: AgentNativeEjectManifest[],
  catalog: AgentNativeEjectCatalog,
): string[] {
  return manifests
    .flatMap((manifest) => manifest.units)
    .filter((unit) => unit.catalog === catalog)
    .flatMap((unit) => unit.catalogItems)
    .sort();
}

describe("repository eject manifests", () => {
  const core = readManifest("packages/core/agent-native.eject.json");
  const toolkit = readManifest("packages/toolkit/agent-native.eject.json");
  const scheduling = readManifest(
    "packages/scheduling/agent-native.eject.json",
  );
  const creativeContext = readManifest(
    "packages/creative-context/agent-native.eject.json",
  );
  const manifests = [core, toolkit, scheduling, creativeContext];

  it("covers every current Toolkit public entrypoint", () => {
    const packageJson = readJson<{ exports: Record<string, unknown> }>(
      "packages/toolkit/package.json",
    );
    const expected = Object.keys(packageJson.exports)
      .filter((entrypoint) => entrypoint !== "./agent-native.eject.json")
      .sort();
    const covered = toolkit.units
      .flatMap((unit) => [
        ...unit.entrypoints,
        ...(unit.styles ?? []).map((style) => style.entrypoint),
      ])
      .sort();
    expect(covered).toEqual(expected);
  });

  it("tracks every item in the five live integration catalogs", () => {
    expect(items(manifests, "remote-mcp-presets")).toEqual(
      DEFAULT_MCP_INTEGRATIONS.map((entry) => entry.id).sort(),
    );
    expect(items(manifests, "workspace-connections")).toEqual(
      WORKSPACE_CONNECTION_PROVIDERS.map((entry) => entry.id).sort(),
    );
    expect(items(manifests, "provider-api-definitions")).toEqual(
      [...PROVIDER_API_IDS].sort(),
    );
    expect(items(manifests, "messaging-adapters")).toEqual(
      [...BUILT_IN_INTEGRATION_ADAPTER_IDS].sort(),
    );
    expect(items(manifests, "setup-readiness-ui")).toEqual(
      [...BUILT_IN_SETUP_READINESS_UI_IDS].sort(),
    );
  });

  it("keeps package lifecycle metadata when a domain package is ejected", () => {
    for (const manifest of [scheduling, creativeContext]) {
      const packageJson = readJson<{ agentNativeEjectManifest: string }>(
        `packages/${manifest.package.replace(/^@agent-native\//, "")}/package.json`,
      );
      for (const unit of manifest.units.filter(
        (candidate) => candidate.strategy === "package-eject",
      )) {
        expect(unit.sourceEntries, unit.id).toContain(
          packageJson.agentNativeEjectManifest,
        );
      }
    }
  });

  it("keeps every copied source and style closure resolvable", () => {
    for (const manifest of manifests) {
      const packageDirectory = path.join(
        repoRoot,
        "packages",
        manifest.package.replace(/^@agent-native\//, ""),
      );
      for (const unit of manifest.units) {
        for (const source of unit.sourceEntries ?? []) {
          expect(
            fs.existsSync(path.join(packageDirectory, source)),
            `${unit.id}: ${source}`,
          ).toBe(true);
        }
        for (const style of unit.styles ?? []) {
          expect(
            fs.existsSync(path.join(packageDirectory, style.source)),
            `${unit.id}: ${style.source}`,
          ).toBe(true);
        }
      }
    }
  });

  it("keeps first-party catalogs executable instead of counting protected or dead recipes", () => {
    const requiredCatalogs = new Set([
      "remote-mcp-presets",
      "workspace-connections",
      "provider-api-definitions",
      "messaging-adapters",
      "setup-readiness-ui",
      "domain-packages",
    ]);
    for (const manifest of manifests) {
      for (const unit of manifest.units) {
        if (requiredCatalogs.has(unit.catalog)) {
          expect(unit.strategy, unit.id).not.toBe("protected-seam");
        }
        if (unit.strategy === "source-copy") {
          expect(
            unit.entrypoints.length + (unit.styles?.length ?? 0),
            unit.id,
          ).toBeGreaterThan(0);
          for (const entrypoint of unit.entrypoints) {
            const publicSpecifier =
              entrypoint === "."
                ? manifest.package
                : `${manifest.package}/${entrypoint.slice(2)}`;
            expect(
              unit.protectedImports?.some(
                (protectedImport) =>
                  publicSpecifier === protectedImport ||
                  publicSpecifier.startsWith(`${protectedImport}/`),
              ) ?? false,
              `${unit.id}: ${publicSpecifier}`,
            ).toBe(false);
          }
        }
      }
    }
  });
});
