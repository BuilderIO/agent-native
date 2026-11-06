import { afterEach, describe, expect, it } from "vitest";
import {
  defineAppConfig,
  resetAppConfigForTests,
} from "../app-config/index.js";
import { getOnboardingHtml } from "./onboarding-html.js";
function readAuthPageData(html: string): { trackingApp: string } {
  const match = html.match(
    /<script type="application\/json" id="agent-native-auth-data">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("Auth data missing");
  return JSON.parse(match[1]!);
}
describe("public auth shell app identity", () => {
  afterEach(() => resetAppConfigForTests());
  it.each(["design.agent-native.com", "beta.design.agent-native.com"])(
    "identifies the public Design auth shell on %s before app config is populated",
    (requestHost) => {
      defineAppConfig({ app: {} });
      expect(
        readAuthPageData(
          getOnboardingHtml({ requestHost, requestPath: "/sign-in" }),
        ).trackingApp,
      ).toBe("design");
    },
  );

  it("keeps an explicitly configured app identity ahead of the host fallback", () => {
    defineAppConfig({ app: { slug: "custom-app" } });
    expect(
      readAuthPageData(
        getOnboardingHtml({ requestHost: "design.agent-native.com" }),
      ).trackingApp,
    ).toBe("custom-app");
  });

  it.each([
    [{ slug: " custom ", template: "design", id: "fallback" }, "custom"],
    [{ slug: " ", template: " custom ", id: "fallback" }, "custom"],
    [{ slug: " ", template: " ", id: " custom " }, "custom"],
    [{ slug: " ", template: " ", id: " " }, "design"],
  ])("uses the first nonempty configured app identity %j", (app, expected) => {
    defineAppConfig({ app });
    expect(
      readAuthPageData(
        getOnboardingHtml({ requestHost: "design.agent-native.com" }),
      ).trackingApp,
    ).toBe(expected);
  });

  it("does not assign an unknown hosted app the Design identity", () => {
    defineAppConfig({ app: {} });
    expect(
      readAuthPageData(
        getOnboardingHtml({
          requestHost: "unrelated.example.com",
          requestPath: "/sign-in",
        }),
      ).trackingApp,
    ).toBe("");
  });
});
