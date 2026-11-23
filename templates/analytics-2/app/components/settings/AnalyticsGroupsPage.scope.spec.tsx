// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({
  orgId: "org-a",
  email: "member@example.test",
}));
vi.mock("@agent-native/core/client/org", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/org")>()),
  useOrg: () => ({
    data: { orgId: identity.orgId, role: "member" },
    isPending: false,
    isError: false,
  }),
}));
vi.mock("@agent-native/core/client/use-session", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/use-session")>()),
  useSession: () => ({ session: { email: identity.email }, isLoading: false }),
}));
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));

import { AnalyticsGroupsPage } from "./AnalyticsWorkspaceSettings";

const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host);
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
afterEach(() => {
  act(() => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});

it("report A2-GROUP-CACHE-WORKSPACE: hides the prior workspace while the next group list loads", async () => {
  const deferred: { resolve?: (response: Response) => void } = {};
  const pendingB = new Promise<Response>((resolve) => {
    deferred.resolve = resolve;
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      identity.orgId === "org-a"
        ? Promise.resolve(
            new Response(
              JSON.stringify([{ id: "a", name: "Org A private group" }]),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          )
        : pendingB,
    ),
  );
  const render = () =>
    root.render(
      <QueryClientProvider client={client}>
        <AnalyticsGroupsPage />
      </QueryClientProvider>,
    );
  await act(async () => render());
  await vi.waitFor(() =>
    expect(host.textContent).toContain("Org A private group"),
  );
  identity.orgId = "org-b";
  await act(async () => render());
  expect(host.textContent).not.toContain("Org A private group");
  if (!deferred.resolve)
    throw new Error("Second workspace request was not initialized");
  const completeB = deferred.resolve;
  await act(async () =>
    completeB(
      new Response(JSON.stringify([{ id: "b", name: "Org B group" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  await vi.waitFor(() => expect(host.textContent).toContain("Org B group"));
});
