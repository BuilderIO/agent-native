import { describe, expect, it } from "vitest";

import {
  contentFilesWebviewDenialReason,
  type ContentFilesWebviewAccessInput,
} from "./content-files-webview-access";

const allowed: ContentFilesWebviewAccessInput = {
  senderType: "webview",
  senderId: 42,
  senderUrl: "http://localhost:8083/local-files",
  activeAppId: "content",
  activeWebviewContentsId: 42,
  contentAppAvailable: true,
  trustedOrigins: ["http://localhost:8083"],
  developmentOrigins: [],
  development: false,
};

describe("contentFilesWebviewDenialReason", () => {
  it("allows only the active registered Content webview at its trusted origin", () => {
    expect(contentFilesWebviewDenialReason(allowed)).toBeNull();
  });

  it.each([
    [{ senderType: "window" }, "sender-not-webview"],
    [{ activeAppId: "mail" }, "content-not-active"],
    [{ activeWebviewContentsId: 41 }, "sender-not-active-webview"],
    [{ contentAppAvailable: false }, "content-app-unavailable"],
    [{ senderUrl: "not a URL" }, "invalid-sender-url"],
    [{ senderUrl: "http://localhost:9999/local-files" }, "untrusted-origin"],
  ] as const)("rejects mismatched evidence", (override, reason) => {
    expect(contentFilesWebviewDenialReason({ ...allowed, ...override })).toBe(
      reason,
    );
  });

  it("allows an explicit development origin only in development", () => {
    const input = {
      ...allowed,
      senderUrl: "http://localhost:8080/frame?app=content",
      trustedOrigins: ["https://content.agent-native.com"],
      developmentOrigins: ["http://localhost:8080"],
    };
    expect(contentFilesWebviewDenialReason(input)).toBe("untrusted-origin");
    expect(
      contentFilesWebviewDenialReason({ ...input, development: true }),
    ).toBeNull();
  });

  it("allows an explicitly configured packaged dev origin", () => {
    expect(
      contentFilesWebviewDenialReason({
        ...allowed,
        trustedOrigins: [
          "https://content.agent-native.com",
          "http://localhost:8083",
        ],
      }),
    ).toBeNull();
  });
});
