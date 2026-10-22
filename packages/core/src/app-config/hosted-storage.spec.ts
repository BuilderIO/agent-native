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
    expect(getAppConfig().clips.hostedStorage).toMatchObject(shared);
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

  it("keeps Clips' existing bucket for both when both names are set", () => {
    process.env.AGENT_NATIVE_HOSTED_STORAGE_ENABLED = "true";
    process.env.AGENT_NATIVE_HOSTED_STORAGE_BUCKET = "private-files";
    process.env.AGENT_NATIVE_HOSTED_STORAGE_ENDPOINT =
      "https://new-storage.example.test";
    process.env.AGENT_NATIVE_HOSTED_STORAGE_ACCESS_KEY_ID = "new-access-key";
    process.env.AGENT_NATIVE_HOSTED_STORAGE_SECRET_ACCESS_KEY =
      "new-secret-key";
    process.env.AGENT_NATIVE_HOSTED_STORAGE_REGION = "auto";
    process.env.CLIPS_HOSTED_STORAGE_BUCKET = "clips";
    process.env.CLIPS_HOSTED_STORAGE_ENDPOINT = "https://storage.example.test";
    process.env.CLIPS_HOSTED_STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.CLIPS_HOSTED_STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.CLIPS_HOSTED_STORAGE_REGION = "us-east-1";

    const config = getAppConfig();
    const clips = {
      endpoint: "https://storage.example.test",
      bucket: "clips",
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
      region: "us-east-1",
    };
    expect(config.clips.hostedStorage).toMatchObject(clips);
    expect(resolveHostedStorageConfig(config.hostedStorage)).toEqual(clips);
  });
});
