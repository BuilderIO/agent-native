import { describe, expect, it } from "vitest";

import {
  firstPartyAppUrl,
  isBetaDocsBuild,
  isBetaDocsDeployment,
} from "./deployment-links";

describe("deployment links", () => {
  it("rewrites known first-party apps for beta docs", () => {
    expect(
      firstPartyAppUrl(
        "https://slides.agent-native.com/?initialPrompt=hello",
        true,
      ),
    ).toBe("https://beta.slides.agent-native.com/?initialPrompt=hello");
  });

  it("leaves external and production links unchanged", () => {
    expect(firstPartyAppUrl("https://nomad.galite.ai", true)).toBe(
      "https://nomad.galite.ai",
    );
    expect(firstPartyAppUrl("https://slides.agent-native.com", false)).toBe(
      "https://slides.agent-native.com",
    );
  });

  it("recognizes the beta docs host", () => {
    expect(isBetaDocsDeployment("beta.agent-native.com", "production")).toBe(
      true,
    );
    expect(isBetaDocsDeployment("www.agent-native.com", "production")).toBe(
      false,
    );
  });

  it("treats only a beta build as a beta build, whatever the host", () => {
    expect(isBetaDocsBuild("beta")).toBe(true);
    expect(isBetaDocsBuild("production")).toBe(false);
    expect(isBetaDocsBuild(undefined)).toBe(false);
  });
});
