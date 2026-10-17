// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentKitIntegrationMenu } from "./use-agentkit-integration-menu.js";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
type Input = Parameters<typeof useAgentKitIntegrationMenu>[0];

describe("AgentKit menu stale selection prevention", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let input: Input;
  let result: ReturnType<typeof useAgentKitIntegrationMenu>;
  let unmounted: boolean;
  function Harness() {
    result = useAgentKitIntegrationMenu(input);
    return null;
  }
  function render() {
    act(() => root.render(<Harness />));
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    unmounted = false;
    input = {
      scopeKey: "member:org",
      onSelect: vi.fn(),
      capabilities: {
        scopeKey: "design:member:org",
        data: {
          sources: { figma: { available: false } },
          integrations: [
            { id: "github", label: "GitHub", kind: "provider-api" },
          ],
        },
        integrationsLoading: false,
        integrationsError: null,
        refetchIntegrations: vi.fn(),
      },
    };
  });
  afterEach(() => {
    if (!unmounted) act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  it.each([
    "scope",
    "scope-return",
    "removed",
    "error",
    "loading",
    "unmount",
  ] as const)("rejects captured selections after %s", (change) => {
    render();
    const select = result.picker!.onSelect!;
    const item = result.picker!.items![0];
    if (change === "scope-return") {
      const original = input.capabilities;
      input.capabilities = { ...original, scopeKey: "slides:member:org" };
      render();
      input.capabilities = original;
    }
    if (change === "scope")
      input.capabilities = {
        ...input.capabilities,
        scopeKey: "slides:member:org",
      };
    if (change === "removed")
      input.capabilities = {
        ...input.capabilities,
        data: { ...input.capabilities.data!, integrations: [] },
      };
    if (change === "error")
      input.capabilities = {
        ...input.capabilities,
        integrationsError: new Error("Unavailable"),
      };
    if (change === "loading")
      input.capabilities = {
        ...input.capabilities,
        integrationsLoading: true,
      };
    if (change === "unmount") {
      act(() => root.unmount());
      unmounted = true;
    } else render();
    expect(() => select(item)).toThrow(
      "agentChat.composer.integrations.loadFailed",
    );
    expect(input.onSelect).not.toHaveBeenCalled();
    if (change === "error" || change === "loading")
      expect(result.picker!.items).toEqual([]);
  });
});
