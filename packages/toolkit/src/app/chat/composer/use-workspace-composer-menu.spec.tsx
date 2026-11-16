import type { WorkspaceComposerMenuContribution } from "@agent-native/toolkit/composer/runtime-adapters";
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import englishMessages from "../../i18n/catalogs/en-US.js";
import { useWorkspaceComposerMenu } from "./use-workspace-composer-menu.js";

const mocks = vi.hoisted(() => ({
  capabilities: vi.fn(),
  refetch: vi.fn(),
  select: vi.fn(),
  org: { orgId: "alpha", role: "member" },
}));
vi.mock("./use-agentkit-capabilities.js", () => ({
  useAgentKitCapabilities: mocks.capabilities,
}));
vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) =>
    (englishMessages as Record<string, string>)[
      key.replace(/^agentChat\./, "")
    ],
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: mocks.org }),
}));
vi.mock("@agent-native/core/client/resources", () => ({
  isMcpIntegrationCatalogAvailable: () => true,
  useCreateMcpServer: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("../../resources/index.js", () => ({
  McpIntegrationDialogDeferred: ({
    open,
    defaultScope,
  }: {
    open: boolean;
    defaultScope: string;
  }) =>
    open ? (
      <div role="dialog" data-scope={defaultScope}>
        Connect tools
      </div>
    ) : null,
}));

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let contribution: WorkspaceComposerMenuContribution;
let enabled = false;
let state: {
  scopeKey: string;
  data:
    | {
        sources: { figma: { available: boolean } };
        integrations: { id: string; label: string; kind: "mcp" }[];
      }
    | undefined;
  integrationsLoading: boolean;
  integrationsError: Error | null;
  refetchIntegrations: typeof mocks.refetch;
};
function Harness() {
  contribution = useWorkspaceComposerMenu({
    enabled,
    onSelectIntegration: mocks.select,
  });
  return (
    <>
      {contribution.items.map((item) => (
        <button key={item.id} onClick={() => item.onSelect?.()}>
          {item.label}
        </button>
      ))}
      {contribution.error && <span role="alert">{contribution.error}</span>}
      {contribution.overlays}
    </>
  );
}
async function render() {
  await act(async () => root.render(<Harness />));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.select.mockReset();
  mocks.refetch.mockReset();
  mocks.capabilities.mockReset();
  state = {
    scopeKey: "chat:member:alpha",
    data: {
      sources: { figma: { available: false } },
      integrations: [{ id: "mcp:tools", label: "Tools", kind: "mcp" }],
    },
    integrationsLoading: false,
    integrationsError: null,
    refetchIntegrations: mocks.refetch,
  };
  mocks.capabilities.mockImplementation(() => state);
  mocks.org = { orgId: "alpha", role: "member" };
  enabled = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("workspace composer contributions", () => {
  it("stages real integration references and offers the shared setup primitive separately", async () => {
    await render();
    expect(mocks.capabilities).toHaveBeenLastCalledWith({ enabled: false });
    enabled = true;
    await render();
    expect(mocks.capabilities).toHaveBeenLastCalledWith({ enabled: true });
    await act(async () => container.querySelector("button")!.click());
    expect(mocks.select).toHaveBeenCalledWith({
      label: "Tools",
      refType: "integration",
      refId: "mcp:tools",
      refPath: "mcp:tools",
      source: "workspace-integration",
      icon: "integration",
    });
    expect(
      contribution.items.every((item) => item.section === "integrations"),
    ).toBe(true);
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Connect an integration…")!
        .click(),
    );
    expect(
      container.querySelector('[role="dialog"]')?.getAttribute("data-scope"),
    ).toBe("user");
  });
  it("starts organization administrators in their allowed shared scope", async () => {
    mocks.org = { orgId: "alpha", role: "owner" };
    await render();
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Connect an integration…")!
        .click(),
    );
    expect(
      container.querySelector('[role="dialog"]')?.getAttribute("data-scope"),
    ).toBe("org");
  });

  it("rejects an old selection after identity changes away and back, and keeps unreadable catalogs visible as errors", async () => {
    await render();
    const select = contribution.items[0].onSelect!;
    state = { ...state, scopeKey: "chat:member:beta" };
    await render();
    state = { ...state, scopeKey: "chat:member:alpha" };
    await render();
    expect(select).toThrow();
    expect(mocks.select).not.toHaveBeenCalled();
    state = {
      ...state,
      data: undefined,
      integrationsError: new Error("permission lookup unavailable"),
    };
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Could not load integrations.",
    );
    expect(contribution.items.map((item) => item.id)).toEqual([
      "workspace-connect-integrations",
    ]);
  });
});
