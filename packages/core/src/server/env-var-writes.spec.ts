import { afterEach, describe, expect, it, vi } from "vitest";
import { isEnvVarWriteAllowed } from "./env-var-writes.js";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_ALLOW = process.env.AGENT_NATIVE_ALLOW_ENV_VAR_WRITES;

describe("isEnvVarWriteAllowed", () => {
  afterEach(() => {
    restoreEnv("NODE_ENV", ORIGINAL_NODE_ENV);
    restoreEnv("AGENT_NATIVE_ALLOW_ENV_VAR_WRITES", ORIGINAL_ALLOW);
    vi.unstubAllEnvs();
  });

  it("refuses request-time env writes in production even with the opt-in flag", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AGENT_NATIVE_ALLOW_ENV_VAR_WRITES", "1");

    expect(isEnvVarWriteAllowed()).toBe(false);
  });

  it("allows explicit non-production single-tenant opt-in", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AGENT_NATIVE_ALLOW_ENV_VAR_WRITES", "1");

    expect(isEnvVarWriteAllowed()).toBe(true);
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
