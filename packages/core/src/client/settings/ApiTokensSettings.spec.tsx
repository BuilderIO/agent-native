// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "member" as "owner" | "admin" | "member",
  orgId: "org-1",
  serviceTokens: { tokens: [] as unknown[] },
  createService: vi.fn(),
  revokeService: vi.fn(),
}));

vi.mock("../org/hooks.js", () => ({
  useOrg: () => ({ data: { orgId: state.orgId, role: state.role } }),
}));

vi.mock("../use-action.js", () => ({
  useActionQuery: () => ({
    data: state.serviceTokens,
    isLoading: false,
    error: null,
  }),
  useActionMutation: (name: string) => ({
    isPending: false,
    mutate: (
      input: unknown,
      options?: Record<string, (result: any) => void>,
    ) => {
      if (name === "create-org-service-token") {
        state.createService(input);
        options?.onSuccess?.({ token: "service-token" });
      } else {
        state.revokeService(input);
        options?.onSuccess?.({ ok: true });
        options?.onSettled?.({ ok: true });
      }
    },
  }),
}));

import { ApiTokensSettings } from "./ApiTokensSettings.js";

function clickByText(text: string, last = false) {
  const matches = Array.from(document.querySelectorAll("button")).filter(
    (element) => element.textContent?.trim() === text,
  );
  const button = last ? matches.at(-1) : matches[0];
  if (!button) throw new Error(`Missing button ${text}`);
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("ApiTokensSettings", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    state.role = "member";
    state.serviceTokens = { tokens: [] };
    state.createService.mockReset();
    state.revokeService.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ tokens: [] }), {
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function render() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <ApiTokensSettings />
        </QueryClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("only offers an org service token to owners and admins", async () => {
    await render();
    await act(async () => clickByText("Create token"));
    expect(document.body.textContent).toContain("Personal");
    expect(document.body.textContent).not.toContain("Org service");

    await act(async () => clickByText("Cancel"));
    state.role = "admin";
    await render();
    await act(async () => clickByText("Create token"));
    expect(document.body.textContent).toContain("Org service");
  });

  it("posts personal token mint and revoke requests to the existing connect routes", async () => {
    await render();
    await act(async () => clickByText("Create token"));
    await act(async () => clickByText("n8n"));
    await act(async () => clickByText("Create token", true));

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      "/mcp/connect/token",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ label: "n8n", ttlDays: 365 }),
      }),
    );
  });

  it("uses the existing org service actions with the CLI payload", async () => {
    state.role = "owner";
    await render();
    await act(async () => clickByText("Create token"));
    const serviceRadio = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    )[1];
    await act(async () => serviceRadio?.click());
    await act(async () => clickByText("Zapier"));
    await act(async () => clickByText("Create token", true));

    expect(state.createService).toHaveBeenCalledWith({
      name: "Zapier",
      ttlDays: 365,
    });
  });
});
