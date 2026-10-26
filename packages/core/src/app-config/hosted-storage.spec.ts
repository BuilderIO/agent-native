import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppConfigurationError } from "./configuration-error.js";
import { resolveHostedStorageConfig } from "./hosted-storage.js";
import {
  defineAppConfig,
  getAppConfig,
  resetAppConfigForTests,
} from "./store.js";

const originalEnv = { ...process.env };
const FIELDS = [
  "ENABLED",
  "ENDPOINT",
  "BUCKET",
  "ACCESS_KEY_ID",
  "SECRET_ACCESS_KEY",
  "REGION",
] as const;

describe("hosted storage config", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
    for (const field of FIELDS) {
      delete process.env[`AGENT_NATIVE_HOSTED_STORAGE_${field}`];
      delete process.env[`CLIPS_HOSTED_STORAGE_${field}`];
    }
  });

  afterEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
  });

  it("is off by default", () => {
    expect(getAppConfig().hostedStorage.enabled).toBe(false);
    expect(resolveHostedStorageConfig(getAppConfig().hostedStorage)).toBeNull();
  });

  it("reads the shared names", () => {
    process.env.AGENT_NATIVE_HOSTED_STORAGE_ENABLED = "true";
    process.env.AGENT_NATIVE_HOSTED_STORAGE_BUCKET = "private-files";
    process.env.AGENT_NATIVE_HOSTED_STORAGE_ENDPOINT =
      "https://storage.example.test";
    process.env.AGENT_NATIVE_HOSTED_STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.AGENT_NATIVE_HOSTED_STORAGE_SECRET_ACCESS_KEY =
      "test-secret-key";
    process.env.AGENT_NATIVE_HOSTED_STORAGE_REGION = "auto";

    const shared = {
      endpoint: "https://storage.example.test",
      bucket: "private-files",
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
      region: "auto",
    };
    expect(resolveHostedStorageConfig(getAppConfig().hostedStorage)).toEqual(
      shared,
    );
  });

  it("isn't turned on by enabling Clips hosted storage", () => {
    process.env.CLIPS_HOSTED_STORAGE_ENABLED = "true";

    expect(getAppConfig().hostedStorage.enabled).toBe(false);
  });

  it("fails loudly when enabled without every setting", () => {
    defineAppConfig({
      hostedStorage: { enabled: true, bucket: "private-files" },
    });

    expect(() =>
      resolveHostedStorageConfig(getAppConfig().hostedStorage),
    ).toThrow(AppConfigurationError);
    expect(() =>
      resolveHostedStorageConfig(getAppConfig().hostedStorage),
    ).toThrow(/endpoint, accessKeyId, secretAccessKey, region/);
  });

  it("never mixes its settings with Clips'", () => {
    process.env.AGENT_NATIVE_HOSTED_STORAGE_ENABLED = "true";
    process.env.AGENT_NATIVE_HOSTED_STORAGE_BUCKET = "private-files";
    process.env.AGENT_NATIVE_HOSTED_STORAGE_ENDPOINT =
      "https://storage.example.test";
    process.env.AGENT_NATIVE_HOSTED_STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.AGENT_NATIVE_HOSTED_STORAGE_SECRET_ACCESS_KEY =
      "test-secret-key";
    process.env.AGENT_NATIVE_HOSTED_STORAGE_REGION = "auto";
    // Clips with only its bucket set.
    process.env.CLIPS_HOSTED_STORAGE_BUCKET = "clips";

    const config = getAppConfig();
    expect(resolveHostedStorageConfig(config.hostedStorage)).toMatchObject({
      bucket: "private-files",
      endpoint: "https://storage.example.test",
    });
    expect(config.clips.hostedStorage).toMatchObject({ bucket: "clips" });
    expect(config.clips.hostedStorage.endpoint).toBeUndefined();
    expect(config.clips.hostedStorage.accessKeyId).toBeUndefined();

    // Clips' names alone don't configure private files.
    for (const field of ["BUCKET", "ENDPOINT", "ACCESS_KEY_ID"]) {
      delete process.env[`AGENT_NATIVE_HOSTED_STORAGE_${field}`];
    }
    process.env.CLIPS_HOSTED_STORAGE_ENDPOINT = "https://storage.example.test";
    process.env.CLIPS_HOSTED_STORAGE_ACCESS_KEY_ID = "test-access-key";
    expect(() =>
      resolveHostedStorageConfig(getAppConfig().hostedStorage),
    ).toThrow(/endpoint, bucket, accessKeyId/);
  });
});
