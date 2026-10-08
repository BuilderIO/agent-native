import { describe, expect, it } from "vitest";

import { AGENT_NATIVE_MIGRATION_GUIDE_URL } from "../package-lifecycle/migration-message.js";
import { loadOptionalPeer } from "./optional-peer.js";

describe("loadOptionalPeer", () => {
  it("turns a missing package or subpath into an install error", async () => {
    const missing = Object.assign(
      new Error("Cannot find package 'example-peer/subpath'"),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    const result = loadOptionalPeer("example-peer", async () => {
      throw missing;
    });
    await expect(result).rejects.toMatchObject({
      name: "OptionalPeerDependencyError",
      code: "ERR_AGENT_NATIVE_OPTIONAL_PEER",
      packageName: "example-peer",
      cause: missing,
    });
    await expect(result).rejects.toThrow(AGENT_NATIVE_MIGRATION_GUIDE_URL);
  });

  it("recognizes Vite unresolved optional imports by exact package or subpath", async () => {
    for (const specifier of ["example-peer", "example-peer/subpath"]) {
      const missing = new Error(
        `Could not resolve "${specifier}" imported by "src/client.ts". Is it installed?`,
      );

      await expect(
        loadOptionalPeer("example-peer", async () => {
          throw missing;
        }),
      ).rejects.toMatchObject({
        name: "OptionalPeerDependencyError",
        packageName: "example-peer",
        cause: missing,
      });
    }

    const similarlyNamedPackage = new Error(
      'Could not resolve "example-peer-extra" imported by "src/client.ts". Is it installed?',
    );
    await expect(
      loadOptionalPeer("example-peer", async () => {
        throw similarlyNamedPackage;
      }),
    ).rejects.toBe(similarlyNamedPackage);
  });

  it.each([
    'Failed to resolve import "example-peer" from "src/client.ts". Does the file exist?',
    'Rollup failed to resolve import "example-peer".',
    'Rolldown failed to resolve import "example-peer".',
  ])("recognizes Vite build and dev resolver errors: %s", async (message) => {
    await expect(
      loadOptionalPeer("example-peer", async () => {
        throw new Error(message);
      }),
    ).rejects.toMatchObject({
      name: "OptionalPeerDependencyError",
      packageName: "example-peer",
    });
  });

  it("does not rewrite unrelated load errors", async () => {
    const failure = new Error("package initialization failed");

    await expect(
      loadOptionalPeer("example-peer", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it("recognizes a missing peer inside an import cause chain", async () => {
    const missing = Object.assign(
      new Error("Cannot find package '@agent-native/recap-cli'"),
      { code: "ERR_MODULE_NOT_FOUND" },
    );
    const wrapped = new Error("Failed to load CLI command", { cause: missing });

    await expect(
      loadOptionalPeer("@agent-native/recap-cli", async () => {
        throw wrapped;
      }),
    ).rejects.toMatchObject({
      name: "OptionalPeerDependencyError",
      packageName: "@agent-native/recap-cli",
      cause: wrapped,
    });
  });
});
