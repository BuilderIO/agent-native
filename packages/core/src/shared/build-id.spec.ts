import { describe, expect, it } from "vitest";

import { resolveAgentNativeCommitSha } from "./build-id.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

describe("resolveAgentNativeCommitSha", () => {
  it.each([
    "AGENT_NATIVE_BUILD_SHA",
    "AGENT_NATIVE_BUILD_ID",
    "COMMIT_REF",
    "NETLIFY_COMMIT_REF",
    "VERCEL_GIT_COMMIT_SHA",
    "CF_PAGES_COMMIT_SHA",
  ])("reads a full commit from %s", (key) => {
    expect(resolveAgentNativeCommitSha({ [key]: SHA_A })).toBe(SHA_A);
  });

  it("prefers the build's own commit over the host's", () => {
    expect(
      resolveAgentNativeCommitSha({
        COMMIT_REF: SHA_B,
        AGENT_NATIVE_BUILD_SHA: SHA_A,
      }),
    ).toBe(SHA_A);
    expect(
      resolveAgentNativeCommitSha({
        COMMIT_REF: SHA_B,
        AGENT_NATIVE_BUILD_ID: SHA_A,
      }),
    ).toBe(SHA_A);
  });

  it("skips a value that isn't a full commit and keeps looking", () => {
    expect(
      resolveAgentNativeCommitSha({
        AGENT_NATIVE_BUILD_ID: "deploy-64f1",
        COMMIT_REF: SHA_B,
      }),
    ).toBe(SHA_B);
  });

  it.each([
    ["a short commit", "abc1234"],
    ["one character too few", "a".repeat(39)],
    ["one character too many", "a".repeat(41)],
    ["a non-hex value of the right length", "g".repeat(40)],
    ["a commit with a prefix", `v${"a".repeat(39)}`],
    ["a commit with a suffix", `${"a".repeat(39)}-`],
    ["an empty value", ""],
    ["only spaces", "   "],
  ])("rejects %s", (_label, value) => {
    expect(resolveAgentNativeCommitSha({ COMMIT_REF: value })).toBe("");
  });

  it("returns empty when nothing names a commit", () => {
    expect(resolveAgentNativeCommitSha({})).toBe("");
    expect(resolveAgentNativeCommitSha({ DEPLOY_ID: SHA_A })).toBe("");
  });

  it("trims and lowercases what it returns", () => {
    expect(
      resolveAgentNativeCommitSha({ COMMIT_REF: `  ${"A".repeat(40)}\n` }),
    ).toBe(SHA_A);
  });
});
