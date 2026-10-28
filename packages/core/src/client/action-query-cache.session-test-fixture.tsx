import type { PersistedClient } from "@tanstack/query-persist-client-core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";

import type { AuthSessionResponse } from "../server/auth.js";
import type { ActionQueryCacheStorage } from "./action-query-cache.js";
import { useActionQuery } from "./use-action.js";
import { isSessionFromFirstRead, useSession } from "./use-session.js";

export type Gate = ComponentType<{ children: ReactNode }>;
export type SessionUser = AuthSessionResponse;
export type ProbeRender = {
  title: string | undefined;
  status: string;
  userId: string | undefined;
  firstRead: boolean;
};

type Designs = { designs: Array<{ title: string }> };

const roots: Array<{ root: Root; container: HTMLDivElement }> = [];
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let restoreLocalStorage: (() => void) | undefined;

function installLocalStorageForTest(): void {
  if (restoreLocalStorage) return;
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      length: 0,
      setItem: () => {},
      getItem: () => null,
      removeItem: () => {},
      clear: () => {},
      key: () => null,
    } satisfies Storage,
  });
  restoreLocalStorage = () => {
    if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
    else Reflect.deleteProperty(window, "localStorage");
    restoreLocalStorage = undefined;
  };
}

export const ALICE: SessionUser = {
  email: "alice@example.com",
  userId: "user-alice",
  orgId: "org-1",
  testIdentity: false,
};
export const BOB: SessionUser = {
  email: "bob@example.com",
  userId: "user-bob",
  orgId: "org-1",
  testIdentity: false,
};

export function sessionResponse(user: SessionUser): Response {
  return new Response(JSON.stringify(user), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export function transientSessionFailure(): Response {
  return new Response("temporarily unavailable", { status: 503 });
}

export function designsResponse(title: string): Response {
  return new Response(
    JSON.stringify({ designs: [{ title }] } satisfies Designs),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Agent-Native-Browser-Persist": "allow",
      },
    },
  );
}

export function memoryStorage() {
  const records = new Map<string, PersistedClient>();
  const storage: ActionQueryCacheStorage = {
    get: async (key) => records.get(key),
    set: async (key, value) => {
      records.set(key, value);
    },
    del: async (key) => {
      records.delete(key);
    },
    keys: async () => [...records.keys()],
    clear: async () => {
      records.clear();
    },
  };
  return { records, storage };
}

export function stubFetch(options: {
  onSession: (request: number) => Promise<Response> | Response;
  onAction: (request: number) => Promise<Response> | Response;
}) {
  let sessionRequests = 0;
  let actionRequests = 0;
  const calls: Array<{ kind: "session" | "action"; path: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const raw =
        typeof input === "object" && "url" in input
          ? String(input.url)
          : String(input);
      const url = new URL(raw, window.location.href);
      calls.push({ kind: "session", path: url.pathname });
      if (url.pathname.endsWith("/_agent-native/auth/session")) {
        sessionRequests += 1;
        calls[calls.length - 1]!.kind = "session";
        return options.onSession(sessionRequests);
      }
      if (url.pathname.includes("/_agent-native/actions/")) {
        actionRequests += 1;
        calls[calls.length - 1]!.kind = "action";
        return options.onAction(actionRequests);
      }
      throw new Error(`Unexpected fetch in private probe: ${url.pathname}`);
    }),
  );
  return {
    calls,
    sessionCount: () => sessionRequests,
    actionCount: () => actionRequests,
  };
}

function DesignsProbe({
  onRender,
}: {
  onRender: (value: ProbeRender) => void;
}) {
  const { status, session } = useSession();
  const query = useActionQuery<Designs>("list-designs" as never);
  const title = query.data?.designs[0]?.title;
  onRender({
    title,
    status,
    userId: session?.userId,
    firstRead: isSessionFromFirstRead(),
  });
  return <span data-result>{title ?? "pending"}</span>;
}

export function StatusProbe({
  onStatus,
}: {
  onStatus: (value: { status: string; userId: string | undefined }) => void;
}) {
  const { status, session } = useSession();
  onStatus({ status, userId: session?.userId });
  return null;
}

export async function mountProbe(
  GateComponent: Gate,
  queryClient: QueryClient,
  onRender: (value: ProbeRender) => void,
  onStatus?: (value: { status: string; userId: string | undefined }) => void,
) {
  installLocalStorageForTest();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container });
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        {onStatus ? <StatusProbe onStatus={onStatus} /> : null}
        <GateComponent>
          <DesignsProbe onRender={onRender} />
        </GateComponent>
      </QueryClientProvider>,
    ),
  );
  return container;
}

export async function settle(ms = 20) {
  await act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
}

export async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 4_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await settle(20);
  return predicate();
}

export async function unmountAll() {
  for (const { root, container } of roots.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  restoreLocalStorage?.();
}

export { QueryClient };
