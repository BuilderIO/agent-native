import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp"), once: vi.fn() },
  ipcMain: { handle: vi.fn() },
  net: { request: vi.fn() },
  session: { fromPartition: vi.fn() },
}));

vi.mock("@agent-native/core/terminal/server", () => ({
  createPtyWebSocketServer: vi.fn(),
}));

vi.mock("../app-store", () => ({
  loadApps: vi.fn(() => []),
}));

import {
  desktopTerminalInfo,
  resolveTargetUrl,
  shouldForwardRequestHeader,
  shouldForwardResponseHeader,
} from "./desktop-chat.js";

describe("desktop chat relay target URLs", () => {
  it("returns an authenticated desktop-owned terminal endpoint", () => {
    expect(desktopTerminalInfo(4567, "a token")).toEqual({
      available: true,
      wsUrl: "ws://127.0.0.1:4567/ws?token=a%20token",
    });
  });

  it("rejects dot-segment traversal after URL normalization", () => {
    expect(
      resolveTargetUrl(
        "https://mail.example.com",
        "/_agent-native/../settings",
      ),
    ).toBeNull();
    expect(
      resolveTargetUrl(
        "https://mail.example.com",
        "/_agent-native/%2e%2e/settings",
      ),
    ).toBeNull();
  });

  it("keeps allowed agent-native routes on the app origin", () => {
    expect(
      resolveTargetUrl(
        "https://mail.example.com/app",
        "/_agent-native/agent-chat?surface=desktop",
      )?.toString(),
    ).toBe(
      "https://mail.example.com/app/_agent-native/agent-chat?surface=desktop",
    );
  });

  it("does not forward Electron-restricted browser headers", () => {
    expect(shouldForwardRequestHeader("content-length", "42")).toBe(false);
    expect(shouldForwardRequestHeader("cookie2", "legacy")).toBe(false);
    expect(shouldForwardRequestHeader("transfer-encoding", "chunked")).toBe(
      false,
    );
    expect(
      shouldForwardRequestHeader("x-agent-native-surface", "desktop"),
    ).toBe(true);
    expect(
      shouldForwardRequestHeader(
        "x-internal",
        "secret",
        new Set(["connection", "x-internal"]),
      ),
    ).toBe(false);
  });

  it("drops stale compression and length headers from proxied responses", () => {
    expect(shouldForwardResponseHeader("content-encoding", "gzip")).toBe(false);
    expect(shouldForwardResponseHeader("content-length", "123")).toBe(false);
    expect(shouldForwardResponseHeader("transfer-encoding", "chunked")).toBe(
      false,
    );
    expect(shouldForwardResponseHeader("cache-control", "no-store")).toBe(true);
  });
});
