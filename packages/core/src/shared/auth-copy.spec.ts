import { describe, expect, it } from "vitest";

import { NATIVE_AUTH_COPY, resolveNativeAuthCopy } from "./auth-copy.js";

const LOCALES = Object.keys(NATIVE_AUTH_COPY) as Array<
  keyof typeof NATIVE_AUTH_COPY
>;

describe("native auth copy", () => {
  it("keeps account creation discoverable from the entry subtitle", () => {
    expect(NATIVE_AUTH_COPY["en-US"].welcomeSubtitle).toBe(
      "Sign in or create your account",
    );
    expect(NATIVE_AUTH_COPY["en-US"].welcomeSubtitle).toMatch(
      /create your account/i,
    );
  });

  it("does not reintroduce the chooser phrasing on a view with no chooser", () => {
    expect(NATIVE_AUTH_COPY["en-US"].welcomeSubtitle).not.toBe(
      "Create an account or sign in",
    );
  });

  it.each(LOCALES)("defines entry copy for %s", (locale) => {
    const copy = NATIVE_AUTH_COPY[locale];
    expect(copy.welcomeTitle.trim()).not.toBe("");
    expect(copy.welcomeToApp).toContain("{appName}");
    expect(copy.welcomeSubtitle.trim()).not.toBe("");
    expect(copy.sendMagicLink.trim()).not.toBe("");
  });

  it("keeps Google sign-in timeout copy user-facing in every locale", () => {
    for (const locale of LOCALES) {
      expect(NATIVE_AUTH_COPY[locale].googleNeverFinished).not.toMatch(
        /redirect uri|server logs|agent-native/i,
      );
    }
    expect(NATIVE_AUTH_COPY["en-US"].googleNeverFinished).toBe(
      "Unable to sign in with Google right now. Please try again or use another sign-in method.",
    );
  });

  it("falls back to the default locale for an unknown request locale", () => {
    expect(resolveNativeAuthCopy("xx-XX").welcomeSubtitle).toBe(
      NATIVE_AUTH_COPY["en-US"].welcomeSubtitle,
    );
    expect(resolveNativeAuthCopy(undefined).welcomeSubtitle).toBe(
      NATIVE_AUTH_COPY["en-US"].welcomeSubtitle,
    );
  });
});
