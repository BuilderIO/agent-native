import { describe, expect, it } from "vitest";
import { getAllowedCorsOrigin } from "./cors-origins.js";

describe("getAllowedCorsOrigin", () => {
  it("allows Tauri native app origins even when an explicit allowlist is configured", () => {
    for (const origin of [
      "tauri://localhost",
      "tauri://tauri.localhost",
      "http://tauri.localhost",
      "https://tauri.localhost",
    ]) {
      expect(
        getAllowedCorsOrigin(origin, {
          allowedOrigins: ["https://app.example.com"],
        }),
      ).toBe(origin);
    }
  });

  it("does not let ordinary localhost bypass an explicit allowlist", () => {
    expect(
      getAllowedCorsOrigin("http://localhost:1420", {
        allowedOrigins: ["https://app.example.com"],
      }),
    ).toBeNull();
  });

  it("allows localhost origins when no allowlist is configured", () => {
    expect(
      getAllowedCorsOrigin("http://localhost:1420", {
        allowedOrigins: [],
        allowLocalhostWhenNoAllowlist: true,
      }),
    ).toBe("http://localhost:1420");
  });

  it("honors explicit browser origins", () => {
    expect(
      getAllowedCorsOrigin("https://preview.example.com", {
        allowedOrigins: ["https://preview.example.com"],
      }),
    ).toBe("https://preview.example.com");
  });
});
