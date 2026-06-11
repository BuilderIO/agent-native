import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PLAN_HOSTED_URL,
  planConnectCommand,
  resolvePlanHostedUrl,
  resolvePlanPublishAuth,
} from "./plan-publish.js";

const ENV_KEYS = [
  "PLAN_PUBLISH_URL",
  "PLAN_HOSTED_URL",
  "PLAN_PUBLISH_TOKEN",
  "AGENT_NATIVE_TOKEN",
  "PLAN_PUBLISH_CONFIG_PATH",
] as const;

describe("plan-publish auth resolution", () => {
  let saved: Record<string, string | undefined>;
  let tmpFile: string;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
    tmpFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "plan-pub-")),
      "plan-publish.json",
    );
    // Point the config path at a file that does not exist by default so the
    // resolver does not read the real user's ~/.agent-native config.
    process.env.PLAN_PUBLISH_CONFIG_PATH = tmpFile;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
  });

  it("returns null when nothing is configured", () => {
    expect(resolvePlanPublishAuth()).toBeNull();
  });

  it("falls back to the default hosted url for needsAuth surfacing", () => {
    expect(resolvePlanHostedUrl()).toBe(DEFAULT_PLAN_HOSTED_URL);
  });

  it("resolves from env vars", () => {
    process.env.PLAN_PUBLISH_URL = "https://plan.example.com/";
    process.env.PLAN_PUBLISH_TOKEN = "tok_123";
    expect(resolvePlanPublishAuth()).toEqual({
      url: "https://plan.example.com",
      token: "tok_123",
    });
    expect(resolvePlanHostedUrl()).toBe("https://plan.example.com");
  });

  it("resolves from the config file", () => {
    fs.writeFileSync(
      tmpFile,
      JSON.stringify({ url: "https://hosted.example.com", token: "tok_file" }),
    );
    expect(resolvePlanPublishAuth()).toEqual({
      url: "https://hosted.example.com",
      token: "tok_file",
    });
    expect(resolvePlanHostedUrl()).toBe("https://hosted.example.com");
  });

  it("accepts alternative token/url keys in the config file", () => {
    fs.writeFileSync(
      tmpFile,
      JSON.stringify({
        baseUrl: "https://alt.example.com",
        accessToken: "tok_alt",
      }),
    );
    expect(resolvePlanPublishAuth()).toEqual({
      url: "https://alt.example.com",
      token: "tok_alt",
    });
  });

  it("builds the connect command", () => {
    expect(planConnectCommand("https://plan.example.com")).toBe(
      "npx @agent-native/core@latest connect https://plan.example.com",
    );
  });
});
