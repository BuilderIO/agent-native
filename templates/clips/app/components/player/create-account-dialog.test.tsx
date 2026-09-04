import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildCreateAccountHref } from "./create-account-dialog";

vi.mock("@agent-native/core/client/ui", () => ({
  buildSignInReturnHref: ({ returnTo }: { returnTo?: string } = {}) =>
    `/_agent-native/sign-in?return=${encodeURIComponent(returnTo ?? "/")}`,
}));

describe("create account dialog", () => {
  it("keeps the viewer continuation while requesting the focused signup mode", () => {
    expect(buildCreateAccountHref("/share/clip-1?at=90")).toBe(
      "/_agent-native/sign-in?return=%2Fshare%2Fclip-1%3Fat%3D90&tab=signup&initialPrompt=1&embedded=1",
    );
  });

  it("composes the shared auth pattern inside the modal", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app/components/player/create-account-dialog.tsx"),
      "utf8",
    );

    expect(source).toContain("resolveNativeAuthCopy");
    expect(source).toContain("AccountGateHeader");
    expect(source).toContain('data-auth-pattern="native"');
    expect(source).toContain("sm:max-w-md");
    expect(source).toContain("copy.welcomeTitle");
    expect(source).toContain("copy.googleButton");
    expect(source).toContain("copy.sendMagicLink");
    expect(source).toContain("copy.usePasswordInstead");
    expect(source).toContain("export function AccountGateDialog");
    expect(source).toContain("data-account-gate-intent");
    expect(source).toContain('t("signInPrompt.agentTitle")');
    expect(source).toContain('t("signInPrompt.genericTitle")');
    expect(source).toContain("/_agent-native/google/auth-url");
    expect(source).toContain("/_agent-native/auth/desktop-exchange");
    expect(source).toContain("/_agent-native/auth/magic-link");
    expect(source).toContain('method: "google"');
    expect(source).not.toContain("IconBrandGoogle");
  });
});
