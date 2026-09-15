import { describe, expect, it } from "vitest";

import manifest from "../public/manifest.json";

describe("extension manifest security contract", () => {
  it("declares only the capabilities needed by the native browser bridge", () => {
    expect(manifest.minimum_chrome_version).toBe("116");
    expect(manifest.key).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(manifest.permissions).toEqual([
      "alarms",
      "debugger",
      "nativeMessaging",
      "storage",
      "tabs",
    ]);
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("externally_connectable");
    expect(manifest).not.toHaveProperty("content_scripts");
  });
});
