import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { requireEnvKey } from "./missing-key.js";

function createMockResponse() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("requireEnvKey", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns false when env var is set", () => {
    process.env.MY_KEY = "some-value";
    const res = createMockResponse();
    const missing = requireEnvKey(res, "MY_KEY", "My Service");
    expect(missing).toBe(false);
    expect(res.json).not.toHaveBeenCalled();
  });

  it("returns true and sends response when env var is missing", () => {
    delete process.env.MISSING_KEY;
    const res = createMockResponse();
    const missing = requireEnvKey(res, "MISSING_KEY", "My Service");
    expect(missing).toBe(true);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      error: "missing_api_key",
      key: "MISSING_KEY",
      label: "My Service",
      message: "Connect your My Service account to see this data",
      settingsPath: "/settings",
    });
  });

  it("uses custom message when provided", () => {
    delete process.env.MISSING_KEY;
    const res = createMockResponse();
    requireEnvKey(res, "MISSING_KEY", "Stripe", {
      message: "Add your Stripe key to continue",
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Add your Stripe key to continue" }),
    );
  });

  it("uses custom settingsPath when provided", () => {
    delete process.env.MISSING_KEY;
    const res = createMockResponse();
    requireEnvKey(res, "MISSING_KEY", "Stripe", {
      settingsPath: "/admin/keys",
    });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ settingsPath: "/admin/keys" }),
    );
  });
});
