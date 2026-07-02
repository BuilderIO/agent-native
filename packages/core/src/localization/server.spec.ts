// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  getLocaleInitScript,
  parseAcceptLanguage,
  resolveLocaleFromRequest,
} from "./server.js";

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

  it("initializes document lang and dir before hydration", () => {
    new Function(getLocaleInitScript({ locale: "ar-SA" }))();

    expect(document.documentElement.getAttribute("lang")).toBe("ar-SA");
    expect(document.documentElement.getAttribute("dir")).toBe("rtl");
    expect(
      (window as Window & { __AGENT_NATIVE_LOCALE__?: { locale?: string } })
        .__AGENT_NATIVE_LOCALE__?.locale,
    ).toBe("ar-SA");
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
