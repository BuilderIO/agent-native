import { describe, expect, it } from "vitest";

import { AGENT_NATIVE_DOCS_ORIGIN, Docs, docsUrl } from "./docs-url.js";

describe("docsUrl", () => {
  it("builds absolute docs paths from content slugs", () => {
    expect(docsUrl("deployment")).toBe(
      `${AGENT_NATIVE_DOCS_ORIGIN}/docs/deployment`,
    );
    expect(docsUrl("getting-started")).toBe(`${AGENT_NATIVE_DOCS_ORIGIN}/docs`);
    expect(docsUrl("")).toBe(`${AGENT_NATIVE_DOCS_ORIGIN}/docs`);
  });

  it("attaches hashes and optional UTM params", () => {
    expect(docsUrl("tracking", { hash: "session-replay" })).toBe(
      `${AGENT_NATIVE_DOCS_ORIGIN}/docs/tracking#session-replay`,
    );
    expect(
      docsUrl("deployment", {
        campaign: "onboarding",
        content: "deployment_settings",
      }),
    ).toBe(
      `${AGENT_NATIVE_DOCS_ORIGIN}/docs/deployment?utm_source=agent-native&utm_medium=product&utm_campaign=onboarding&utm_content=deployment_settings`,
    );
  });

  it("keeps named Docs helpers for non-obvious slug/hash targets", () => {
    expect(Docs.trackingErrors()).toBe(
      `${AGENT_NATIVE_DOCS_ORIGIN}/docs/tracking#posthog-error-tracking`,
    );
    expect(Docs.templateClipsBrowserLogs()).toBe(
      `${AGENT_NATIVE_DOCS_ORIGIN}/docs/template-clips-capture-everywhere#browser-logs-with-the-chrome-extension`,
    );
    expect(Docs.templatePlanLocalFiles()).toBe(
      `${AGENT_NATIVE_DOCS_ORIGIN}/docs/template-plan-local-and-desktop#local-files`,
    );
    expect(Docs.multiAppAdding()).toBe(
      `${AGENT_NATIVE_DOCS_ORIGIN}/docs/multi-app-workspace#adding-a-new-app`,
    );
  });
});
