// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  org: "org-a",
  actor: "a@example.test",
  canFetch: false,
  call: vi.fn(),
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () => ({ data: { orgId: state.org } }),
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    status: "authenticated",
    session: { email: state.actor },
  }),
}));
vi.mock("@agent-native/core/client/hooks", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/hooks")>()),
  useActionQueryCanFetch: () => state.canFetch,
  callAction: (...args: unknown[]) => state.call(...args),
}));
import { useThreadCreators } from "./use-thread-creators";

it("waits for the binding and does not reuse creator data across workspaces", async () => {
  state.canFetch = false;
  state.org = "org-a";
  state.actor = "a@example.test";
  state.call.mockReset().mockImplementation(async () => ({
    creators: [
      { email: "owner@example.test", name: state.org, imageUrl: null },
    ],
  }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Probe() {
    const result = useThreadCreators(["owner@example.test"]);
    return (
      <span>{result.creators.get("owner@example.test")?.name ?? "none"}</span>
    );
  }
  const render = () =>
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
  try {
    await render();
    expect(state.call).not.toHaveBeenCalled();
    state.canFetch = true;
    await render();
    await vi.waitFor(() => expect(host.textContent).toBe("org-a"));
    state.org = "org-b";
    state.canFetch = false;
    await render();
    expect(host.textContent).toBe("none");
    expect(state.call).toHaveBeenCalledTimes(1);
    state.canFetch = true;
    await render();
    await vi.waitFor(() => expect(host.textContent).toBe("org-b"));
    expect(state.call).toHaveBeenCalledTimes(2);
    expect(state.call.mock.calls[1]?.[2]).toMatchObject({ method: "GET" });
    state.call.mockRejectedValueOnce(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );
    await act(async () => {
      await client.invalidateQueries({
        queryKey: ["action", "list-thread-creators"],
      });
    });
    await vi.waitFor(() => expect(host.textContent).toBe("none"));
  } finally {
    act(() => root.unmount());
    host.remove();
    client.clear();
  }
});
