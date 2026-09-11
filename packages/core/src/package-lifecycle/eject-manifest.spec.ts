import { describe, expect, it } from "vitest";

import {
  assertAgentNativeEjectManifest,
  type AgentNativeEjectManifest,
} from "./eject-manifest.js";

function manifest(): AgentNativeEjectManifest {
  return {
    manifestVersion: 1,
    package: "@agent-native/toolkit",
    catalogs: ["toolkit-ui"],
    units: [
      {
        id: "toolkit/chat-history",
        label: "Chat history",
        catalog: "toolkit-ui",
        catalogItems: ["chat-history"],
        entrypoints: ["./chat-history", "./chat-history/*"],
        strategy: "source-copy",
        sourceEntries: ["src/chat-history/index.ts"],
        targetRoot: "app/components/agent-native/toolkit",
        styles: [
          {
            entrypoint: "./chat-history.css",
            source: "src/chat-history.css",
          },
        ],
        dependencies: ["@tabler/icons-react"],
        protectedImports: ["@agent-native/core/client"],
        verification: ["pnpm typecheck"],
      },
    ],
  };
}

describe("assertAgentNativeEjectManifest", () => {
  it("accepts a complete unit manifest", () => {
    expect(() => assertAgentNativeEjectManifest(manifest())).not.toThrow();
  });

  it("rejects traversal in copied source and target paths", () => {
    const value = manifest();
    value.units[0]!.sourceEntries = ["../private.ts"];
    expect(() => assertAgentNativeEjectManifest(value)).toThrow(
      /sourceEntries contains an invalid value/,
    );

    value.units[0]!.sourceEntries = ["src/index.ts"];
    value.units[0]!.targetRoot = "app/../server";
    expect(() => assertAgentNativeEjectManifest(value)).toThrow(
      /unsafe targetRoot/,
    );
  });

  it("rejects duplicate public entrypoint ownership", () => {
    const value = manifest();
    value.units.push({
      ...value.units[0]!,
      id: "toolkit/other",
      label: "Other",
      catalogItems: ["other"],
    });
    expect(() => assertAgentNativeEjectManifest(value)).toThrow(
      /Duplicate eject entrypoint/,
    );
  });

  it("requires every declared catalog to own a unit", () => {
    const value = manifest();
    value.catalogs.push("domain-packages");
    expect(() => assertAgentNativeEjectManifest(value)).toThrow(
      /catalog has no unit: domain-packages/,
    );
  });

  it("requires package export keys instead of consumer specifiers", () => {
    const value = manifest();
    value.units[0]!.entrypoints = ["@agent-native/core/client"];
    expect(() => assertAgentNativeEjectManifest(value)).toThrow(
      /entrypoints contains an invalid value/,
    );
  });

  it("requires protected runtime units to name a package seam", () => {
    const value = manifest();
    value.units[0] = {
      id: "integration/runtime",
      label: "Runtime",
      catalog: "toolkit-ui",
      catalogItems: ["runtime"],
      entrypoints: ["./runtime"],
      strategy: "protected-seam",
    };
    expect(() => assertAgentNativeEjectManifest(value)).toThrow(
      /requires a safe seam/,
    );
  });
});
