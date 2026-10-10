import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  NativeTextureProviderError,
  readNativeTextureProviderWith,
} from "./design-native-texture-provider-policy";

const qa =
  "/api/qa-figma-import-assets/12345678-1234-4123-8123-123456789abc.png";
const png = new Uint8Array([137, 80, 78, 71]);
function dependencies(enabled = true) {
  const calls: string[] = [];
  return {
    calls,
    localQaEnabled: () => enabled,
    readLocal: async (url: string, owner: string, max: number) => {
      calls.push(`local:${url}:${owner}:${max}`);
      return { mimeType: "image/png", data: png };
    },
    readHttps: async (url: string, owner: string, max: number) => {
      calls.push(`https:${url}:${owner}:${max}`);
      return { mimeType: "image/png", data: png };
    },
  };
}
const input = {
  url: qa,
  ownerEmail: "owner@example.test",
  maxBytes: 1_000_000,
};
function code(error: unknown) {
  return error instanceof NativeTextureProviderError ? error.code : null;
}

describe("Design native texture provider policy", () => {
  it("uses the bounded owner-scoped QA reader only for the exact enabled route", async () => {
    const deps = dependencies();
    assert.deepEqual(await readNativeTextureProviderWith(input, deps), {
      mimeType: "image/png",
      data: png,
    });
    assert.deepEqual(deps.calls, [`local:${qa}:owner@example.test:1000000`]);
    await assert.rejects(
      readNativeTextureProviderWith({ ...input, url: qa + "?escape=1" }, deps),
      (error) => code(error) === "invalid-reference",
    );
    assert.equal(deps.calls.length, 1);
  });

  it("fails disabled QA, missing owner, invalid bounds and unsafe relative URLs before any reader", async () => {
    const deps = dependencies(false);
    await assert.rejects(
      readNativeTextureProviderWith(input, deps),
      (error) => code(error) === "unavailable",
    );
    await assert.rejects(
      readNativeTextureProviderWith({ ...input, ownerEmail: "" }, deps),
      (error) => code(error) === "forbidden",
    );
    await assert.rejects(
      readNativeTextureProviderWith({ ...input, maxBytes: 1_000_001 }, deps),
      (error) => code(error) === "limit",
    );
    await assert.rejects(
      readNativeTextureProviderWith(
        { ...input, url: "/api/other/file.png" },
        deps,
      ),
      (error) => code(error) === "invalid-reference",
    );
    assert.deepEqual(deps.calls, []);
  });

  it("delegates HTTPS to the unchanged production reader", async () => {
    const deps = dependencies(false);
    await readNativeTextureProviderWith(
      { ...input, url: "https://owned.example.test/file.png" },
      deps,
    );
    assert.deepEqual(deps.calls, [
      "https:https://owned.example.test/file.png:owner@example.test:1000000",
    ]);
  });

  it("rejects oversize or unsupported returned bytes even when a reader misbehaves", async () => {
    const deps = dependencies();
    deps.readLocal = async () => ({
      mimeType: "image/png",
      data: new Uint8Array(5),
    });
    await assert.rejects(
      readNativeTextureProviderWith({ ...input, maxBytes: 4 }, deps),
      (error) => code(error) === "limit",
    );
    deps.readLocal = async () => ({ mimeType: "image/svg+xml", data: png });
    await assert.rejects(
      readNativeTextureProviderWith(input, deps),
      (error) => code(error) === "unsupported",
    );
  });
});
