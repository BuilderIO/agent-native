// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToolkitI18nCatalog } from "../i18n.js";
import { credentialPartnerKey, SecretsSection } from "./SecretsSection.js";

const catalog = createToolkitI18nCatalog({ messages: {} });

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  appMountedPath: (path: string) => path,
}));

vi.mock("../org/workspace-app-links.js", () => ({
  useOrgSwitcherAppLinks: () => ({
    isWorkspace: true,
    dispatchVaultHref: "/dispatch/vault",
    apps: [],
    isLoading: false,
    dispatchHref: "",
    dispatchAllAppsHref: "",
  }),
}));

const idRow = {
  key: "HUBSPOT_MCP_CLIENT_ID",
  label: "HubSpot MCP OAuth client ID",
  scope: "workspace",
  kind: "api-key",
  required: false,
};
const secretRow = {
  key: "HUBSPOT_MCP_CLIENT_SECRET",
  label: "HubSpot MCP OAuth client secret",
  scope: "workspace",
  kind: "api-key",
  required: false,
};
const unrelated = {
  key: "TAVILY_API_KEY",
  label: "Tavily API Key",
  scope: "workspace",
  kind: "api-key",
  required: false,
  status: "unset",
};
const setId = {
  ...idRow,
  status: "set",
  source: "workspace",
  managedHere: true,
  last4: "abcd",
};

function stubFetch(secrets: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/org/me"))
        return Response.json({ email: "a@example.test", role: "admin" });
      if (url.endsWith("/secrets/adhoc")) return Response.json([]);
      return Response.json(secrets);
    }),
  );
}

function render(root: Root, focusKey?: string) {
  root.render(
    <AgentNativeI18nProvider catalog={catalog} persistPreference={false}>
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <SecretsSection focusKey={focusKey} />
        </TooltipProvider>
      </QueryClientProvider>
    </AgentNativeI18nProvider>,
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("SecretsSection credential pairs", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("pairs client IDs with client secrets only", () => {
    expect(credentialPartnerKey("HUBSPOT_MCP_CLIENT_ID")).toBe(
      "HUBSPOT_MCP_CLIENT_SECRET",
    );
    expect(credentialPartnerKey("GOOGLE_CLIENT_SECRET")).toBe(
      "GOOGLE_CLIENT_ID",
    );
    expect(credentialPartnerKey("OPENAI_API_KEY")).toBeNull();
  });

  it("shows both halves of an unset pair when a deep link names the ID", async () => {
    stubFetch([
      { ...idRow, status: "unset" },
      { ...secretRow, status: "unset" },
      unrelated,
    ]);
    await act(async () => render(root, "HUBSPOT_MCP_CLIENT_ID"));
    await settle();
    expect(container.textContent).toContain("HubSpot MCP OAuth client ID");
    expect(container.textContent).toContain("HubSpot MCP OAuth client secret");
    expect(container.textContent).not.toContain("Tavily API Key");
  });

  // Once the ID was saved, the same link showed only the saved ID and the
  // secret it still needed had no row on the page.
  it("opens the missing client secret when the linked client ID is already saved", async () => {
    stubFetch([setId, { ...secretRow, status: "unset" }, unrelated]);
    await act(async () => render(root, "HUBSPOT_MCP_CLIENT_ID"));
    await settle();
    expect(container.textContent).toContain("HubSpot MCP OAuth client secret");
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="HubSpot MCP OAuth client secret"]',
    );
    expect(input).toBeTruthy();
    expect(input).toBe(document.activeElement);
  });
});
