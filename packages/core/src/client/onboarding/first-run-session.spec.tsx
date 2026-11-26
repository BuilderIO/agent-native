// @vitest-environment happy-dom

import React, { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../analytics.js", () => ({
  setSentryUser: vi.fn(),
  trackEvent: vi.fn(),
  trackSessionStatus: vi.fn(),
}));

const SESSION_PATH = "/_agent-native/auth/session";
const COMPLETE_PATH = "/_agent-native/onboarding/first-run/complete";
const COMPLETED_EVENT = "agent-native:first-run-completed";
const identity = {
  userId: "first-run-person",
  authUserId: "first-run-person",
  email: "person@example.com",
  name: "Person",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let root: Root;
let container: HTMLDivElement;
let sessionModule: typeof import("../use-session.js");
let complete: typeof import("./first-run-status.js").completeFirstRunOnboarding;
let completedListener: (() => void) | undefined;

function WorkspaceNavigation({ unlocked = false }: { unlocked?: boolean }) {
  const { session, status } = sessionModule.useSession();
  return (
    <main>
      <output data-status={status} data-org={session?.orgId ?? ""} />
      {unlocked && status === "authenticated" && session?.orgId ? (
        <a href="/library?view=agents">Agents</a>
      ) : null}
    </main>
  );
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetModules();
  sessionModule = await import("../use-session.js");
  complete = (await import("./first-run-status.js")).completeFirstRunOnboarding;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  if (completedListener)
    window.removeEventListener(COMPLETED_EVENT, completedListener);
  completedListener = undefined;
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("first-run completion and mounted session", () => {
  it("refreshes the provisioned workspace before unlocking identity-scoped navigation", async () => {
    const refreshedSession = deferred<Response>();
    const calls: string[] = [];
    let sessionReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const pathname = new URL(String(input), window.location.href).pathname;
        calls.push(pathname);
        if (pathname === SESSION_PATH) {
          sessionReads += 1;
          return sessionReads === 1 ? json(identity) : refreshedSession.promise;
        }
        if (pathname === COMPLETE_PATH) return json({ ok: true });
        throw new Error(`Unexpected request: ${pathname}`);
      }),
    );
    await act(async () => {
      root.render(<WorkspaceNavigation />);
    });
    expect(container.querySelector("output")?.getAttribute("data-status")).toBe(
      "authenticated",
    );
    expect(container.querySelector("output")?.getAttribute("data-org")).toBe(
      "",
    );
    const eventStates: Array<{ orgId: string | null; hasAgents: boolean }> = [];
    completedListener = () => {
      flushSync(() => root.render(<WorkspaceNavigation unlocked />));
      eventStates.push({
        orgId:
          container.querySelector("output")?.getAttribute("data-org") ?? null,
        hasAgents: Boolean(
          container.querySelector('a[href="/library?view=agents"]'),
        ),
      });
    };
    window.addEventListener(COMPLETED_EVENT, completedListener);
    let completion!: Promise<void>;
    await act(async () => {
      completion = complete({
        expectedUserEmail: identity.email,
        expectedOrgId: "new-workspace",
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(eventStates).toEqual([]);
    expect(sessionReads).toBe(2);
    expect(container.querySelector("a")).toBeNull();
    await act(async () => {
      refreshedSession.resolve(json({ ...identity, orgId: "new-workspace" }));
      await completion;
    });
    expect(calls).toEqual([SESSION_PATH, COMPLETE_PATH, SESSION_PATH]);
    expect(eventStates).toEqual([{ orgId: "new-workspace", hasAgents: true }]);
    expect(container.querySelector("a")?.textContent).toBe("Agents");
  });

  it("does not refresh or unlock a workspace when completion is refused", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const pathname = new URL(String(input), window.location.href).pathname;
        calls.push(pathname);
        if (pathname === SESSION_PATH) return json(identity);
        if (pathname === COMPLETE_PATH)
          return json({ error: "Not completed" }, 500);
        throw new Error(`Unexpected request: ${pathname}`);
      }),
    );
    await act(async () => root.render(<WorkspaceNavigation />));
    const completed = vi.fn();
    completedListener = completed;
    window.addEventListener(COMPLETED_EVENT, completedListener);
    await expect(
      complete({
        expectedUserEmail: identity.email,
        expectedOrgId: "new-workspace",
      }),
    ).rejects.toThrow("first-run completion failed: 500");
    expect(calls).toEqual([SESSION_PATH, COMPLETE_PATH]);
    expect(completed).not.toHaveBeenCalled();
    expect(container.querySelector("output")?.getAttribute("data-org")).toBe(
      "",
    );
    expect(container.querySelector("a")).toBeNull();
  });
});
