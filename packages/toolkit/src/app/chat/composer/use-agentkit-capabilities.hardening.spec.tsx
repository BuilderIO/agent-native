import type { AgentKitCapabilityCatalog } from "@agent-native/core/client/agent-chat";
import type {
  AuthSession,
  SessionStatus,
} from "@agent-native/core/client/use-session";
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentKitCapabilities } from "./use-agentkit-capabilities.js";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  path: "/design",
  session: { email: "member@example.test", orgId: "one" } as AuthSession | null,
  status: "authenticated" as SessionStatus,
  error: null as Error | null,
  complete: undefined as (() => void) | undefined,
}));
vi.mock("@agent-native/core/client/use-action", () => ({
  callAction: mocks.call,
  defaultActionQueryRetry: () => false,
  defaultActionQueryRetryDelay: () => 0,
}));
vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => mocks.path + path,
}));
vi.mock("@agent-native/core/client/api-surface", () => ({
  agentNativeApiDisabledReason: () => null,
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    session: mocks.session,
    status: mocks.status,
    error: mocks.error,
  }),
}));
vi.mock("@agent-native/core/client/resources/mcp-connection-resume", () => ({
  addMcpConnectionCompleteListener: (callback: () => void) => {
    mocks.complete = callback;
    return () => {
      mocks.complete = undefined;
    };
  },
}));

const catalog: AgentKitCapabilityCatalog = {
  sources: { figma: { available: true } },
  integrations: [
    { id: "github", label: "GitHub", kind: "provider-api" },
    { id: "mcp:org_one_tools", label: "Tools", kind: "mcp" },
  ],
};
const empty: AgentKitCapabilityCatalog = {
  sources: { figma: { available: false } },
  integrations: [],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("AgentKit capability lifecycle", () => {
  let client: QueryClient;
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  let result: ReturnType<typeof useAgentKitCapabilities>;
  let unmounted: boolean;
  function Harness() {
    result = useAgentKitCapabilities();
    return null;
  }
  async function render() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Harness />
        </QueryClientProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.call.mockReset().mockResolvedValue(catalog);
    mocks.path = "/design";
    mocks.session = { email: "member@example.test", orgId: "one" };
    mocks.status = "authenticated";
    mocks.error = null;
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    unmounted = false;
  });
  afterEach(async () => {
    if (!unmounted) await act(async () => root.unmount());
    client.clear();
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each(["account", "organization", "app"] as const)(
    "isolates data and cancels stale requests across a change of %s",
    async (change) => {
      const pending = deferred<AgentKitCapabilityCatalog>();
      mocks.call.mockReturnValueOnce(pending.promise);
      await render();
      const signal = mocks.call.mock.calls[0][2].signal as AbortSignal;
      if (change === "account")
        mocks.session = { ...mocks.session!, email: "other@example.test" };
      if (change === "organization")
        mocks.session = { ...mocks.session!, orgId: "two" };
      if (change === "app") mocks.path = "/slides";
      const next = deferred<AgentKitCapabilityCatalog>();
      mocks.call.mockReturnValueOnce(next.promise);
      await render();
      expect(signal.aborted).toBe(true);
      expect(result.data).toBeUndefined();
      expect(result.integrationsLoading).toBe(true);
      pending.resolve(catalog);
      await settle();
      expect(result.data).toBeUndefined();
      next.resolve(empty);
      await act(async () => {
        await vi.waitFor(() => expect(result.data).toEqual(empty));
      });
    },
  );

  it("does not expose a previous successful catalog when changing organizations", async () => {
    await render();
    await settle();
    expect(result.data).toEqual(catalog);
    mocks.call.mockReturnValueOnce(new Promise(() => {}));
    mocks.session = { ...mocks.session!, orgId: "two" };
    await render();
    expect(result.data).toBeUndefined();
    expect(result.integrationsLoading).toBe(true);
  });

  it("does not repopulate filtered integrations from a settings cache", async () => {
    client.setQueryData(["mcp-servers"], {
      user: [],
      org: [
        {
          mergedId: "org_one_other-app",
          firstParty: true,
          status: { state: "connected", toolCount: 4 },
        },
      ],
    });
    mocks.call.mockResolvedValue(empty);
    await render();
    await settle();
    expect(result.data).toEqual(empty);
    expect(mocks.call).toHaveBeenCalledTimes(1);
  });

  it("revalidates MCP deletion and replaces the old catalog", async () => {
    await render();
    await settle();
    await act(async () => {
      client.setQueryData(["mcp-servers"], {});
    });
    await settle();
    mocks.call.mockResolvedValue(empty);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["mcp-servers"] });
    });
    await settle();
    expect(result.data).toEqual(empty);
  });

  it("refreshes after MCP connection completion", async () => {
    await render();
    await settle();
    mocks.call.mockResolvedValue(empty);
    await act(async () => {
      mocks.complete!();
    });
    await settle();
    expect(result.data).toEqual(empty);
  });

  it("clears stale readiness after a failed refresh and supports retry", async () => {
    await render();
    await settle();
    mocks.call.mockRejectedValueOnce(new Error("Catalog unavailable"));
    await act(async () => {
      await expect(result.refetchIntegrations()).rejects.toThrow(
        "Catalog unavailable",
      );
    });
    await settle();
    expect(result.data).toBeUndefined();
    expect(result.integrationsLoading).toBe(false);
    expect(result.integrationsError?.message).toBe("Catalog unavailable");
    await act(async () => {
      await result.refetchIntegrations();
    });
    await settle();
    expect(result.data).toEqual(catalog);
    expect(result.integrationsError).toBeNull();
  });

  it("distinguishes session loading, session errors, and signing out", async () => {
    mocks.status = "loading";
    await render();
    expect(result.integrationsLoading).toBe(true);
    expect(mocks.call).not.toHaveBeenCalled();
    mocks.status = "unavailable";
    mocks.error = new Error("Session unavailable");
    await render();
    expect(result.integrationsLoading).toBe(false);
    expect(result.integrationsError).toBe(mocks.error);
    mocks.status = "authenticated";
    mocks.error = null;
    await render();
    await settle();
    expect(result.data).toEqual(catalog);
    mocks.status = "signing-out";
    await render();
    expect(result.data).toBeUndefined();
    expect(result.integrationsLoading).toBe(false);
  });

  it("rejects an old retry callback after scope changes", async () => {
    await render();
    await settle();
    const retry = result.refetchIntegrations;
    mocks.path = "/slides";
    await render();
    await expect(retry()).rejects.toMatchObject({ name: "AbortError" });
    mocks.path = "/design";
    await render();
    await expect(retry()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborts unmounted requests and rejects their retry completion", async () => {
    await render();
    await settle();
    const pending = deferred<AgentKitCapabilityCatalog>();
    mocks.call.mockReturnValueOnce(pending.promise);
    const retry = result.refetchIntegrations();
    const rejection = expect(retry).rejects.toMatchObject({
      name: "AbortError",
    });
    const signal = mocks.call.mock.calls.at(-1)![2].signal as AbortSignal;
    await act(async () => root.unmount());
    unmounted = true;
    expect(signal.aborted).toBe(true);
    pending.resolve(catalog);
    await rejection;
    expect(mocks.complete).toBeUndefined();
  });
});
