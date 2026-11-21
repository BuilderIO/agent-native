import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const status = vi.hoisted(() => ({ read: vi.fn() }));
vi.unmock("./use-session.js");
vi.mock("./client-status-requests.js", () => ({
  fetchAuthSessionStatus: status.read,
  invalidateClientStatusRequest: vi.fn(),
  expireClientStatusResult: vi.fn(),
  SESSION_RESULT_LIFETIME_MS: 30_000,
  statusResultAnsweredAt: () => undefined,
}));
vi.mock("./analytics.js", () => ({
  trackEvent: vi.fn(),
  trackSessionStatus: vi.fn(),
  setSentryUser: vi.fn(),
}));
import { PRIVATE_ACTION_SCOPE_HEADER } from "../shared/private-action-scope.js";
import { currentPrivateActionScope } from "./session-identity.js";
import {
  forgetUiActionCapability,
  useActionMutation,
  type PrivateActionMutationResult,
} from "./use-action.js";
import {
  beginSignOut,
  notifySessionInvalidated,
  useSession,
} from "./use-session.js";

it("publishes known scope, normalizes personal/fallback identity, and cancels pending writes on org/auth/email refresh", async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.localStorage)
    Object.defineProperty(window, "localStorage", {
      value: new Storage(),
      configurable: true,
    });
  const first = {
    userId: "effective-user",
    email: " User@Example.Test ",
    name: "Test User",
  };
  status.read.mockResolvedValue({ state: "available", value: first });
  forgetUiActionCapability();
  const onSuccess = vi.fn();
  let actionResponse: ((value: Response) => void) | undefined;
  const posts: {
    header: string | null;
    signal: AbortSignal | null | undefined;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (!url.includes("/actions/"))
        return Promise.resolve(new Response("{}"));
      posts.push({
        header: new Headers(init?.headers).get(PRIVATE_ACTION_SCOPE_HEADER),
        signal: init?.signal,
      });
      return new Promise<Response>((resolve) => {
        actionResponse = resolve;
      });
    }),
  );
  let mutation!: PrivateActionMutationResult<{ secret: string }>;
  function Probe() {
    useSession();
    mutation = useActionMutation<void, { secret: string }>(
      "scope-private-write",
      {
        privateInputs: true,
        uiOnly: true,
        retry: false,
        retryUiCapability: false,
        onSuccess,
      },
    );
    return null;
  }
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: 3 } },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    expect(currentPrivateActionScope()).toEqual({
      email: "user@example.test",
      orgId: null,
      authUserId: "effective-user",
    });
    for (const next of [
      { ...first, orgId: "organization-b", authUserId: "effective-user" },
      { ...first, orgId: "organization-b", authUserId: "authenticated-other" },
      {
        ...first,
        email: "changed@example.test",
        orgId: "organization-b",
        authUserId: "authenticated-other",
      },
    ]) {
      const scopeBefore = currentPrivateActionScope();
      let completion!: Promise<void>;
      await act(async () => {
        completion = mutation.mutateAsync({
          secret: "synthetic-private-value",
        });
        void completion.catch(() => {});
      });
      expect(mutation.isPending).toBe(true);
      const sent = posts.at(-1)!;
      expect(JSON.parse(sent.header!)).toEqual(scopeBefore);
      status.read.mockResolvedValue({ state: "available", value: next });
      await act(async () => {
        await notifySessionInvalidated();
      });
      expect(mutation.isIdle).toBe(true);
      expect(sent.signal?.aborted).toBe(true);
      await act(async () => {
        actionResponse!(new Response("{}"));
        await completion.catch(() => {});
      });
      expect(onSuccess).not.toHaveBeenCalled();
      expect(currentPrivateActionScope()).toEqual({
        email: next.email.trim().toLowerCase(),
        orgId: next.orgId,
        authUserId: next.authUserId,
      });
      expect(client.getMutationCache().getAll()).toHaveLength(0);
    }
    await act(async () => {
      beginSignOut();
    });
    expect(currentPrivateActionScope()).toBeUndefined();
  } finally {
    await act(async () => {
      root.unmount();
    });
    client.clear();
    container.remove();
    vi.unstubAllGlobals();
  }
});
