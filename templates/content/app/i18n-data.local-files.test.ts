import { describe, expect, it } from "vitest";

import { messagesByLocale } from "./i18n-data";

describe("local folder host guidance", () => {
  it("directs every unsupported host to Agent Native Desktop", () => {
    for (const messages of Object.values(messagesByLocale)) {
      expect(messages.localFiles.unsupportedElectron).toContain(
        "Agent Native Desktop",
      );
      expect(messages.localFiles.unsupportedBrowser).toContain(
        "Agent Native Desktop",
      );
    }
  });

  it("does not claim an ordinary browser is currently supported", () => {
    expect(messagesByLocale["en-US"].localFiles.unsupportedElectron).toBe(
      "Local folder sync is unavailable here. Open this page in Agent Native Desktop. Browser folder access is not enabled yet.",
    );
    expect(messagesByLocale["en-US"].localFiles.unsupportedBrowser).toBe(
      messagesByLocale["en-US"].localFiles.unsupportedElectron,
    );
  });
});
