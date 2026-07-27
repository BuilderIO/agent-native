import { describe, expect, it } from "vitest";

import {
  buildVsCodeOpenUri,
  normalizeOpenUrl,
  titleForUrl,
  VSCODE_OPEN_AUTHORITY,
} from "./links";

describe("normalizeOpenUrl", () => {
  it("keeps http and https URLs", () => {
    expect(normalizeOpenUrl("https://dispatch.agent-native.com")).toBe(
      "https://dispatch.agent-native.com/",
    );
    expect(normalizeOpenUrl("http://localhost:3000/_agent-native/open")).toBe(
      "http://localhost:3000/_agent-native/open",
    );
  });

  it("drops URL fragments before embedding", () => {
    expect(normalizeOpenUrl("https://app.example.com/path#token")).toBe(
      "https://app.example.com/path",
    );
  });

  it("unwraps the Agent Native VS Code URI", () => {
    const target =
      "https://mail.agent-native.com/_agent-native/open?view=inbox";
    expect(normalizeOpenUrl(buildVsCodeOpenUri(target))).toBe(target);
  });

  it("unwraps agentnative URLs when they carry a webUrl", () => {
    const target =
      "https://mail.agent-native.com/_agent-native/open?view=inbox";
    expect(
      normalizeOpenUrl(
        `agentnative://open?webUrl=${encodeURIComponent(target)}`,
      ),
    ).toBe(target);
  });

  it("rejects unknown schemes and malformed input", () => {
    expect(normalizeOpenUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeOpenUrl("not a url")).toBeNull();
    expect(
      normalizeOpenUrl("vscode://elsewhere.extension/open?url=x"),
    ).toBeNull();
    expect(normalizeOpenUrl("agentnative://open?view=inbox")).toBeNull();
  });
});

describe("buildVsCodeOpenUri", () => {
  it("builds the URI handled by the extension", () => {
    const target = "https://app.example.com/_agent-native/open?view=inbox";
    const uri = buildVsCodeOpenUri(target);
    expect(uri).toBe(
      `vscode://${VSCODE_OPEN_AUTHORITY}/open?url=https%3A%2F%2Fapp.example.com%2F_agent-native%2Fopen%3Fview%3Dinbox`,
    );
  });
});

describe("titleForUrl", () => {
  it("uses the host when available", () => {
    expect(titleForUrl("https://mail.agent-native.com/inbox")).toBe(
      "Agent Native: mail.agent-native.com",
    );
  });
});
