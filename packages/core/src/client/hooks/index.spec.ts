// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("lets an app retry sign-out through the public hooks API after local cleanup fails", async () => {
  vi.resetModules();
  const { registerSignOutCleanup, signOut, SignOutCleanupError, isSigningOut } =
    await import("./index.js");
  const originalLocation = window.location;
  const replace = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      pathname: "/overview",
      search: "",
      hash: "",
      origin: "https://app.example.com",
      href: "https://app.example.com/overview",
      host: "app.example.com",
      hostname: "app.example.com",
      replace,
      assign: vi.fn(),
      reload: vi.fn(),
    },
  });
  const revoke = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
  vi.stubGlobal("fetch", revoke);
  const unregister = registerSignOutCleanup(() => {
    throw new Error("Local app data is locked");
  });

  try {
    await expect(signOut()).rejects.toBeInstanceOf(SignOutCleanupError);
    expect(isSigningOut()).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();

    unregister();
    await signOut();

    expect(isSigningOut()).toBe(true);
    expect(revoke).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledOnce();
  } finally {
    unregister();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  }
});
