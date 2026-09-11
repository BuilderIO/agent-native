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

  it("keeps cached app chat sidebars mounted without replaying entrance animation", () => {
    const source = readFileSync(
      new URL("./DesktopAppChatShell.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("animateDesktop={false}");
  });

  it("keeps the shell open state shared while new app chats start empty", () => {
    const source = readFileSync(
      new URL("./DesktopAppChatShell.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('openStorageKey="desktop-app-chat"');
    expect(source).toContain("storageKey={`desktop-app-chat:${appId}`}");
    expect(source).toContain('position="left"');
    expect(source).toContain('agentChatSurface="desktop"');
    expect(source).toContain("toggleScopeId={toggleScopeId}");
    expect(source).toContain("defaultMode={defaultMode}");
    expect(source).toContain("renderCliTab={");
    expect(source).toContain('newCliTabLabel="New CLI tab"');
    expect(source).toContain("chatOnly={false}");
    expect(source).toContain("restoreActiveThread={false}");
    expect(source).toContain("enabled={showChatSidebar}");
    expect(source).not.toContain(
      "{showChatSidebar ? (\n          <MemoryRouter>",
    );
    expect(source).not.toContain("Sign in on the right");
    expect(source).not.toContain("data-desktop-app-sign-in");
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

  it("keeps the resolved chat endpoint across app tab switches", () => {
    const source = readFileSync(
      new URL("./DesktopAppChatShell.tsx", import.meta.url),
      "utf8",
    );
    const apiUrlEffectStart = source.indexOf("setApiUrl(null);");
    const apiUrlEffectEnd = source.indexOf(
      "  useEffect(() => {\n    void preloadAgentChatSurface();",
      apiUrlEffectStart,
    );
    const apiUrlEffect = source.slice(apiUrlEffectStart, apiUrlEffectEnd);

    expect(apiUrlEffect).toContain("}, [appId]);");
    expect(apiUrlEffect).not.toContain("setDesktopChatRelayActive");
  });

  it("keeps the app webview boundary visible with or without chat", () => {
    const shellCss = readFileSync(
      new URL("../shell.css", import.meta.url),
      "utf8",
    );

    expect(shellCss).toMatch(
      /\.desktop-app-webview-surface,\s*\.code-agents-embedded-app-surface\s*\{[\s\S]*?border-radius: var\(--agent-native-raised-radius, 8px\) 0 0\s+var\(--agent-native-raised-radius, 8px\);[\s\S]*?border-left: 0;[\s\S]*?box-shadow: 0 0 0 1px hsl\(var\(--border\)\);[\s\S]*?\}/,
    );
    expect(shellCss).not.toContain(
      "transition: grid-template-columns 200ms var(--ease-collapse)",
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
