import { describe, expect, it } from "vitest";

import { dispatchIntegrationsHref } from "./dispatch-links";

describe("dispatch integration links", () => {
  it("uses the standalone Dispatch URL when the app suite is not mounted", () => {
    expect(
      dispatchIntegrationsHref(
        "gong",
        "https://dispatch.agent-native.com/overview",
      ),
    ).toBe(
      "https://dispatch.agent-native.com/integrations?provider=gong&appId=brain&returnTo=ask",
    );
  });

  it("preserves the workspace gateway for mounted Dispatch", () => {
    expect(dispatchIntegrationsHref("hubspot", "/dispatch/overview")).toBe(
      "/dispatch/integrations?provider=hubspot&appId=brain&returnTo=ask",
    );
  });
});
