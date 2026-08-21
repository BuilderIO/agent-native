import { describe, expect, it } from "vitest";

import { SUPPORTED_LOCALES } from "../localization/shared.js";
import { AUTH_MARKETING_LOCALE_COPY } from "./auth-marketing-locales.js";
import { BUILT_IN_AUTH_MARKETING } from "./auth-marketing.js";

describe("auth marketing locale coverage", () => {
  it("covers every built-in marketing surface in every non-English locale", () => {
    for (const locale of SUPPORTED_LOCALES.filter(
      (candidate) => candidate !== "en-US",
    )) {
      const localeCopy = AUTH_MARKETING_LOCALE_COPY[locale];
      expect(localeCopy, locale).toBeDefined();

      for (const [slug, marketing] of Object.entries(BUILT_IN_AUTH_MARKETING)) {
        const localized = localeCopy?.[slug];
        expect(localized?.tagline, `${locale}/${slug}`).toBeTruthy();
        expect(localized?.tagline, `${locale}/${slug}`).not.toBe(
          marketing.tagline,
        );
        expect(localized?.features?.length, `${locale}/${slug}`).toBe(
          marketing.features?.length,
        );
      }
    }
  });
});
