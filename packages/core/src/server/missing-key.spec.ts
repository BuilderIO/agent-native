import { describe, it, expect, vi, afterEach } from "vitest";
import { requireEnvKey } from "./missing-key.js";

// Mock h3's setResponseStatus since we're testing in a Node context without a real H3 event
vi.mock("h3", () => ({
  setResponseStatus: vi.fn(),
}));

// Minimal H3Event stub — requireEnvKey only uses it to call setResponseStatus
function createMockEvent() {
  return {} as any;
}

describe("requireEnvKey", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("returns null when env var is set", () => {
    process.env.MY_KEY = "some-value";
    const event = createMockEvent();
    const result = requireEnvKey(event, "MY_KEY", "My Service");
    expect(result).toBeNull();
  });

  it("returns missing_api_key response when env var is missing", () => {
    delete process.env.MISSING_KEY;
    const event = createMockEvent();
    const result = requireEnvKey(event, "MISSING_KEY", "My Service");
    expect(result).toEqual({
      error: "missing_api_key",
      key: "MISSING_KEY",
      label: "My Service",
      message: "Connect your My Service account to see this data",
      settingsPath: "/settings",
    });
  });

  it("uses custom message when provided", () => {
    delete process.env.MISSING_KEY;
    const event = createMockEvent();
    const result = requireEnvKey(event, "MISSING_KEY", "Stripe", {
      message: "Add your Stripe key to continue",
    });
    expect(result).toMatchObject({
      message: "Add your Stripe key to continue",
    });
  });

  it("uses custom settingsPath when provided", () => {
    delete process.env.MISSING_KEY;
    const event = createMockEvent();
    const result = requireEnvKey(event, "MISSING_KEY", "Stripe", {
      settingsPath: "/admin/keys",
    });
    expect(result).toMatchObject({ settingsPath: "/admin/keys" });
  });
});
