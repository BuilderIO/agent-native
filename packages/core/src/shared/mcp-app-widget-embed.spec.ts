import { describe, expect, it } from "vitest";

import {
  EMBED_TOKEN_STORAGE_KEY,
  embedTokenStorageKey,
  getMcpAppWidgetEmbedBootScriptBody,
  MCP_CHAT_BRIDGE_STORAGE_KEY,
  mcpChatBridgeStorageKey,
  resolveExternalEmbedTargetBasePath,
  resolveWorkspaceAppMountPath,
} from "./mcp-app-widget-embed.js";

describe("MCP app widget embed boot storage", () => {
  it("keeps the legacy keys outside workspace runtime and scopes workspace mounts", () => {
    expect(embedTokenStorageKey("/event-finder", false)).toBe(
      EMBED_TOKEN_STORAGE_KEY,
    );
    expect(mcpChatBridgeStorageKey("/event-finder", false)).toBe(
      MCP_CHAT_BRIDGE_STORAGE_KEY,
    );
    expect(embedTokenStorageKey("//event-finder/", true)).toBe(
      `${EMBED_TOKEN_STORAGE_KEY}:/event-finder`,
    );
    expect(mcpChatBridgeStorageKey("/", true)).toBe(
      `${MCP_CHAT_BRIDGE_STORAGE_KEY}:/`,
    );
  });

  it("resolves external embed storage with the runtime's root and nested mounts", () => {
    expect(
      resolveExternalEmbedTargetBasePath("/deck/reports", {
        workspaceRuntime: true,
        workspaceAppPath: "/",
        workspaceAppMountPaths: ["/deck"],
      }),
    ).toBe("/deck");
    expect(
      resolveExternalEmbedTargetBasePath("/deck/reports", {
        workspaceRuntime: true,
        workspaceAppPath: "/",
        workspaceAppMountPaths: ["/deck"],
      }),
    ).toBe("/deck");
    expect(
      resolveExternalEmbedTargetBasePath("/reports/detail", {
        workspaceRuntime: true,
        workspaceAppPath: "/",
      }),
    ).toBe("");
    expect(
      resolveExternalEmbedTargetBasePath("/reports/overview", {
        workspaceRuntime: true,
        workspaceAppPath: "/",
        workspaceAppMountPaths: ["/mail"],
      }),
    ).toBe("");
    expect(
      resolveExternalEmbedTargetBasePath("/mail/inbox/threads", {
        workspaceRuntime: true,
        workspaceAppPath: "/mail/inbox",
        workspaceAppMountPaths: ["/mail/inbox"],
      }),
    ).toBe("/mail/inbox");
    expect(
      resolveExternalEmbedTargetBasePath("/mail/inbox/threads", {
        workspaceRuntime: true,
        routerBasePath: "/mail",
        workspaceAppMountPaths: ["/mail/inbox"],
      }),
    ).toBe("/mail/inbox");
    expect(
      resolveExternalEmbedTargetBasePath("/mail/inbox/threads", {
        workspaceRuntime: true,
      }),
    ).toBe("/mail");
    expect(
      resolveWorkspaceAppMountPath("/mail/inbox/threads", {
        workspaceAppPath: "/mail",
        workspaceAppMountPaths: ["/mail/inbox"],
      }),
    ).toBe("/mail");
  });

  it("leaves a non-workspace external target unresolved", () => {
    expect(resolveExternalEmbedTargetBasePath("/deck/reports")).toBeUndefined();
    expect(
      resolveExternalEmbedTargetBasePath("/reports/detail", {
        workspaceRuntime: true,
        workspaceAppMountPaths: ["/mail"],
      }),
    ).toBeUndefined();
  });

  it("embeds the self-contained workspace resolver and mount inputs", () => {
    const script = getMcpAppWidgetEmbedBootScriptBody(undefined, true);

    expect(script).toContain(
      "var resolveMcpAppEmbedBasePath = function resolveMcpAppEmbedBasePath",
    );
    expect(script).toContain(
      "workspaceAppMountPaths: appConfig.workspaceAppMountPaths",
    );
    expect(script).toContain(
      'resolveMcpAppEmbedBasePath("external-target", external.target',
    );
    expect(script).toContain(
      'resolveMcpAppEmbedBasePath("workspace-path", w.location.pathname',
    );
    expect(script).toContain("storageScopeAvailable = false");
  });
});
