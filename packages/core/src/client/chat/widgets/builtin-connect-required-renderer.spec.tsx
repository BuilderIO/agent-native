// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACTION_CHAT_UI_DATA_TABLE_RENDERER } from "../../../action-ui.js";
import {
  BUILDER_CONNECT_PROVIDER,
  BUILDER_CONNECT_PROVIDER_LABEL,
  connectRequiredResult,
} from "../../../shared/connect-required.js";
import { resolveToolRenderer } from "../tool-render-registry.js";
import {
  resolveBuiltinActionChatRenderer,
  resolveBuiltinFallbackToolRenderer,
} from "./builtin-tool-renderers.js";

describe("built-in connect-required renderer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 503 })),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders a Connect control for any tool blocked on Builder", async () => {
    const context = {
      toolName: "start-workspace-app-creation",
      args: { prompt: "Create an app for onboarding requests" },
      resultJson: {
        mode: "builder-unavailable",
        appId: "onboarding-requests",
        reason: "builder-not-connected",
        ...connectRequiredResult({
          provider: BUILDER_CONNECT_PROVIDER,
          providerLabel: BUILDER_CONNECT_PROVIDER_LABEL,
          reason:
            "Builder.io is not connected for this workspace, so the app could not be created.",
        }),
      },
      isRunning: false,
    };

    const Renderer = resolveToolRenderer(context);
    expect(Renderer).not.toBeNull();
    expect(resolveBuiltinFallbackToolRenderer(context)).toBe(Renderer);

    act(() => {
      root.render(Renderer ? <Renderer context={context} /> : null);
    });
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    expect(container.textContent).toContain("Builder.io");
    expect(container.textContent).toContain(
      "Builder.io is not connected for this workspace",
    );
    expect(container.querySelector("button")).not.toBeNull();
  });

  it("links to the connect url for a non-Builder provider", async () => {
    const context = {
      toolName: "some-provider-action",
      args: {},
      resultJson: connectRequiredResult({
        provider: "acme",
        providerLabel: "Acme",
        reason: "Acme is not connected for this workspace.",
        connectUrl: "https://example.test/connect",
      }),
      isRunning: false,
    };

    const Renderer = resolveToolRenderer(context);
    expect(Renderer).not.toBeNull();

    act(() => {
      root.render(Renderer ? <Renderer context={context} /> : null);
    });
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.test/connect");
    expect(link?.textContent).toContain("Acme");
  });

  it("outranks the action's own chatUI renderer", async () => {
    const context = {
      toolName: "query-staged-dataset",
      args: {},
      resultJson: connectRequiredResult({
        provider: "acme",
        providerLabel: "Acme",
        reason: "Acme is not connected for this workspace.",
        connectUrl: "https://example.test/connect",
      }),
      isRunning: false,
      chatUI: { renderer: ACTION_CHAT_UI_DATA_TABLE_RENDERER },
    };

    const Renderer = resolveBuiltinActionChatRenderer(context);
    expect(Renderer).not.toBeNull();
    expect(resolveToolRenderer(context)).toBe(Renderer);

    act(() => {
      root.render(Renderer ? <Renderer context={context} /> : null);
    });
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    expect(container.textContent).toContain(
      "Acme is not connected for this workspace",
    );
  });

  it("drops an unsafe connect target instead of rendering it", async () => {
    const context = {
      toolName: "some-remote-mcp-tool",
      args: {},
      resultJson: {
        connectRequired: {
          provider: "acme",
          providerLabel: "Acme",
          reason: "Acme is not connected.",
          message: "Acme is not connected. Connect Acme to continue.",
          connectUrl: "javascript:alert(1)",
        },
      },
      isRunning: false,
    };

    const Renderer = resolveToolRenderer(context);
    expect(Renderer).not.toBeNull();

    act(() => {
      root.render(Renderer ? <Renderer context={context} /> : null);
    });
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    expect(container.textContent).toContain("Acme is not connected.");
    expect(container.querySelector("a")).toBeNull();
    expect(container.innerHTML).not.toContain("javascript:");
  });

  it("offers a reconnect control even when status still reports connected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ configured: true, orgName: "Acme Space" }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const context = {
      toolName: "start-workspace-app-creation",
      args: {},
      resultJson: connectRequiredResult({
        provider: BUILDER_CONNECT_PROVIDER,
        providerLabel: BUILDER_CONNECT_PROVIDER_LABEL,
        reason: "Builder.io is not connected for this workspace.",
      }),
      isRunning: false,
    };

    const Renderer = resolveToolRenderer(context);
    act(() => {
      root.render(Renderer ? <Renderer context={context} /> : null);
    });
    await act(async () => {
      await vi.dynamicImportSettled();
    });

    expect(container.querySelector("button")).not.toBeNull();
    expect(container.textContent).not.toContain("Connected to");
  });

  it("does not claim a successful result", () => {
    expect(
      resolveToolRenderer({
        toolName: "start-workspace-app-creation",
        args: {},
        resultJson: { mode: "builder", appId: "onboarding-requests" },
        isRunning: false,
      }),
    ).toBeNull();
  });
});
