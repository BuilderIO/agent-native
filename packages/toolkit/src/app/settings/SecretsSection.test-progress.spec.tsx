// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { TooltipProvider } from "@agent-native/toolkit/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToolkitI18nCatalog } from "../i18n.js";
import { SecretsSection } from "./SecretsSection.js";

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

const ID_LABEL = "HubSpot MCP OAuth client ID";
const CANDIDATE = "candidate-fixture-value";
const unsetId = {
  key: "HUBSPOT_MCP_CLIENT_ID",
  label: ID_LABEL,
  scope: "workspace",
  kind: "api-key",
  required: false,
  status: "unset",
};
const setId = {
  ...unsetId,
  status: "set",
  source: "workspace",
  managedHere: true,
  last4: "abcd",
};

type Call = { url: string; method: string; body: string | undefined };
type Deferred = { resolve: (res: Response) => void };

function stubFetch(secrets: unknown[]) {
  const calls: Call[] = [];
  const pending: Deferred[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method !== "GET" || url.endsWith("/test")) {
        calls.push({ url, method, body: init?.body as string | undefined });
      }
      if (url.endsWith("/test")) {
        return new Promise<Response>((resolve) => pending.push({ resolve }));
      }
      if (url.endsWith("/org/me"))
        return Response.json({ email: "a@example.test", role: "admin" });
      if (url.endsWith("/secrets/adhoc")) return Response.json([]);
      return Response.json(secrets);
    }),
  );
  return { calls, pending };
}

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("expected a value in the mounted settings UI");
  }
  return value;
}

describe("SecretsSection test progress and result", () => {
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

  async function mount(secrets: unknown[]) {
    const stub = stubFetch(secrets);
    await act(async () => {
      root.render(
        <AgentNativeI18nProvider catalog={catalog} persistPreference={false}>
          <QueryClientProvider client={new QueryClient()}>
            <TooltipProvider>
              <SecretsSection focusKey="HUBSPOT_MCP_CLIENT_ID" />
            </TooltipProvider>
          </QueryClientProvider>
        </AgentNativeI18nProvider>,
      );
    });
    await vi.waitFor(() => expect(buttonWith("Test")).toBeTruthy());
    return stub;
  }

  const buttons = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
  const buttonWith = (text: string) =>
    buttons().find((b) => String(b.textContent).trim() === text);
  const result = () =>
    container.querySelector<HTMLElement>('[data-testid="secret-test-result"]');
  const input = () =>
    must(
      container.querySelector<HTMLInputElement>(
        `input[aria-label="${ID_LABEL}"]`,
      ),
    );
  const testButton = () => must(buttonWith("Test"));

  function type(value: string) {
    const setter = must(
      must(Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value"))
        .set,
    );
    act(() => {
      setter.call(input(), value);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  async function flushMicrotasks() {
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  }

  async function deliver(pending: Deferred[], res: Response) {
    const consumed = new Promise<void>((done) => {
      const readBody = res.json.bind(res);
      res.json = async () => {
        try {
          return await readBody();
        } finally {
          done();
        }
      };
    });
    await act(async () => {
      must(pending.shift()).resolve(res);
      await consumed;
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  }

  const resolveTest = (pending: Deferred[], status: number, payload: unknown) =>
    deliver(pending, Response.json(payload, { status }));

  const noPersistence = (calls: Call[]) =>
    calls.filter((c) => !c.url.endsWith("/test"));

  it("labels a pending candidate test and keeps a partial result readable", async () => {
    const { calls, pending } = await mount([unsetId]);
    type(CANDIDATE);

    act(() => testButton().click());

    expect(buttonWith("Testing…")).toBeTruthy();
    expect(must(buttonWith("Testing…")).disabled).toBe(true);
    await flushMicrotasks();
    expect(result()?.getAttribute("role")).toBe("status");
    expect(result()?.textContent).toBe("Testing…");
    expect(calls.filter((c) => c.url.endsWith("/test"))).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "/_agent-native/secrets/HUBSPOT_MCP_CLIENT_ID/test",
      method: "POST",
      body: JSON.stringify({ value: CANDIDATE }),
    });

    await resolveTest(pending, 200, {
      ok: true,
      note: "No validator registered",
    });

    expect(buttonWith("Test")).toBeTruthy();
    expect(result()?.textContent).toBe("This key can't be checked on its own");
    expect(result()?.textContent).not.toContain("Working");
    await flushMicrotasks();
    expect(result()?.textContent).toBe("This key can't be checked on its own");
    expect(noPersistence(calls)).toEqual([]);
  });

  it("keeps a failed candidate result visible", async () => {
    const { pending } = await mount([unsetId]);
    type(CANDIDATE);
    act(() => testButton().click());
    await flushMicrotasks();
    await resolveTest(pending, 200, { ok: false, error: "Provider rejected" });
    expect(result()?.textContent).toBe("Provider rejected");
  });

  it("reports a malformed response as a failure, not success", async () => {
    const { pending } = await mount([unsetId]);
    type(CANDIDATE);
    act(() => testButton().click());
    await flushMicrotasks();
    await deliver(pending, new Response("<html>", { status: 200 }));
    expect(result()?.textContent).toBe("Test failed");
  });

  it("clears a stale candidate result when the input is edited", async () => {
    const { pending } = await mount([unsetId]);
    type(CANDIDATE);
    act(() => testButton().click());
    await flushMicrotasks();
    await resolveTest(pending, 200, { ok: false, error: "Provider rejected" });
    expect(result()).toBeTruthy();

    type(`${CANDIDATE}-edited`);
    expect(result()).toBeNull();
  });

  it("ignores a completion that lands after the input changed", async () => {
    const { pending } = await mount([unsetId]);
    type(CANDIDATE);
    act(() => testButton().click());
    await flushMicrotasks();
    type(`${CANDIDATE}-edited`);
    expect(result()).toBeNull();

    await resolveTest(pending, 200, { ok: true });
    expect(result()).toBeNull();
    expect(testButton().disabled).toBe(false);
  });

  it("shows the same progress and result for a stored value", async () => {
    const { calls, pending } = await mount([setId]);

    act(() => testButton().click());

    expect(buttonWith("Testing…")).toBeTruthy();
    expect(result()?.textContent).toBe("Testing…");
    await flushMicrotasks();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toBeUndefined();

    await resolveTest(pending, 200, { ok: true });

    expect(result()?.textContent).toBe("Working");
    expect(noPersistence(calls)).toEqual([]);
  });

  it("clears a stored-value result once the secret is deleted", async () => {
    const { pending } = await mount([setId]);
    act(() => testButton().click());
    await flushMicrotasks();
    await resolveTest(pending, 200, { ok: true });
    expect(result()?.textContent).toBe("Working");

    act(() => must(buttonWith("Delete")).click());
    await act(async () => must(buttonWith("Confirm")).click());
    await vi.waitFor(() => expect(result()).toBeNull());
  });
});
