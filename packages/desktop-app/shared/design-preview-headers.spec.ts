import { describe, expect, it } from "vitest";

import {
  designPreviewChromeUserAgent,
  designPreviewResponseHeaders,
} from "./design-preview-headers";
import { deriveDesktopDesignPreviewPartition } from "./design-preview-protocol";

describe("Design native screen response policy", () => {
  const headers = {
    "X-Frame-Options": ["DENY"],
    "content-security-policy": [
      "default-src 'self'; frame-ancestors 'none'; script-src 'self'",
    ],
    "Set-Cookie": ["session=example; Secure"],
  };
  const partition =
    deriveDesktopDesignPreviewPartition({
      appId: "design",
      workspaceId: "w",
      connectionId: "https://example.com",
    }) ?? "";
  it("relaxes only framing directives in isolated screen documents", () => {
    expect(
      designPreviewResponseHeaders(partition, "mainFrame", headers),
    ).toEqual({
      "content-security-policy": ["default-src 'self'; script-src 'self'"],
      "Set-Cookie": headers["Set-Cookie"],
    });
  });
  it("keeps framing protections on subframes a visited page creates", () => {
    expect(designPreviewResponseHeaders(partition, "subFrame", headers)).toBe(
      headers,
    );
  });
  it("preserves app windows, unrelated partitions and asset responses", () => {
    for (const other of [
      "persist:design",
      "persist:app-design",
      "",
      "persist:design-preview:untrusted",
    ]) {
      expect(designPreviewResponseHeaders(other, "mainFrame", headers)).toBe(
        headers,
      );
    }
    expect(designPreviewResponseHeaders(partition, "script", headers)).toBe(
      headers,
    );
  });
  it("presents Chrome without Electron or the application product", () => {
    expect(
      designPreviewChromeUserAgent(
        "Mozilla/5.0 Agent-Native/1.0 Chrome/140.0 Safari/537.36 Electron/43.0 AgentNativeDesktop/1.0",
      ),
    ).toBe("Mozilla/5.0 Chrome/140.0 Safari/537.36");
  });
});
