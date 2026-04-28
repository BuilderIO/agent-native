import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  signInternalToken,
  verifyInternalToken,
  extractBearerToken,
} from "./internal-token.js";

describe("integrations/internal-token", () => {
  let prevSecret: string | undefined;

  beforeEach(() => {
    prevSecret = process.env.A2A_SECRET;
    process.env.A2A_SECRET = "test-secret-do-not-use-in-prod";
  });

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.A2A_SECRET;
    else process.env.A2A_SECRET = prevSecret;
  });

  it("signs a token that the verifier accepts for the same task id", () => {
    const token = signInternalToken("task-1");
    expect(verifyInternalToken("task-1", token)).toBe(true);
  });

  it("rejects a token bound to a different task id", () => {
    const token = signInternalToken("task-1");
    expect(verifyInternalToken("task-2", token)).toBe(false);
  });

  it("rejects an empty or malformed token", () => {
    expect(verifyInternalToken("task-1", "")).toBe(false);
    expect(verifyInternalToken("task-1", "no-dot")).toBe(false);
    expect(verifyInternalToken("task-1", ".")).toBe(false);
  });

  it("rejects a token with a tampered signature", () => {
    const token = signInternalToken("task-1");
    const [ts, sig] = token.split(".");
    // Flip a hex digit in the signature.
    const tampered = `${ts}.${sig.slice(0, -1)}${sig.slice(-1) === "0" ? "1" : "0"}`;
    expect(verifyInternalToken("task-1", tampered)).toBe(false);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signInternalToken("task-1");
    process.env.A2A_SECRET = "different-secret";
    expect(verifyInternalToken("task-1", token)).toBe(false);
  });

  it("throws when signing without an A2A_SECRET", () => {
    delete process.env.A2A_SECRET;
    expect(() => signInternalToken("task-1")).toThrow(/A2A_SECRET/);
  });

  it("extractBearerToken parses a Bearer header", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
    expect(extractBearerToken("bearer xyz")).toBe("xyz");
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken("")).toBeNull();
    expect(extractBearerToken("Basic abc")).toBeNull();
  });
});
