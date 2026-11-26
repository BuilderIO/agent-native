import { describe, expect, it, vi } from "vitest";

import { IPC } from "../../shared/ipc-channels.js";
import {
  collectDesktopHostExtensions,
  registerDesktopHostExtensions,
  type DesktopHostExtensionContext,
} from "./host-extensions.js";
import {
  onboardingIdentityScope,
  registerOnboardingIdentityIpc,
} from "./onboarding-identity.js";

function context(): DesktopHostExtensionContext {
  return {
    ipc: { handle: vi.fn() },
    isShell: () => true,
    identity: () => null,
  };
}

describe("desktop host extensions", () => {
  it("registers each extension once, in file order", () => {
    const order: string[] = [];
    const extensions = collectDesktopHostExtensions({
      "./host-extensions/b.ts": {
        hostExtension: { id: "b", register: () => order.push("b") },
      },
      "./host-extensions/a.ts": {
        hostExtension: { id: "a", register: () => order.push("a") },
      },
    });
    registerDesktopHostExtensions(extensions, context());
    expect(order).toEqual(["a", "b"]);
  });

  it("refuses a malformed module and a duplicate id", () => {
    expect(() =>
      collectDesktopHostExtensions({ "./host-extensions/x.ts": {} }),
    ).toThrow(/hostExtension/);
    const twice = { id: "same", register: vi.fn() };
    expect(() =>
      registerDesktopHostExtensions([twice, twice], context()),
    ).toThrow(/Duplicate/);
  });
});

describe("onboarding identity scope", () => {
  it("keys onboarding to the signed-in account and refuses other senders", async () => {
    const handlers = new Map<string, (event: string) => Promise<string>>();
    registerOnboardingIdentityIpc<string>(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        isShell: (event) => event === "shell",
        identity: () => ({ status: "signed-in", email: " A@Example.com " }),
      },
    );
    const handler = handlers.get(IPC.IDENTITY_ONBOARDING_SCOPE_GET);
    if (!handler) throw new Error("Scope handler was not registered");
    const scope = await handler("shell");
    expect(scope).toMatch(/^[0-9a-f]{64}$/);
    expect(scope).toBe(
      onboardingIdentityScope({ status: "signed-in", email: "a@example.com" }),
    );
    expect(scope).not.toBe(
      onboardingIdentityScope({ status: "signed-in", email: "b@example.com" }),
    );
    await expect(handler("webview")).rejects.toThrow(/not available/);
    expect(() =>
      onboardingIdentityScope({ status: "idle", email: "a@example.com" }),
    ).toThrow(/verified desktop identity/);
  });
});
