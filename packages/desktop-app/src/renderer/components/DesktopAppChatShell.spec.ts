import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  desktopSettingsTabForSection,
  shouldShowDesktopAppChatSidebar,
} from "./DesktopAppChatShell.js";

describe("desktop app chat shell", () => {
  it("routes chat settings requests to the native settings surface", () => {
    expect(desktopSettingsTabForSection("llm")).toBe("providers");
    expect(desktopSettingsTabForSection("secrets:OPENAI_API_KEY")).toBe(
      "connections",
    );
    expect(desktopSettingsTabForSection("uploads")).toBe("workspace");
    expect(desktopSettingsTabForSection("terminal")).toBe("terminal");
    expect(desktopSettingsTabForSection("voice")).toBe("general");
  });

  it("creates an isolated query client for each mounted app shell", () => {
    const source = readFileSync(
      new URL("./DesktopAppChatShell.tsx", import.meta.url),
      "utf8",
    );
    const componentStart = source.indexOf(
      "export default function DesktopAppChatShell(",
    );
    const queryClientCreation = source.indexOf(
      "createAgentNativeQueryClient()",
    );

    expect(queryClientCreation).toBeGreaterThan(componentStart);
    expect(source).not.toContain(
      "const desktopChatQueryClient = createAgentNativeQueryClient();",
    );
  });

  it("shows chat while the guest app is still loading", () => {
    expect(
      shouldShowDesktopAppChatSidebar({
        apiUrl: "https://dispatch.example/_agent-native/agent-chat",
        appAuthState: "unknown",
      }),
    ).toBe(true);
    expect(
      shouldShowDesktopAppChatSidebar({
        apiUrl: "https://dispatch.example/_agent-native/agent-chat",
        appAuthState: "authenticated",
        desktopIdentityStatus: "checking",
      }),
    ).toBe(true);
    expect(
      shouldShowDesktopAppChatSidebar({
        apiUrl: "https://dispatch.example/_agent-native/agent-chat",
        appAuthState: "unauthenticated",
      }),
    ).toBe(false);
    expect(
      shouldShowDesktopAppChatSidebar({
        apiUrl: "https://dispatch.example/_agent-native/agent-chat",
        appAuthState: "authenticated",
        desktopIdentityStatus: "sign-in-required",
      }),
    ).toBe(false);
    expect(
      shouldShowDesktopAppChatSidebar({
        apiUrl: "https://dispatch.example/_agent-native/agent-chat",
        appAuthState: "authenticated",
        desktopIdentityStatus: "signed-in",
      }),
    ).toBe(true);
    expect(
      shouldShowDesktopAppChatSidebar({
        apiUrl: "https://dispatch.example/_agent-native/agent-chat",
        appAuthState: "authenticated",
        desktopIdentityStatus: "signed-in",
        chatEnabled: false,
      }),
    ).toBe(false);
  });
});
