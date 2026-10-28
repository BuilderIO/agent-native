import { describe, expect, it } from "vitest";

import { AGENT_NATIVE_DOCS_ORIGIN, docsUrl } from "./docs-url.js";

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
    expect(
      docsUrl("getting-started", {
        source: "app",
        campaign: null,
        content: "docs-card",
        hash: "quick-start",
      }),
    ).toBe(
      `${AGENT_NATIVE_DOCS_ORIGIN}/docs?utm_source=app&utm_medium=product&utm_content=docs-card#quick-start`,
    );
    expect(docsUrl("deployment", { content: "help" })).toBe(
      `${AGENT_NATIVE_DOCS_ORIGIN}/docs/deployment?utm_source=agent-native&utm_medium=product&utm_campaign=docs&utm_content=help`,
    );
    expect(
      docsUrl("template-clips-features", {
        hash: "chrome-extension-browser-logs",
      }),
    ).toBe(
      `${AGENT_NATIVE_DOCS_ORIGIN}/docs/template-clips-features#chrome-extension-browser-logs`,
    );
  });
});
