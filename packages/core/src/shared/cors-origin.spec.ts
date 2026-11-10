import { describe, expect, it } from "vitest";

import { normalizeCorsOrigin } from "./cors-origin.js";

describe("normalizeCorsOrigin", () => {
  it.each([
    ["https://app.example.com", "https://app.example.com"],
    ["HTTPS://App.Example.com", "https://app.example.com"],
    ["https://app.example.com/", "https://app.example.com"],
    ["https://app.example.com///", "https://app.example.com"],
    ["  app.example.com  ", "https://app.example.com"],
    ["http://localhost:5173", "http://localhost:5173"],
    ["tauri://localhost", "tauri://localhost"],
  ])("normalizes %j", (value, expected) => {
    expect(normalizeCorsOrigin(value)).toBe(expected);
  });

  it("keeps scheme and port distinct", () => {
    expect(normalizeCorsOrigin("http://app.example.com")).not.toBe(
      normalizeCorsOrigin("app.example.com"),
    );
    expect(normalizeCorsOrigin("https://app.example.com:8443")).not.toBe(
      normalizeCorsOrigin("https://app.example.com"),
    );
  });
});
