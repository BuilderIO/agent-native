import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveClipsHostedStorageConfig } from "./clips.js";
import { AppConfigurationError } from "./configuration-error.js";
import {
  defineAppConfig,
  getAppConfig,
  resetAppConfigForTests,
} from "./store.js";

const originalEnv = { ...process.env };

const STORAGE_ENV_KEYS = [
  "CLIPS_HOSTED_STORAGE_ENABLED",
  "CLIPS_HOSTED_STORAGE_ENDPOINT",
  "CLIPS_HOSTED_STORAGE_BUCKET",
  "CLIPS_HOSTED_STORAGE_ACCESS_KEY_ID",
  "CLIPS_HOSTED_STORAGE_SECRET_ACCESS_KEY",
  "CLIPS_HOSTED_STORAGE_REGION",
  "CLIPS_HOSTED_STORAGE_PER_IDENTITY_CLIP_LIMIT",
  "CLIPS_HOSTED_STORAGE_MAX_CLIP_BYTES",
  "CLIPS_HOSTED_STORAGE_MAX_CLIP_DURATION_MS",
  "CLIPS_HOSTED_STORAGE_GLOBAL_DAILY_CLIP_CAP",
  "CLIPS_HOSTED_STORAGE_IP_PREFIX_DAILY_GRANT_CAP",
  "CLIPS_HOSTED_STORAGE_GLOBAL_RETAINED_BYTE_CAP",
  "CLIPS_HOSTED_STORAGE_RETAINED_BYTE_ALERT_RATIO",
] as const;

describe("Clips hosted storage config", () => {
  beforeEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
    for (const key of STORAGE_ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    resetAppConfigForTests();
    process.env = { ...originalEnv };
  });

  it("defaults to disabled storage and bounded free-trial settings", () => {
    expect(getAppConfig().clips.hostedStorage).toMatchObject({
      enabled: false,
      perIdentityClipLimit: 3,
      maxClipBytes: 250 * 1024 * 1024,
      maxClipDurationMs: 10 * 60 * 1000,
      retainedByteAlertRatio: 0.8,
    });
    expect(
      getAppConfig().clips.hostedStorage.globalDailyClipCap,
    ).toBeUndefined();
    expect(
      getAppConfig().clips.hostedStorage.ipPrefixDailyGrantCap,
    ).toBeUndefined();
    expect(
      getAppConfig().clips.hostedStorage.globalRetainedByteCap,
    ).toBeUndefined();
  });

  it("reads declared deployment environment aliases as typed values", () => {
    process.env.CLIPS_HOSTED_STORAGE_ENABLED = "true";
    process.env.CLIPS_HOSTED_STORAGE_ENDPOINT = "https://storage.example.test";
    process.env.CLIPS_HOSTED_STORAGE_BUCKET = "clips";
    process.env.CLIPS_HOSTED_STORAGE_ACCESS_KEY_ID = "test-access-key";
    process.env.CLIPS_HOSTED_STORAGE_SECRET_ACCESS_KEY = "test-secret-key";
    process.env.CLIPS_HOSTED_STORAGE_REGION = "auto";
    process.env.CLIPS_HOSTED_STORAGE_PER_IDENTITY_CLIP_LIMIT = "4";
    process.env.CLIPS_HOSTED_STORAGE_MAX_CLIP_BYTES = "1048576";
    process.env.CLIPS_HOSTED_STORAGE_MAX_CLIP_DURATION_MS = "60000";
    process.env.CLIPS_HOSTED_STORAGE_GLOBAL_DAILY_CLIP_CAP = "100";
    process.env.CLIPS_HOSTED_STORAGE_IP_PREFIX_DAILY_GRANT_CAP = "5";
    process.env.CLIPS_HOSTED_STORAGE_GLOBAL_RETAINED_BYTE_CAP = "5000000";
    process.env.CLIPS_HOSTED_STORAGE_RETAINED_BYTE_ALERT_RATIO = "0.9";

    expect(getAppConfig().clips.hostedStorage).toMatchObject({
      enabled: true,
      endpoint: "https://storage.example.test",
      bucket: "clips",
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
      region: "auto",
      perIdentityClipLimit: 4,
      maxClipBytes: 1_048_576,
      maxClipDurationMs: 60_000,
      globalDailyClipCap: 100,
      ipPrefixDailyGrantCap: 5,
      globalRetainedByteCap: 5_000_000,
      retainedByteAlertRatio: 0.9,
    });
  });

  it("lets explicit app config override deployment aliases", () => {
    process.env.CLIPS_HOSTED_STORAGE_PER_IDENTITY_CLIP_LIMIT = "7";
    defineAppConfig({
      clips: { hostedStorage: { perIdentityClipLimit: 2 } },
    });

    expect(getAppConfig().clips.hostedStorage.perIdentityClipLimit).toBe(2);
  });

  it("returns no storage only when disabled", () => {
    expect(
      resolveClipsHostedStorageConfig(getAppConfig().clips.hostedStorage),
    ).toBe(null);
  });

  it("fails at the storage resolver when enabled without complete credentials", () => {
    process.env.CLIPS_HOSTED_STORAGE_ENABLED = "true";

    const config = getAppConfig().clips.hostedStorage;
    expect(config.enabled).toBe(true);
    expect(() => resolveClipsHostedStorageConfig(config)).toThrow(
      AppConfigurationError,
    );
    expect(() => resolveClipsHostedStorageConfig(config)).toThrow(
      "Clips hosted storage is enabled but missing required settings: endpoint, bucket, accessKeyId, secretAccessKey, region.",
    );
  });

  it("returns a narrowed config after required storage settings are present", () => {
    defineAppConfig({
      clips: {
        hostedStorage: {
          enabled: true,
          endpoint: "https://storage.example.test",
          bucket: "clips",
          accessKeyId: "test-access-key",
          secretAccessKey: "test-secret-key",
          region: "auto",
        },
      },
    });

    expect(
      resolveClipsHostedStorageConfig(getAppConfig().clips.hostedStorage),
    ).toMatchObject({
      enabled: true,
      endpoint: "https://storage.example.test",
      bucket: "clips",
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
      region: "auto",
    });
  });

  it("rejects invalid deployment limits during config parsing", () => {
    process.env.CLIPS_HOSTED_STORAGE_PER_IDENTITY_CLIP_LIMIT = "0";
    expect(() => getAppConfig()).toThrow();
  });
});
