// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentProviderSetupForm } from "./ProviderSetupForm.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchFixture(orgMe: () => Promise<Response> | Response) {
  const saves: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/_agent-native/org/me")) return orgMe();
      if (url.endsWith("/_agent-native/secrets")) return json([]);
      if (url.endsWith("/_agent-native/agent-engine/api-key")) {
        saves.push(JSON.parse(String(init?.body)));
        return json({
          ok: true,
          defaultModel: { status: "skipped", reason: "not-allowed" },
        });
      }
      throw new Error(`Unexpected test request: ${url}`);
    },
  );
  return { fetchMock, saves };
}

function orgMe(role: "owner" | "admin" | "member" | null) {
  return json({
    email: "viewer@example.test",
    orgId: role ? "org-1" : null,
    orgName: role ? "Acme" : null,
    role,
    icon: null,
    iconRevision: 0,
  });
}

async function renderForm(
  fetchMock: typeof fetch,
  props: React.ComponentProps<typeof AgentProviderSetupForm> = {},
): Promise<Root> {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AgentProviderSetupForm {...props} />
      </QueryClientProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return root;
}

function submitButton(): HTMLButtonElement {
  const button = document.querySelector('button[type="submit"]');
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error("Missing submit button");
  }
  return button;
}

async function enterKeyAndSave(value: string) {
  const input = document.querySelector<HTMLInputElement>(
    'input[type="password"]',
  );
  if (!input) throw new Error("Missing API key input");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    submitButton().click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("AgentProviderSetupForm save scope", () => {
  it.each([
    ["member", "user"],
    ["admin", "org"],
    ["owner", "org"],
    [null, "user"],
  ] as const)("saves a %s's key at %s scope", async (role, scope) => {
    const fixture = fetchFixture(() => orgMe(role));
    const root = await renderForm(fixture.fetchMock);

    await enterKeyAndSave("sk-ant-obviously-fake");

    expect(fixture.saves).toEqual([
      expect.objectContaining({ key: "ANTHROPIC_API_KEY", scope }),
    ]);
    act(() => root.unmount());
  });

  it("uses the scope the caller chose over the role default", async () => {
    const fixture = fetchFixture(() => orgMe("admin"));
    const root = await renderForm(fixture.fetchMock, { scope: "user" });

    await enterKeyAndSave("sk-ant-obviously-fake");

    expect(fixture.saves).toEqual([
      expect.objectContaining({ key: "ANTHROPIC_API_KEY", scope: "user" }),
    ]);
    act(() => root.unmount());
  });

  it("keeps Save off with a retry when the viewer's role can't be read", async () => {
    let orgMeFails = true;
    const fixture = fetchFixture(() =>
      orgMeFails
        ? json({ error: "Org context unavailable" }, 500)
        : orgMe("admin"),
    );
    const root = await renderForm(fixture.fetchMock);

    await enterKeyAndSave("sk-ant-obviously-fake");

    expect(submitButton().disabled).toBe(true);
    expect(fixture.saves).toEqual([]);
    expect(document.body.textContent).toContain(
      "Couldn't load your organization role",
    );

    orgMeFails = false;
    const retry = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Retry",
    );
    if (!retry) throw new Error("Missing Retry button");
    await act(async () => {
      retry.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      submitButton().click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fixture.saves).toEqual([
      expect.objectContaining({ key: "ANTHROPIC_API_KEY", scope: "org" }),
    ]);
    act(() => root.unmount());
  });

  it("holds Save until the viewer's role is known", async () => {
    const fixture = fetchFixture(() => new Promise<Response>(() => {}));
    const root = await renderForm(fixture.fetchMock);

    await enterKeyAndSave("sk-ant-obviously-fake");

    expect(submitButton().disabled).toBe(true);
    expect(fixture.saves).toEqual([]);
    act(() => root.unmount());
  });
});
