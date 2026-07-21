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
      expect(messages.localFiles.interruptedPicker).toContain(
        "Agent Native Desktop",
      );
    }
  });

  it("names the supported Chromium browser path", () => {
    expect(messagesByLocale["en-US"].localFiles.unsupportedElectron).toBe(
      "Local folder sync is unavailable here. Use Agent Native Desktop, Chrome, Edge, or another Chromium browser.",
    );
    expect(messagesByLocale["en-US"].localFiles.unsupportedBrowser).toBe(
      messagesByLocale["en-US"].localFiles.unsupportedElectron,
    );
  });
});
