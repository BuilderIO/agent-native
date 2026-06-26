import { describe, expect, it } from "vitest";

import { normalizeLocaleCode } from "./shared.js";

describe("localization shared helpers", () => {
  it("maps traditional Chinese browser locales to zh-TW", () => {
    expect(normalizeLocaleCode("zh-Hant")).toBe("zh-TW");
    expect(normalizeLocaleCode("zh-Hant-TW")).toBe("zh-TW");
    expect(normalizeLocaleCode("zh-HK")).toBe("zh-TW");
    expect(normalizeLocaleCode("zh-MO")).toBe("zh-TW");
  });

  it("keeps simplified Chinese browser locales on zh-CN", () => {
    expect(normalizeLocaleCode("zh-Hans")).toBe("zh-CN");
    expect(normalizeLocaleCode("zh-SG")).toBe("zh-CN");
    expect(normalizeLocaleCode("zh")).toBe("zh-CN");
  });
});
