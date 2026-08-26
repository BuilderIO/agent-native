// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `signingOut` is deliberately one-way for the life of a document, so every
// case needs a fresh module rather than a reset hook.
async function loadSignOut() {
  vi.resetModules();
  const [{ signOut }, { isSigningOut, useSession }] = await Promise.all([
    import("./sign-out.js"),
    import("./use-session.js"),
  ]);
  return { signOut, isSigningOut, useSession };
}

let replace: ReturnType<typeof vi.fn>;
let originalLocation: Location;

beforeEach(() => {
  replace = vi.fn();
  originalLocation = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      pathname: "/overview",
      search: "",
      hash: "",
      origin: "https://dispatch.example.com",
      href: "https://dispatch.example.com/overview",
      host: "dispatch.example.com",
      hostname: "dispatch.example.com",
      replace,
      assign: vi.fn(),
      reload: vi.fn(),
    },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("signOut", () => {
  it("stops trusting the session before it asks the server to revoke it", async () => {
    const { signOut, isSigningOut } = await loadSignOut();
    // The reported bug: the app shell stayed authenticated for the whole
    // revoke-plus-navigate window, so its queries 401ed and painted
    // "Couldn't load data" over the app instead of landing on the auth page.
    let signingOutDuringRequest: boolean | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        signingOutDuringRequest = isSigningOut();
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    await signOut();

    expect(signingOutDuringRequest).toBe(true);
  });

  it("waits for the revoke to land before navigating away", async () => {
    const { signOut } = await loadSignOut();
    // Navigating first can abandon the request, leaving the server session
    // live — the user gets silently signed back in on their next visit.
    let settleRevoke: (() => void) | undefined;
    const revoked = new Promise<void>((resolve) => {
      settleRevoke = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await revoked;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    const pending = signOut();
    await Promise.resolve();
    expect(replace).not.toHaveBeenCalled();

    settleRevoke!();
    await pending;
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0]).toContain("/sign-in?c=");
  });

  it("notifies other tabs again after revocation settles", async () => {
    const { signOut } = await loadSignOut();
    const originalLocalStorage = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );
    const setItem = vi.fn();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { setItem },
    });
    try {
      let settleRevoke: ((response: Response) => void) | undefined;
      const revoke = new Promise<Response>((resolve) => {
        settleRevoke = resolve;
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(() => revoke),
      );

      const pending = signOut();
      await Promise.resolve();
      expect(setItem).toHaveBeenCalledTimes(1);

      settleRevoke!(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      await pending;

      expect(setItem).toHaveBeenCalledTimes(2);
    } finally {
      if (originalLocalStorage) {
        Object.defineProperty(window, "localStorage", originalLocalStorage);
      } else {
        delete (window as Window & { localStorage?: Storage }).localStorage;
      }
    }
  });

  it("reloads the current document when the revoke request fails", async () => {
    const { signOut } = await loadSignOut();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const originalLocalStorage = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );
    const setItem = vi.fn();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { setItem },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    await signOut();

    expect(window.location.reload).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    if (originalLocalStorage) {
      Object.defineProperty(window, "localStorage", originalLocalStorage);
    } else {
      delete (window as Window & { localStorage?: Storage }).localStorage;
    }
  });

  it("reloads the current document when the revoke request times out", async () => {
    const { signOut } = await loadSignOut();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.useFakeTimers();
    const originalLocalStorage = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );
    const setItem = vi.fn();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: { setItem },
    });
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal;
        return new Promise<Response>((_, reject) => {
          signal?.addEventListener("abort", () => reject(signal?.reason), {
            once: true,
          });
        });
      }),
    );

    const pending = signOut();
    await vi.runAllTimersAsync();
    await pending;

    expect(signal?.aborted).toBe(true);
    expect(window.location.reload).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Unable to complete the sign-out request",
      expect.anything(),
    );
    if (originalLocalStorage) {
      Object.defineProperty(window, "localStorage", originalLocalStorage);
    } else {
      delete (window as Window & { localStorage?: Storage }).localStorage;
    }
  });

  it("shares one revoke and redirect across concurrent calls", async () => {
    const { signOut } = await loadSignOut();
    let settleRevoke: (() => void) | undefined;
    const revoke = new Promise<void>((resolve) => {
      settleRevoke = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await revoke;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = signOut();
    const second = signOut();
    expect(first).toBe(second);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();

    settleRevoke!();
    await Promise.all([first, second]);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("uses the all-device revoke route when requested", async () => {
    const { signOut } = await loadSignOut();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await signOut({ allDevices: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "/_agent-native/auth/logout-all",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("honours an explicit destination", async () => {
    const { signOut } = await loadSignOut();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }))),
    );

    await signOut({ redirectTo: "/goodbye" });

    expect(replace).toHaveBeenCalledWith("/goodbye");
  });
});
