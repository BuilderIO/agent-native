import { describe, expect, it, vi } from "vitest";

vi.mock("h3", () => ({
  getRequestHeader: (event: any, name: string) =>
    event.headers?.[name] ?? event.headers?.[name.toLowerCase()],
}));

import { isSameOriginRequest } from "./request-origin.js";

function fakeEvent(headers: Record<string, string> = {}) {
  return { headers } as any;
}

describe("isSameOriginRequest", () => {
  it.each([
    {
      name: "matching Origin and Host",
      headers: { host: "app.example.com", origin: "https://app.example.com" },
      expected: true,
    },
    {
      name: "matching Origin and forwarded Host behind a dev proxy",
      headers: {
        host: "127.0.0.1:8088",
        origin: "http://127.0.0.1:8080",
        "x-forwarded-host": "127.0.0.1:8080",
        "x-forwarded-proto": "http",
        "sec-fetch-site": "same-origin",
      },
      expected: true,
    },
    {
      name: "cross-site fetch metadata despite a matching forwarded Host",
      headers: {
        host: "internal.example:3000",
        origin: "https://app.example.com",
        "x-forwarded-host": "app.example.com",
        "x-forwarded-proto": "https",
        "sec-fetch-site": "cross-site",
      },
      expected: false,
    },
    {
      name: "mismatched web origin",
      headers: { host: "app.example.com", origin: "https://evil.example.com" },
      expected: false,
    },
    {
      name: "same host with a mismatched scheme",
      headers: { host: "app.example.com", origin: "http://app.example.com" },
      expected: false,
    },
    {
      name: "malformed Origin",
      headers: { host: "app.example.com", origin: "://invalid" },
      expected: false,
    },
    {
      name: "same-origin fetch metadata",
      headers: { "sec-fetch-site": "same-origin" },
      expected: true,
    },
    {
      name: "non-browser navigation fetch metadata",
      headers: { "sec-fetch-site": "none" },
      expected: true,
    },
    {
      name: "cross-site fetch metadata",
      headers: { "sec-fetch-site": "cross-site" },
      expected: false,
    },
    {
      name: "non-browser client without browser headers",
      headers: {},
      expected: true,
    },
    {
      name: "Tauri production origin against loopback app host",
      headers: { host: "localhost:3000", origin: "tauri://localhost" },
      expected: true,
    },
    {
      name: "Tauri HTTP origin against loopback app host",
      headers: { host: "127.0.0.1:3000", origin: "http://tauri.localhost" },
      expected: true,
    },
    {
      name: "Tauri HTTPS origin against loopback app host",
      headers: { host: "localhost:3000", origin: "https://tauri.localhost" },
      expected: true,
    },
    {
      name: "Tauri dev origin against loopback app host",
      headers: { host: "127.0.0.1:3000", origin: "http://localhost:1420" },
      expected: true,
    },
    {
      name: "Tauri loopback-IP dev origin against loopback app host",
      headers: { host: "localhost:3000", origin: "http://127.0.0.1:1420" },
      expected: true,
    },
    {
      name: "Tauri production origin against remote app host",
      headers: { host: "app.example.com", origin: "tauri://localhost" },
      expected: true,
    },
    {
      name: "Tauri web origin against remote app host",
      headers: { host: "app.example.com", origin: "https://tauri.localhost" },
      expected: false,
    },
    {
      name: "Tauri dev origin against remote app host",
      headers: { host: "app.example.com", origin: "http://localhost:1420" },
      expected: false,
    },
  ])("handles $name", ({ headers, expected }) => {
    expect(isSameOriginRequest(fakeEvent(headers))).toBe(expected);
  });
});
