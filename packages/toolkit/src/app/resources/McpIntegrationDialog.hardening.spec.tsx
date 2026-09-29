import { DEFAULT_MCP_INTEGRATIONS } from "@agent-native/core/client/resources/mcp-integration-catalog";
import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  McpIntegrationDialog,
  type McpIntegrationDialogProps,
} from "./McpIntegrationDialog.js";

const mocks = vi.hoisted(() => ({
  oauth: vi.fn(),
  settings: vi.fn(),
  create: vi.fn(),
  close: vi.fn(),
}));
vi.mock("../shared/index.js", async (original) => ({
  ...(await original<typeof import("../shared/index.js")>()),
  openAgentSettings: mocks.settings,
}));
vi.mock(
  "@agent-native/core/client/resources/mcp-integration-catalog",
  async (original) => ({
    ...(await original<
      typeof import("@agent-native/core/client/resources/mcp-integration-catalog")
    >()),
    navigateToMcpOAuthStart: mocks.oauth,
    isCustomMcpIntegrationEnabled: () => true,
  }),
);
vi.mock(
  "@agent-native/core/client/resources/use-mcp-servers",
  async (original) => ({
    ...(await original<
      typeof import("@agent-native/core/client/resources/use-mcp-servers")
    >()),
    useMcpServers: () => ({
      data: { user: [], org: [], orgId: null, role: null },
      isSuccess: true,
      isError: false,
      isFetching: false,
    }),
  }),
);

describe("legacy integration setup routing", () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  const figma = DEFAULT_MCP_INTEGRATIONS.find((entry) => entry.id === "figma")!;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("__AGENT_NATIVE_CONFIG__", { template: "design" });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  async function render(props: Partial<McpIntegrationDialogProps>) {
    await act(async () => {
      root.render(
        <TooltipProvider>
          <McpIntegrationDialog
            open
            onOpenChange={mocks.close}
            defaultScope="user"
            canCreateOrgMcp={false}
            hasOrg={false}
            onCreateMcpServer={mocks.create}
            integrations={[figma]}
            {...props}
          />
        </TooltipProvider>,
      );
    });
  }

  it.each([
    "initialIntegrationId",
    "connectIntegrationId",
    "quickConnectIntegrationId",
  ] as const)(
    "routes Figma's %s to the existing API-key setup, including while OAuth is unavailable",
    async (entry) => {
      await render({ [entry]: "figma", oauthReady: false });
      const submit = document.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      )!;
      expect(submit?.textContent).toBe("Use API token");
      expect(submit.disabled).toBe(false);
      await act(async () => submit.click());
      expect(mocks.settings).toHaveBeenCalledExactlyOnceWith(
        "secrets:FIGMA_ACCESS_TOKEN",
      );
      expect(mocks.close).toHaveBeenCalledExactlyOnceWith(false);
      expect(mocks.oauth).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it("does not offer unsupported OAuth when this app has no API fallback", async () => {
    vi.stubGlobal("__AGENT_NATIVE_CONFIG__", { template: "slides" });
    await render({ initialIntegrationId: "figma" });
    expect(document.body.textContent).toContain("Open setup guide");
    expect(document.querySelector('button[type="submit"]')).toBeNull();
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.oauth).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("uses the same token route from the catalog", async () => {
    await render({});
    const action = [...document.querySelectorAll("button")].find(
      (item) => item.textContent === "Use API token",
    )!;
    expect(action).toBeDefined();
    await act(async () => action.click());
    expect(mocks.settings).toHaveBeenCalledExactlyOnceWith(
      "secrets:FIGMA_ACCESS_TOKEN",
    );
    expect(mocks.oauth).not.toHaveBeenCalled();
  });

  it.each(["canva", "hubspot"])(
    "preserves the supported %s OAuth flow",
    async (id) => {
      const integration = DEFAULT_MCP_INTEGRATIONS.find(
        (entry) => entry.id === id,
      )!;
      await render({
        initialIntegrationId: id,
        integrations: [integration],
        hasOrg: true,
      });
      const submit = document.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      )!;
      expect(submit).not.toBeNull();
      expect(submit.disabled).toBe(false);
      await act(async () => submit.click());
      expect(mocks.oauth).toHaveBeenCalledTimes(1);
      const url = new URL(
        mocks.oauth.mock.calls[0][0],
        "https://app.example.test",
      );
      expect(url.searchParams.get("url")).toBe(integration.url);
      expect(url.searchParams.get("scope")).toBe("user");
      expect(mocks.settings).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it("does not block an explicitly managed client-restricted OAuth integration", async () => {
    const integration = {
      ...figma,
      id: "managed-example",
      managedOAuth: true,
      apiFallback: undefined,
    };
    await render({
      initialIntegrationId: integration.id,
      integrations: [integration],
    });
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('button[type="submit"]')!
        .click(),
    );
    expect(mocks.oauth).toHaveBeenCalledTimes(1);
    expect(mocks.settings).not.toHaveBeenCalled();
  });

  it("prevents a custom connection to the known restricted Figma endpoint from starting OAuth", async () => {
    await render({});
    const custom = [...document.querySelectorAll("button")].find(
      (item) => item.textContent === "Add your own",
    )!;
    expect(custom).toBeDefined();
    await act(async () => custom.click());
    const name = document.querySelector<HTMLInputElement>(
      'input[placeholder="Integration name"]',
    );
    const url = document.querySelector<HTMLInputElement>('input[type="url"]');
    expect(name).not.toBeNull();
    expect(url).not.toBeNull();
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setValue.call(name, "Example Figma");
      name!.dispatchEvent(new Event("input", { bubbles: true }));
      setValue.call(url, figma.url);
      url!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('button[type="submit"]')!
        .click(),
    );
    expect(mocks.settings).toHaveBeenCalledExactlyOnceWith(
      "secrets:FIGMA_ACCESS_TOKEN",
    );
    expect(mocks.oauth).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
