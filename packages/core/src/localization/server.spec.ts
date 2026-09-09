// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  getLocaleInitScript,
  parseAcceptLanguage,
  resolveLocaleFromRequest,
} from "./server.js";

function readHydrationPayload() {
  return (
    window as Window & {
      __AGENT_NATIVE_LOCALE__?: Record<string, unknown>;
    }
  ).__AGENT_NATIVE_LOCALE__;
}

describe("localization server helpers", () => {
  it("parses Accept-Language by q weight", () => {
    expect(parseAcceptLanguage("fr-CA, zh-CN;q=0.9, en;q=0.5")).toEqual([
      "fr-CA",
      "zh-CN",
      "en",
    ]);
  });

  it("resolves supported locale from Accept-Language", () => {
    expect(
      resolveLocaleFromRequest({
        acceptLanguage: "zh;q=0.8, fr-FR;q=0.9",
      }),
    ).toMatchObject({ locale: "fr-FR", dir: "ltr" });
  });

  it("honors explicit preference over request headers", () => {
    expect(
      resolveLocaleFromRequest({
        acceptLanguage: "zh-CN",
        preference: { locale: "de-DE" },
      }).locale,
    ).toBe("de-DE");
  });

  it("resolves app-registered locales and their direction", () => {
    expect(
      resolveLocaleFromRequest({
        acceptLanguage: "ar-EG",
        supportedLocales: ["en-US", "ar-EG"],
        localeMetadata: [
          {
            code: "ar-EG",
            englishName: "Arabic",
            nativeName: "العربية",
            dir: "rtl",
          },
        ],
      }),
    ).toMatchObject({ locale: "ar-EG", dir: "rtl" });
  });

  it("keeps invalid preferences and fallbacks inside the app registry", () => {
    expect(
      resolveLocaleFromRequest({
        acceptLanguage: "fr-FR",
        preference: { locale: "de-DE" },
        fallback: "en-US",
        supportedLocales: ["it-IT"],
      }),
    ).toMatchObject({ locale: "it-IT", preference: { locale: "system" } });

    new Function(
      getLocaleInitScript({
        preference: { locale: "de-DE" },
        supportedLocales: ["it-IT"],
      }),
    )();
    expect(document.documentElement.getAttribute("lang")).toBe("it-IT");
    expect(readHydrationPayload()).toMatchObject({
      locale: "it-IT",
      preference: { locale: "system" },
    });
  });

  it("initializes document lang and dir before hydration", () => {
    new Function(getLocaleInitScript({ locale: "ar-SA" }))();

    expect(document.documentElement.getAttribute("lang")).toBe("ar-SA");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    expect(readHydrationPayload()).toMatchObject({
      locale: "ar-SA",
      dir: "rtl",
    });
  });

  it("initializes a registered locale from metadata before hydration", () => {
    new Function(
      getLocaleInitScript({
        locale: "ar-EG",
        supportedLocales: ["en-US", "ar-EG"],
        localeMetadata: [
          {
            code: "ar-EG",
            englishName: "Arabic",
            nativeName: "العربية",
            dir: "rtl",
          },
        ],
      }),
    )();

    expect(document.documentElement.getAttribute("lang")).toBe("ar-EG");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    expect(readHydrationPayload()).toMatchObject({
      locale: "ar-EG",
      dir: "rtl",
    });
  });

  it("keeps translations out of the render-blocking payload", () => {
    const script = getLocaleInitScript({
      locale: "ja-JP",
      preference: { locale: "ja-JP" },
    });
    expect(script).not.toContain("messages");

    new Function(script)();
    expect(Object.keys(readHydrationPayload() ?? {}).sort()).toEqual([
      "dir",
      "locale",
      "preference",
    ]);
  });

  it("does not overwrite stored preference unless a preference is provided", () => {
    window.localStorage.setItem("agent-native:locale-preference", "zh-CN");

    new Function(getLocaleInitScript({ locale: "fr-FR" }))();
    expect(window.localStorage.getItem("agent-native:locale-preference")).toBe(
      "zh-CN",
    );

    new Function(
      getLocaleInitScript({
        locale: "de-DE",
        preference: { locale: "de-DE" },
      }),
    )();
    expect(window.localStorage.getItem("agent-native:locale-preference")).toBe(
      "de-DE",
    );
  });
});
