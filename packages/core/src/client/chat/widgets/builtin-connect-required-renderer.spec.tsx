// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BUILDER_CONNECT_PROVIDER,
  BUILDER_CONNECT_PROVIDER_LABEL,
  connectRequiredResult,
} from "../../../shared/connect-required.js";
import { resolveToolRenderer } from "../tool-render-registry.js";
import { resolveBuiltinFallbackToolRenderer } from "./builtin-tool-renderers.js";

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

  // The reported dead end: the tool stopped on a missing integration and the
  // user got prose with nothing to click. Any tool's result shape must produce
  // the Connect control, with no chatUI renderer and no tool allow-list.
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
